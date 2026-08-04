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
  let sql = `SELECT u.*, s.nombre AS sucursal_nombre, r.nombre AS rol_personalizado_nombre
             FROM users u
             LEFT JOIN sucursales s ON s.id = u.sucursal_id
             LEFT JOIN roles r ON r.id = u.custom_role_id
             WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ' AND (u.full_name LIKE ? OR u.nombres LIKE ? OR u.apellidos LIKE ? OR u.username LIKE ? OR u.dni LIKE ? OR u.email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (estado === 'activo') { sql += ' AND u.activo = 1'; }
  if (estado === 'inactivo') { sql += ' AND u.activo = 0'; }
  sql += ' ORDER BY u.nombres ASC, u.full_name ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(sinPassword));
});

function sucursalIdOrError(sucursalId) {
  if (sucursalId === undefined || sucursalId === null || sucursalId === '') return { value: null };
  const suc = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(Number(sucursalId));
  if (!suc) return { error: 'La sede seleccionada no existe o está desactivada.' };
  return { value: suc.id };
}

function customRoleIdOrError(customRoleId) {
  if (customRoleId === undefined || customRoleId === null || customRoleId === '') return { value: null };
  const role = db.prepare('SELECT id FROM roles WHERE id = ? AND activo = 1').get(Number(customRoleId));
  if (!role) return { error: 'El rol seleccionado no existe o está desactivado.' };
  return { value: role.id };
}

router.post('/', (req, res) => {
  const { username, password, nombres, apellidos, email, telefono, dni, role, sucursal_id, custom_role_id } = req.body || {};
  if (!username || !password || !nombres || !apellidos || !dni) {
    return res.status(400).json({ error: 'Usuario, contraseña, nombres, apellidos y DNI son requeridos.' });
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
  const sucursal = sucursalIdOrError(sucursal_id);
  if (sucursal.error) return res.status(400).json({ error: sucursal.error });
  const customRole = customRoleIdOrError(custom_role_id);
  if (customRole.error) return res.status(400).json({ error: customRole.error });
  const fullName = `${nombres} ${apellidos}`.trim();
  try {
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, full_name, nombres, apellidos, email, telefono, role, dni, activo, sucursal_id, custom_role_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(username, bcrypt.hashSync(password, 10), fullName, nombres, apellidos, email || null, telefono || null, role, dni, sucursal.value, customRole.value);
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
  const { nombres, apellidos, email, telefono, dni, role, password, sucursal_id, custom_role_id } = req.body || {};
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
  let sucursalId = existing.sucursal_id;
  if (sucursal_id !== undefined) {
    const sucursal = sucursalIdOrError(sucursal_id);
    if (sucursal.error) return res.status(400).json({ error: sucursal.error });
    sucursalId = sucursal.value;
  }
  let customRoleId = existing.custom_role_id;
  if (custom_role_id !== undefined) {
    const customRole = customRoleIdOrError(custom_role_id);
    if (customRole.error) return res.status(400).json({ error: customRole.error });
    customRoleId = customRole.value;
  }
  const nombresFinal = nombres ?? existing.nombres;
  const apellidosFinal = apellidos ?? existing.apellidos;
  const fullName = `${nombresFinal || ''} ${apellidosFinal || ''}`.trim() || existing.full_name;
  db.prepare(
    `UPDATE users SET full_name = ?, nombres = ?, apellidos = ?, email = ?, telefono = ?, dni = ?, role = ?, password_hash = ?, sucursal_id = ?, custom_role_id = ?
     WHERE id = ?`
  ).run(
    fullName,
    nombresFinal,
    apellidosFinal,
    email !== undefined ? (email || null) : existing.email,
    telefono !== undefined ? (telefono || null) : existing.telefono,
    dni ?? existing.dni,
    role ?? existing.role,
    password ? bcrypt.hashSync(password, 10) : existing.password_hash,
    sucursalId,
    customRoleId,
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
