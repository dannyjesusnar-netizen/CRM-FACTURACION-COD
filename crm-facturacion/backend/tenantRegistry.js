const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR } = require('./db');

// Registro central de empresas registradas desde "Registrar mi empresa"
// (login → botón Registro). Es una base sqlite propia, separada de la de
// cada empresa: solo guarda a qué archivo .db corresponde cada RUC, si esa
// empresa ya fue aprobada, y su suscripción a la plataforma (costo mensual,
// tarjeta tokenizada en Culqi, historial de cobros) — nunca datos de
// negocio de la empresa (eso vive aislado en su propio .db, ver db.js), y
// nunca el número de tarjeta real (eso lo guarda Culqi, acá solo sus IDs).
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
  culqi_cargo_id TEXT,
  mensaje TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// --- Migración: columnas de suscripción a la plataforma (costo que le
// corresponde pagar a cada empresa, y su tarjeta tokenizada en Culqi) ---
const tenantColumns = registryDb.prepare("PRAGMA table_info(tenants)").all().map((c) => c.name);
const TENANT_SUSCRIPCION_COLUMNS = [
  ['costo_mensual', 'REAL'], // en soles (S/); NULL = todavía sin asignar por el dueño de la plataforma
  ['fecha_inicio_suscripcion', 'TEXT'], // YYYY-MM-DD desde la que corre el cobro
  ['culqi_customer_id', 'TEXT'],
  ['culqi_card_id', 'TEXT'],
  ['tarjeta_marca', 'TEXT'],
  ['tarjeta_ultimos4', 'TEXT'],
  ['ultimo_cobro_at', 'TEXT'],
  ['proximo_cobro_at', 'TEXT'],
  // sin_tarjeta | activa | pago_fallido
  ['suscripcion_estado', "TEXT NOT NULL DEFAULT 'sin_tarjeta'"],
];
for (const [col, def] of TENANT_SUSCRIPCION_COLUMNS) {
  if (!tenantColumns.includes(col)) {
    registryDb.exec(`ALTER TABLE tenants ADD COLUMN ${col} ${def}`);
  }
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

function aprobarTenant(ruc) {
  registryDb.prepare(`UPDATE tenants SET estado = 'aprobado', approved_at = datetime('now') WHERE ruc = ?`).run(ruc);
  return findTenant(ruc);
}

function rechazarTenant(ruc) {
  registryDb.prepare(`UPDATE tenants SET estado = 'rechazado' WHERE ruc = ?`).run(ruc);
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
  const fecha = fecha_inicio_suscripcion || tenant.fecha_inicio_suscripcion || new Date().toISOString().slice(0, 10);
  registryDb.prepare(
    'UPDATE tenants SET costo_mensual = ?, fecha_inicio_suscripcion = ? WHERE ruc = ?'
  ).run(costo_mensual, fecha, ruc);
  return findTenant(ruc);
}

function guardarTarjeta(ruc, { culqi_customer_id, culqi_card_id, tarjeta_marca, tarjeta_ultimos4 }) {
  const tenant = findTenant(ruc);
  if (!tenant) return null;
  // Si todavía no tenía fecha de inicio (el dueño de la plataforma no la
  // asignó a mano), arranca desde que se guarda la primera tarjeta.
  const fecha = tenant.fecha_inicio_suscripcion || new Date().toISOString().slice(0, 10);
  registryDb.prepare(
    `UPDATE tenants SET culqi_customer_id = ?, culqi_card_id = ?, tarjeta_marca = ?, tarjeta_ultimos4 = ?,
     fecha_inicio_suscripcion = ?, suscripcion_estado = 'activa', proximo_cobro_at = COALESCE(proximo_cobro_at, ?)
     WHERE ruc = ?`
  ).run(culqi_customer_id, culqi_card_id, tarjeta_marca, tarjeta_ultimos4, fecha, fecha, ruc);
  return findTenant(ruc);
}

function quitarTarjeta(ruc) {
  registryDb.prepare(
    `UPDATE tenants SET culqi_customer_id = NULL, culqi_card_id = NULL, tarjeta_marca = NULL, tarjeta_ultimos4 = NULL,
     suscripcion_estado = 'sin_tarjeta' WHERE ruc = ?`
  ).run(ruc);
  return findTenant(ruc);
}

function registrarPago(ruc, { monto, estado, culqi_cargo_id, mensaje, proximo_cobro_at }) {
  registryDb.prepare(
    'INSERT INTO pagos_plataforma (ruc, monto, estado, culqi_cargo_id, mensaje) VALUES (?, ?, ?, ?, ?)'
  ).run(ruc, monto, estado, culqi_cargo_id || null, mensaje || null);
  registryDb.prepare(
    `UPDATE tenants SET ultimo_cobro_at = datetime('now'), proximo_cobro_at = ?,
     suscripcion_estado = ? WHERE ruc = ?`
  ).run(proximo_cobro_at, estado === 'exitoso' ? 'activa' : 'pago_fallido', ruc);
  return listarPagos(ruc);
}

function listarPagos(ruc) {
  return registryDb.prepare('SELECT * FROM pagos_plataforma WHERE ruc = ? ORDER BY created_at DESC').all(ruc);
}

// Empresas con tarjeta activa cuyo próximo cobro ya venció — para el motor
// de cobro recurrente (ver utils/facturacionPlataforma.js).
function tenantsConCobroVencido() {
  const hoy = new Date().toISOString().slice(0, 10);
  return registryDb.prepare(
    `SELECT * FROM tenants
     WHERE estado = 'aprobado' AND culqi_card_id IS NOT NULL AND costo_mensual IS NOT NULL
       AND proximo_cobro_at IS NOT NULL AND proximo_cobro_at <= ?`
  ).all(hoy);
}

module.exports = {
  tenantDbPath, findTenant, listPendientes, listTodos, crearTenant, aprobarTenant, rechazarTenant,
  setCosto, guardarTarjeta, quitarTarjeta, registrarPago, listarPagos, tenantsConCobroVencido,
};
