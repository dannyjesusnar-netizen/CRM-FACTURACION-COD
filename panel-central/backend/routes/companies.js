const express = require('express');
const { requireAuth } = require('../middleware/auth');
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

// PUT /api/companies/locales/:ruc/activo { activo }
router.put('/locales/:ruc/activo', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(req.body?.activo ? localTenants.activar(req.params.ruc) : localTenants.desactivar(req.params.ruc));
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

// PUT /api/companies/locales/:ruc/sedes-libres { cantidad }
router.put('/locales/:ruc/sedes-libres', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const cantidad = Number(req.body?.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 0) {
    return res.status(400).json({ error: 'cantidad debe ser un número entero mayor o igual a 0.' });
  }
  res.json(localTenants.setSedesLibres(req.params.ruc, cantidad));
});

// GET /api/companies/locales/:ruc/solicitudes-sede — solicitudes de sede
// de esa empresa (pendientes y ya resueltas).
router.get('/locales/:ruc/solicitudes-sede', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(localTenants.listarSolicitudesSede(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/solicitudes-sede/:id/aprobar { respuesta? }
// Crea la sede pedida y marca la solicitud como aprobada.
router.put('/locales/:ruc/solicitudes-sede/:id/aprobar', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const resultado = localTenants.resolverSolicitudSede(req.params.ruc, req.params.id, {
    aprobar: true,
    respuesta: req.body?.respuesta,
  });
  if (resultado.error) return res.status(400).json({ error: resultado.error });
  res.json(resultado.solicitud);
});

// PUT /api/companies/locales/:ruc/solicitudes-sede/:id/rechazar { respuesta? }
router.put('/locales/:ruc/solicitudes-sede/:id/rechazar', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const resultado = localTenants.resolverSolicitudSede(req.params.ruc, req.params.id, {
    aprobar: false,
    respuesta: req.body?.respuesta,
  });
  if (resultado.error) return res.status(400).json({ error: resultado.error });
  res.json(resultado.solicitud);
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

// GET /api/companies/locales/:ruc/usuarios — empleados de esa empresa.
router.get('/locales/:ruc/usuarios', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(localTenants.listarUsuarios(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/usuarios/:userId/password { new_password }
router.put('/locales/:ruc/usuarios/:userId/password', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'Falta la nueva contraseña.' });
  const usuario = localTenants.restablecerClave(req.params.ruc, req.params.userId, new_password);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(usuario);
});

module.exports = router;
