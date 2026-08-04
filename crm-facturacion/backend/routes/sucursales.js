const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/sucursales?todas=1 (incluye desactivadas, para el panel de Gerencia)
router.get('/', (req, res) => {
  const sql = req.query.todas
    ? 'SELECT * FROM sucursales ORDER BY es_principal DESC, nombre ASC'
    : 'SELECT * FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, nombre ASC';
  res.json(db.prepare(sql).all());
});

router.post('/', requireGerencia, (req, res) => {
  const { nombre, direccion } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  try {
    const info = db.prepare('INSERT INTO sucursales (nombre, direccion) VALUES (?, ?)').run(nombre, direccion || null);
    res.status(201).json(db.prepare('SELECT * FROM sucursales WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: 'Ya existe una sucursal con ese nombre.' });
  }
});

router.put('/:id', requireGerencia, (req, res) => {
  const existing = db.prepare('SELECT * FROM sucursales WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Sucursal no encontrada.' });
  const { nombre, direccion } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  try {
    db.prepare('UPDATE sucursales SET nombre = ?, direccion = ? WHERE id = ?').run(nombre, direccion || null, req.params.id);
    res.json(db.prepare('SELECT * FROM sucursales WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(400).json({ error: 'Ya existe una sucursal con ese nombre.' });
  }
});

// PUT /api/sucursales/:id/estado { activo: true|false }
router.put('/:id/estado', requireGerencia, (req, res) => {
  const existing = db.prepare('SELECT * FROM sucursales WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Sucursal no encontrada.' });
  if (existing.es_principal && req.body?.activo === false) {
    return res.status(400).json({ error: 'No puedes desactivar la sede principal.' });
  }
  db.prepare('UPDATE sucursales SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM sucursales WHERE id = ?').get(req.params.id));
});

module.exports = router;
