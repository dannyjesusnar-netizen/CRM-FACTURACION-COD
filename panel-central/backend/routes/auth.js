const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { passwordError } = require('../utils/password');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
  }
  const admin = db.prepare('SELECT * FROM platform_admins WHERE email = ?').get(String(email).toLowerCase());
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }
  const token = jwt.sign(
    { id: admin.id, email: admin.email, full_name: admin.full_name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, admin: { id: admin.id, email: admin.email, full_name: admin.full_name } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

router.put('/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Contraseña actual y nueva contraseña son requeridas.' });
  }
  const admin = db.prepare('SELECT * FROM platform_admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(current_password, admin.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
  }
  const pwdErr = passwordError(new_password);
  if (pwdErr) {
    return res.status(400).json({ error: pwdErr });
  }
  db.prepare('UPDATE platform_admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), admin.id);
  res.json({ ok: true });
});

module.exports = router;
