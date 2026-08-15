const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { sembrarSeriesParaSucursal } = require('../utils/series');
const tenantRegistry = require('../tenantRegistry');

const router = express.Router();
router.use(requireAuth);

// Cuántas sedes puede crear esta empresa sin pedir permiso: lo decide el
// dueño de la plataforma por tenant (Companies.jsx en panel-central ->
// tenantRegistry.js: tenants.sedes_libres), no algo que Gerencia pueda
// cambiar desde acá. Sin registro de tenant (instalación base todavía sin
// RUC configurado, o corriendo suelta sin panel-central) no hay límite —
// mismo criterio que resolveTenantDb: sin tenant, se comporta como siempre.
function sedesLibres(ruc) {
  if (!ruc) return null;
  const tenant = tenantRegistry.findTenant(ruc);
  return tenant ? tenant.sedes_libres : null;
}

// GET /api/sucursales?todas=1 (incluye desactivadas, para el panel de Gerencia)
router.get('/', (req, res) => {
  const sql = req.query.todas
    ? 'SELECT * FROM sucursales ORDER BY es_principal DESC, nombre ASC'
    : 'SELECT * FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, nombre ASC';
  res.json(db.prepare(sql).all());
});

// GET /api/sucursales/limite -> { libres, actual } para que la UI muestre
// "X de Y sedes usadas" y cambie a "Solicitar sede" al llegar al tope libre.
router.get('/limite', (req, res) => {
  const actual = db.prepare('SELECT COUNT(*) AS n FROM sucursales').get().n;
  res.json({ libres: sedesLibres(req.user.ruc), actual });
});

// GET /api/sucursales/solicitudes -> historial de solicitudes de sede de
// esta empresa (pendientes, aprobadas, rechazadas), para que Gerencia vea
// en qué quedó cada una.
router.get('/solicitudes', requireGerencia, (req, res) => {
  res.json(db.prepare('SELECT * FROM solicitudes_sede ORDER BY created_at DESC').all());
});

// POST /api/sucursales/solicitudes { nombre, direccion, motivo } -> se usa
// en vez de POST / cuando ya se agotaron las sedes libres; no crea la sede,
// solo la deja pedida para que panel-central la apruebe o rechace.
router.post('/solicitudes', requireGerencia, (req, res) => {
  const { nombre, direccion, motivo } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  const info = db.prepare(
    `INSERT INTO solicitudes_sede (user_id, nombre_usuario, nombre, direccion, motivo) VALUES (?, ?, ?, ?, ?)`
  ).run(req.user.id, req.user.full_name || null, nombre, direccion || null, motivo || null);
  res.status(201).json(db.prepare('SELECT * FROM solicitudes_sede WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/', requireGerencia, (req, res) => {
  const { nombre, direccion } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  const libres = sedesLibres(req.user.ruc);
  if (libres !== null) {
    const actual = db.prepare('SELECT COUNT(*) AS n FROM sucursales').get().n;
    if (actual >= libres) {
      return res.status(400).json({
        error: `Ya usaste tus ${libres} sede(s) libres. Envía una solicitud para crear una sede adicional — la aprueba tu proveedor.`,
      });
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
