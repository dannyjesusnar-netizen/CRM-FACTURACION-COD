const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

const CATEGORIAS = ['vendedor', 'trainer', 'supervisor'];

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
     WHERE activo = 1 AND sucursal_id IS NOT NULL AND categoria_staff IN ('vendedor', 'trainer', 'supervisor')
     GROUP BY sucursal_id, categoria_staff`
  ).all();
  const conteoMap = new Map(conteos.map((c) => [`${c.sucursal_id}:${c.categoria_staff}`, c.cantidad]));
  const metas = db.prepare(
    'SELECT sucursal_id, categoria_staff, monto_meta, dotacion, monto_individual FROM metas_venta_sede WHERE anio = ? AND mes = ?'
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
        monto_individual: meta?.monto_individual ?? null,
      });
    }
  }
  res.json(filas);
});

// PUT /api/metas-venta { sucursal_id, categoria_staff, anio, mes, monto_meta?, dotacion?, monto_individual? }
// — upsert del pool, la dotación y/o la cuota individual manual de esa
// sede/categoría/mes. Cada campo omitido conserva el valor que ya tenía la
// fila (o 0/NULL si es nueva), para que el frontend pueda guardar cada uno
// por separado sin pisarse. monto_individual solo tiene efecto real para
// categoria_staff='vendedor' (ver tablero.js): cuando está asignado (no
// NULL), reemplaza el cálculo pool/dotación para la meta de cada vendedor
// de esa sede; para 'trainer' se guarda igual pero tablero.js lo ignora.
router.put('/', (req, res) => {
  const { sucursal_id, categoria_staff, anio, mes, monto_meta, dotacion, monto_individual } = req.body || {};
  if (!sucursal_id || !anio || !mes) {
    return res.status(400).json({ error: 'sucursal_id, anio y mes son requeridos.' });
  }
  if (!CATEGORIAS.includes(categoria_staff)) {
    return res.status(400).json({ error: 'categoria_staff inválida. Use vendedor, trainer o supervisor.' });
  }
  const sede = db.prepare('SELECT id FROM sucursales WHERE id = ?').get(sucursal_id);
  if (!sede) return res.status(404).json({ error: 'Sede no encontrada.' });

  const existente = db.prepare(
    'SELECT monto_meta, dotacion, monto_individual FROM metas_venta_sede WHERE sucursal_id = ? AND categoria_staff = ? AND anio = ? AND mes = ?'
  ).get(sucursal_id, categoria_staff, anio, mes);
  const monto = monto_meta !== undefined ? Number(monto_meta) || 0 : (existente?.monto_meta || 0);
  const dotacionValor = dotacion !== undefined ? Math.max(0, Math.trunc(Number(dotacion)) || 0) : (existente?.dotacion || 0);
  const montoIndividualValor = monto_individual !== undefined
    ? (monto_individual === null || monto_individual === '' ? null : Math.max(0, Number(monto_individual) || 0))
    : (existente?.monto_individual ?? null);

  db.prepare(
    `INSERT INTO metas_venta_sede (sucursal_id, categoria_staff, anio, mes, monto_meta, dotacion, monto_individual) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sucursal_id, categoria_staff, anio, mes) DO UPDATE SET monto_meta = excluded.monto_meta, dotacion = excluded.dotacion, monto_individual = excluded.monto_individual`
  ).run(sucursal_id, categoria_staff, anio, mes, monto, dotacionValor, montoIndividualValor);
  res.json({
    sucursal_id: Number(sucursal_id), categoria_staff, anio: Number(anio), mes: Number(mes),
    monto_meta: monto, dotacion: dotacionValor, monto_individual: montoIndividualValor,
  });
});

// GET /api/metas-venta/vendedores?anio=&mes= — un vendedor activo por fila,
// con su sede/turno y la cuota individual que Gerencia le haya asignado a
// mano para ese mes (null si no tiene una asignada — en ese caso sigue la
// cuota de la sede, ver PUT /metas-venta y tablero.js).
router.get('/vendedores', (req, res) => {
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = Number(req.query.mes) || new Date().getMonth() + 1;

  const vendedores = db.prepare(
    `SELECT u.id AS user_id, u.full_name AS nombre, u.turno, u.sucursal_id, s.nombre AS sede_nombre
     FROM users u LEFT JOIN sucursales s ON s.id = u.sucursal_id
     WHERE u.activo = 1 AND u.categoria_staff = 'vendedor'
     ORDER BY s.nombre ASC, u.full_name ASC`
  ).all();
  const metas = db.prepare(
    'SELECT user_id, monto_meta FROM metas_venta_usuario WHERE anio = ? AND mes = ?'
  ).all(anio, mes);
  const metaMap = new Map(metas.map((m) => [m.user_id, m.monto_meta]));

  res.json(vendedores.map((v) => ({ ...v, monto_meta: metaMap.get(v.user_id) ?? null })));
});

// PUT /api/metas-venta/vendedor { user_id, anio, mes, monto_meta }
// — upsert de la cuota individual de UN vendedor puntual. monto_meta null o
// '' borra la asignación (ese vendedor vuelve a la cuota de su sede).
router.put('/vendedor', (req, res) => {
  const { user_id, anio, mes, monto_meta } = req.body || {};
  if (!user_id || !anio || !mes) {
    return res.status(400).json({ error: 'user_id, anio y mes son requeridos.' });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND categoria_staff = 'vendedor'").get(user_id);
  if (!user) return res.status(404).json({ error: 'Vendedor no encontrado.' });

  if (monto_meta === null || monto_meta === undefined || monto_meta === '') {
    db.prepare('DELETE FROM metas_venta_usuario WHERE user_id = ? AND anio = ? AND mes = ?').run(user_id, anio, mes);
    return res.json({ user_id: Number(user_id), anio: Number(anio), mes: Number(mes), monto_meta: null });
  }
  const monto = Math.max(0, Number(monto_meta) || 0);
  db.prepare(
    `INSERT INTO metas_venta_usuario (user_id, anio, mes, monto_meta) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, anio, mes) DO UPDATE SET monto_meta = excluded.monto_meta`
  ).run(user_id, anio, mes, monto);
  res.json({ user_id: Number(user_id), anio: Number(anio), mes: Number(mes), monto_meta: monto });
});

module.exports = router;
