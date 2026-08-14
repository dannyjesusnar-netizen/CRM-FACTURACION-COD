const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

const CATEGORIAS = ['vendedor', 'trainer'];

// GET /api/metas-venta?anio=&mes= — una fila por sede activa x categoría,
// con el monto del pool ya asignado (0 si no hay ninguno todavía) y cuántos
// empleados activos de esa categoría tiene la sede, para que el frontend
// pueda mostrar de una vez la meta individual aproximada (pool / cantidad).
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
    'SELECT sucursal_id, categoria_staff, monto_meta FROM metas_venta_sede WHERE anio = ? AND mes = ?'
  ).all(anio, mes);
  const metaMap = new Map(metas.map((m) => [`${m.sucursal_id}:${m.categoria_staff}`, m.monto_meta]));

  const filas = [];
  for (const sede of sedes) {
    for (const categoria of CATEGORIAS) {
      const key = `${sede.id}:${categoria}`;
      filas.push({
        sucursal_id: sede.id,
        sede_nombre: sede.nombre,
        categoria_staff: categoria,
        cantidad_empleados: conteoMap.get(key) || 0,
        monto_meta: metaMap.get(key) || 0,
      });
    }
  }
  res.json(filas);
});

// PUT /api/metas-venta { sucursal_id, categoria_staff, anio, mes, monto_meta }
// — upsert del pool de esa sede/categoría/mes.
router.put('/', (req, res) => {
  const { sucursal_id, categoria_staff, anio, mes, monto_meta } = req.body || {};
  if (!sucursal_id || !anio || !mes) {
    return res.status(400).json({ error: 'sucursal_id, anio y mes son requeridos.' });
  }
  if (!CATEGORIAS.includes(categoria_staff)) {
    return res.status(400).json({ error: 'categoria_staff inválida. Use vendedor o trainer.' });
  }
  const sede = db.prepare('SELECT id FROM sucursales WHERE id = ?').get(sucursal_id);
  if (!sede) return res.status(404).json({ error: 'Sede no encontrada.' });
  const monto = Number(monto_meta) || 0;
  db.prepare(
    `INSERT INTO metas_venta_sede (sucursal_id, categoria_staff, anio, mes, monto_meta) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sucursal_id, categoria_staff, anio, mes) DO UPDATE SET monto_meta = excluded.monto_meta`
  ).run(sucursal_id, categoria_staff, anio, mes, monto);
  res.json({ sucursal_id: Number(sucursal_id), categoria_staff, anio: Number(anio), mes: Number(mes), monto_meta: monto });
});

module.exports = router;
