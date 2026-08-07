const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { siguienteNumero } = require('../utils/series');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('ventas'));

const MOTIVOS = ['venta', 'compra', 'traslado_entre_establecimientos', 'consignacion', 'otros'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

router.get('/siguiente-numero', (req, res) => {
  res.json(siguienteNumero('guia_remitente'));
});

// GET /api/guias?estado=&client_id=&from=&to=&q=
router.get('/', (req, res) => {
  const { estado, client_id, from, to, q } = req.query;
  let sql = `
    SELECT g.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento
    FROM guias_remitentes g
    LEFT JOIN clients c ON c.id = g.client_id
    WHERE 1=1
  `;
  const params = [];
  if (estado) { sql += ' AND g.estado = ?'; params.push(estado); }
  if (client_id) { sql += ' AND g.client_id = ?'; params.push(client_id); }
  if (from) { sql += ' AND date(g.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(g.created_at) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (c.nombre LIKE ? OR CAST(g.numero AS TEXT) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY g.id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const guia = db.prepare(
    `SELECT g.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento
     FROM guias_remitentes g LEFT JOIN clients c ON c.id = g.client_id WHERE g.id = ?`
  ).get(req.params.id);
  if (!guia) return res.status(404).json({ error: 'Guía no encontrada.' });
  const items = db.prepare('SELECT * FROM guia_items WHERE guia_id = ?').all(req.params.id);
  res.json({ ...guia, items });
});

router.post('/', requireAccion('ventas', 'guia_remision'), (req, res) => {
  const {
    client_id, items, motivo_traslado, punto_partida, punto_llegada,
    cantidad_bultos, observaciones, numero: numeroManual,
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  const motivo = motivo_traslado || 'venta';
  if (!MOTIVOS.includes(motivo)) {
    return res.status(400).json({ error: 'motivo_traslado inválido.' });
  }
  if (client_id) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });
  }

  let pesoTotal = 0;
  const preparedItems = items.map((it) => {
    const cantidad = Number(it.cantidad || 1);
    const peso_unitario = Number(it.peso_unitario || 0);
    const peso_subtotal = round2(cantidad * peso_unitario);
    pesoTotal += peso_subtotal;
    return {
      product_id: it.product_id || null,
      descripcion: it.descripcion || '',
      cantidad,
      peso_unitario,
      peso_subtotal,
    };
  });
  pesoTotal = round2(pesoTotal);

  const { serie, numero: numeroSugerido } = siguienteNumero('guia_remitente');
  const insertAll = db.transaction(() => {
    const numero = numeroManual ? Number(numeroManual) : numeroSugerido;
    const info = db.prepare(
      `INSERT INTO guias_remitentes (serie, numero, motivo_traslado, client_id, punto_partida, punto_llegada, peso_total, cantidad_bultos, estado, observaciones, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'emitida', ?, ?)`
    ).run(
      serie,
      numero,
      motivo,
      client_id || null,
      punto_partida || null,
      punto_llegada || null,
      pesoTotal,
      Number(cantidad_bultos || 0),
      observaciones || null,
      req.user?.id || null
    );
    const guiaId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO guia_items (guia_id, product_id, descripcion, cantidad, peso_unitario, peso_subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const it of preparedItems) {
      insertItem.run(guiaId, it.product_id, it.descripcion, it.cantidad, it.peso_unitario, it.peso_subtotal);
    }
    return guiaId;
  });

  const guiaId = insertAll();
  const guia = db.prepare('SELECT * FROM guias_remitentes WHERE id = ?').get(guiaId);
  const guiaItems = db.prepare('SELECT * FROM guia_items WHERE guia_id = ?').all(guiaId);
  res.status(201).json({ ...guia, items: guiaItems });
});

router.post('/:id/anular', (req, res) => {
  const guia = db.prepare('SELECT * FROM guias_remitentes WHERE id = ?').get(req.params.id);
  if (!guia) return res.status(404).json({ error: 'Guía no encontrada.' });
  if (guia.estado === 'anulada') return res.status(400).json({ error: 'La guía ya está anulada.' });
  db.prepare("UPDATE guias_remitentes SET estado = 'anulada' WHERE id = ?").run(req.params.id);
  res.json(db.prepare('SELECT * FROM guias_remitentes WHERE id = ?').get(req.params.id));
});

module.exports = router;
