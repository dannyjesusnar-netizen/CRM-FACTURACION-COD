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
try {
  tenantRegistry = require('../../crm-facturacion/backend/tenantRegistry');
} catch {
  tenantRegistry = null;
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

module.exports = { disponible, listarEmpresas, encontrar, aprobar, rechazar, setCosto, listarPagos };
