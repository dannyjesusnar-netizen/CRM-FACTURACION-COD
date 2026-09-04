const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR, DEFAULT_DB_PATH } = require('./db');
const { hoyPeru } = require('./utils/fechas');

// Registro central de empresas registradas desde "Registrar mi empresa"
// (login → botón Registro). Es una base sqlite propia, separada de la de
// cada empresa: solo guarda a qué archivo .db corresponde cada RUC, si esa
// empresa ya fue aprobada, y su suscripción a la plataforma (costo mensual,
// tarjeta tokenizada en Izipay, historial de cobros) — nunca datos de
// negocio de la empresa (eso vive aislado en su propio .db, ver db.js), y
// nunca el número de tarjeta real (eso lo guarda Izipay, acá solo su token).
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR, { recursive: true });

const registryDb = new Database(path.join(DATA_DIR, 'tenants_registry.db'));
registryDb.pragma('journal_mode = WAL');
registryDb.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  ruc TEXT PRIMARY KEY,
  razon_social TEXT NOT NULL,
  db_file TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aprobado | rechazado
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT,
  -- Evidencia de que aceptó Términos de Servicio / Política de Privacidad al
  -- registrarse (requerido, ver routes/auth.js) — queda como constancia.
  terminos_aceptados_at TEXT
);

CREATE TABLE IF NOT EXISTS pagos_plataforma (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruc TEXT NOT NULL,
  monto REAL NOT NULL,
  estado TEXT NOT NULL, -- exitoso | fallido
  izipay_cargo_id TEXT,
  mensaje TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// --- Migración: columnas de suscripción a la plataforma (costo que le
// corresponde pagar a cada empresa, y su tarjeta tokenizada en Izipay) ---
const tenantColumns = registryDb.prepare("PRAGMA table_info(tenants)").all().map((c) => c.name);
const TENANT_SUSCRIPCION_COLUMNS = [
  ['costo_mensual', 'REAL'], // en soles (S/); NULL = todavía sin asignar por el dueño de la plataforma
  ['fecha_inicio_suscripcion', 'TEXT'], // YYYY-MM-DD desde la que corre el cobro
  ['izipay_token', 'TEXT'], // paymentMethodToken guardado
  ['tarjeta_marca', 'TEXT'],
  ['tarjeta_ultimos4', 'TEXT'],
  ['ultimo_cobro_at', 'TEXT'],
  ['proximo_cobro_at', 'TEXT'],
  // sin_tarjeta | activa | pago_fallido
  ['suscripcion_estado', "TEXT NOT NULL DEFAULT 'sin_tarjeta'"],
  // Suspensión manual del dueño de la plataforma (distinta de "rechazado":
  // rechazado es una decisión al momento del registro, activo/inactivo se
  // puede alternar en cualquier momento, ej. por falta de pago, sin perder
  // el historial ni tener que volver a aprobar el registro).
  ['activo', 'INTEGER NOT NULL DEFAULT 1'],
  // Marca la fila que corresponde a la instalación base de este despliegue
  // (la que ya venía con la instancia, nunca pasó por "Registrar mi
  // empresa") — ver adoptarInstanciaBase más abajo. Es un cliente normal y
  // facturable como cualquier otro, solo que su db_file es la de siempre
  // (DEFAULT_DB_PATH) en vez de un archivo nuevo en /tenants.
  ['es_instalacion_base', 'INTEGER NOT NULL DEFAULT 0'],
  // Cuántas sedes puede crear esta empresa sin pedir permiso (ver
  // routes/sucursales.js del CRM). Al llegar a este número, la siguiente
  // sede queda como solicitud pendiente hasta que el dueño de la plataforma
  // la apruebe desde panel-central (ver setSedesLibres más abajo).
  ['sedes_libres', 'INTEGER NOT NULL DEFAULT 1'],
];
for (const [col, def] of TENANT_SUSCRIPCION_COLUMNS) {
  if (!tenantColumns.includes(col)) {
    registryDb.exec(`ALTER TABLE tenants ADD COLUMN ${col} ${def}`);
  }
}
const pagosPlataformaColumns = registryDb.prepare("PRAGMA table_info(pagos_plataforma)").all().map((c) => c.name);
if (!pagosPlataformaColumns.includes('izipay_cargo_id')) {
  registryDb.exec('ALTER TABLE pagos_plataforma ADD COLUMN izipay_cargo_id TEXT');
}

function tenantDbPath(ruc) {
  return path.join(TENANTS_DIR, `${ruc}.db`);
}

function findTenant(ruc) {
  return registryDb.prepare('SELECT * FROM tenants WHERE ruc = ?').get(ruc);
}

function listPendientes() {
  return registryDb.prepare("SELECT * FROM tenants WHERE estado = 'pendiente' ORDER BY created_at ASC").all();
}

function listTodos() {
  return registryDb.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
}

function crearTenant({ ruc, razon_social }) {
  const db_file = tenantDbPath(ruc);
  registryDb.prepare(
    `INSERT INTO tenants (ruc, razon_social, db_file, estado, terminos_aceptados_at) VALUES (?, ?, ?, 'pendiente', datetime('now'))`
  ).run(ruc, razon_social, db_file);
  return findTenant(ruc);
}

// La empresa que corre en la instalación base de este despliegue (la que
// ya venía con la instancia, nunca pasó por "Registrar mi empresa") es un
// cliente real como cualquier otro — el dueño de la plataforma la vende
// igual que a las que se auto-registran, solo que sus datos ya estaban acá
// desde el principio. Esto la da de alta en el registro (aprobada, activa,
// apuntando a la base de siempre en vez de crear una nueva) para que
// panel-central pueda facturarla igual que a las demás. Se llama al
// guardar Configuración → Datos de la empresa y al arrancar el servidor.
function adoptarInstanciaBase({ ruc, razon_social }) {
  if (!ruc || !razon_social) return null;
  const existingBase = registryDb.prepare('SELECT * FROM tenants WHERE es_instalacion_base = 1').get();
  if (existingBase && existingBase.ruc === ruc) {
    if (existingBase.razon_social !== razon_social) {
      registryDb.prepare('UPDATE tenants SET razon_social = ? WHERE ruc = ?').run(razon_social, ruc);
    }
    return findTenant(ruc);
  }
  // Si ese RUC ya pertenece a otra empresa (auto-registrada de verdad), no
  // se pisa — un RUC no debería repetirse, pero por seguridad no se toca.
  const conflicto = registryDb.prepare('SELECT * FROM tenants WHERE ruc = ? AND es_instalacion_base = 0').get(ruc);
  if (conflicto) return null;
  if (existingBase) {
    // El RUC de la instalación base cambió (se corrigió en Configuración):
    // se mueve la fila en vez de dejar una duplicada.
    registryDb.prepare('DELETE FROM tenants WHERE ruc = ?').run(existingBase.ruc);
  }
  registryDb.prepare(
    `INSERT INTO tenants (ruc, razon_social, db_file, estado, activo, es_instalacion_base, approved_at, terminos_aceptados_at)
     VALUES (?, ?, ?, 'aprobado', 1, 1, datetime('now'), datetime('now'))`
  ).run(ruc, razon_social, DEFAULT_DB_PATH);
  return findTenant(ruc);
}

function aprobarTenant(ruc) {
  registryDb.prepare(`UPDATE tenants SET estado = 'aprobado', approved_at = datetime('now') WHERE ruc = ?`).run(ruc);
  return findTenant(ruc);
}

function rechazarTenant(ruc) {
  registryDb.prepare(`UPDATE tenants SET estado = 'rechazado' WHERE ruc = ?`).run(ruc);
  return findTenant(ruc);
}

// Suspende/reactiva el acceso de una empresa ya aprobada (ver gating en
// routes/auth.js login) sin tocar su estado de aprobación ni su historial.
function activarTenant(ruc) {
  registryDb.prepare('UPDATE tenants SET activo = 1 WHERE ruc = ?').run(ruc);
  return findTenant(ruc);
}

function desactivarTenant(ruc) {
  registryDb.prepare('UPDATE tenants SET activo = 0 WHERE ruc = ?').run(ruc);
  return findTenant(ruc);
}

// --- Suscripción a la plataforma ---

// El dueño de la plataforma (panel central) define cuánto le corresponde
// pagar a esta empresa por mes, y desde cuándo. Si no se manda
// fecha_inicio_suscripcion explícita y la empresa todavía no tenía una, se
// usa hoy — así "Mis pagos" siempre puede mostrar una fecha de inicio real.
function setCosto(ruc, { costo_mensual, fecha_inicio_suscripcion }) {
  const tenant = findTenant(ruc);
  if (!tenant) return null;
  const fecha = fecha_inicio_suscripcion || tenant.fecha_inicio_suscripcion || hoyPeru();
  registryDb.prepare(
    'UPDATE tenants SET costo_mensual = ?, fecha_inicio_suscripcion = ? WHERE ruc = ?'
  ).run(costo_mensual, fecha, ruc);
  return findTenant(ruc);
}

// Cuántas sedes puede crear esta empresa sin pedir permiso — lo decide el
// dueño de la plataforma desde panel-central (Companies.jsx), igual que
// setCosto. No tiene tope superior propio: una empresa puede tener más
// sedes que sedes_libres (las que se le aprobaron a mano vía solicitud),
// solo que la siguiente por encima de este número vuelve a pedir permiso.
function setSedesLibres(ruc, cantidad) {
  registryDb.prepare('UPDATE tenants SET sedes_libres = ? WHERE ruc = ?').run(cantidad, ruc);
  return findTenant(ruc);
}

function guardarTarjeta(ruc, { izipay_token, tarjeta_marca, tarjeta_ultimos4 }) {
  const tenant = findTenant(ruc);
  if (!tenant) return null;
  // Si todavía no tenía fecha de inicio (el dueño de la plataforma no la
  // asignó a mano), arranca desde que se guarda la primera tarjeta.
  const fecha = tenant.fecha_inicio_suscripcion || hoyPeru();
  registryDb.prepare(
    `UPDATE tenants SET izipay_token = ?, tarjeta_marca = ?, tarjeta_ultimos4 = ?,
     fecha_inicio_suscripcion = ?, suscripcion_estado = 'activa', proximo_cobro_at = COALESCE(proximo_cobro_at, ?)
     WHERE ruc = ?`
  ).run(izipay_token, tarjeta_marca, tarjeta_ultimos4, fecha, fecha, ruc);
  return findTenant(ruc);
}

function quitarTarjeta(ruc) {
  registryDb.prepare(
    `UPDATE tenants SET izipay_token = NULL, tarjeta_marca = NULL, tarjeta_ultimos4 = NULL,
     suscripcion_estado = 'sin_tarjeta' WHERE ruc = ?`
  ).run(ruc);
  return findTenant(ruc);
}

function registrarPago(ruc, { monto, estado, izipay_cargo_id, mensaje, proximo_cobro_at }) {
  registryDb.prepare(
    'INSERT INTO pagos_plataforma (ruc, monto, estado, izipay_cargo_id, mensaje) VALUES (?, ?, ?, ?, ?)'
  ).run(ruc, monto, estado, izipay_cargo_id || null, mensaje || null);
  registryDb.prepare(
    `UPDATE tenants SET ultimo_cobro_at = datetime('now'), proximo_cobro_at = ?,
     suscripcion_estado = ? WHERE ruc = ?`
  ).run(proximo_cobro_at, estado === 'exitoso' ? 'activa' : 'pago_fallido', ruc);
  return listarPagos(ruc);
}

function listarPagos(ruc) {
  return registryDb.prepare('SELECT * FROM pagos_plataforma WHERE ruc = ? ORDER BY created_at DESC').all(ruc);
}

// Total cobrado con éxito a esta empresa por su suscripción a la
// plataforma — para mostrar "Ingresos" en panel-central.
function ingresoTotal(ruc) {
  const row = registryDb.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM pagos_plataforma WHERE ruc = ? AND estado = 'exitoso'`
  ).get(ruc);
  return row.total;
}

// Empresas con tarjeta activa cuyo próximo cobro ya venció — para el motor
// de cobro recurrente (ver utils/facturacionPlataforma.js). Una empresa
// suspendida (activo = 0) no se cobra mientras dure la suspensión.
function tenantsConCobroVencido() {
  const hoy = hoyPeru();
  return registryDb.prepare(
    `SELECT * FROM tenants
     WHERE estado = 'aprobado' AND activo = 1 AND izipay_token IS NOT NULL AND costo_mensual IS NOT NULL
       AND proximo_cobro_at IS NOT NULL AND proximo_cobro_at <= ?`
  ).all(hoy);
}

module.exports = {
  tenantDbPath, findTenant, listPendientes, listTodos, crearTenant, adoptarInstanciaBase, aprobarTenant,
  rechazarTenant, activarTenant, desactivarTenant, setCosto, setSedesLibres, guardarTarjeta, quitarTarjeta,
  registrarPago, listarPagos, ingresoTotal, tenantsConCobroVencido,
};
