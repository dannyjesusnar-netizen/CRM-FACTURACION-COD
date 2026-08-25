const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('inventario'));

// GET /api/tipos-inventario?q=&estado=activo|inactivo|todos
router.get('/', (req, res) => {
  const { q, estado } = req.query;
  let sql = 'SELECT * FROM tipos_inventario WHERE 1=1';
  const params = [];
  if (estado === 'activo') { sql += ' AND activo = 1'; }
  else if (estado === 'inactivo') { sql += ' AND activo = 0'; }
  if (q) { sql += ' AND nombre LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY nombre ASC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAccion('inventario', 'tipos_inventario'), (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del tipo de inventario es requerido.' });
  try {
    const info = db.prepare('INSERT INTO tipos_inventario (nombre) VALUES (?)').run(nombre.trim());
    res.status(201).json(db.prepare('SELECT * FROM tipos_inventario WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un tipo de inventario con ese nombre.' });
    }
    res.status(500).json({ error: 'No se pudo crear el tipo de inventario.' });
  }
});

router.put('/:id', requireAccion('inventario', 'tipos_inventario'), (req, res) => {
  const existing = db.prepare('SELECT * FROM tipos_inventario WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tipo de inventario no encontrado.' });
  const { nombre, activo } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del tipo de inventario es requerido.' });
  try {
    db.prepare('UPDATE tipos_inventario SET nombre = ?, activo = ? WHERE id = ?')
      .run(nombre.trim(), activo === false ? 0 : 1, req.params.id);
    res.json(db.prepare('SELECT * FROM tipos_inventario WHERE id = ?').get(req.params.id));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un tipo de inventario con ese nombre.' });
    }
    res.status(500).json({ error: 'No se pudo actualizar el tipo de inventario.' });
  }
});

module.exports = router;
