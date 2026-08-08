const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { platformRequest } = require('../utils/httpClient');
const localTenants = require('../localTenants');

const router = express.Router();
router.use(requireAuth);

// GET /api/companies/locales — empresas registradas vía "Registrar mi
// empresa" en la MISMA instancia donde corre este panel (co-desplegado,
// ver localTenants.js). Automático: sin URL ni token.
router.get('/locales', (req, res) => {
  if (!localTenants.disponible()) return res.json({ disponible: false, empresas: [] });
  res.json({ disponible: true, empresas: localTenants.listarEmpresas() });
});

function getLocalTenantOr404(req, res) {
  if (!localTenants.disponible()) {
    res.status(404).json({ error: 'Esta instancia del panel no tiene una instancia local co-desplegada.' });
    return null;
  }
  const tenant = localTenants.encontrar(req.params.ruc);
  if (!tenant) {
    res.status(404).json({ error: 'Registro no encontrado.' });
    return null;
  }
  return tenant;
}

// PUT /api/companies/locales/:ruc/aprobar
router.put('/locales/:ruc/aprobar', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(localTenants.aprobar(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/rechazar
router.put('/locales/:ruc/rechazar', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(localTenants.rechazar(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/costo { costo_mensual, fecha_inicio_suscripcion? }
router.put('/locales/:ruc/costo', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const costo = Number(req.body?.costo_mensual);
  if (!Number.isFinite(costo) || costo < 0) {
    return res.status(400).json({ error: 'costo_mensual debe ser un número mayor o igual a 0.' });
  }
  res.json(localTenants.setCosto(req.params.ruc, {
    costo_mensual: costo,
    fecha_inicio_suscripcion: req.body?.fecha_inicio_suscripcion || null,
  }));
});

// GET /api/companies/locales/:ruc/pagos — historial de cobros de la
// suscripción de esa empresa.
router.get('/locales/:ruc/pagos', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(localTenants.listarPagos(req.params.ruc));
});

// GET /api/companies/locales/:ruc/mensajes — mensajes que le escribieron
// al asistente ODIN desde el CRM de esa empresa.
router.get('/locales/:ruc/mensajes', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(localTenants.listarMensajes(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/mensajes/:id/leido
router.put('/locales/:ruc/mensajes/:id/leido', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const mensaje = localTenants.marcarMensajeLeido(req.params.ruc, req.params.id);
  if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' });
  res.json(mensaje);
});

function sinToken(company) {
  const { platform_token, ...rest } = company;
  return rest;
}

// Nota: nunca devolvemos 401 aquí, aunque el error venga de un 401 real del
// cliente (token de esa instancia incorrecto) — el interceptor del frontend
// del panel trata cualquier 401 como "mi sesión expiró" y redirige a
// /login. Un 401 ajeno (de la instancia cliente, no del panel) no debe
// cerrar la sesión del propio admin de plataforma.
function errorStatus(code) {
  if (code === 'AUTH') return 409;
  if (code === 'UNREACHABLE') return 502;
  return 400;
}

// GET /api/companies
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM empresas_cliente ORDER BY nombre ASC').all();
  res.json(rows.map(sinToken));
});

// POST /api/companies { nombre, ruc, telefono, render_url, platform_token }
router.post('/', (req, res) => {
  const { nombre, ruc, telefono, render_url, platform_token } = req.body || {};
  if (!nombre || !render_url || !platform_token) {
    return res.status(400).json({ error: 'Nombre, URL de Render y token de plataforma son requeridos.' });
  }
  const info = db.prepare(
    'INSERT INTO empresas_cliente (nombre, ruc, telefono, render_url, platform_token) VALUES (?, ?, ?, ?, ?)'
  ).run(nombre, ruc || null, telefono || null, render_url, platform_token);
  res.status(201).json(sinToken(db.prepare('SELECT * FROM empresas_cliente WHERE id = ?').get(info.lastInsertRowid)));
});

// PUT /api/companies/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM empresas_cliente WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Empresa no encontrada.' });
  const { nombre, ruc, telefono, render_url, platform_token, activo } = req.body || {};
  db.prepare(
    `UPDATE empresas_cliente SET nombre = ?, ruc = ?, telefono = ?, render_url = ?, platform_token = ?, activo = ?
     WHERE id = ?`
  ).run(
    nombre ?? existing.nombre,
    ruc !== undefined ? (ruc || null) : existing.ruc,
    telefono !== undefined ? (telefono || null) : existing.telefono,
    render_url ?? existing.render_url,
    platform_token ?? existing.platform_token,
    activo !== undefined ? (activo ? 1 : 0) : existing.activo,
    req.params.id
  );
  res.json(sinToken(db.prepare('SELECT * FROM empresas_cliente WHERE id = ?').get(req.params.id)));
});

// DELETE /api/companies/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM empresas_cliente WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Empresa no encontrada.' });
  db.prepare('DELETE FROM empresas_cliente WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function getCompanyOr404(req, res) {
  const company = db.prepare('SELECT * FROM empresas_cliente WHERE id = ?').get(req.params.id);
  if (!company) {
    res.status(404).json({ error: 'Empresa no encontrada.' });
    return null;
  }
  return company;
}

async function proxy(req, res, path, opts) {
  const company = getCompanyOr404(req, res);
  if (!company) return;
  try {
    const data = await platformRequest(company, path, opts);
    res.json(data);
  } catch (err) {
    res.status(errorStatus(err.code)).json({ error: err.message });
  }
}

// GET /api/companies/:id/live/empresa
router.get('/:id/live/empresa', (req, res) => proxy(req, res, '/empresa'));

// GET /api/companies/:id/live/users
router.get('/:id/live/users', (req, res) => proxy(req, res, '/users'));

// PUT /api/companies/:id/live/users/:userId/estado { activo }
router.put('/:id/live/users/:userId/estado', (req, res) =>
  proxy(req, res, `/users/${req.params.userId}/estado`, { method: 'PUT', body: { activo: !!req.body?.activo } })
);

// PUT /api/companies/:id/live/users/:userId/password { new_password }
router.put('/:id/live/users/:userId/password', (req, res) =>
  proxy(req, res, `/users/${req.params.userId}/password`, { method: 'PUT', body: { new_password: req.body?.new_password } })
);

// PUT /api/companies/:id/live/users/:userId/rol
router.put('/:id/live/users/:userId/rol', (req, res) =>
  proxy(req, res, `/users/${req.params.userId}/rol`, { method: 'PUT', body: {} })
);

// GET /api/companies/:id/live/registros — historial completo (pendiente,
// aprobado, rechazado) de empresas que se auto-registraron en esa instancia
// desde su pantalla "Registrar mi empresa".
router.get('/:id/live/registros', (req, res) => proxy(req, res, '/registros'));

// PUT /api/companies/:id/live/registros/:ruc/aprobar
router.put('/:id/live/registros/:ruc/aprobar', (req, res) =>
  proxy(req, res, `/registros/${req.params.ruc}/aprobar`, { method: 'PUT', body: {} })
);

// PUT /api/companies/:id/live/registros/:ruc/rechazar
router.put('/:id/live/registros/:ruc/rechazar', (req, res) =>
  proxy(req, res, `/registros/${req.params.ruc}/rechazar`, { method: 'PUT', body: {} })
);

// PUT /api/companies/:id/live/registros/:ruc/costo { costo_mensual } — lo
// que le corresponde pagar a esa empresa por mes de suscripción a la
// plataforma (ver "Mis pagos" del lado del CRM).
router.put('/:id/live/registros/:ruc/costo', (req, res) =>
  proxy(req, res, `/registros/${req.params.ruc}/costo`, { method: 'PUT', body: { costo_mensual: req.body?.costo_mensual } })
);

// GET /api/companies/:id/live/registros/:ruc/pagos — historial de cobros.
router.get('/:id/live/registros/:ruc/pagos', (req, res) =>
  proxy(req, res, `/registros/${req.params.ruc}/pagos`)
);

// GET /api/companies/:id/live/mensajes-soporte — mensajes que le
// escribieron al asistente ODIN desde el CRM de esa empresa remota.
router.get('/:id/live/mensajes-soporte', (req, res) => proxy(req, res, '/mensajes-soporte'));

// PUT /api/companies/:id/live/mensajes-soporte/:msgId/leido
router.put('/:id/live/mensajes-soporte/:msgId/leido', (req, res) =>
  proxy(req, res, `/mensajes-soporte/${req.params.msgId}/leido`, { method: 'PUT', body: {} })
);

module.exports = router;
