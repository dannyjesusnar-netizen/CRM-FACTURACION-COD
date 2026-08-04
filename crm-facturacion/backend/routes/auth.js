const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { passwordError } = require('../utils/password');
const { permisosDeUsuario } = require('../utils/permisos');

const router = express.Router();

router.post('/login', (req, res) => {
  const { ruc, dni, password } = req.body || {};
  if (!ruc || !dni || !password) {
    return res.status(400).json({ error: 'RUC, DNI y contraseña son requeridos.' });
  }
  // Si la empresa aun no configuro su RUC (primer ingreso tras desplegar), no
  // bloqueamos por RUC para no dejar a Gerencia sin forma de entrar y configurarlo.
  const empresa = db.prepare('SELECT ruc FROM empresa_config WHERE id = 1').get();
  if (empresa && empresa.ruc && empresa.ruc !== ruc) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE dni = ?').get(dni);
  if (!user) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }
  if (!user.activo) {
    return res.status(403).json({ error: 'Esta cuenta está desactivada. Contacta a un administrador.' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  const sucursalFija = user.sucursal_id
    ? db.prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(user.sucursal_id)
    : null;
  res.json({
    token,
    user: {
      id: user.id, username: user.username, full_name: user.full_name, role: user.role, dni: user.dni,
      sucursal_id: sucursalFija?.id || null, sucursal_nombre: sucursalFija?.nombre || null,
      custom_role_id: user.custom_role_id || null,
      permisos: permisosDeUsuario(user),
    }
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put('/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Contraseña actual y nueva contraseña son requeridas.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
  }
  const pwdErr = passwordError(new_password);
  if (pwdErr) {
    return res.status(400).json({ error: pwdErr });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ ok: true });
});

module.exports = router;
