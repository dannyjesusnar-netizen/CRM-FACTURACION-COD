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
let tenantRegistry = null;
let resolveTenantDb = null;
let crmDb = null;
try {
  tenantRegistry = require('../../crm-facturacion/backend/tenantRegistry');
  resolveTenantDb = require('../../crm-facturacion/backend/utils/tenant').resolveTenantDb;
  crmDb = require('../../crm-facturacion/backend/db');
} catch {
  tenantRegistry = null;
  resolveTenantDb = null;
  crmDb = null;
}

function disponible() {
  return Boolean(tenantRegistry);
}

function listarEmpresas() {
  if (!tenantRegistry) return [];
  return tenantRegistry.listTodos();
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

function setCosto(ruc, datos) {
  return tenantRegistry.setCosto(ruc, datos);
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

module.exports = {
  disponible, listarEmpresas, encontrar, aprobar, rechazar, setCosto, listarPagos,
  listarMensajes, marcarMensajeLeido,
};
