const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { MODULOS } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

function conPermisos(role) {
  const filas = db.prepare('SELECT modulo, habilitado FROM role_permisos WHERE role_id = ?').all(role.id);
  const porModulo = {};
  filas.forEach((f) => { porModulo[f.modulo] = !!f.habilitado; });
  const permisos = MODULOS.map((m) => ({ modulo: m.key, label: m.label, habilitado: !!porModulo[m.key] }));
  return { ...role, permisos };
}

// GET /api/roles?q=&estado=
router.get('/', (req, res) => {
  const { q, estado } = req.query;
  let sql = 'SELECT * FROM roles WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (nombre LIKE ? OR descripcion LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (estado === 'activo') sql += ' AND activo = 1';
  if (estado === 'inactivo') sql += ' AND activo = 0';
  sql += ' ORDER BY nombre ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(conPermisos));
});

router.get('/modulos', (req, res) => {
  res.json(MODULOS);
});

router.get('/:id', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rol no encontrado.' });
  res.json(conPermisos(role));
});

function guardarPermisos(roleId, permisos) {
  const upsert = db.prepare(
    `INSERT INTO role_permisos (role_id, modulo, habilitado) VALUES (?, ?, ?)
     ON CONFLICT(role_id, modulo) DO UPDATE SET habilitado = excluded.habilitado`
  );
  const modulosValidos = new Set(MODULOS.map((m) => m.key));
  for (const [modulo, habilitado] of Object.entries(permisos || {})) {
    if (!modulosValidos.has(modulo)) continue;
    upsert.run(roleId, modulo, habilitado ? 1 : 0);
  }
}

router.post('/', (req, res) => {
  const { nombre, descripcion, permisos } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  const info = db.prepare(
    'INSERT INTO roles (nombre, descripcion, created_by) VALUES (?, ?, ?)'
  ).run(nombre, descripcion || null, req.user?.id || null);
  guardarPermisos(info.lastInsertRowid, permisos);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(conPermisos(role));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rol no encontrado.' });
  const { nombre, descripcion, permisos } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  db.prepare('UPDATE roles SET nombre = ?, descripcion = ? WHERE id = ?').run(nombre, descripcion || null, req.params.id);
  if (permisos) guardarPermisos(req.params.id, permisos);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  res.json(conPermisos(role));
});

// PUT /api/roles/:id/estado { activo: true|false }
router.put('/:id/estado', (req, res) => {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rol no encontrado.' });
  db.prepare('UPDATE roles SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(conPermisos(db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id)));
});

module.exports = router;
