const db = require('../db');
const { hoyPeru } = require('./fechas');

// Único punto de verdad para el % de descuento global de una venta: el
// cliente nunca puede mandar el porcentaje a mano — solo puede elegir un
// descuento_id de Configuración → Descuentos, y este helper resuelve el %
// real desde la base de datos (vigente hoy, activo, y de esta sede o de
// todas). Si no manda descuento_id, el descuento es 0 — ya no existe la
// opción de escribir un % libre.
function resolverDescuentoPct(descuentoId, sucursalId) {
  if (!descuentoId) return 0;
  const hoy = hoyPeru();
  const descuento = db.prepare(
    `SELECT * FROM descuentos
     WHERE id = ? AND activo = 1 AND fecha_inicio <= ? AND fecha_fin >= ?
       AND (sucursal_id IS NULL OR sucursal_id = ?)`
  ).get(descuentoId, hoy, hoy, sucursalId);
  if (!descuento) {
    const err = new Error('El descuento seleccionado ya no está disponible (venció, se desactivó, o no aplica a esta sede).');
    err.status = 400;
    throw err;
  }
  return descuento.porcentaje;
}

module.exports = { resolverDescuentoPct };
