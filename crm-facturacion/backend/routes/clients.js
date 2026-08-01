const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(
      `SELECT * FROM clients WHERE nombre LIKE ? OR numero_documento LIKE ? ORDER BY nombre ASC`
    ).all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM clients ORDER BY nombre ASC').all();
  }
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const invoices = db.prepare(
    'SELECT * FROM invoices WHERE client_id = ? ORDER BY fecha_emision DESC'
  ).all(req.params.id);
  res.json({ ...row, invoices });
});

router.post('/', (req, res) => {
  const { tipo_documento, numero_documento, nombre, direccion, telefono, email, notas } = req.body || {};
  if (!numero_documento || !nombre) {
    return res.status(400).json({ error: 'numero_documento y nombre son requeridos.' });
  }
  try {
    const info = db.prepare(
      `INSERT INTO clients (tipo_documento, numero_documento, nombre, direccion, telefono, email, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(tipo_documento || 'DNI', numero_documento, nombre, direccion || null, telefono || null, email || null, notas || null);
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un cliente con ese tipo y numero de documento.' });
    }
    res.status(500).json({ error: 'Error al crear cliente.' });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const { tipo_documento, numero_documento, nombre, direccion, telefono, email, notas } = req.body || {};
  try {
    db.prepare(
      `UPDATE clients SET tipo_documento = ?, numero_documento = ?, nombre = ?, direccion = ?, telefono = ?, email = ?, notas = ?
       WHERE id = ?`
    ).run(
      tipo_documento ?? existing.tipo_documento,
      numero_documento ?? existing.numero_documento,
      nombre ?? existing.nombre,
      direccion ?? existing.direccion,
      telefono ?? existing.telefono,
      email ?? existing.email,
      notas ?? existing.notas,
      req.params.id
    );
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar cliente.' });
  }
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const used = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?').get(req.params.id).n;
  if (used > 0) {
    return res.status(409).json({ error: 'No se puede eliminar: el cliente tiene comprobantes asociados.' });
  }
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
