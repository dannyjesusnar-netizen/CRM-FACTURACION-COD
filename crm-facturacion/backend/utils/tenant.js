const db = require('../db');
const tenantRegistry = require('../tenantRegistry');

// Dado un RUC (puede venir vacío/null: así se comportaba siempre la
// instancia original, antes de que existiera el registro multi-empresa),
// resuelve a qué base de datos better-sqlite3 pertenece esa sesión.
//
// - RUC registrado y aprobado -> su propia base aislada (data/tenants/<ruc>.db).
// - RUC registrado pero pendiente/rechazado -> null (no hay base que usar;
//   quien llama debe bloquear el acceso).
// - RUC no encontrado en el registro (incluye null/undefined) -> la base por
//   defecto de siempre (data/crm.db) — la empresa original de este
//   despliegue nunca pasó por el registro, así que nunca aparece ahí.
function resolveTenantDb(ruc) {
  if (ruc) {
    const tenant = tenantRegistry.findTenant(ruc);
    if (tenant) {
      if (tenant.estado !== 'aprobado') return null;
      return db.openTenantDb(tenant.db_file, { demo: false });
    }
  }
  return db.openTenantDb(db.DEFAULT_DB_PATH);
}

module.exports = { resolveTenantDb };
