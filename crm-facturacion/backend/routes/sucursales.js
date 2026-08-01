const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, nombre ASC').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { nombre, direccion } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  try {
    const info = db.prepare('INSERT INTO sucursales (nombre, direccion) VALUES (?, ?)').run(nombre, direccion || null);
    res.status(201).json(db.prepare('SELECT * FROM sucursales WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: 'Ya existe una sucursal con ese nombre.' });
  }
});

module.exports = router;
