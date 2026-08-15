const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia, resolveSucursal } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);

function validar(body) {
  const { nombre, porcentaje, fecha_inicio, fecha_fin, sucursal_id } = body || {};
  if (!nombre) return 'nombre es requerido.';
  if (!(Number(porcentaje) > 0 && Number(porcentaje) <= 100)) return 'Ingresa un porcentaje entre 0 y 100.';
  if (!fecha_inicio || !fecha_fin) return 'fecha_inicio y fecha_fin son requeridas.';
  if (fecha_fin < fecha_inicio) return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
  if (sucursal_id) {
    const sede = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(sucursal_id);
    if (!sede) return 'La sede seleccionada no existe o está desactivada.';
  }
  return null;
}

// GET /api/descuentos — lista completa para Configuración → Descuentos (Gerencia).
router.get('/', requireGerencia, (req, res) => {
  const descuentos = db.prepare(
    `SELECT d.*, s.nombre AS sede_nombre FROM descuentos d
     LEFT JOIN sucursales s ON s.id = d.sucursal_id
     ORDER BY d.activo DESC, d.fecha_inicio DESC, d.id DESC`
  ).all();
  res.json(descuentos);
});

// GET /api/descuentos/activos — vigentes hoy en la sede activa (o sin sede
// asignada = todas), para el selector en Registrar Venta. Sin requireGerencia
// a propósito: cualquiera que registra una venta debe poder elegirlos.
router.get('/activos', (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const descuentos = db.prepare(
    `SELECT * FROM descuentos
     WHERE activo = 1 AND fecha_inicio <= ? AND fecha_fin >= ?
       AND (sucursal_id IS NULL OR sucursal_id = ?)
     ORDER BY nombre ASC`
  ).all(hoy, hoy, req.sucursalId);
  res.json(descuentos);
});

// POST /api/descuentos { nombre, porcentaje, sucursal_id?, fecha_inicio, fecha_fin }
router.post('/', requireGerencia, (req, res) => {
  const error = validar(req.body);
  if (error) return res.status(400).json({ error });
  const { nombre, porcentaje, sucursal_id, fecha_inicio, fecha_fin } = req.body;
  const info = db.prepare(
    `INSERT INTO descuentos (nombre, porcentaje, sucursal_id, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?, ?)`
  ).run(nombre, Number(porcentaje), sucursal_id || null, fecha_inicio, fecha_fin);
  res.status(201).json(db.prepare('SELECT * FROM descuentos WHERE id = ?').get(info.lastInsertRowid));
});

// PUT /api/descuentos/:id
router.put('/:id', requireGerencia, (req, res) => {
  const existente = db.prepare('SELECT id FROM descuentos WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Descuento no encontrado.' });
  const error = validar(req.body);
  if (error) return res.status(400).json({ error });
  const { nombre, porcentaje, sucursal_id, fecha_inicio, fecha_fin } = req.body;
  db.prepare(
    `UPDATE descuentos SET nombre = ?, porcentaje = ?, sucursal_id = ?, fecha_inicio = ?, fecha_fin = ? WHERE id = ?`
  ).run(nombre, Number(porcentaje), sucursal_id || null, fecha_inicio, fecha_fin, req.params.id);
  res.json(db.prepare('SELECT * FROM descuentos WHERE id = ?').get(req.params.id));
});

// PUT /api/descuentos/:id/estado { activo: true|false }
router.put('/:id/estado', requireGerencia, (req, res) => {
  const existente = db.prepare('SELECT id FROM descuentos WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Descuento no encontrado.' });
  db.prepare('UPDATE descuentos SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM descuentos WHERE id = ?').get(req.params.id));
});

module.exports = router;
