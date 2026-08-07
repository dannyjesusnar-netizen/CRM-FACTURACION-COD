const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { requirePlatformToken } = require('../middleware/platform');
const { passwordError } = require('../utils/password');

const router = express.Router();
router.use(requirePlatformToken);

function sinPassword(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// GET /api/platform/empresa — datos de la empresa dueña de esta instancia.
router.get('/empresa', (req, res) => {
  const empresa = db.prepare(
    'SELECT razon_social, nombre_comercial, ruc, telefono FROM empresa_config WHERE id = 1'
  ).get();
  res.json(empresa || null);
});

// GET /api/platform/users — TODAS las cuentas, no solo gerencia: una cuenta
// que ya cayó a "vendedor" por error debe seguir siendo visible para poder
// repararla desde aquí.
router.get('/users', (req, res) => {
  const rows = db.prepare(
    'SELECT id, full_name, nombres, apellidos, dni, email, role, activo FROM users ORDER BY nombres ASC, full_name ASC'
  ).all();
  res.json(rows);
});

// PUT /api/platform/users/:id/estado { activo }
router.put('/users/:id/estado', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });
  db.prepare('UPDATE users SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(sinPassword(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

// PUT /api/platform/users/:id/password { new_password }
router.put('/users/:id/password', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const { new_password } = req.body || {};
  const pwdErr = passwordError(new_password);
  if (pwdErr) return res.status(400).json({ error: pwdErr });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.params.id);
  res.json(sinPassword(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

// PUT /api/platform/users/:id/rol — restaura la cuenta a rol "gerencia".
// Pensado para el caso de una cuenta que quedó mal marcada como "vendedor"
// y ya no tiene forma de repararse a sí misma desde dentro de la app.
router.put('/users/:id/rol', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });
  db.prepare("UPDATE users SET role = 'gerencia' WHERE id = ?").run(req.params.id);
  res.json(sinPassword(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

// Empresas que se registraron desde "Registrar mi empresa" (login → botón
// Registro) en este mismo despliegue, y esperan aprobación antes de poder
// iniciar sesión — ver POST /api/auth/register y utils/tenant.js.
router.get('/registros-pendientes', (req, res) => {
  res.json(tenantRegistry.listPendientes());
});

router.get('/registros', (req, res) => {
  res.json(tenantRegistry.listTodos());
});

router.put('/registros/:ruc/aprobar', (req, res) => {
  const tenant = tenantRegistry.findTenant(req.params.ruc);
  if (!tenant) return res.status(404).json({ error: 'Registro no encontrado.' });
  res.json(tenantRegistry.aprobarTenant(req.params.ruc));
});

router.put('/registros/:ruc/rechazar', (req, res) => {
  const tenant = tenantRegistry.findTenant(req.params.ruc);
  if (!tenant) return res.status(404).json({ error: 'Registro no encontrado.' });
  res.json(tenantRegistry.rechazarTenant(req.params.ruc));
});

module.exports = router;
