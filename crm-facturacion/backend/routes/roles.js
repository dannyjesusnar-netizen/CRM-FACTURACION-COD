const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { MODULOS, ACCIONES_POR_MODULO } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

function conPermisos(role) {
  const filas = db.prepare('SELECT modulo, habilitado FROM role_permisos WHERE role_id = ?').all(role.id);
  const porModulo = {};
  filas.forEach((f) => { porModulo[f.modulo] = !!f.habilitado; });

  const filasAcciones = db.prepare('SELECT modulo, accion, habilitado FROM role_acciones WHERE role_id = ?').all(role.id);
  const accionesPorModulo = {};
  filasAcciones.forEach((f) => {
    if (!accionesPorModulo[f.modulo]) accionesPorModulo[f.modulo] = {};
    accionesPorModulo[f.modulo][f.accion] = !!f.habilitado;
  });

  const permisos = MODULOS.map((m) => {
    const acciones = (ACCIONES_POR_MODULO[m.key] || []).map((a) => {
      // Sin fila guardada todavía: habilitada por defecto (mismo criterio
      // que tieneAccion()) salvo que la acción declare default:false — hoy
      // solo "tablero_ventas" lo hace (ver utils/permisos.js).
      const porDefecto = a.default === false ? false : true;
      return {
        accion: a.key,
        label: a.label,
        grupo: a.grupo,
        habilitado: accionesPorModulo[m.key]?.[a.key] ?? porDefecto,
      };
    });
    return { modulo: m.key, label: m.label, habilitado: !!porModulo[m.key], acciones };
  });
  return { ...role, permisos };
}

// GET /api/roles?q=&estado=
router.get('/', (req, res) => {
  const { q, estado } = req.query;
  let sql = 'SELECT * FROM roles WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (nombre LIKE ? OR descripcion LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (estado === 'activo') sql += ' AND activo = 1';
  if (estado === 'inactivo') sql += ' AND activo = 0';
  sql += ' ORDER BY nombre ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(conPermisos));
});

router.get('/modulos', (req, res) => {
  res.json(MODULOS.map((m) => ({ ...m, acciones: ACCIONES_POR_MODULO[m.key] || [] })));
});

router.get('/:id', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Rol no encontrado.' });
  res.json(conPermisos(role));
});

function guardarPermisos(roleId, permisos) {
  const upsert = db.prepare(
    `INSERT INTO role_permisos (role_id, modulo, habilitado) VALUES (?, ?, ?)
     ON CONFLICT(role_id, modulo) DO UPDATE SET habilitado = excluded.habilitado`
  );
  const modulosValidos = new Set(MODULOS.map((m) => m.key));
  for (const [modulo, habilitado] of Object.entries(permisos || {})) {
    if (!modulosValidos.has(modulo)) continue;
    upsert.run(roleId, modulo, habilitado ? 1 : 0);
  }
}

// acciones: { ventas: { factura: true, abonado: false, ... }, compras: {...} }
function guardarAcciones(roleId, acciones) {
  const upsert = db.prepare(
    `INSERT INTO role_acciones (role_id, modulo, accion, habilitado) VALUES (?, ?, ?, ?)
     ON CONFLICT(role_id, modulo, accion) DO UPDATE SET habilitado = excluded.habilitado`
  );
  for (const [modulo, porAccion] of Object.entries(acciones || {})) {
    const accionesValidas = new Set((ACCIONES_POR_MODULO[modulo] || []).map((a) => a.key));
    for (const [accion, habilitado] of Object.entries(porAccion || {})) {
      if (!accionesValidas.has(accion)) continue;
      upsert.run(roleId, modulo, accion, habilitado ? 1 : 0);
    }
  }
}

router.post('/', (req, res) => {
  const { nombre, descripcion, permisos, acciones } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  const info = db.prepare(
    'INSERT INTO roles (nombre, descripcion, created_by) VALUES (?, ?, ?)'
  ).run(nombre, descripcion || null, req.user?.id || null);
  guardarPermisos(info.lastInsertRowid, permisos);
  guardarAcciones(info.lastInsertRowid, acciones);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(conPermisos(role));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rol no encontrado.' });
  const { nombre, descripcion, permisos, acciones } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  db.prepare('UPDATE roles SET nombre = ?, descripcion = ? WHERE id = ?').run(nombre, descripcion || null, req.params.id);
  if (permisos) guardarPermisos(req.params.id, permisos);
  if (acciones) guardarAcciones(req.params.id, acciones);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  res.json(conPermisos(role));
});

// PUT /api/roles/:id/estado { activo: true|false }
router.put('/:id/estado', (req, res) => {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rol no encontrado.' });
  db.prepare('UPDATE roles SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(conPermisos(db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id)));
});

module.exports = router;
