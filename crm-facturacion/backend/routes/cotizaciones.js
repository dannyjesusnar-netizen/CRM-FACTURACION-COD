const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('ventas'));

const IGV_RATE = 0.18;
const SERIE = 'CL02';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function nextNumero() {
  const row = db.prepare('SELECT MAX(numero) AS maxNum FROM cotizaciones WHERE serie = ?').get(SERIE);
  return (row.maxNum || 0) + 1;
}

router.get('/siguiente-numero', (req, res) => {
  res.json({ serie: SERIE, numero: nextNumero() });
});

// GET /api/cotizaciones?estado=&client_id=&from=&to=&q=
router.get('/', (req, res) => {
  const { estado, client_id, from, to, q } = req.query;
  let sql = `
    SELECT co.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento
    FROM cotizaciones co
    LEFT JOIN clients c ON c.id = co.client_id
    WHERE 1=1
  `;
  const params = [];
  if (estado) { sql += ' AND co.estado = ?'; params.push(estado); }
  if (client_id) { sql += ' AND co.client_id = ?'; params.push(client_id); }
  if (from) { sql += ' AND date(co.fecha_emision) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(co.fecha_emision) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (c.nombre LIKE ? OR c.numero_documento LIKE ? OR CAST(co.numero AS TEXT) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY co.fecha_emision DESC, co.id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const cot = db.prepare(
    `SELECT co.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento
     FROM cotizaciones co LEFT JOIN clients c ON c.id = co.client_id WHERE co.id = ?`
  ).get(req.params.id);
  if (!cot) return res.status(404).json({ error: 'Cotización no encontrada.' });
  const items = db.prepare('SELECT * FROM cotizacion_items WHERE cotizacion_id = ?').all(req.params.id);
  res.json({ ...cot, items });
});

router.post('/', requireAccion('ventas', 'cotizacion'), (req, res) => {
  const { client_id, items, moneda, observaciones, fecha_emision, descuento_global_pct, numero: numeroManual } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  if (client_id) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });
  }

  const descuentoGlobalPct = Math.min(100, Math.max(0, Number(descuento_global_pct || 0)));

  let totalBruto = 0;
  const preparedItems = items.map((it) => {
    const cantidad = Number(it.cantidad || 1);
    const precio_unitario = Number(it.precio_unitario || 0);
    const descuentoPct = Math.min(100, Math.max(0, Number(it.descuento_pct || 0)));
    const lineBruta = cantidad * precio_unitario;
    const lineNeta = round2(lineBruta - lineBruta * (descuentoPct / 100));
    totalBruto += lineNeta;
    return {
      product_id: it.product_id || null,
      descripcion: it.descripcion || '',
      cantidad,
      precio_unitario,
      descuento_pct: descuentoPct,
      subtotal: lineNeta,
    };
  });

  totalBruto = round2(totalBruto);
  const total = round2(totalBruto * (1 - descuentoGlobalPct / 100));
  const subtotal = round2(total / (1 + IGV_RATE));
  const igv = round2(total - subtotal);

  const insertAll = db.transaction(() => {
    const numero = numeroManual ? Number(numeroManual) : nextNumero();
    const info = db.prepare(
      `INSERT INTO cotizaciones (serie, numero, client_id, created_by, fecha_emision, moneda, subtotal, igv, descuento_global_pct, total, estado, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'vigente', ?)`
    ).run(
      SERIE,
      numero,
      client_id || null,
      req.user?.id || null,
      fecha_emision || new Date().toISOString().slice(0, 10),
      moneda || 'PEN',
      subtotal,
      igv,
      descuentoGlobalPct,
      total,
      observaciones || null
    );
    const cotizacionId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO cotizacion_items (cotizacion_id, product_id, descripcion, cantidad, precio_unitario, descuento_pct, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of preparedItems) {
      insertItem.run(cotizacionId, it.product_id, it.descripcion, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal);
    }
    return cotizacionId;
  });

  const cotizacionId = insertAll();
  const cot = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(cotizacionId);
  const cotItems = db.prepare('SELECT * FROM cotizacion_items WHERE cotizacion_id = ?').all(cotizacionId);
  res.status(201).json({ ...cot, items: cotItems });
});

router.post('/:id/anular', (req, res) => {
  const cot = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!cot) return res.status(404).json({ error: 'Cotización no encontrada.' });
  if (cot.estado === 'anulada') return res.status(400).json({ error: 'La cotización ya está anulada.' });
  db.prepare("UPDATE cotizaciones SET estado = 'anulada' WHERE id = ?").run(req.params.id);
  res.json(db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id));
});

module.exports = router;
