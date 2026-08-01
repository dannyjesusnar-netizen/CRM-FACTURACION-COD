const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'crm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_documento TEXT NOT NULL DEFAULT 'DNI',   -- DNI | RUC
  numero_documento TEXT NOT NULL,
  nombre TEXT NOT NULL,                          -- razon social o nombre completo
  direccion TEXT,
  telefono TEXT,
  email TEXT,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tipo_documento, numero_documento)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL DEFAULT 'producto',         -- producto | servicio
  categoria TEXT DEFAULT 'General',
  unidad TEXT NOT NULL DEFAULT 'NIU',
  precio_unitario REAL NOT NULL DEFAULT 0,
  stock REAL DEFAULT 0,
  stock_minimo REAL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_comprobante TEXT NOT NULL,                -- factura | boleta | nota_credito
  serie TEXT NOT NULL,
  numero INTEGER NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  created_by INTEGER REFERENCES users(id),       -- vendedor que emitio el comprobante
  fecha_emision TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'PEN',
  subtotal REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'emitido',        -- emitido | anulado
  observaciones TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tipo_comprobante, serie, numero)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  lote_id INTEGER REFERENCES lotes(id),
  tipo TEXT NOT NULL,                            -- venta | anulacion | ajuste | ingreso_lote
  cantidad REAL NOT NULL,                        -- positivo = ingreso, negativo = salida
  stock_resultante REAL,
  motivo TEXT,
  referencia TEXT,                               -- ej. numero de comprobante
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  codigo_lote TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'lote',             -- lote | serie
  fecha_vencimiento TEXT,                        -- NULL = sin vencimiento (ej. series)
  cantidad_inicial REAL NOT NULL DEFAULT 0,
  cantidad_actual REAL NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_item_lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
  lote_id INTEGER NOT NULL REFERENCES lotes(id),
  cantidad REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS caja_saldos_iniciales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT UNIQUE NOT NULL,
  saldo_inicial_efectivo REAL NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS caja_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL,                            -- ingreso | egreso
  medio TEXT NOT NULL,                           -- efectivo | tarjeta | banco | otros
  categoria TEXT NOT NULL,                       -- ventas | cuentas_cobrar | cuentas_pagar | compras | transferencia | otros
  monto REAL NOT NULL,
  descripcion TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sucursales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,
  direccion TEXT,
  es_principal INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sucursal_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  stock REAL NOT NULL DEFAULT 0,
  UNIQUE(product_id, sucursal_id)
);

CREATE TABLE IF NOT EXISTS traslados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo INTEGER,
  fecha TEXT DEFAULT (datetime('now')),
  sucursal_origen_id INTEGER NOT NULL REFERENCES sucursales(id),
  sucursal_destino_id INTEGER NOT NULL REFERENCES sucursales(id),
  estado TEXT NOT NULL DEFAULT 'completado',     -- completado | anulado
  observaciones TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS traslado_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  traslado_id INTEGER NOT NULL REFERENCES traslados(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  cantidad REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS recetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  product_id_salida INTEGER NOT NULL REFERENCES products(id),
  cantidad_salida REAL NOT NULL DEFAULT 1,
  tipo_produccion TEXT NOT NULL DEFAULT 'automatico', -- automatico | manual
  activo INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receta_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receta_id INTEGER NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  cantidad REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS producciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receta_id INTEGER NOT NULL REFERENCES recetas(id),
  cantidad_lotes REAL NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equivalencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  nombre TEXT NOT NULL,
  factor REAL NOT NULL DEFAULT 1,
  precio REAL,
  stock_minimo REAL,
  stock_maximo REAL,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// --- Migracion: agregar columnas nuevas a bases de datos ya existentes ---
const invoiceColumns = db.prepare("PRAGMA table_info(invoices)").all().map((c) => c.name);
if (!invoiceColumns.includes('created_by')) {
  db.exec('ALTER TABLE invoices ADD COLUMN created_by INTEGER REFERENCES users(id)');
}
const productColumns = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!productColumns.includes('categoria')) {
  db.exec("ALTER TABLE products ADD COLUMN categoria TEXT DEFAULT 'General'");
}
if (!productColumns.includes('stock_minimo')) {
  db.exec('ALTER TABLE products ADD COLUMN stock_minimo REAL DEFAULT 0');
}
const movementColumns = db.prepare("PRAGMA table_info(stock_movements)").all().map((c) => c.name);
if (!movementColumns.includes('lote_id')) {
  db.exec('ALTER TABLE stock_movements ADD COLUMN lote_id INTEGER REFERENCES lotes(id)');
}
if (!invoiceColumns.includes('forma_pago')) {
  db.exec("ALTER TABLE invoices ADD COLUMN forma_pago TEXT DEFAULT 'efectivo'");
}

// --- Seed inicial ---
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
  );
  insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'Administrador', 'gerencia');
  insertUser.run('vendedor1', bcrypt.hashSync('vendedor123', 10), 'Carlos Ramírez', 'vendedor');
  insertUser.run('vendedor2', bcrypt.hashSync('vendedor123', 10), 'Lucía Fernández', 'vendedor');
}

const clientCount = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
if (clientCount === 0) {
  const insertClient = db.prepare(
    'INSERT INTO clients (tipo_documento, numero_documento, nombre, direccion, telefono, email) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertClient.run('RUC', '20123456789', 'Comercial Los Andes S.A.C.', 'Av. Javier Prado 123, Lima', '014567890', 'contacto@losandes.com');
  insertClient.run('DNI', '45678912', 'Maria Fernanda Torres', 'Jr. Union 456, Lima', '987654321', 'mftorres@gmail.com');
  insertClient.run('RUC', '20456789123', 'Distribuidora Peru Norte E.I.R.L.', 'Calle Los Pinos 789, Trujillo', '044556677', 'ventas@perunorte.com');
}

const productCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (productCount === 0) {
  const insertProduct = db.prepare(
    `INSERT INTO products (codigo, nombre, descripcion, tipo, categoria, unidad, precio_unitario, stock, stock_minimo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertProduct.run('P001', 'Servicio de Consultoria', 'Consultoria empresarial por hora', 'servicio', 'Servicios', 'ZZ', 150, null, null);
  insertProduct.run('P002', 'Laptop HP 15"', 'Laptop HP 15 pulgadas, 8GB RAM, 512GB SSD', 'producto', 'Tecnología', 'NIU', 2200, 15, 5);
  insertProduct.run('P003', 'Licencia Software Anual', 'Licencia anual de software administrativo', 'servicio', 'Servicios', 'ZZ', 480, null, null);
  insertProduct.run('P004', 'Resma de Papel A4', 'Resma de papel bond A4, 500 hojas', 'producto', 'Útiles de oficina', 'NIU', 14.5, 200, 20);
  insertProduct.run('P005', 'Creatina Monohidratada 500gr', 'Creatina monohidratada en polvo, envase 500gr', 'producto', 'Suplementos', 'NIU', 89.9, 0, 5);
  insertProduct.run('P006', 'Proteína Whey 1kg', 'Proteína whey sabor chocolate, envase 1kg', 'producto', 'Suplementos', 'NIU', 149.9, 0, 5);
  insertProduct.run('P007', 'Mix Pre-Entreno a Granel (Kg)', 'Insumo a granel para envasado de pre-entreno', 'producto', 'Insumos', 'KGM', 45, 10, 2);
  insertProduct.run('P008', 'Pre-Entreno 30gr (envase individual)', 'Envase individual de pre-entreno, producido a partir del mix a granel', 'producto', 'Suplementos', 'NIU', 6.9, 0, 20);
}

// Lotes de ejemplo (con vencimiento) para los productos de suplementos
const loteCount = db.prepare('SELECT COUNT(*) AS n FROM lotes').get().n;
if (loteCount === 0) {
  const creatina = db.prepare("SELECT id FROM products WHERE codigo = 'P005'").get();
  const proteina = db.prepare("SELECT id FROM products WHERE codigo = 'P006'").get();
  const insertLote = db.prepare(
    `INSERT INTO lotes (product_id, codigo_lote, tipo, fecha_vencimiento, cantidad_inicial, cantidad_actual)
     VALUES (?, ?, 'lote', ?, ?, ?)`
  );
  const addStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  if (creatina) {
    insertLote.run(creatina.id, 'CRE-2026-01', '2026-09-15', 12, 12);
    insertLote.run(creatina.id, 'CRE-2026-02', '2027-03-01', 30, 30);
    addStock.run(42, creatina.id);
  }
  if (proteina) {
    insertLote.run(proteina.id, 'PRO-2026-01', '2027-06-30', 20, 20);
    addStock.run(20, proteina.id);
  }
}

// Sucursales de ejemplo (Miraflores es la principal: concentra el stock existente)
const sucursalCount = db.prepare('SELECT COUNT(*) AS n FROM sucursales').get().n;
if (sucursalCount === 0) {
  const insertSucursal = db.prepare('INSERT INTO sucursales (nombre, direccion, es_principal) VALUES (?, ?, ?)');
  insertSucursal.run('Miraflores', 'Av. Larco 123, Miraflores', 1);
  insertSucursal.run('San Borja', 'Av. San Borja Norte 456, San Borja', 0);
  insertSucursal.run('Jesús María', 'Av. Salaverry 789, Jesús María', 0);
}

// Receta de ejemplo (Producción): envasado de pre-entreno a partir del mix a granel
const recetaCount = db.prepare('SELECT COUNT(*) AS n FROM recetas').get().n;
if (recetaCount === 0) {
  const mix = db.prepare("SELECT id FROM products WHERE codigo = 'P007'").get();
  const preEntreno = db.prepare("SELECT id FROM products WHERE codigo = 'P008'").get();
  if (mix && preEntreno) {
    const info = db.prepare(
      `INSERT INTO recetas (nombre, descripcion, product_id_salida, cantidad_salida, tipo_produccion)
       VALUES (?, ?, ?, ?, 'automatico')`
    ).run('Envasado Pre-Entreno 30gr', 'Envasa 1kg del mix a granel en 33 unidades de 30gr', preEntreno.id, 33);
    db.prepare('INSERT INTO receta_items (receta_id, product_id, cantidad) VALUES (?, ?, ?)').run(info.lastInsertRowid, mix.id, 1);
  }
}

module.exports = db;
