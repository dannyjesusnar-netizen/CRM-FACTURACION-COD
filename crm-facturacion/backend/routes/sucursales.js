const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { sembrarSeriesParaSucursal } = require('../utils/series');

const router = express.Router();
router.use(requireAuth);

// Tope de sedes del plan contratado. Se configura por variable de entorno
// (MAX_SUCURSALES) al desplegar la instancia de un cliente — no es algo que
// Gerencia pueda cambiar desde la app, para que el límite acordado con el
// cliente sea real. Sin la variable configurada, no hay límite.
const MAX_SUCURSALES = Number.isInteger(Number(process.env.MAX_SUCURSALES)) && Number(process.env.MAX_SUCURSALES) > 0
  ? Number(process.env.MAX_SUCURSALES)
  : null;

// GET /api/sucursales?todas=1 (incluye desactivadas, para el panel de Gerencia)
router.get('/', (req, res) => {
  const sql = req.query.todas
    ? 'SELECT * FROM sucursales ORDER BY es_principal DESC, nombre ASC'
    : 'SELECT * FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, nombre ASC';
  res.json(db.prepare(sql).all());
});

// GET /api/sucursales/limite -> { max, actual } para que la UI muestre
// "X de Y sedes usadas" y deshabilite "Nueva sede" al llegar al tope.
router.get('/limite', (req, res) => {
  const actual = db.prepare('SELECT COUNT(*) AS n FROM sucursales').get().n;
  res.json({ max: MAX_SUCURSALES, actual });
});

router.post('/', requireGerencia, (req, res) => {
  const { nombre, direccion } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (MAX_SUCURSALES !== null) {
    const actual = db.prepare('SELECT COUNT(*) AS n FROM sucursales').get().n;
    if (actual >= MAX_SUCURSALES) {
      return res.status(400).json({ error: `Llegaste al máximo de sedes de tu plan (${MAX_SUCURSALES}). Contacta a tu proveedor para ampliarlo.` });
    }
  }
  try {
    const info = db.prepare('INSERT INTO sucursales (nombre, direccion) VALUES (?, ?)').run(nombre, direccion || null);
    // Cada sede necesita su propia serie por tipo de documento (SUNAT no
    // permite compartirla entre puntos de emisión distintos).
    sembrarSeriesParaSucursal(info.lastInsertRowid);
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
