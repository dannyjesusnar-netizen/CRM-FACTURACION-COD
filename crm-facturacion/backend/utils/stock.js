const db = require('../db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Error específico para que las rutas puedan distinguir "no hay stock en esta
// sede" (409, mensaje al usuario) de un error inesperado (500).
class StockInsuficienteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StockInsuficienteError';
  }
}

// Descuenta `cantidad` del stock de un producto, consumiendo primero de los
// lotes/series disponibles por FEFO (First-Expired-First-Out); si no hay
// lotes suficientes, descuenta el resto del stock agregado. Registra cada
// paso en stock_movements. Debe invocarse dentro de un db.transaction(...).
//
// Si se indica sucursalId, ademas valida y descuenta el stock real de esa
// sede en `sucursal_stock` (separacion real por sede: una venta en Miraflores
// no puede vender lo que solo existe en San Isidro). El seguimiento de lotes/
// vencimientos sigue siendo unico por producto (no por sede).
function consumirStock(productId, cantidad, { tipoMovimiento, motivo, referencia, userId, invoiceItemId, sucursalId } = {}) {
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!prod || prod.tipo !== 'producto' || prod.stock === null) return;

  if (sucursalId) {
    const disponible = getStockSucursal(productId, sucursalId);
    if (cantidad > disponible) {
      throw new StockInsuficienteError(
        `Stock insuficiente en esta sede para "${prod.nombre}" (disponible: ${disponible}, solicitado: ${cantidad}).`
      );
    }
  }

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
      `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, lote.id, tipoMovimiento, -consumir, stockTrasLote, `${motivo} (lote ${lote.codigo_lote})`, referencia || null, userId || null, sucursalId || null);
    restante -= consumir;
  }

  if (restante > 0) {
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(restante, productId);
    const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
    db.prepare(
      `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, tipoMovimiento, -restante, nuevoStock, motivo, referencia || null, userId || null, sucursalId || null);
  }

  if (sucursalId) {
    setStockSucursal(productId, sucursalId, getStockSucursal(productId, sucursalId) - cantidad);
  }
}

// Incrementa el stock agregado de un producto y registra el movimiento. Si se
// indica sucursalId, tambien incrementa el stock real de esa sede.
function incrementarStock(productId, cantidad, { tipoMovimiento, motivo, referencia, userId, sucursalId } = {}) {
  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(cantidad, productId);
  const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock;
  db.prepare(
    `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, tipoMovimiento, cantidad, nuevoStock, motivo, referencia || null, userId || null, sucursalId || null);

  if (sucursalId) {
    setStockSucursal(productId, sucursalId, getStockSucursal(productId, sucursalId) + cantidad);
  }
}

// Ajusta directamente el stock por sede sin pasar por consumirStock/incrementarStock
// (usado por reversiones de anulacion, que ya insertan su propio stock_movement).
function ajustarStockSucursal(productId, sucursalId, delta) {
  if (!sucursalId) return;
  setStockSucursal(productId, sucursalId, getStockSucursal(productId, sucursalId) + delta);
}

function getSucursalPrincipalId() {
  const row = db.prepare('SELECT id FROM sucursales WHERE es_principal = 1').get()
    || db.prepare('SELECT id FROM sucursales ORDER BY id ASC LIMIT 1').get();
  return row ? row.id : null;
}

// --- Stock por sucursal ---
// `sucursal_stock` es la fuente real de cuanto stock hay fisicamente en cada
// sede (usado para vender, comprar, ajustar y trasladar). Si un producto
// nunca tuvo movimiento propio en una sede, es 0 alli. La migracion en
// db.js se encarga de crear la fila inicial de la sede principal para
// productos que ya tenian stock antes de existir sedes reales — sin eso,
// cualquier fallback "en tiempo de lectura" hacia products.stock termina
// leyendo el agregado ya mutado a mitad de una venta/compra y duplica el
// movimiento (ver historial: bug real encontrado en pruebas).
function getStockSucursal(productId, sucursalId) {
  const row = db.prepare('SELECT stock FROM sucursal_stock WHERE product_id = ? AND sucursal_id = ?').get(productId, sucursalId);
  return row ? row.stock : 0;
}

function setStockSucursal(productId, sucursalId, stock) {
  db.prepare(
    `INSERT INTO sucursal_stock (product_id, sucursal_id, stock) VALUES (?, ?, ?)
     ON CONFLICT(product_id, sucursal_id) DO UPDATE SET stock = excluded.stock`
  ).run(productId, sucursalId, round2(stock));
}

module.exports = {
  consumirStock, incrementarStock, getStockSucursal, setStockSucursal, ajustarStockSucursal,
  getSucursalPrincipalId, StockInsuficienteError, round2,
};
