const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');

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
  res.json({
    token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, dni: user.dni }
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
