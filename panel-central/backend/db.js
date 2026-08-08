const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

// Cuando corre integrado dentro del mismo despliegue que crm-facturacion
// (ver server.js de crm-facturacion), comparte el mismo disco persistente
// vía DATA_DIR — así panel.db sobrevive a los redeploys igual que crm.db.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'panel.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS platform_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Limpieza de la funcionalidad "empresas en otras instancias" (administrar
// remotamente una empresa con su propio despliegue de Render, vía URL +
// PLATFORM_TOKEN): se decidió no usarla — todos los clientes comparten esta
// misma instancia y se auto-registran (ver localTenants.js) — así que se
// quita la tabla si ya existía de una versión anterior.
db.exec('DROP TABLE IF EXISTS empresas_cliente');

// Seed idempotente: solo si no hay ningun admin de plataforma todavia.
const adminCount = db.prepare('SELECT COUNT(*) AS n FROM platform_admins').get().n;
if (adminCount === 0) {
  db.prepare('INSERT INTO platform_admins (email, password_hash, full_name) VALUES (?, ?, ?)')
    .run('dannyjesusnar@gmail.com', bcrypt.hashSync('26344711', 10), 'Danny');
}

module.exports = db;
