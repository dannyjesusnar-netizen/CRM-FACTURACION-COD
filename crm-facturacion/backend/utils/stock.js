const db = require('../db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Descuenta `cantidad` del stock de un producto, consumiendo primero de los
// lotes/series disponibles por FEFO (First-Expired-First-Out); si no hay
// lotes suficientes, descuenta el resto del stock agregado. Registra cada
// paso en stock_movements. Debe invocarse dentro de un db.transaction(...).
function consumirStock(productId, cantidad, { tipoMovimiento, motivo, referencia, userId, invoiceItemId } = {}) {
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!prod || prod.tipo !== 'producto' || prod.stock === null) return;

  const lotesDisponibles = db.prepare(
    `SELECT * FROM lotes WHERE product_id = ? AND activo = 1 AND cantidad_actual > 0
     ORDER BY (fecha_vencimiento IS NULL), date(fecha_vencimiento) ASC, id ASC`
  ).all(productId);

  let restante = cantidad;
  for (const lote of lotesDisponibles) {
    if (restante <= 0) break;
    const consumir = Math.min(lote.cantidad_actual, restante);
    db.prepare('UPDATE lotes SET cantidad_actual = cantidad_actual - ? WHERE id = ?').run(consumir, lote.id);
    if (invoiceItemId) {
      db.prepare('INSERT INTO invoice_item_lotes (invoice_item_id, lote_id, cantidad) VALUES (?, ?, ?)').run(invoiceItemId, lote.id, consumir);
    }
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(consumir, productId);
    const stockTrasLote = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
    db.prepare(
      `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, lote.id, tipoMovimiento, -consumir, stockTrasLote, `${motivo} (lote ${lote.codigo_lote})`, referencia || null, userId || null);
    restante -= consumir;
  }

  if (restante > 0) {
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(restante, productId);
    const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
    db.prepare(
      `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, tipoMovimiento, -restante, nuevoStock, motivo, referencia || null, userId || null);
  }
}

// Incrementa el stock agregado de un producto y registra el movimiento.
function incrementarStock(productId, cantidad, { tipoMovimiento, motivo, referencia, userId } = {}) {
  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(cantidad, productId);
  const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
  db.prepare(
    `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, tipoMovimiento, cantidad, nuevoStock, motivo, referencia || null, userId || null);
}

// --- Stock por sucursal (para Traslados) ---
// El stock agregado en `products.stock` sigue siendo la fuente de verdad para
// ventas/kardex. `sucursal_stock` sólo registra cómo se distribuye ese total
// entre sucursales. Si un producto nunca tuvo un traslado, se asume que todo
// su stock agregado está en la sucursal principal.
function getStockSucursal(productId, sucursalId) {
  const row = db.prepare('SELECT stock FROM sucursal_stock WHERE product_id = ? AND sucursal_id = ?').get(productId, sucursalId);
  if (row) return row.stock;
  const suc = db.prepare('SELECT es_principal FROM sucursales WHERE id = ?').get(sucursalId);
  if (suc && suc.es_principal) {
    const prod = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId);
    return prod ? (prod.stock || 0) : 0;
  }
  return 0;
}

function setStockSucursal(productId, sucursalId, stock) {
  db.prepare(
    `INSERT INTO sucursal_stock (product_id, sucursal_id, stock) VALUES (?, ?, ?)
     ON CONFLICT(product_id, sucursal_id) DO UPDATE SET stock = excluded.stock`
  ).run(productId, sucursalId, round2(stock));
}

module.exports = { consumirStock, incrementarStock, getStockSucursal, setStockSucursal, round2 };
