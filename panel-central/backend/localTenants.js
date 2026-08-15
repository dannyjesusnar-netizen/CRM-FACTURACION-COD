// Cuando panel-central corre co-desplegado junto a una instancia de
// crm-facturacion (mismo proceso Node, mismo disco — ver
// crm-facturacion/backend/server.js y render.yaml, que monta este panel
// bajo /panel dentro del mismo servicio), las empresas que se registraron
// ahí mismo vía "Registrar mi empresa" deben verse automáticamente acá,
// sin pedir URL ni token: viven en el mismo proceso, no hace falta ni
// siquiera una llamada HTTP. Si panel-central corriera solo (sin esa
// instancia al lado), esto queda deshabilitado sin romper nada — el resto
// del panel (empresas agregadas a mano con su propia URL) sigue
// funcionando igual.
const bcrypt = require('bcryptjs');

let tenantRegistry = null;
let resolveTenantDb = null;
let crmDb = null;
let sembrarSeriesParaSucursal = null;
try {
  tenantRegistry = require('../../crm-facturacion/backend/tenantRegistry');
  resolveTenantDb = require('../../crm-facturacion/backend/utils/tenant').resolveTenantDb;
  crmDb = require('../../crm-facturacion/backend/db');
  sembrarSeriesParaSucursal = require('../../crm-facturacion/backend/utils/series').sembrarSeriesParaSucursal;
} catch {
  tenantRegistry = null;
  resolveTenantDb = null;
  crmDb = null;
  sembrarSeriesParaSucursal = null;
}

function disponible() {
  return Boolean(tenantRegistry);
}

// El número de sucursales de cada empresa vive en su propia base aislada
// (cross-db, ver listarMensajes más abajo para la misma técnica) — se
// calcula por fila al listar, no es costoso porque todo corre en el mismo
// proceso (sin red). Incluye a la instalación base (ver
// tenantRegistry.js:adoptarInstanciaBase): su db_file ya apunta a la base
// de siempre, así que resolveTenantDb la resuelve igual que a cualquiera.
function sucursalesCount(ruc) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  return crmDb.runWithDb(tenantDb, () => crmDb.prepare('SELECT COUNT(*) AS n FROM sucursales WHERE activo = 1').get().n);
}

// Cuántas solicitudes de sede siguen sin resolver — para el badge del botón
// "Solicitudes" en la tabla, sin tener que abrir el modal para saberlo.
function solicitudesSedePendientesCount(ruc) {
  if (!resolveTenantDb || !crmDb) return 0;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return 0;
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare(`SELECT COUNT(*) AS n FROM solicitudes_sede WHERE estado = 'pendiente'`).get().n
  );
}

function listarEmpresas() {
  if (!tenantRegistry) return [];
  return tenantRegistry.listTodos().map((t) => ({
    ...t,
    ingreso_total: tenantRegistry.ingresoTotal(t.ruc),
    sucursales_count: sucursalesCount(t.ruc),
    solicitudes_sede_pendientes: solicitudesSedePendientesCount(t.ruc),
  }));
}

function encontrar(ruc) {
  if (!tenantRegistry) return null;
  return tenantRegistry.findTenant(ruc);
}

function aprobar(ruc) {
  return tenantRegistry.aprobarTenant(ruc);
}

function rechazar(ruc) {
  return tenantRegistry.rechazarTenant(ruc);
}

function activar(ruc) {
  return tenantRegistry.activarTenant(ruc);
}

function desactivar(ruc) {
  return tenantRegistry.desactivarTenant(ruc);
}

function setCosto(ruc, datos) {
  return tenantRegistry.setCosto(ruc, datos);
}

function setSedesLibres(ruc, cantidad) {
  return tenantRegistry.setSedesLibres(ruc, cantidad);
}

function listarPagos(ruc) {
  return tenantRegistry.listarPagos(ruc);
}

// Los mensajes que le escriben al asistente ODIN (widget del CRM) viven en
// la base de datos AISLADA de cada empresa (crm-facturacion/backend/db.js
// es multi-tenant: un archivo .db por RUC), no en el registro central de
// tenantRegistry. Por eso hace falta resolver esa base puntual y correr la
// consulta dentro de ella — mismo patrón que usa
// crm-facturacion/backend/routes/auth.js al registrar una empresa nueva.
function listarMensajes(ruc) {
  if (!resolveTenantDb || !crmDb) return [];
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return [];
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare('SELECT * FROM mensajes_soporte ORDER BY created_at DESC').all()
  );
}

function marcarMensajeLeido(ruc, id) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  return crmDb.runWithDb(tenantDb, () => {
    crmDb.prepare('UPDATE mensajes_soporte SET leido = 1 WHERE id = ?').run(id);
    return crmDb.prepare('SELECT * FROM mensajes_soporte WHERE id = ?').get(id);
  });
}

// Solicitudes de sede (cuando la empresa ya usó sus sedes libres, ver
// crm-facturacion/backend/routes/sucursales.js) — mismo cross-db que
// listarMensajes.
function listarSolicitudesSede(ruc) {
  if (!resolveTenantDb || !crmDb) return [];
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return [];
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare('SELECT * FROM solicitudes_sede ORDER BY created_at DESC').all()
  );
}

// Aprobar una solicitud crea la sede tal cual fue pedida (con su propia
// serie de comprobantes, igual que POST /api/sucursales del CRM) dentro de
// la base de esa empresa, y deja la solicitud marcada como resuelta.
// Rechazarla solo cambia su estado, sin tocar nada más. Si la sede ya no se
// puede crear (p.ej. otra con el mismo nombre se creó mientras tanto), no
// se toca el estado de la solicitud y se informa el motivo para reintentar.
function resolverSolicitudSede(ruc, id, { aprobar, respuesta }) {
  if (!resolveTenantDb || !crmDb) return { error: 'No disponible.' };
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return { error: 'No disponible.' };
  return crmDb.runWithDb(tenantDb, () => {
    const solicitud = crmDb.prepare('SELECT * FROM solicitudes_sede WHERE id = ?').get(id);
    if (!solicitud) return { error: 'Solicitud no encontrada.' };
    if (solicitud.estado !== 'pendiente') return { error: 'Esta solicitud ya fue resuelta.' };

    if (aprobar) {
      const yaExiste = crmDb.prepare('SELECT id FROM sucursales WHERE nombre = ?').get(solicitud.nombre);
      if (yaExiste) {
        return { error: `Ya existe una sede llamada "${solicitud.nombre}" — pide que la empresa la solicite de nuevo con otro nombre.` };
      }
      const info = crmDb.prepare('INSERT INTO sucursales (nombre, direccion) VALUES (?, ?)').run(solicitud.nombre, solicitud.direccion);
      if (sembrarSeriesParaSucursal) sembrarSeriesParaSucursal(info.lastInsertRowid);
    }

    crmDb.prepare(
      `UPDATE solicitudes_sede SET estado = ?, respuesta = ?, resuelto_at = datetime('now') WHERE id = ?`
    ).run(aprobar ? 'aprobada' : 'rechazada', respuesta || null, id);
    return { solicitud: crmDb.prepare('SELECT * FROM solicitudes_sede WHERE id = ?').get(id) };
  });
}

// Cuentas de empleados de esa empresa (mismo cross-db que listarMensajes),
// para poder restablecerles la clave desde acá cuando lo pidan.
function listarUsuarios(ruc) {
  if (!resolveTenantDb || !crmDb) return [];
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return [];
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare('SELECT id, full_name, nombres, apellidos, dni, email, role, activo FROM users ORDER BY nombres ASC, full_name ASC').all()
  );
}

function restablecerClave(ruc, userId, password) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  return crmDb.runWithDb(tenantDb, () => {
    const existing = crmDb.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) return null;
    crmDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), userId);
    return crmDb.prepare('SELECT id, full_name, nombres, apellidos, dni, email, role, activo FROM users WHERE id = ?').get(userId);
  });
}

module.exports = {
  disponible, listarEmpresas, encontrar, aprobar, rechazar, activar, desactivar, setCosto, setSedesLibres,
  listarPagos, listarMensajes, marcarMensajeLeido, listarSolicitudesSede, resolverSolicitudSede,
  listarUsuarios, restablecerClave,
};
