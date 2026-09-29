const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('compras'));

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(
      `SELECT * FROM suppliers WHERE nombre LIKE ? OR ruc LIKE ? ORDER BY nombre ASC`
    ).all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM suppliers ORDER BY nombre ASC').all();
  }
  res.json(rows);
});

router.post('/', requireAccion('compras', 'proveedores'), (req, res) => {
  const { ruc, nombre, direccion, telefono, email } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  const info = db.prepare(
    'INSERT INTO suppliers (ruc, nombre, direccion, telefono, email) VALUES (?, ?, ?, ?, ?)'
  ).run(ruc || null, nombre, direccion || null, telefono || null, email || null);
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/:id', requireAccion('compras', 'proveedores'), (req, res) => {
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado.' });
  const { ruc, nombre, direccion, telefono, email } = req.body || {};
  db.prepare(
    'UPDATE suppliers SET ruc = ?, nombre = ?, direccion = ?, telefono = ?, email = ? WHERE id = ?'
  ).run(
    ruc ?? existing.ruc,
    nombre ?? existing.nombre,
    direccion ?? existing.direccion,
    telefono ?? existing.telefono,
    email ?? existing.email,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  res.json(row);
});

router.delete('/:id', requireAccion('compras', 'proveedores'), (req, res) => {
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado.' });
  const used = db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ?').get(req.params.id).n;
  if (used > 0) {
    return res.status(409).json({ error: 'No se puede eliminar: el proveedor tiene compras asociadas.' });
  }
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
