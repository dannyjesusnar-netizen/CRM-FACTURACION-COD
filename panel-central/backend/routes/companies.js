const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const localTenants = require('../localTenants');
const db = require('../db');
const github = require('../utils/github');

const router = express.Router();
router.use(requireAuth);

// Deja constancia en acciones_sensibles de toda acción que un admin de
// plataforma toma sobre una empresa desde este panel — no solo el reseteo
// de contraseña (la única que hoy pide un motivo) sino también aprobar,
// rechazar, activar/desactivar, cambiar costo, tipo de negocio, sedes
// libres y resolver solicitudes de sede. Antes estas quedaban sin rastro:
// se sobreescribía el valor sin guardar quién lo cambió ni cuándo (ver área
// de Reportes). "motivo" sigue siendo NOT NULL en la tabla pero acá no se le
// pide una razón al admin (a diferencia del reseteo de clave) — se guarda
// como cadena vacía, no NULL.
function registrarAccion(adminId, accion, ruc, detalle) {
  db.prepare(
    'INSERT INTO acciones_sensibles (admin_id, accion, ruc, detalle, motivo) VALUES (?, ?, ?, ?, ?)'
  ).run(adminId, accion, ruc, detalle || null, '');
}

// GET /api/companies/locales — empresas registradas vía "Registrar mi
// empresa" en la MISMA instancia donde corre este panel (co-desplegado,
// ver localTenants.js). Automático: sin URL ni token.
router.get('/locales', (req, res) => {
  if (!localTenants.disponible()) return res.json({ disponible: false, empresas: [] });
  res.json({ disponible: true, empresas: localTenants.listarEmpresas() });
});

// POST /api/companies/locales/demo { ruc, razon_social } — crea y aprueba
// de una vez una empresa de demostración, con datos de ejemplo ya
// cargados (ver localTenants.js:crearEmpresaDemo).
router.post('/locales/demo', (req, res) => {
  if (!localTenants.disponible()) {
    return res.status(404).json({ error: 'Esta instancia del panel no tiene una instancia local co-desplegada.' });
  }
  const { ruc, razon_social } = req.body || {};
  const resultado = localTenants.crearEmpresaDemo({ ruc, razon_social });
  if (resultado.error) return res.status(400).json({ error: resultado.error });
  registrarAccion(req.admin.id, 'crear_empresa_demo', ruc, razon_social);
  res.status(201).json(resultado.tenant);
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
  const tenant = getLocalTenantOr404(req, res);
  if (!tenant) return;
  registrarAccion(req.admin.id, 'aprobar_empresa', req.params.ruc, tenant.razon_social);
  res.json(localTenants.aprobar(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/rechazar
router.put('/locales/:ruc/rechazar', (req, res) => {
  const tenant = getLocalTenantOr404(req, res);
  if (!tenant) return;
  registrarAccion(req.admin.id, 'rechazar_empresa', req.params.ruc, tenant.razon_social);
  res.json(localTenants.rechazar(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/activo { activo }
router.put('/locales/:ruc/activo', (req, res) => {
  const tenant = getLocalTenantOr404(req, res);
  if (!tenant) return;
  const activo = !!req.body?.activo;
  registrarAccion(req.admin.id, activo ? 'activar_empresa' : 'desactivar_empresa', req.params.ruc, tenant.razon_social);
  res.json(activo ? localTenants.activar(req.params.ruc) : localTenants.desactivar(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/costo { costo_mensual, fecha_inicio_suscripcion? }
router.put('/locales/:ruc/costo', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const costo = Number(req.body?.costo_mensual);
  if (!Number.isFinite(costo) || costo < 0) {
    return res.status(400).json({ error: 'costo_mensual debe ser un número mayor o igual a 0.' });
  }
  registrarAccion(req.admin.id, 'cambiar_costo', req.params.ruc, `S/ ${costo.toFixed(2)} mensual`);
  res.json(localTenants.setCosto(req.params.ruc, {
    costo_mensual: costo,
    fecha_inicio_suscripcion: req.body?.fecha_inicio_suscripcion || null,
  }));
});

// PUT /api/companies/locales/:ruc/tipo-negocio { tipo_negocio } -- general
// o restaurante. Prende/oculta en el CRM de esa empresa las funciones
// pensadas solo para restaurantes (ver GET /api/empresa del CRM).
router.put('/locales/:ruc/tipo-negocio', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const resultado = localTenants.setTipoNegocio(req.params.ruc, req.body?.tipo_negocio);
  if (resultado.error) return res.status(400).json({ error: resultado.error });
  registrarAccion(req.admin.id, 'cambiar_tipo_negocio', req.params.ruc, req.body?.tipo_negocio);
  res.json(resultado.tenant);
});

// PUT /api/companies/locales/:ruc/sedes-libres { cantidad }
router.put('/locales/:ruc/sedes-libres', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const cantidad = Number(req.body?.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 0) {
    return res.status(400).json({ error: 'cantidad debe ser un número entero mayor o igual a 0.' });
  }
  registrarAccion(req.admin.id, 'cambiar_sedes_libres', req.params.ruc, String(cantidad));
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
  registrarAccion(req.admin.id, 'aprobar_solicitud_sede', req.params.ruc, resultado.solicitud?.nombre);
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
  registrarAccion(req.admin.id, 'rechazar_solicitud_sede', req.params.ruc, resultado.solicitud?.nombre);
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

// GET /api/companies/locales/:ruc/documentos-por-sede?anio=&mes= — cuántos
// documentos emitió cada sede de esa empresa en el mes (default: mes/año
// actual), más el total de la empresa. Exclusivo de este panel (ver la nota
// en localTenants.js:documentosPorSede sobre por qué no existe un endpoint
// equivalente dentro del propio CRM de la empresa).
router.get('/locales/:ruc/documentos-por-sede', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const anio = req.query.anio ? Number(req.query.anio) : undefined;
  const mes = req.query.mes ? Number(req.query.mes) : undefined;
  res.json(localTenants.documentosPorSede(req.params.ruc, { anio, mes }));
});

// GET /api/companies/locales/:ruc/usuarios — empleados de esa empresa.
router.get('/locales/:ruc/usuarios', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  res.json(localTenants.listarUsuarios(req.params.ruc));
});

// PUT /api/companies/locales/:ruc/usuarios/:userId/password
// { new_password, motivo, admin_password }
// Es la acción más sensible que este panel puede hacer directamente sobre
// los datos de una empresa (ver auditoría de estructura: equivale a tomar
// control de la cuenta de un empleado) — por eso, a diferencia del resto de
// endpoints de este archivo, exige dos cosas además del token: que el admin
// de plataforma vuelva a escribir SU PROPIA contraseña (así un token
// robado/filtrado no alcanza por sí solo) y un motivo no vacío, que queda
// guardado en acciones_sensibles junto con quién y cuándo.
router.put('/locales/:ruc/usuarios/:userId/password', (req, res) => {
  if (!getLocalTenantOr404(req, res)) return;
  const { new_password, motivo, admin_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'Falta la nueva contraseña.' });
  const motivoLimpio = (motivo || '').toString().trim();
  if (!motivoLimpio) return res.status(400).json({ error: 'Escribe el motivo de este reseteo de contraseña.' });
  if (!admin_password) return res.status(400).json({ error: 'Vuelve a escribir tu contraseña para confirmar.' });

  const admin = db.prepare('SELECT * FROM platform_admins WHERE id = ?').get(req.admin.id);
  if (!admin || !bcrypt.compareSync(admin_password, admin.password_hash)) {
    return res.status(401).json({ error: 'Tu contraseña no es correcta.' });
  }

  const usuario = localTenants.restablecerClave(req.params.ruc, req.params.userId, new_password);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

  db.prepare(
    'INSERT INTO acciones_sensibles (admin_id, accion, ruc, detalle, motivo) VALUES (?, ?, ?, ?, ?)'
  ).run(req.admin.id, 'reset_password', req.params.ruc, `Usuario: ${usuario.full_name} (id ${usuario.id})`, motivoLimpio);

  res.json(usuario);
});

// GET /api/companies/reportes/documentos-por-sede?anio=&mes= — mismo
// reporte que documentos-por-sede de una empresa, pero para TODAS a la vez
// (ver localTenants.js:documentosPorSedeTodasLasEmpresas).
router.get('/reportes/documentos-por-sede', (req, res) => {
  if (!localTenants.disponible()) return res.json({ disponible: false, sedes: [], total: null });
  const anio = req.query.anio ? Number(req.query.anio) : undefined;
  const mes = req.query.mes ? Number(req.query.mes) : undefined;
  res.json({ disponible: true, ...localTenants.documentosPorSedeTodasLasEmpresas({ anio, mes }) });
});

// GET /api/companies/reportes/acciones?ruc=&desde=&hasta=&limit= — bitácora
// de acciones que un admin de plataforma tomó sobre una empresa desde este
// panel (ver registrarAccion más arriba y la tabla acciones_sensibles).
router.get('/reportes/acciones', (req, res) => {
  const { ruc, desde, hasta } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  let sql = `
    SELECT a.*, p.full_name AS admin_nombre, p.email AS admin_email
    FROM acciones_sensibles a
    LEFT JOIN platform_admins p ON p.id = a.admin_id
    WHERE 1 = 1
  `;
  const params = [];
  if (ruc) { sql += ' AND a.ruc = ?'; params.push(ruc); }
  if (desde) { sql += ' AND date(a.created_at) >= date(?)'; params.push(desde); }
  if (hasta) { sql += ' AND date(a.created_at) <= date(?)'; params.push(hasta); }
  sql += ' ORDER BY a.id DESC LIMIT ?';
  params.push(limit);
  res.json(db.prepare(sql).all(...params));
});

// GET /api/companies/reportes/commits?limit= — últimos commits del
// repositorio (ver utils/github.js). Requiere GITHUB_TOKEN configurado en
// el servidor; si no está, responde { disponible: false } en vez de fallar.
router.get('/reportes/commits', async (req, res) => {
  res.json(await github.listarCommitsRecientes({ limit: req.query.limit }));
});

module.exports = router;
