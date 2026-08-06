const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { incrementarStock, ajustarStockSucursal, round2 } = require('../utils/stock');
const { requirePermiso, requireAccion } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('compras'));
router.use(resolveSucursal);

const IGV_RATE = 0.18;
const FORMAS_PAGO = ['efectivo', 'tarjeta', 'banco'];

function nextNumero() {
  const row = db.prepare('SELECT MAX(numero) AS maxNum FROM purchases').get();
  return (row.maxNum || 0) + 1;
}

// GET /api/purchases?estado=&supplier_id=&from=&to=&q=
router.get('/', (req, res) => {
  const { estado, supplier_id, from, to, q } = req.query;
  let sql = `
    SELECT p.*, s.nombre AS proveedor_nombre, s.ruc AS proveedor_ruc,
           u.full_name AS usuario_nombre
    FROM purchases p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN users u ON u.id = p.created_by
    WHERE p.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
  if (supplier_id) { sql += ' AND p.supplier_id = ?'; params.push(supplier_id); }
  if (from) { sql += ' AND date(p.fecha) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(p.fecha) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (s.nombre LIKE ? OR s.ruc LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY p.fecha DESC, p.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const purchase = db.prepare(
    `SELECT p.*, s.nombre AS proveedor_nombre, s.ruc AS proveedor_ruc
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ? AND p.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada.' });
  const items = db.prepare(
    `SELECT pi.*, pr.nombre AS producto_nombre, pr.codigo AS producto_codigo
     FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ?`
  ).all(req.params.id);
  res.json({ ...purchase, items });
});

router.post('/', requireAccion('compras', 'registrar_compra'), (req, res) => {
  const { supplier_id, items, fecha, forma_pago, observaciones } = req.body || {};

  if (!supplier_id) return res.status(400).json({ error: 'supplier_id es requerido.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  if (forma_pago && !FORMAS_PAGO.includes(forma_pago)) {
    return res.status(400).json({ error: 'forma_pago invalida. Use efectivo, tarjeta o banco.' });
  }

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
  if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado.' });

  let total = 0;
  const preparedItems = [];
  for (const it of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) return res.status(404).json({ error: `Producto ${it.product_id} no encontrado.` });
    if (product.tipo !== 'producto' || product.stock === null) {
      return res.status(400).json({ error: `${product.nombre} es un servicio y no maneja stock.` });
    }
    const cantidad = Number(it.cantidad || 0);
    const costo_unitario = Number(it.costo_unitario || 0);
    if (cantidad <= 0) return res.status(400).json({ error: 'La cantidad de cada item debe ser mayor a 0.' });
    const lineTotal = round2(cantidad * costo_unitario);
    total += lineTotal;
    preparedItems.push({ product_id: product.id, cantidad, costo_unitario, subtotal: lineTotal });
  }

  total = round2(total);
  const subtotal = round2(total / (1 + IGV_RATE));
  const igv = round2(total - subtotal);

  const insertAll = db.transaction(() => {
    const numero = nextNumero();
    const info = db.prepare(
      `INSERT INTO purchases (numero, supplier_id, created_by, fecha, forma_pago, subtotal, igv, total, estado, observaciones, sucursal_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'registrada', ?, ?)`
    ).run(
      numero,
      supplier_id,
      req.user?.id || null,
      fecha || new Date().toISOString().slice(0, 10),
      forma_pago || 'efectivo',
      subtotal,
      igv,
      total,
      observaciones || null,
      req.sucursalId
    );
    const purchaseId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, cantidad, costo_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?)`
    );
    const referencia = `COMPRA-${String(numero).padStart(5, '0')}`;

    for (const it of preparedItems) {
      insertItem.run(purchaseId, it.product_id, it.cantidad, it.costo_unitario, it.subtotal);
      incrementarStock(it.product_id, it.cantidad, {
        tipoMovimiento: 'compra',
        motivo: `Compra a ${supplier.nombre}`,
        referencia,
        userId: req.user?.id,
        sucursalId: req.sucursalId,
      });
    }
    return purchaseId;
  });

  const purchaseId = insertAll();
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
  const purchaseItems = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchaseId);
  res.status(201).json({ ...purchase, items: purchaseItems });
});

router.post('/:id/anular', requireAccion('compras', 'anular_compra'), (req, res) => {
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada.' });
  if (purchase.estado === 'anulada') {
    return res.status(400).json({ error: 'La compra ya esta anulada.' });
  }
  const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(req.params.id);
  for (const it of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (product && product.stock < it.cantidad) {
      return res.status(409).json({
        error: `No se puede anular: ${product.nombre} ya no tiene stock suficiente (parte de esta compra ya fue vendida o trasladada).`,
      });
    }
  }
  const referencia = `COMPRA-${String(purchase.numero).padStart(5, '0')}`;
  db.transaction(() => {
    db.prepare("UPDATE purchases SET estado = 'anulada' WHERE id = ?").run(req.params.id);
    for (const it of items) {
      incrementarStock(it.product_id, -it.cantidad, {
        tipoMovimiento: 'anulacion_compra',
        motivo: 'Anulación de compra',
        referencia,
        userId: req.user?.id,
        sucursalId: purchase.sucursal_id,
      });
    }
  })();
  const updated = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
