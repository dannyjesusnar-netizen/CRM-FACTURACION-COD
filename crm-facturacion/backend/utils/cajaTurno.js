const db = require('../db');
const { esGerenciaOSupervisor } = require('./permisos');

// ¿Este usuario tiene un turno de caja abierto (sin cerrar) en esta sede
// ahora mismo? Ver routes/planilla.js: POST /abrir y /cerrar.
function tieneTurnoAbierto(userId, sucursalId) {
  return !!db.prepare(
    'SELECT 1 FROM caja_turnos WHERE created_by = ? AND sucursal_id = ? AND cerrado_at IS NULL'
  ).get(userId, sucursalId);
}

// Exige haber abierto el turno de caja del día (pantalla Planillas) antes de
// registrar una venta o un movimiento manual de Caja — así ningún cobro
// queda "suelto" fuera de un turno. Gerencia y el rol personalizado
// "Supervisor" quedan exentos, mismo criterio que el resto del sistema
// (esGerenciaOSupervisor): a ellos no se les pide fichar para poder operar.
function requireTurnoCajaAbierto(req, res, next) {
  if (esGerenciaOSupervisor(req.user)) return next();
  if (tieneTurnoAbierto(req.user.id, req.sucursalId)) return next();
  return res.status(403).json({ error: 'Debes abrir tu turno de caja (pantalla Planillas) antes de registrar esto.' });
}

module.exports = { tieneTurnoAbierto, requireTurnoCajaAbierto };
