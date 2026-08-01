const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildInvoicePdf } = require('../utils/pdf');
const { consumirStock } = require('../utils/stock');

const router = express.Router();
router.use(requireAuth);

const IGV_RATE = 0.18;

const SERIES_BY_TIPO = {
  factura: 'F001',
  boleta: 'B001',
  nota_credito: 'FC01',
};

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function nextNumero(tipo_comprobante, serie) {
  const row = db.prepare(
    'SELECT MAX(numero) AS maxNum FROM invoices WHERE tipo_comprobante = ? AND serie = ?'
  ).get(tipo_comprobante, serie);
  return (row.maxNum || 0) + 1;
}

// GET /api/invoices?tipo=&estado=&client_id=&from=&to=&q=
router.get('/', (req, res) => {
  const { tipo, estado, client_id, from, to, q } = req.query;
  let sql = `
    SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
           u.full_name AS vendedor_nombre
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN users u ON u.id = i.created_by
    WHERE 1=1
  `;
  const params = [];
  if (tipo) { sql += ' AND i.tipo_comprobante = ?'; params.push(tipo); }
  if (estado) { sql += ' AND i.estado = ?'; params.push(estado); }
  if (client_id) { sql += ' AND i.client_id = ?'; params.push(client_id); }
  if (from) { sql += ' AND date(i.fecha_emision) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(i.fecha_emision) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (c.nombre LIKE ? OR c.numero_documento LIKE ? OR i.serie LIKE ? OR CAST(i.numero AS TEXT) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY i.fecha_emision DESC, i.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const invoice = db.prepare(
    `SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion
     FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
  ).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  res.json({ ...invoice, items });
});

const FORMAS_PAGO = ['efectivo', 'tarjeta', 'banco'];

router.post('/', (req, res) => {
  const { tipo_comprobante, client_id, items, moneda, observaciones, fecha_emision, forma_pago } = req.body || {};

  if (!['factura', 'boleta', 'nota_credito'].includes(tipo_comprobante)) {
    return res.status(400).json({ error: 'tipo_comprobante invalido. Use factura, boleta o nota_credito.' });
  }
  if (!client_id) return res.status(400).json({ error: 'client_id es requerido.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  if (forma_pago && !FORMAS_PAGO.includes(forma_pago)) {
    return res.status(400).json({ error: 'forma_pago invalida. Use efectivo, tarjeta o banco.' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });

  if (tipo_comprobante === 'factura' && client.tipo_documento !== 'RUC') {
    return res.status(400).json({ error: 'Para emitir factura el cliente debe tener RUC.' });
  }

  let totalConIgv = 0;
  const preparedItems = items.map((it) => {
    const cantidad = Number(it.cantidad || 1);
    const precio_unitario = Number(it.precio_unitario || 0);
    const lineTotal = round2(cantidad * precio_unitario);
    totalConIgv += lineTotal;
    return {
      product_id: it.product_id || null,
      descripcion: it.descripcion || '',
      cantidad,
      precio_unitario,
      subtotal: lineTotal,
    };
  });

  const total = round2(totalConIgv);
  const subtotal = round2(total / (1 + IGV_RATE));
  const igv = round2(total - subtotal);

  const serie = SERIES_BY_TIPO[tipo_comprobante];

  const insertAll = db.transaction(() => {
    const numero = nextNumero(tipo_comprobante, serie);
    const info = db.prepare(
      `INSERT INTO invoices (tipo_comprobante, serie, numero, client_id, created_by, fecha_emision, moneda, subtotal, igv, total, estado, observaciones, forma_pago)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitido', ?, ?)`
    ).run(
      tipo_comprobante,
      serie,
      numero,
      client_id,
      req.user?.id || null,
      fecha_emision || new Date().toISOString().slice(0, 10),
      moneda || 'PEN',
      subtotal,
      igv,
      total,
      observaciones || null,
      forma_pago || 'efectivo'
    );
    const invoiceId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const referenciaComprobante = `${serie}-${String(numero).padStart(6, '0')}`;

    for (const it of preparedItems) {
      const itemInfo = insertItem.run(invoiceId, it.product_id, it.descripcion, it.cantidad, it.precio_unitario, it.subtotal);
      const invoiceItemId = itemInfo.lastInsertRowid;

      if (it.product_id) {
        consumirStock(it.product_id, it.cantidad, {
          tipoMovimiento: 'venta',
          motivo: `Venta - ${tipo_comprobante}`,
          referencia: referenciaComprobante,
          userId: req.user?.id,
          invoiceItemId,
        });
      }
    }
    return invoiceId;
  });

  const invoiceId = insertAll();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  res.status(201).json({ ...invoice, items: invoiceItems });
});

router.post('/:id/anular', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  if (invoice.estado === 'anulado') {
    return res.status(400).json({ error: 'El comprobante ya esta anulado.' });
  }
  db.prepare("UPDATE invoices SET estado = 'anulado' WHERE id = ?").run(req.params.id);
  const referenciaComprobante = `${invoice.serie}-${String(invoice.numero).padStart(6, '0')}`;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  for (const it of items) {
    if (it.product_id) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (prod && prod.tipo === 'producto' && prod.stock !== null) {
        // Restaurar exactamente los lotes/series de donde se descontó esta venta
        const itemLotes = db.prepare('SELECT * FROM invoice_item_lotes WHERE invoice_item_id = ?').all(it.id);
        for (const il of itemLotes) {
          db.prepare('UPDATE lotes SET cantidad_actual = cantidad_actual + ? WHERE id = ?').run(il.cantidad, il.lote_id);
        }
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.cantidad, it.product_id);
        const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product_id).stock;
        db.prepare(
          `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by)
           VALUES (?, ?, 'anulacion', ?, ?, 'Anulación de comprobante', ?, ?)`
        ).run(it.product_id, itemLotes[0]?.lote_id || null, it.cantidad, nuevoStock, referenciaComprobante, req.user?.id || null);
      }
    }
  }
  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.get('/:id/pdf', (req, res) => {
  const invoice = db.prepare(
    `SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion
     FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`
  ).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.serie}-${invoice.numero}.pdf"`);
  const doc = buildInvoicePdf(invoice, items);
  doc.pipe(res);
  doc.end();
});

module.exports = router;
