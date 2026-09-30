const db = require('../db');

// Valida que un usuario pueda recibir la atribución de una venta (columna
// invoices.atribuido_a / notas_venta.atribuido_a) — Trainers, Supervisores,
// Vendedores y Gerencia, activos, de la misma sede (o sin sede asignada).
// Mismo criterio que GET /api/invoices/entrenadores, usado tanto al emitir
// (POST /) como al reatribuir después (PUT /:id/atribuido-a) en
// routes/invoices.js y routes/notasVenta.js.
function usuarioAtribuible(userId, sucursalId) {
  return db.prepare(
    `SELECT id FROM users WHERE id = ? AND activo = 1
       AND (categoria_staff IN ('trainer', 'supervisor', 'vendedor') OR role = 'gerencia')
       AND (sucursal_id IS NULL OR sucursal_id = ?)`
  ).get(userId, sucursalId);
}

module.exports = { usuarioAtribuible };
