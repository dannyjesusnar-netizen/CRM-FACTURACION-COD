const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { ajustarStockSucursal } = require('../utils/stock');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { hoyPeru } = require('../utils/fechas');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('inventario'));
router.use(resolveSucursal);

const DIAS_ALERTA_VENCIMIENTO = 30;
// Ventanas del filtro "por vencer en N días" — separadas de "vencidos" para
// que un producto ya vencido no se mezcle con uno que recién está por
// vencer (importante para productos orgánicos/sensibles, donde 7 días de
// diferencia importa).
const VENTANAS_POR_VENCER = { por_vencer_7: 7, por_vencer_15: 15, por_vencer_30: 30 };

// Suma/resta días a una fecha ISO (YYYY-MM-DD) sin pasar por Date con hora,
// para no arrastrar el mismo bug de zona horaria que hoyPeru() ya evita.
function sumarDiasIso(fechaIso, dias) {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

// GET /api/lotes?mostrar=con_stock|todos|agotados|vencidos|por_vencer_7|por_vencer_15|por_vencer_30&q=&categoria=&tipo=
router.get('/', (req, res) => {
  const { mostrar, q, categoria, tipo } = req.query;
  const today = hoyPeru();
  let sql = `
    SELECT l.*, p.codigo AS producto_codigo, p.nombre AS producto_nombre,
           p.unidad AS producto_unidad, p.categoria AS producto_categoria
    FROM lotes l
    JOIN products p ON p.id = l.product_id
    WHERE l.activo = 1
  `;
  const params = [];
  if (mostrar === 'con_stock') { sql += ' AND l.cantidad_actual > 0'; }
  if (mostrar === 'agotados') { sql += ' AND l.cantidad_actual <= 0'; }
  if (mostrar === 'vencidos') {
    sql += ' AND l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < ?';
    params.push(today);
  } else if (VENTANAS_POR_VENCER[mostrar]) {
    // Solo lo que vence de hoy en adelante y dentro de la ventana — no
    // incluye lo ya vencido (para eso está el filtro "Vencidos").
    sql += ' AND l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento >= ? AND l.fecha_vencimiento <= ?';
    params.push(today, sumarDiasIso(today, VENTANAS_POR_VENCER[mostrar]));
  }
  if (q) { sql += ' AND (p.nombre LIKE ? OR p.codigo LIKE ? OR l.codigo_lote LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (categoria) { sql += ' AND p.categoria = ?'; params.push(categoria); }
  if (tipo) { sql += ' AND l.tipo = ?'; params.push(tipo); }
  sql += " ORDER BY (l.fecha_vencimiento IS NULL), date(l.fecha_vencimiento) ASC, p.nombre ASC";
  const rows = db.prepare(sql).all(...params);

  const alertaLimite = sumarDiasIso(today, DIAS_ALERTA_VENCIMIENTO);
  const withStatus = rows.map((r) => {
    let estado_vencimiento = 'ok';
    if (r.fecha_vencimiento) {
      if (r.fecha_vencimiento < today) estado_vencimiento = 'vencido';
      else if (r.fecha_vencimiento <= alertaLimite) estado_vencimiento = 'por_vencer';
    }
    return { ...r, estado_vencimiento };
  });
  res.json(withStatus);
});

router.post('/', requireAccion('inventario', 'lotes'), (req, res) => {
  const { product_id, codigo_lote, tipo, fecha_vencimiento, cantidad_inicial } = req.body || {};
  if (!product_id || !codigo_lote || !cantidad_inicial) {
    return res.status(400).json({ error: 'product_id, codigo_lote y cantidad_inicial son requeridos.' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  if (product.tipo !== 'producto') {
    return res.status(400).json({ error: 'Solo los productos (no servicios) pueden tener lotes/series.' });
  }

  const cantidad = Number(cantidad_inicial);
  const insertAll = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO lotes (product_id, codigo_lote, tipo, fecha_vencimiento, cantidad_inicial, cantidad_actual, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(product_id, codigo_lote, tipo || 'lote', fecha_vencimiento || null, cantidad, cantidad, req.user?.id || null);
    const loteId = info.lastInsertRowid;

    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(cantidad, product_id);
    const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(product_id).stock;
    ajustarStockSucursal(product_id, req.sucursalId, cantidad);
    db.prepare(
      `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
       VALUES (?, ?, 'ingreso_lote', ?, ?, 'Ingreso de lote/serie', ?, ?, ?)`
    ).run(product_id, loteId, cantidad, nuevoStock, codigo_lote, req.user?.id || null, req.sucursalId);

    return loteId;
  });

  const loteId = insertAll();
  const row = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  res.status(201).json(row);
});

module.exports = router;
