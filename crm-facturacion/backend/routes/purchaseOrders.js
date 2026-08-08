const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { round2, incrementarStock } = require('../utils/stock');
const { requirePermiso, requireAccion } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('compras'));
router.use(resolveSucursal);

const MONEDAS = ['PEN', 'USD'];
const TIPOS_COMPRA = ['mercaderia', 'servicio', 'activo_fijo', 'envase_embalaje', 'otros'];
const TIPOS_OPERACION = ['gravada_exportacion', 'no_gravada', 'sin_derecho_credito', 'no_gravado'];
const AFECTACIONES_IGV = ['gravado', 'exonerado', 'inafecto'];

function igvRate() {
  const row = db.prepare('SELECT igv_rate FROM empresa_config WHERE id = 1').get();
  return Number(row?.igv_rate) || 0.18;
}

function nextNumero() {
  const row = db.prepare('SELECT MAX(numero) AS maxNum FROM purchase_orders').get();
  return (row.maxNum || 0) + 1;
}

// GET /api/purchase-orders?estado=&from=&to=&q=
router.get('/', (req, res) => {
  const { estado, from, to, q } = req.query;
  let sql = `
    SELECT po.*, s.nombre AS proveedor_nombre, s.ruc AS proveedor_ruc,
           u.full_name AS usuario_nombre, suc.nombre AS sucursal_nombre
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN users u ON u.id = po.created_by
    LEFT JOIN sucursales suc ON suc.id = po.sucursal_id
    WHERE po.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (estado) { sql += ' AND po.estado = ?'; params.push(estado); }
  if (from) { sql += ' AND date(po.fecha) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(po.fecha) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (s.nombre LIKE ? OR s.ruc LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY po.fecha DESC, po.id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const order = db.prepare(
    `SELECT po.*, s.nombre AS proveedor_nombre, s.ruc AS proveedor_ruc
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ? AND po.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!order) return res.status(404).json({ error: 'Orden de compra no encontrada.' });
  const items = db.prepare(
    `SELECT oi.*, pr.nombre AS producto_nombre, pr.codigo AS producto_codigo
     FROM purchase_order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.purchase_order_id = ?`
  ).all(req.params.id);
  res.json({ ...order, items });
});

router.post('/', requireAccion('compras', 'registrar_compra'), (req, res) => {
  const {
    supplier_id, items, fecha, observaciones,
    serie, numero_doc, moneda, tipo_cambio,
    tipo_compra, tipo_operacion, descuento_pct, percepcion,
  } = req.body || {};

  if (!supplier_id) return res.status(400).json({ error: 'Selecciona un proveedor.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  if (!serie) return res.status(400).json({ error: 'La serie del documento es requerida.' });
  if (!numero_doc) return res.status(400).json({ error: 'El número del documento es requerido.' });
  if (!fecha) return res.status(400).json({ error: 'La fecha de emisión es requerida.' });
  if (!moneda || !MONEDAS.includes(moneda)) {
    return res.status(400).json({ error: 'Selecciona la moneda.' });
  }
  const tipoCambio = moneda === 'USD' ? Number(tipo_cambio || 0) : 1;
  if (moneda === 'USD' && tipoCambio <= 0) {
    return res.status(400).json({ error: 'Ingresa un tipo de cambio válido.' });
  }
  if (!tipo_compra || !TIPOS_COMPRA.includes(tipo_compra)) {
    return res.status(400).json({ error: 'Selecciona el tipo de compra.' });
  }
  if (!tipo_operacion || !TIPOS_OPERACION.includes(tipo_operacion)) {
    return res.status(400).json({ error: 'Selecciona el destino de la operación (Compra).' });
  }
  const descuentoPct = Number(descuento_pct || 0);
  if (descuentoPct < 0 || descuentoPct > 100) {
    return res.status(400).json({ error: 'El descuento debe estar entre 0 y 100%.' });
  }
  const percepcionMonto = round2(Number(percepcion || 0));
  if (percepcionMonto < 0) return res.status(400).json({ error: 'La percepción no puede ser negativa.' });

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
  if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado.' });

  const rate = igvRate();
  let subtotalGravado = 0;
  let igvTotal = 0;
  let noGravado = 0;
  const preparedItems = [];
  for (const it of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) return res.status(404).json({ error: `Producto ${it.product_id} no encontrado.` });
    const cantidad = Number(it.cantidad || 0);
    const costo_unitario = Number(it.costo_unitario || 0);
    if (cantidad <= 0) return res.status(400).json({ error: 'La cantidad de cada item debe ser mayor a 0.' });
    const afectacion_igv = AFECTACIONES_IGV.includes(it.afectacion_igv) ? it.afectacion_igv : 'gravado';
    const unidad = (it.unidad || 'UND').toString().slice(0, 20);

    const lineBruta = round2(cantidad * costo_unitario);
    const lineNeta = round2(lineBruta * (1 - descuentoPct / 100));
    if (afectacion_igv === 'gravado') {
      const igvLinea = round2(lineNeta - lineNeta / (1 + rate));
      subtotalGravado += lineNeta - igvLinea;
      igvTotal += igvLinea;
    } else {
      noGravado += lineNeta;
    }

    preparedItems.push({
      product_id: product.id, cantidad, costo_unitario, subtotal: lineBruta,
      observacion: it.observacion || null, unidad, afectacion_igv,
    });
  }

  subtotalGravado = round2(subtotalGravado);
  igvTotal = round2(igvTotal);
  noGravado = round2(noGravado);
  const total = round2(subtotalGravado + igvTotal + noGravado + percepcionMonto);

  const insertAll = db.transaction(() => {
    const numero = nextNumero();
    const info = db.prepare(
      `INSERT INTO purchase_orders (
         numero, supplier_id, created_by, fecha, serie, numero_doc, moneda, tipo_cambio,
         tipo_compra, tipo_operacion, descuento_pct, percepcion, subtotal, igv, no_gravado, total,
         estado, observaciones, sucursal_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`
    ).run(
      numero, supplier_id, req.user?.id || null, fecha, serie, numero_doc, moneda, tipoCambio,
      tipo_compra, tipo_operacion, descuentoPct, percepcionMonto, subtotalGravado, igvTotal, noGravado, total,
      observaciones || null, req.sucursalId
    );
    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, cantidad, costo_unitario, subtotal, observacion, unidad, afectacion_igv)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of preparedItems) {
      insertItem.run(orderId, it.product_id, it.cantidad, it.costo_unitario, it.subtotal, it.observacion, it.unidad, it.afectacion_igv);
    }
    return orderId;
  });

  const orderId = insertAll();
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(orderId);
  res.status(201).json({ ...order, items: orderItems });
});

router.post('/:id/anular', requireAccion('compras', 'anular_compra'), (req, res) => {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!order) return res.status(404).json({ error: 'Orden de compra no encontrada.' });
  if (order.estado !== 'pendiente') {
    return res.status(400).json({ error: 'Solo se pueden anular órdenes pendientes.' });
  }
  db.prepare("UPDATE purchase_orders SET estado = 'anulada' WHERE id = ?").run(req.params.id);
  res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id));
});

// POST /api/purchase-orders/:id/recibir — convierte la orden pendiente en una
// recepción real: ingresa el stock de cada item y marca la orden como recibida.
router.post('/:id/recibir', requireAccion('compras', 'registrar_compra'), (req, res) => {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!order) return res.status(404).json({ error: 'Orden de compra no encontrada.' });
  if (order.estado !== 'pendiente') {
    return res.status(400).json({ error: 'Esta orden ya fue recibida o anulada.' });
  }
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(order.supplier_id);
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(order.id);
  const fechaRecepcion = (req.body && req.body.fecha_recepcion) || new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    db.prepare(
      "UPDATE purchase_orders SET estado = 'recibida', fecha_recepcion = ? WHERE id = ?"
    ).run(fechaRecepcion, order.id);
    const referencia = `OC-${String(order.numero).padStart(5, '0')}`;
    for (const it of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!product || product.stock === null) continue; // servicios no manejan stock
      incrementarStock(it.product_id, it.cantidad, {
        tipoMovimiento: 'compra',
        motivo: `Recepción de orden de compra a ${supplier?.nombre || 'proveedor'}`,
        referencia,
        userId: req.user?.id,
        sucursalId: order.sucursal_id,
      });
    }
  })();

  const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(order.id);
  res.json(updated);
});

module.exports = router;
