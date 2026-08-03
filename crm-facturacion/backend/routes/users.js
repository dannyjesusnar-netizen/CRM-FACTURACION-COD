const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { passwordError } = require('../utils/password');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

const ROLES = ['gerencia', 'vendedor'];

function sinPassword(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// GET /api/users?q=&estado=
router.get('/', (req, res) => {
  const { q, estado } = req.query;
  let sql = 'SELECT * FROM users WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (full_name LIKE ? OR username LIKE ? OR dni LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (estado === 'activo') { sql += ' AND activo = 1'; }
  if (estado === 'inactivo') { sql += ' AND activo = 0'; }
  sql += ' ORDER BY full_name ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(sinPassword));
});

router.post('/', (req, res) => {
  const { username, password, full_name, dni, role } = req.body || {};
  if (!username || !password || !full_name || !dni) {
    return res.status(400).json({ error: 'Usuario, contraseña, nombre completo y DNI son requeridos.' });
  }
  if (!/^\d{8}$/.test(dni)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos.' });
  }
  const pwdErr = passwordError(password);
  if (pwdErr) {
    return res.status(400).json({ error: pwdErr });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: 'role inválido. Use gerencia o vendedor.' });
  }
  if (db.prepare('SELECT id FROM users WHERE dni = ?').get(dni)) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese DNI.' });
  }
  try {
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, role, dni, activo) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(username, bcrypt.hashSync(password, 10), full_name, role, dni);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(sinPassword(row));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario.' });
    }
    res.status(500).json({ error: 'Error al crear el usuario.' });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const { full_name, dni, role, password } = req.body || {};
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'role inválido. Use gerencia o vendedor.' });
  }
  if (dni && !/^\d{8}$/.test(dni)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos.' });
  }
  if (password) {
    const pwdErr = passwordError(password);
    if (pwdErr) return res.status(400).json({ error: pwdErr });
  }
  if (dni && dni !== existing.dni && db.prepare('SELECT id FROM users WHERE dni = ? AND id != ?').get(dni, req.params.id)) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese DNI.' });
  }
  db.prepare(
    'UPDATE users SET full_name = ?, dni = ?, role = ?, password_hash = ? WHERE id = ?'
  ).run(
    full_name ?? existing.full_name,
    dni ?? existing.dni,
    role ?? existing.role,
    password ? bcrypt.hashSync(password, 10) : existing.password_hash,
    req.params.id
  );
  res.json(sinPassword(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

// PUT /api/users/:id/estado { activo: true|false }
router.put('/:id/estado', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes activar/desactivar tu propia cuenta.' });
  }
  const { activo } = req.body || {};
  db.prepare('UPDATE users SET activo = ? WHERE id = ?').run(activo ? 1 : 0, req.params.id);
  res.json(sinPassword(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

module.exports = router;
