const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR } = require('./db');

// Registro central de empresas registradas desde "Registrar mi empresa"
// (login → botón Registro). Es una base sqlite propia, separada de la de
// cada empresa: solo guarda a qué archivo .db corresponde cada RUC y si esa
// empresa ya fue aprobada — nunca datos de negocio (eso vive aislado en el
// .db de cada una, ver db.js).
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
  approved_at TEXT
);
`);

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
    `INSERT INTO tenants (ruc, razon_social, db_file, estado) VALUES (?, ?, ?, 'pendiente')`
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

module.exports = { tenantDbPath, findTenant, listPendientes, listTodos, crearTenant, aprobarTenant, rechazarTenant };
