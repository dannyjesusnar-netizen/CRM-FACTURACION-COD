const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { siguienteNumero } = require('../utils/series');
const { consumirStock, incrementarStock, StockInsuficienteError } = require('../utils/stock');
const { buildNotaVentaPdf } = require('../utils/pdf');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('ventas'));
router.use(resolveSucursal);

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

router.get('/siguiente-numero', (req, res) => {
  res.json(siguienteNumero('nota_venta', req.sucursalId));
});

// GET /api/notas-venta?estado=&client_id=&from=&to=&q=&forma_pago=
// "subtotal" e "igv" se devuelven como alias de total/0 — la Nota de Venta
// no tiene desglose de IGV (no es un comprobante fiscal) — así el frontend
// puede mostrarla en la misma tabla que facturas/boletas sin casos especiales.
router.get('/', (req, res) => {
  const { estado, client_id, from, to, q, forma_pago } = req.query;
  let sql = `
    SELECT nv.*, nv.total AS subtotal, 0 AS igv,
           c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
           u.full_name AS vendedor_nombre
    FROM notas_venta nv
    LEFT JOIN clients c ON c.id = nv.client_id
    LEFT JOIN users u ON u.id = nv.created_by
    WHERE nv.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (estado) { sql += ' AND nv.estado = ?'; params.push(estado); }
  if (client_id) { sql += ' AND nv.client_id = ?'; params.push(client_id); }
  if (from) { sql += ' AND date(nv.fecha_emision) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(nv.fecha_emision) <= date(?)'; params.push(to); }
  if (forma_pago) { sql += ' AND nv.forma_pago = ?'; params.push(forma_pago); }
  if (q) {
    sql += ' AND (c.nombre LIKE ? OR c.numero_documento LIKE ? OR CAST(nv.numero AS TEXT) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY nv.fecha_emision DESC, nv.id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const nv = db.prepare(
    `SELECT nv.*, nv.total AS subtotal, 0 AS igv,
            c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento, c.direccion AS cliente_direccion,
            c.tipo_documento AS cliente_tipo_documento
     FROM notas_venta nv LEFT JOIN clients c ON c.id = nv.client_id
     WHERE nv.id = ? AND nv.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  const items = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(req.params.id);
  res.json({ ...nv, items });
});

router.post('/', requireAccion('ventas', 'nota_venta'), (req, res) => {
  const {
    client_id, items, moneda, observaciones, fecha_emision,
    descuento_global_pct, numero: numeroManual, forma_pago,
  } = req.body || {};

  if (!client_id) return res.status(400).json({ error: 'client_id es requerido.' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  for (const it of items) {
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio_unitario);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return res.status(400).json({ error: 'Cantidad inválida en un item.' });
    if (!Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: 'Precio unitario inválido en un item.' });
  }

  const descuentoGlobalPct = Math.min(100, Math.max(0, Number(descuento_global_pct || 0)));

  // Sin IGV: el total de cada línea es el importe final tal cual, sin
  // separar impuesto — es exactamente lo que diferencia a este documento
  // de una Boleta/Factura reales.
  let totalBruto = 0;
  const preparedItems = items.map((it) => {
    const cantidad = Number(it.cantidad);
    const precio_unitario = Number(it.precio_unitario);
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

  const { serie, numero: numeroSugerido } = siguienteNumero('nota_venta', req.sucursalId);
  const referencia = `${serie}-${String(numeroManual || numeroSugerido).padStart(6, '0')}`;

  const insertAll = db.transaction(() => {
    const numero = numeroManual ? Number(numeroManual) : numeroSugerido;
    const info = db.prepare(
      `INSERT INTO notas_venta (serie, numero, client_id, created_by, sucursal_id, fecha_emision, moneda, descuento_global_pct, total, forma_pago, estado, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitido', ?)`
    ).run(
      serie,
      numero,
      client_id,
      req.user?.id || null,
      req.sucursalId,
      fecha_emision || new Date().toISOString().slice(0, 10),
      moneda || 'PEN',
      descuentoGlobalPct,
      total,
      forma_pago || 'efectivo',
      observaciones || null
    );
    const notaVentaId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO nota_venta_items (nota_venta_id, product_id, descripcion, cantidad, precio_unitario, descuento_pct, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of preparedItems) {
      insertItem.run(notaVentaId, it.product_id, it.descripcion, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal);
      if (it.product_id) {
        consumirStock(it.product_id, it.cantidad, {
          tipoMovimiento: 'venta',
          motivo: 'Venta - nota de venta (sin IGV)',
          referencia,
          userId: req.user?.id,
          sucursalId: req.sucursalId,
        });
      }
    }
    return notaVentaId;
  });

  let notaVentaId;
  try {
    notaVentaId = insertAll();
  } catch (err) {
    if (err instanceof StockInsuficienteError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  const nv = db.prepare('SELECT *, total AS subtotal, 0 AS igv FROM notas_venta WHERE id = ?').get(notaVentaId);
  const nvItems = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(notaVentaId);
  res.status(201).json({ ...nv, items: nvItems });
});

router.post('/:id/anular', requireAccion('ventas', 'anular_comprobante'), (req, res) => {
  const nv = db.prepare('SELECT * FROM notas_venta WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  if (nv.estado === 'anulado') return res.status(400).json({ error: 'La nota de venta ya está anulada.' });

  const items = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(nv.id);
  const referencia = `${nv.serie}-${String(nv.numero).padStart(6, '0')}`;
  const anular = db.transaction(() => {
    for (const it of items) {
      if (it.product_id) {
        incrementarStock(it.product_id, it.cantidad, {
          tipoMovimiento: 'anulacion',
          motivo: 'Anulación de nota de venta',
          referencia,
          userId: req.user?.id,
          sucursalId: req.sucursalId,
        });
      }
    }
    db.prepare("UPDATE notas_venta SET estado = 'anulado' WHERE id = ?").run(nv.id);
  });
  anular();
  res.json(db.prepare('SELECT *, total AS subtotal, 0 AS igv FROM notas_venta WHERE id = ?').get(nv.id));
});

router.get('/:id/pdf', async (req, res) => {
  const nv = db.prepare(
    `SELECT nv.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion
     FROM notas_venta nv LEFT JOIN clients c ON c.id = nv.client_id
     WHERE nv.id = ? AND nv.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  const items = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(nv.id);
  const empresa = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nv.serie}-${String(nv.numero).padStart(6, '0')}.pdf"`);
  const doc = await buildNotaVentaPdf(nv, items, empresa);
  doc.pipe(res);
  doc.end();
});

module.exports = router;
