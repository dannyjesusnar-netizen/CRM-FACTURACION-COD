const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('compras'));

const DESTINOS = ['centro_costo', 'ingreso_inventario'];

// GET /api/tipos-compra?q=&estado=activo|inactivo|todos
router.get('/', (req, res) => {
  const { q, estado } = req.query;
  let sql = 'SELECT * FROM tipos_compra WHERE 1=1';
  const params = [];
  if (estado === 'activo') { sql += ' AND activo = 1'; }
  else if (estado === 'inactivo') { sql += ' AND activo = 0'; }
  if (q) { sql += ' AND nombre LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAccion('compras', 'tipos_compra'), (req, res) => {
  const { categoria, nombre, glosa_observacion, clasificacion_libros, destino_compra } = req.body || {};
  if (!categoria) return res.status(400).json({ error: 'La categoría es requerida.' });
  if (!nombre) return res.status(400).json({ error: 'El nombre del tipo de compra es requerido.' });
  if (!destino_compra || !DESTINOS.includes(destino_compra)) {
    return res.status(400).json({ error: 'Selecciona el destino de compra.' });
  }
  const info = db.prepare(
    `INSERT INTO tipos_compra (categoria, nombre, glosa_observacion, clasificacion_libros, destino_compra)
     VALUES (?, ?, ?, ?, ?)`
  ).run(categoria, nombre, glosa_observacion || null, clasificacion_libros || null, destino_compra);
  res.status(201).json(db.prepare('SELECT * FROM tipos_compra WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', requireAccion('compras', 'tipos_compra'), (req, res) => {
  const existing = db.prepare('SELECT * FROM tipos_compra WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tipo de compra no encontrado.' });
  const { categoria, nombre, glosa_observacion, clasificacion_libros, destino_compra, activo } = req.body || {};
  if (!categoria) return res.status(400).json({ error: 'La categoría es requerida.' });
  if (!nombre) return res.status(400).json({ error: 'El nombre del tipo de compra es requerido.' });
  if (!destino_compra || !DESTINOS.includes(destino_compra)) {
    return res.status(400).json({ error: 'Selecciona el destino de compra.' });
  }
  db.prepare(
    `UPDATE tipos_compra SET categoria = ?, nombre = ?, glosa_observacion = ?, clasificacion_libros = ?, destino_compra = ?, activo = ?
     WHERE id = ?`
  ).run(categoria, nombre, glosa_observacion || null, clasificacion_libros || null, destino_compra, activo === false ? 0 : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM tipos_compra WHERE id = ?').get(req.params.id));
});

module.exports = router;
