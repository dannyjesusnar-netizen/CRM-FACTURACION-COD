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

// La empresa DUEÑA de este despliegue (la que ya venía con la instancia,
// nunca pasó por "Registrar mi empresa") no tiene fila en tenantRegistry
// a propósito: su JWT lleva ruc=null justo para que "Mis pagos" nunca le
// pida pagarse una suscripción a sí misma (ver routes/suscripcion.js). Por
// eso NO se inserta en tenants_registry.db — en vez de eso se arma una
// fila "de solo lectura" leyendo empresa_config directo de su propia base,
// para que igual aparezca en "CUENTAS REGISTRADAS" sin que el dueño tenga
// que agregarla a mano con URL/token.
function empresaOriginal() {
  if (!crmDb) return null;
  const config = crmDb.prepare('SELECT ruc, razon_social, nombre_comercial FROM empresa_config WHERE id = 1').get();
  if (!config || !config.ruc) return null;
  const { n: sucursales_count } = crmDb.prepare('SELECT COUNT(*) AS n FROM sucursales WHERE activo = 1').get();
  return {
    ruc: config.ruc,
    razon_social: config.nombre_comercial || config.razon_social,
    estado: 'aprobado',
    activo: 1,
    costo_mensual: null,
    fecha_inicio_suscripcion: null,
    proximo_cobro_at: null,
    created_at: null,
    ingreso_total: null,
    sucursales_count,
    es_original: true,
  };
}

// Cuánto le corresponde a cada RUC ver en el conteo de sucursales/ingresos
// requiere leer su propia base aislada (cross-db, ver listarMensajes más
// abajo para la misma técnica) — se calcula por fila al listar, no es
// costoso porque todo corre en el mismo proceso (sin red).
function sucursalesCount(ruc) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  return crmDb.runWithDb(tenantDb, () => crmDb.prepare('SELECT COUNT(*) AS n FROM sucursales WHERE activo = 1').get().n);
}

function listarEmpresas() {
  if (!tenantRegistry) return [];
  const original = empresaOriginal();
  const registradas = tenantRegistry.listTodos().map((t) => ({
    ...t,
    ingreso_total: tenantRegistry.ingresoTotal(t.ruc),
    sucursales_count: sucursalesCount(t.ruc),
  }));
  return original ? [original, ...registradas] : registradas;
}

function encontrar(ruc) {
  if (!tenantRegistry) return null;
  const tenant = tenantRegistry.findTenant(ruc);
  if (tenant) return tenant;
  const original = empresaOriginal();
  return original && original.ruc === ruc ? original : null;
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
  disponible, listarEmpresas, encontrar, aprobar, rechazar, activar, desactivar, setCosto, listarPagos,
  listarMensajes, marcarMensajeLeido,
};
