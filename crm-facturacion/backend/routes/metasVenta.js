const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

// GET /api/metas-venta?anio=&mes= — metas del mes, una fila por empleado
// que ya tiene una asignada (el frontend completa 0 para el resto).
router.get('/', (req, res) => {
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = Number(req.query.mes) || new Date().getMonth() + 1;
  const rows = db.prepare(
    'SELECT user_id, monto_meta FROM metas_venta WHERE anio = ? AND mes = ?'
  ).all(anio, mes);
  res.json(rows);
});

// PUT /api/metas-venta { user_id, anio, mes, monto_meta } — upsert.
router.put('/', (req, res) => {
  const { user_id, anio, mes, monto_meta } = req.body || {};
  if (!user_id || !anio || !mes) {
    return res.status(400).json({ error: 'user_id, anio y mes son requeridos.' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'Empleado no encontrado.' });
  const monto = Number(monto_meta) || 0;
  db.prepare(
    `INSERT INTO metas_venta (user_id, anio, mes, monto_meta) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, anio, mes) DO UPDATE SET monto_meta = excluded.monto_meta`
  ).run(user_id, anio, mes, monto);
  res.json({ user_id: Number(user_id), anio: Number(anio), mes: Number(mes), monto_meta: monto });
});

module.exports = router;
