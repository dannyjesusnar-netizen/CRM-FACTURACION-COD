const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

const CATEGORIAS = ['vendedor', 'trainer'];

// GET /api/metas-venta?anio=&mes= — una fila por sede activa x categoría,
// con el monto del pool ya asignado (0 si no hay ninguno todavía), cuántos
// empleados activos de esa categoría tiene la sede (informativo) y la
// dotación asignada a mano (0 si no se asignó ninguna todavía), para que el
// frontend pueda mostrar de una vez la meta individual aproximada
// (pool / dotación, o pool / empleados activos si no hay dotación).
router.get('/', (req, res) => {
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = Number(req.query.mes) || new Date().getMonth() + 1;

  const sedes = db.prepare('SELECT id, nombre FROM sucursales WHERE activo = 1 ORDER BY nombre ASC').all();
  const conteos = db.prepare(
    `SELECT sucursal_id, categoria_staff, COUNT(*) AS cantidad FROM users
     WHERE activo = 1 AND sucursal_id IS NOT NULL AND categoria_staff IN ('vendedor', 'trainer')
     GROUP BY sucursal_id, categoria_staff`
  ).all();
  const conteoMap = new Map(conteos.map((c) => [`${c.sucursal_id}:${c.categoria_staff}`, c.cantidad]));
  const metas = db.prepare(
    'SELECT sucursal_id, categoria_staff, monto_meta, dotacion FROM metas_venta_sede WHERE anio = ? AND mes = ?'
  ).all(anio, mes);
  const metaMap = new Map(metas.map((m) => [`${m.sucursal_id}:${m.categoria_staff}`, m]));

  const filas = [];
  for (const sede of sedes) {
    for (const categoria of CATEGORIAS) {
      const key = `${sede.id}:${categoria}`;
      const meta = metaMap.get(key);
      filas.push({
        sucursal_id: sede.id,
        sede_nombre: sede.nombre,
        categoria_staff: categoria,
        cantidad_empleados: conteoMap.get(key) || 0,
        monto_meta: meta?.monto_meta || 0,
        dotacion: meta?.dotacion || 0,
      });
    }
  }
  res.json(filas);
});

// PUT /api/metas-venta { sucursal_id, categoria_staff, anio, mes, monto_meta?, dotacion? }
// — upsert del pool y/o la dotación de esa sede/categoría/mes. Cada campo
// omitido conserva el valor que ya tenía la fila (o 0 si es nueva), para que
// el frontend pueda guardar el monto y la dotación por separado sin pisarse.
router.put('/', (req, res) => {
  const { sucursal_id, categoria_staff, anio, mes, monto_meta, dotacion } = req.body || {};
  if (!sucursal_id || !anio || !mes) {
    return res.status(400).json({ error: 'sucursal_id, anio y mes son requeridos.' });
  }
  if (!CATEGORIAS.includes(categoria_staff)) {
    return res.status(400).json({ error: 'categoria_staff inválida. Use vendedor o trainer.' });
  }
  const sede = db.prepare('SELECT id FROM sucursales WHERE id = ?').get(sucursal_id);
  if (!sede) return res.status(404).json({ error: 'Sede no encontrada.' });

  const existente = db.prepare(
    'SELECT monto_meta, dotacion FROM metas_venta_sede WHERE sucursal_id = ? AND categoria_staff = ? AND anio = ? AND mes = ?'
  ).get(sucursal_id, categoria_staff, anio, mes);
  const monto = monto_meta !== undefined ? Number(monto_meta) || 0 : (existente?.monto_meta || 0);
  const dotacionValor = dotacion !== undefined ? Math.max(0, Math.trunc(Number(dotacion)) || 0) : (existente?.dotacion || 0);

  db.prepare(
    `INSERT INTO metas_venta_sede (sucursal_id, categoria_staff, anio, mes, monto_meta, dotacion) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sucursal_id, categoria_staff, anio, mes) DO UPDATE SET monto_meta = excluded.monto_meta, dotacion = excluded.dotacion`
  ).run(sucursal_id, categoria_staff, anio, mes, monto, dotacionValor);
  res.json({
    sucursal_id: Number(sucursal_id), categoria_staff, anio: Number(anio), mes: Number(mes),
    monto_meta: monto, dotacion: dotacionValor,
  });
});

module.exports = router;
