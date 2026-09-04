const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { siguienteSerieDisponible, SERIE_BASE_POR_TIPO } = require('./utils/serieCodegen');

// DATA_DIR es configurable para poder apuntar a un disco persistente de
// Render (plan pago) montado, por ejemplo, en /var/data — sin la variable,
// se comporta igual que siempre (carpeta local, se pierde en cada redeploy
// en el plan Free).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// initSchema crea/migra el esquema completo y siembra datos iniciales sobre
// CUALQUIER conexión sqlite que se le pase — es lo que permite que cada
// empresa registrada (ver tenantRegistry.js) tenga su propia base de datos
// aislada con exactamente la misma estructura, sin duplicar este archivo.
//
// opts:
//  - demo (default true): siembra los datos de ejemplo históricos (clientes,
//    productos, proveedores, sedes de muestra). Las empresas que se
//    registran desde el botón "Registrar mi empresa" arrancan con demo:false
//    (solo catálogos universales: métodos de pago, series, sede principal,
//    cliente genérico "CLIENTES VARIOS" — nada de datos ficticios de otro
//    negocio).
//  - empresa: { razon_social, ruc, nombre_comercial, direccion_fiscal,
//    telefono, email } — datos reales de la empresa nueva, en vez del
//    placeholder "MI EMPRESA S.A.C."
//  - primerUsuario: { username, password_hash, full_name, dni, nombres,
//    apellidos, email } — cuenta Gerencia real con la que se registró la
//    empresa, en vez de los usuarios de demostración admin/vendedor1/vendedor2.
function initSchema(db, opts = {}) {
  const demo = opts.demo !== false;

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

-- Historial de cobros contra una venta "abonado" (crédito): cada abono o
-- pago posterior queda registrado aquí, además de sumarse a
-- invoices.monto_pagado y reflejarse en Caja (categoria 'cuentas_cobrar').
CREATE TABLE IF NOT EXISTS cobros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  monto REAL NOT NULL,
  medio TEXT NOT NULL,                           -- efectivo | tarjeta | banco | otros
  observacion TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
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

-- Cuando Gerencia llega al número de sedes que puede crear libremente (ver
-- tenants.sedes_libres en tenantRegistry.js, panel-central), pedir una sede
-- adicional queda registrado acá en vez de crearla directo: el proveedor la
-- aprueba o rechaza desde panel-central (ver localTenants.js:
-- resolverSolicitudSede) — al aprobarla, crea la sede tal cual fue pedida.
CREATE TABLE IF NOT EXISTS solicitudes_sede (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  nombre_usuario TEXT,
  nombre TEXT NOT NULL,
  direccion TEXT,
  motivo TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aprobada | rechazada
  respuesta TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resuelto_at TEXT
);

-- Catálogo de métodos de pago configurable por Gerencia (Configuración ->
-- Métodos de pago). "codigo" es el valor real que se guarda en
-- invoices.forma_pago / cobros.medio / caja_movimientos.medio — por eso es
-- único e inmutable una vez creado (renombrar "nombre" sí se puede).
CREATE TABLE IF NOT EXISTS metodos_pago (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'otro',        -- efectivo | billetera | pos | transferencia | link | otro
  color TEXT NOT NULL DEFAULT '#0f4c81',
  icono TEXT NOT NULL DEFAULT '💳',
  orden INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  qr_data_url TEXT,                          -- foto/captura del QR real (Yape, Plin, etc.), en base64
  link_pago TEXT,                            -- URL de pago (yape.me, link de una pasarela, etc.)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Serie y siguiente correlativo de cada tipo de documento que el sistema
-- realmente emite (Configuración -> Series y Sucursal), por SEDE — SUNAT
-- exige que cada punto de emisión tenga su propia serie, nunca compartida
-- con otra sede. El correlativo real que se usa al emitir siempre es el
-- mayor entre "MAX(numero) ya usado" y lo guardado aquí — así Gerencia
-- puede adelantar el número (para retomar una numeración física ya usada)
-- sin arriesgarse nunca a repetir uno existente.
CREATE TABLE IF NOT EXISTS series_config (
  tipo_documento TEXT NOT NULL,      -- factura | boleta | nota_credito | cotizacion | guia_remitente | orden_compra | orden_servicio
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  serie TEXT NOT NULL,
  siguiente_numero INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tipo_documento, sucursal_id)
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

-- Recuerda qué producto del catálogo corresponde a un nombre tal como lo
-- escribe un proveedor en su guía (que casi nunca coincide exactamente con
-- el nombre interno que usa el cliente). Se llena solo, la primera vez que
-- alguien vincula manualmente un ítem sin match automático a un producto
-- existente (ver utils/productoAlias.js) — desde ahí en adelante, cualquier
-- guía/foto que traiga ese mismo texto empareja sola, sin volver a preguntar.
CREATE TABLE IF NOT EXISTS product_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  alias_normalizado TEXT NOT NULL UNIQUE,
  alias_original TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruc TEXT,
  nombre TEXT NOT NULL,
  direccion TEXT,
  telefono TEXT,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  created_by INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL,
  forma_pago TEXT NOT NULL DEFAULT 'efectivo',
  subtotal REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'registrada',    -- registrada | anulada
  observaciones TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  cantidad REAL NOT NULL,
  costo_unitario REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0
);

-- Orden de Compra: una solicitud al proveedor, todavía no es una compra
-- recibida (no afecta stock). "Recepción de Compras" la convertirá en una
-- compra real más adelante.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  created_by INTEGER REFERENCES users(id),
  fecha TEXT NOT NULL,
  serie TEXT,
  numero_doc TEXT,
  moneda TEXT NOT NULL DEFAULT 'PEN',
  tipo_cambio REAL NOT NULL DEFAULT 1,
  tipo_compra TEXT NOT NULL DEFAULT 'mercaderia',
  tipo_operacion TEXT NOT NULL DEFAULT 'gravada_exportacion',
  descuento_pct REAL NOT NULL DEFAULT 0,
  percepcion REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  no_gravado REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | recibida | anulada
  observaciones TEXT,
  sucursal_id INTEGER REFERENCES sucursales(id),
  fecha_recepcion TEXT,
  tipo_documento TEXT NOT NULL DEFAULT 'orden_compra',  -- orden_compra | orden_servicio
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  cantidad REAL NOT NULL,
  costo_unitario REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  observacion TEXT,
  unidad TEXT NOT NULL DEFAULT 'UND',
  afectacion_igv TEXT NOT NULL DEFAULT 'gravado'
);

-- Catálogo administrable de "Tipo de Compra" (antes una lista fija en el
-- código). "categoria" y "clasificacion_libros" quedan como texto libre a
-- propósito: no fabricamos el catálogo contable/tributario oficial, cada
-- empresa los define a su manera.
CREATE TABLE IF NOT EXISTS tipos_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria TEXT NOT NULL,
  nombre TEXT NOT NULL,
  glosa_observacion TEXT,
  clasificacion_libros TEXT,
  destino_compra TEXT NOT NULL DEFAULT 'centro_costo',  -- centro_costo | ingreso_inventario
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tipo de inventario de un producto (Mercaderías, Materia Prima, Producto
-- Terminado, etc.) — antes era una lista fija en el frontend (products.js
-- guardaba lo que le llegara como texto libre, sin validarlo); ahora es un
-- catálogo editable, mismo criterio que tipos_compra.
CREATE TABLE IF NOT EXISTS tipos_inventario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serie TEXT NOT NULL DEFAULT 'CL02',
  numero INTEGER NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  created_by INTEGER REFERENCES users(id),
  fecha_emision TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'PEN',
  subtotal REAL NOT NULL DEFAULT 0,
  igv REAL NOT NULL DEFAULT 0,
  descuento_global_pct REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'vigente',        -- vigente | anulada
  observaciones TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(serie, numero)
);

CREATE TABLE IF NOT EXISTS cotizacion_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL DEFAULT 0,
  descuento_pct REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS guias_remitentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serie TEXT NOT NULL DEFAULT 'TL02',
  numero INTEGER NOT NULL,
  motivo_traslado TEXT NOT NULL DEFAULT 'venta',
  client_id INTEGER REFERENCES clients(id),
  punto_partida TEXT,
  punto_llegada TEXT,
  peso_total REAL NOT NULL DEFAULT 0,
  cantidad_bultos INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'emitida',        -- emitida | anulada
  observaciones TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(serie, numero)
);

CREATE TABLE IF NOT EXISTS guia_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guia_id INTEGER NOT NULL REFERENCES guias_remitentes(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  peso_unitario REAL NOT NULL DEFAULT 0,
  peso_subtotal REAL NOT NULL DEFAULT 0
);

-- Documento de venta SIN efectos tributarios (no lo reconoce SUNAT como
-- comprobante de pago, no lleva IGV) — distinto de una Boleta vendida al
-- crédito (esa sigue siendo un comprobante fiscal real, ver invoices con
-- forma_pago='abonado'). Serie propia "NV01" por sede (ver
-- utils/serieCodegen.js / utils/series.js), sí descuenta stock real porque
-- representa una venta real, solo que no fiscal.
CREATE TABLE IF NOT EXISTS notas_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serie TEXT NOT NULL DEFAULT 'NV01',
  numero INTEGER NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  created_by INTEGER REFERENCES users(id),
  sucursal_id INTEGER REFERENCES sucursales(id),
  fecha_emision TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'PEN',
  descuento_global_pct REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  forma_pago TEXT,
  estado TEXT NOT NULL DEFAULT 'emitido',        -- emitido | anulado
  observaciones TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(serie, numero)
);

CREATE TABLE IF NOT EXISTS nota_venta_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_venta_id INTEGER NOT NULL REFERENCES notas_venta(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  descripcion TEXT NOT NULL,
  cantidad REAL NOT NULL DEFAULT 1,
  precio_unitario REAL NOT NULL DEFAULT 0,
  descuento_pct REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0
);

-- Historial de cobros contra una Nota de Venta Interna "abonado" (crédito):
-- mismo patrón que la tabla "cobros" de invoices, pero separada porque
-- notas_venta es una tabla propia (no fiscal). Cada abono actualiza
-- notas_venta.monto_pagado y se refleja en Caja (categoria 'cuentas_cobrar').
CREATE TABLE IF NOT EXISTS nota_venta_cobros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nota_venta_id INTEGER NOT NULL REFERENCES notas_venta(id),
  monto REAL NOT NULL,
  medio TEXT NOT NULL,
  observacion TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Datos legales del negocio que usa esta instancia del CRM (emisor de los
-- comprobantes). Tabla singleton: siempre existe una única fila con id = 1.
CREATE TABLE IF NOT EXISTS empresa_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  razon_social TEXT,
  ruc TEXT,
  nombre_comercial TEXT,
  direccion_fiscal TEXT,
  telefono TEXT,
  email TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);

-- Mensajes que cualquier cuenta le escribe al asistente ODIN (widget
-- flotante del CRM). Por ahora no hay respuesta automática con IA: cada
-- mensaje llega al panel-central del dueño de la plataforma para que lo
-- lea (ver routes/mensajesSoporte.js y routes/platform.js).
CREATE TABLE IF NOT EXISTS mensajes_soporte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  nombre_usuario TEXT,
  mensaje TEXT NOT NULL,
  leido INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Registro de pagos recibidos por Yape/Plin (pantalla "QR Único") —
-- control manual con foto de respaldo del comprobante. monto_detectado es
-- lo que el OCR leyó de la foto (puede ser NULL si no detectó nada); monto
-- es el valor final que confirma quien registra el pago, siempre editable.
CREATE TABLE IF NOT EXISTS pagos_qr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medio TEXT NOT NULL,                       -- yape | plin
  monto REAL NOT NULL,
  monto_detectado REAL,
  foto_data_url TEXT NOT NULL,
  sucursal_id INTEGER REFERENCES sucursales(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Datos propios de la pantalla "QR Único" (Menú → QR Único) — totalmente
-- separados de metodos_pago (que es lo que se usa al Cobrar una venta en
-- Ventas). Un QR único genérico (generado con la librería qrcode, ver
-- routes/qrUnico.js) apunta a /pago/:ruc, una página pública donde el
-- cliente elige Yape o Plin y ve estos datos para pagar desde su app.
CREATE TABLE IF NOT EXISTS qr_unico_medios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medio TEXT NOT NULL UNIQUE,                -- yape | plin
  qr_data_url TEXT,                          -- foto del QR real de esa app (opcional)
  titular_nombre TEXT,
  titular_telefono TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

  // --- Migracion: agregar columnas nuevas a bases de datos ya existentes ---
  const invoiceColumns = db.prepare("PRAGMA table_info(invoices)").all().map((c) => c.name);
  if (!invoiceColumns.includes('created_by')) {
    db.exec('ALTER TABLE invoices ADD COLUMN created_by INTEGER REFERENCES users(id)');
  }
  const clientColumns = db.prepare("PRAGMA table_info(clients)").all().map((c) => c.name);
  if (!clientColumns.includes('sucursal_id')) {
    db.exec('ALTER TABLE clients ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)');
  }
  if (!clientColumns.includes('turno')) {
    db.exec('ALTER TABLE clients ADD COLUMN turno TEXT');
  }
  if (!clientColumns.includes('referencia')) {
    db.exec('ALTER TABLE clients ADD COLUMN referencia TEXT');
  }
  if (!clientColumns.includes('contacto')) {
    db.exec('ALTER TABLE clients ADD COLUMN contacto TEXT');
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
  if (!invoiceColumns.includes('descuento_global_pct')) {
    db.exec('ALTER TABLE invoices ADD COLUMN descuento_global_pct REAL DEFAULT 0');
  }
  const invoiceItemColumns = db.prepare("PRAGMA table_info(invoice_items)").all().map((c) => c.name);
  if (!invoiceItemColumns.includes('descuento_pct')) {
    db.exec('ALTER TABLE invoice_items ADD COLUMN descuento_pct REAL DEFAULT 0');
  }
  if (!invoiceItemColumns.includes('igv_item')) {
    db.exec('ALTER TABLE invoice_items ADD COLUMN igv_item REAL DEFAULT 0');
  }
  const INVOICE_NC_COLUMNS = [
    ['modifica_tipo', "TEXT"],
    ['modifica_serie', "TEXT"],
    ['modifica_numero', "INTEGER"],
    ['tipo_nota', "TEXT"],
  ];
  for (const [col, def] of INVOICE_NC_COLUMNS) {
    if (!invoiceColumns.includes(col)) {
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col} ${def}`);
    }
  }
  // Facturación electrónica real (OSE/SUNAT). modo_emision = 'simulado' hasta
  // que el servidor tenga credenciales de un OSE configuradas (ver
  // backend/utils/facturacionElectronica.js); sunat_estado refleja la
  // respuesta real del OSE (aceptado | rechazado | error | null).
  const INVOICE_SUNAT_COLUMNS = [
    ['modo_emision', "TEXT DEFAULT 'simulado'"],
    ['sunat_estado', "TEXT"],
    ['sunat_hash', "TEXT"],
    ['sunat_pdf_url', "TEXT"],
    ['sunat_xml_url', "TEXT"],
    ['sunat_cdr_url', "TEXT"],
    ['sunat_mensaje', "TEXT"],
  ];
  for (const [col, def] of INVOICE_SUNAT_COLUMNS) {
    if (!invoiceColumns.includes(col)) {
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col} ${def}`);
    }
  }
  // Ventas "abonado" (crédito): monto_pagado es lo realmente cobrado hasta
  // ahora (puede ser menor al total); para efectivo/tarjeta/banco siempre es
  // igual al total (se asume pagado por completo, como hasta ahora). Las
  // facturas/boletas que ya existían antes de esta columna quedan como
  // pagadas por completo (comportamiento anterior sin cambios).
  if (!invoiceColumns.includes('monto_pagado')) {
    db.exec('ALTER TABLE invoices ADD COLUMN monto_pagado REAL');
    db.exec('UPDATE invoices SET monto_pagado = total WHERE monto_pagado IS NULL');
  }
  // Las ventas a crédito (fiado) ahora se registran únicamente como Nota de
  // Venta Interna (sin IGV) — mismo mecanismo de monto_pagado que invoices,
  // ver nota_venta_cobros más abajo.
  const notaVentaColumns = db.prepare("PRAGMA table_info(notas_venta)").all().map((c) => c.name);
  if (!notaVentaColumns.includes('monto_pagado')) {
    db.exec('ALTER TABLE notas_venta ADD COLUMN monto_pagado REAL');
    db.exec('UPDATE notas_venta SET monto_pagado = total WHERE monto_pagado IS NULL');
  }
  const PRODUCT_NEW_COLUMNS = [
    ['codigo_barras', "TEXT"],
    ['afectacion_igv', "TEXT DEFAULT 'gravado'"],
    ['control', "TEXT DEFAULT 'ninguno'"],
    ['tipo_inventario', "TEXT DEFAULT 'MERCADERIAS'"],
    ['tipo_clasificacion', "TEXT DEFAULT 'Otros'"],
    ['subtipo_clasificacion', "TEXT DEFAULT 'Otros'"],
    ['peso', "REAL"],
    ['favorito', "INTEGER DEFAULT 0"],
    ['precio_compra', "REAL"],
    ['palabras_clave', "TEXT"],
    ['proveedor_id', "INTEGER REFERENCES suppliers(id)"],
    ['precio_mayorista', "REAL"],
    ['precio_distribuidor', "REAL"],
  ];
  for (const [col, def] of PRODUCT_NEW_COLUMNS) {
    if (!productColumns.includes(col)) {
      db.exec(`ALTER TABLE products ADD COLUMN ${col} ${def}`);
    }
  }
  // Roles personalizados con permisos por módulo (Configuración → Roles de
  // usuario). Solo Gerencia los administra y asigna, para no permitir que un
  // rol se otorgue a sí mismo más acceso del que tiene quien lo crea.
  db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS role_permisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  habilitado INTEGER NOT NULL DEFAULT 0,
  UNIQUE(role_id, modulo)
);
CREATE TABLE IF NOT EXISTS role_acciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  accion TEXT NOT NULL,
  habilitado INTEGER NOT NULL DEFAULT 1,
  UNIQUE(role_id, modulo, accion)
);
`);

  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  const USER_NEW_COLUMNS = [
    ['activo', 'INTEGER NOT NULL DEFAULT 1'],
    ['dni', 'TEXT'],
    // sucursal_id fija = el usuario (vendedor) solo opera en esa sede; NULL =
    // acceso a todas las sedes de la empresa (gerencia), elige una por sesión.
    ['sucursal_id', 'INTEGER REFERENCES sucursales(id)'],
    // nombres/apellidos son la fuente para el formulario de Empleados;
    // full_name se sigue calculando a partir de ellos para no romper PDFs,
    // reportes y badges que ya lo usan tal cual.
    ['nombres', 'TEXT'],
    ['apellidos', 'TEXT'],
    ['email', 'TEXT'],
    ['telefono', 'TEXT'],
    // custom_role_id: rol personalizado (ver tabla roles) con permisos por
    // módulo. NULL = sin restricciones extra (compatibilidad con cuentas
    // creadas antes de que existiera este sistema). Gerencia nunca lo usa:
    // siempre tiene acceso completo, sea cual sea este valor.
    ['custom_role_id', 'INTEGER REFERENCES roles(id)'],
    // categoria_staff: agrupación para el Tablero de Ventas (Ranking
    // Trainers/Vendedores/Supervisores) — independiente del rol de permisos
    // (role/custom_role_id), que sigue gobernando el acceso al sistema.
    ['categoria_staff', "TEXT DEFAULT 'vendedor'"],
    // turno del empleado (mañana/tarde), mismo patrón que clients.turno.
    ['turno', 'TEXT'],
    // puede_iniciar_sesion = 0: "registro operativo" (Trainer / Supervisor
    // operativo) creado solo para que el Tablero de Ventas y la atribución
    // de ventas (invoices.atribuido_a) tengan a quién sumarle — nunca inicia
    // sesión, no factura nada. Se les bloquea el login en auth.js. Todos los
    // empleados existentes (y los nuevos por defecto) quedan en 1.
    ['puede_iniciar_sesion', 'INTEGER NOT NULL DEFAULT 1'],
  ];
  for (const [col, def] of USER_NEW_COLUMNS) {
    if (!userColumns.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    }
  }

  // Metas de venta: Gerencia asigna un monto "pool" por sede y categoría de
  // personal (vendedor/trainer) cada mes — no una meta individual por
  // persona. Ese monto se reparte en partes iguales entre los empleados
  // activos de esa categoría en esa sede al calcular el Tablero de Ventas
  // (ver routes/tablero.js). Reemplaza la tabla metas_venta (meta por
  // empleado) de la primera versión del Tablero — nunca llegó a tener datos
  // reales, así que se elimina en vez de migrarla.
  db.exec('DROP TABLE IF EXISTS metas_venta');
  db.exec(`
CREATE TABLE IF NOT EXISTS metas_venta_sede (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  categoria_staff TEXT NOT NULL,
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  monto_meta REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(sucursal_id, categoria_staff, anio, mes)
);
`);

  // dotacion: cantidad de personas sobre la que Gerencia quiere repartir el
  // pool, asignada a mano (no siempre coincide con los empleados activos
  // registrados hoy — puede ser la dotación planeada del equipo). En 0
  // (sin asignar), routes/tablero.js sigue repartiendo entre los empleados
  // activos reales, igual que antes de que existiera este campo.
  const metasVentaSedeColumns = db.prepare("PRAGMA table_info(metas_venta_sede)").all().map((c) => c.name);
  if (!metasVentaSedeColumns.includes('dotacion')) {
    db.exec('ALTER TABLE metas_venta_sede ADD COLUMN dotacion INTEGER NOT NULL DEFAULT 0');
  }

  const empresaColumns = db.prepare("PRAGMA table_info(empresa_config)").all().map((c) => c.name);
  const EMPRESA_NEW_COLUMNS = [
    // Texto libre: no fabricamos el catálogo oficial CIIU/MCC de SUNAT.
    ['actividad_ciiu', 'TEXT'],
    ['actividad_mcc', 'TEXT'],
    ['departamento', 'TEXT'],
    // Provincia/distrito en texto libre: el catálogo UBIGEO completo del Perú
    // (~1874 distritos) no está embebido aquí para no arriesgar datos
    // incorrectos en una dirección fiscal real.
    ['provincia', 'TEXT'],
    ['distrito', 'TEXT'],
    ['logo_data_url', 'TEXT'],
    ['color_acento', "TEXT DEFAULT '#0f4c81'"],
    ['mostrar_logo_pdf', 'INTEGER NOT NULL DEFAULT 1'],
    ['mostrar_datos_contacto_pdf', 'INTEGER NOT NULL DEFAULT 1'],
    ['tamano_pdf', "TEXT NOT NULL DEFAULT 'A4'"],
    ['terminos_condiciones_pdf', 'TEXT'],
    ['igv_rate', 'REAL NOT NULL DEFAULT 0.18'],
    // Color de la franja superior de cada panel del Tablero de Ventas
    // (Dashboard → Hoja 1), independiente de color_acento (que es el color
    // de marca usado en los PDF de comprobantes).
    ['color_tablero_ventas', "TEXT DEFAULT '#16a34a'"],
  ];
  for (const [col, def] of EMPRESA_NEW_COLUMNS) {
    if (!empresaColumns.includes(col)) {
      db.exec(`ALTER TABLE empresa_config ADD COLUMN ${col} ${def}`);
    }
  }

  // Separación real por sede: cada venta, compra, movimiento de stock y
  // movimiento de caja queda ligado a una sucursal concreta.
  if (!invoiceColumns.includes('sucursal_id')) {
    db.exec('ALTER TABLE invoices ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)');
  }
  // atribuido_a: el vendedor que registra la venta puede elegir que la
  // venta cuente para un entrenador en vez de para él mismo, en el Ranking
  // del Tablero de Ventas (ver routes/tablero.js). NULL = se atribuye a
  // created_by (el vendedor), como siempre — created_by sigue siendo quien
  // realmente registró el comprobante (auditoría/caja), esto es solo para
  // el ranking de ventas.
  if (!invoiceColumns.includes('atribuido_a')) {
    db.exec('ALTER TABLE invoices ADD COLUMN atribuido_a INTEGER REFERENCES users(id)');
  }
  // Mismo mecanismo que invoices.atribuido_a, para que una Nota de Venta
  // Interna también pueda contarle a un Trainer/Supervisor en el Ranking.
  if (!notaVentaColumns.includes('atribuido_a')) {
    db.exec('ALTER TABLE notas_venta ADD COLUMN atribuido_a INTEGER REFERENCES users(id)');
  }
  const purchaseColumns = db.prepare("PRAGMA table_info(purchases)").all().map((c) => c.name);
  if (!purchaseColumns.includes('sucursal_id')) {
    db.exec('ALTER TABLE purchases ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)');
  }
  const stockMovementColumns = db.prepare("PRAGMA table_info(stock_movements)").all().map((c) => c.name);
  if (!stockMovementColumns.includes('sucursal_id')) {
    db.exec('ALTER TABLE stock_movements ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)');
  }
  // Canal de un movimiento manual de inventario (Compras, Canje, Premio,
  // Regalo...): distinto de "tipo" (que es el origen técnico del movimiento
  // — venta/anulacion/ajuste/ingreso_lote). Gerencia/Supervisor administra
  // la lista desde Configuración; "Compras" es el canal por defecto.
  if (!stockMovementColumns.includes('canal')) {
    db.exec("ALTER TABLE stock_movements ADD COLUMN canal TEXT DEFAULT 'Compras'");
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS movimiento_canales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
`);
  const canalesExistentes = db.prepare('SELECT COUNT(*) AS n FROM movimiento_canales').get().n;
  if (canalesExistentes === 0) {
    const insertCanal = db.prepare('INSERT INTO movimiento_canales (nombre) VALUES (?)');
    ['Compras', 'Canje', 'Premio', 'Regalo'].forEach((nombre) => insertCanal.run(nombre));
  }
  const cajaMovimientoColumns = db.prepare("PRAGMA table_info(caja_movimientos)").all().map((c) => c.name);
  if (!cajaMovimientoColumns.includes('sucursal_id')) {
    db.exec('ALTER TABLE caja_movimientos ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)');
  }
  // invoice_id: marca los movimientos que el sistema genera automáticamente
  // al emitir/cobrar una venta (mixto, abonado, cobros de cuentas por
  // cobrar) — a diferencia de los movimientos manuales de Caja, estos no se
  // pueden borrar sueltos sin desincronizar invoices.monto_pagado/cobros de
  // lo que el arqueo muestra (ver DELETE /movimientos/:id).
  if (!cajaMovimientoColumns.includes('invoice_id')) {
    db.exec('ALTER TABLE caja_movimientos ADD COLUMN invoice_id INTEGER REFERENCES invoices(id)');
  }
  // Mismo mecanismo que invoice_id, para los cobros de una Nota de Venta
  // Interna a crédito (ver POST /api/notas-venta/:id/cobros).
  if (!cajaMovimientoColumns.includes('nota_venta_id')) {
    db.exec('ALTER TABLE caja_movimientos ADD COLUMN nota_venta_id INTEGER REFERENCES notas_venta(id)');
  }
  // cotizaciones/guias_remitentes nacieron antes que el multi-sede real y
  // nunca quedaron scoped a una sucursal — a diferencia de invoices/purchases,
  // que sí tienen sucursal_id desde esa migración. Sin esto, un usuario fijo
  // a una sede podía listar/ver/anular cotizaciones y guías de otra sede del
  // mismo tenant. Los registros existentes se asignan a la sede principal
  // (mismo criterio que caja_saldos_iniciales) para no perderlos de vista.
  const cotizacionColumns = db.prepare("PRAGMA table_info(cotizaciones)").all().map((c) => c.name);
  if (!cotizacionColumns.includes('sucursal_id')) {
    db.exec('ALTER TABLE cotizaciones ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)');
    const principalCot = db.prepare('SELECT id FROM sucursales WHERE es_principal = 1').get()
      || db.prepare('SELECT id FROM sucursales ORDER BY id ASC LIMIT 1').get();
    if (principalCot) {
      db.prepare('UPDATE cotizaciones SET sucursal_id = ? WHERE sucursal_id IS NULL').run(principalCot.id);
    }
  }
  const guiaColumns = db.prepare("PRAGMA table_info(guias_remitentes)").all().map((c) => c.name);
  if (!guiaColumns.includes('sucursal_id')) {
    db.exec('ALTER TABLE guias_remitentes ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)');
    const principalGuia = db.prepare('SELECT id FROM sucursales WHERE es_principal = 1').get()
      || db.prepare('SELECT id FROM sucursales ORDER BY id ASC LIMIT 1').get();
    if (principalGuia) {
      db.prepare('UPDATE guias_remitentes SET sucursal_id = ? WHERE sucursal_id IS NULL').run(principalGuia.id);
    }
  }

  // Registrar Compra al estilo de un comprobante real: documento, serie-número
  // del proveedor, moneda/tipo de cambio, tipo de compra y destino de la
  // operación (para crédito fiscal), más descuento y percepción globales.
  const PURCHASE_NEW_COLUMNS = [
    ['tipo_comprobante', "TEXT NOT NULL DEFAULT 'factura'"],
    ['serie', 'TEXT'],
    ['numero_doc', 'TEXT'],
    ['moneda', "TEXT NOT NULL DEFAULT 'PEN'"],
    ['tipo_cambio', 'REAL NOT NULL DEFAULT 1'],
    ['tipo_compra', "TEXT NOT NULL DEFAULT 'mercaderia'"],
    ['tipo_operacion', "TEXT NOT NULL DEFAULT 'gravada_exportacion'"],
    ['descuento_pct', 'REAL NOT NULL DEFAULT 0'],
    ['percepcion', 'REAL NOT NULL DEFAULT 0'],
    ['no_gravado', 'REAL NOT NULL DEFAULT 0'],
    ['guia_serie', 'TEXT'],
    ['guia_numero', 'TEXT'],
  ];
  for (const [col, def] of PURCHASE_NEW_COLUMNS) {
    if (!purchaseColumns.includes(col)) {
      db.exec(`ALTER TABLE purchases ADD COLUMN ${col} ${def}`);
    }
  }
  const purchaseItemColumns = db.prepare("PRAGMA table_info(purchase_items)").all().map((c) => c.name);
  const PURCHASE_ITEM_NEW_COLUMNS = [
    ['observacion', 'TEXT'],
    ['unidad', "TEXT NOT NULL DEFAULT 'UND'"],
    ['afectacion_igv', "TEXT NOT NULL DEFAULT 'gravado'"],
    ['lote_id', 'INTEGER REFERENCES lotes(id)'],
  ];
  for (const [col, def] of PURCHASE_ITEM_NEW_COLUMNS) {
    if (!purchaseItemColumns.includes(col)) {
      db.exec(`ALTER TABLE purchase_items ADD COLUMN ${col} ${def}`);
    }
  }
  const purchaseOrderColumns = db.prepare("PRAGMA table_info(purchase_orders)").all().map((c) => c.name);
  if (!purchaseOrderColumns.includes('fecha_recepcion')) {
    db.exec('ALTER TABLE purchase_orders ADD COLUMN fecha_recepcion TEXT');
  }
  if (!purchaseOrderColumns.includes('tipo_documento')) {
    db.exec("ALTER TABLE purchase_orders ADD COLUMN tipo_documento TEXT NOT NULL DEFAULT 'orden_compra'");
  }

  // caja_saldos_iniciales tenia UNIQUE(fecha) — con varias sedes cada una necesita
  // su propio saldo inicial por fecha, asi que hace falta recrear la tabla con
  // UNIQUE(fecha, sucursal_id). Los datos existentes se asignan a la sede principal.
  const cajaSaldosColumns = db.prepare("PRAGMA table_info(caja_saldos_iniciales)").all().map((c) => c.name);
  if (!cajaSaldosColumns.includes('sucursal_id')) {
    db.exec(`
    CREATE TABLE caja_saldos_iniciales_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
      saldo_inicial_efectivo REAL NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(fecha, sucursal_id)
    );
  `);
    const principal = db.prepare('SELECT id FROM sucursales WHERE es_principal = 1').get()
      || db.prepare('SELECT id FROM sucursales ORDER BY id ASC LIMIT 1').get();
    if (principal) {
      db.prepare(
        `INSERT INTO caja_saldos_iniciales_new (id, fecha, sucursal_id, saldo_inicial_efectivo, created_by, updated_at)
       SELECT id, fecha, ?, saldo_inicial_efectivo, created_by, updated_at FROM caja_saldos_iniciales`
      ).run(principal.id);
    }
    db.exec('DROP TABLE caja_saldos_iniciales');
    db.exec('ALTER TABLE caja_saldos_iniciales_new RENAME TO caja_saldos_iniciales');
  }

  // --- Seed inicial ---
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const insertUser = db.prepare(
      `INSERT INTO users (username, password_hash, full_name, role, dni, nombres, apellidos, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    if (opts.primerUsuario) {
      const u = opts.primerUsuario;
      insertUser.run(u.username, u.password_hash, u.full_name, 'gerencia', u.dni, u.nombres, u.apellidos || '', u.email || null);
    } else {
      insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'Administrador', 'gerencia', '00000000', 'Administrador', '', null);
      insertUser.run('vendedor1', bcrypt.hashSync('vendedor123', 10), 'Carlos Ramírez', 'vendedor', '45678912', 'Carlos', 'Ramírez', null);
      insertUser.run('vendedor2', bcrypt.hashSync('vendedor123', 10), 'Lucía Fernández', 'vendedor', '87654321', 'Lucía', 'Fernández', null);
    }
  }

  // Backfill: cuentas creadas antes de que existieran nombres/apellidos
  // separados los derivan de full_name (primera palabra = nombres, resto =
  // apellidos) para que Empleados no las muestre en blanco.
  const usuariosSinNombres = db.prepare("SELECT id, full_name FROM users WHERE (nombres IS NULL OR nombres = '') AND full_name IS NOT NULL").all();
  if (usuariosSinNombres.length > 0) {
    const updateNombres = db.prepare('UPDATE users SET nombres = ?, apellidos = ? WHERE id = ?');
    for (const u of usuariosSinNombres) {
      const partes = u.full_name.trim().split(/\s+/);
      updateNombres.run(partes[0] || u.full_name, partes.slice(1).join(' '), u.id);
    }
  }

  const empresaConfigCount = db.prepare('SELECT COUNT(*) AS n FROM empresa_config').get().n;
  if (empresaConfigCount === 0) {
    if (opts.empresa) {
      const e = opts.empresa;
      db.prepare(
        `INSERT INTO empresa_config (id, razon_social, ruc, nombre_comercial, direccion_fiscal, telefono, email)
         VALUES (1, ?, ?, ?, ?, ?, ?)`
      ).run(e.razon_social, e.ruc, e.nombre_comercial || e.razon_social, e.direccion_fiscal || null, e.telefono || null, e.email || null);
    } else {
      db.prepare(
        `INSERT INTO empresa_config (id, razon_social, ruc, nombre_comercial, direccion_fiscal, telefono, email)
         VALUES (1, ?, ?, ?, ?, ?, ?)`
      ).run('MI EMPRESA S.A.C.', null, 'MI EMPRESA', 'Sede Principal', null, null);
    }
  }

  const clientCount = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  if (clientCount === 0) {
    const insertClient = db.prepare(
      'INSERT INTO clients (tipo_documento, numero_documento, nombre, direccion, telefono, email) VALUES (?, ?, ?, ?, ?, ?)'
    );
    // "CLIENTES VARIOS" es un cliente genérico universal (para ventas sin
    // datos de cliente), útil para cualquier empresa — se siembra siempre.
    insertClient.run('DNI', '10000000', 'CLIENTES VARIOS', null, null, null);
    if (demo) {
      insertClient.run('RUC', '20123456789', 'Comercial Los Andes S.A.C.', 'Av. Javier Prado 123, Lima', '014567890', 'contacto@losandes.com');
      insertClient.run('DNI', '45678912', 'Maria Fernanda Torres', 'Jr. Union 456, Lima', '987654321', 'mftorres@gmail.com');
      insertClient.run('RUC', '20456789123', 'Distribuidora Peru Norte E.I.R.L.', 'Calle Los Pinos 789, Trujillo', '044556677', 'ventas@perunorte.com');
    }
  }

  if (demo) {
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
  }

  const metodoPagoColumns = db.prepare('PRAGMA table_info(metodos_pago)').all().map((c) => c.name);
  if (!metodoPagoColumns.includes('qr_data_url')) {
    db.exec('ALTER TABLE metodos_pago ADD COLUMN qr_data_url TEXT');
  }
  if (!metodoPagoColumns.includes('link_pago')) {
    db.exec('ALTER TABLE metodos_pago ADD COLUMN link_pago TEXT');
  }

  const pagoQrColumns = db.prepare('PRAGMA table_info(pagos_qr)').all().map((c) => c.name);
  if (!pagoQrColumns.includes('comentario')) {
    db.exec('ALTER TABLE pagos_qr ADD COLUMN comentario TEXT');
  }
  if (!pagoQrColumns.includes('hora_detectada')) {
    db.exec('ALTER TABLE pagos_qr ADD COLUMN hora_detectada TEXT');
  }

  // Sucursales: toda empresa arranca con al menos una sede principal. La
  // instancia de demostración trae 3 sedes de ejemplo; una empresa recién
  // registrada arranca solo con "Sede Principal" (ella agrega el resto).
  const sucursalCount = db.prepare('SELECT COUNT(*) AS n FROM sucursales').get().n;
  if (sucursalCount === 0) {
    const insertSucursal = db.prepare('INSERT INTO sucursales (nombre, direccion, es_principal) VALUES (?, ?, ?)');
    if (demo) {
      insertSucursal.run('Miraflores', 'Av. Larco 123, Miraflores', 1);
      insertSucursal.run('San Borja', 'Av. San Borja Norte 456, San Borja', 0);
      insertSucursal.run('Jesús María', 'Av. Salaverry 789, Jesús María', 0);
    } else {
      insertSucursal.run('Sede Principal', opts.empresa?.direccion_fiscal || null, 1);
    }
  }

  // Métodos de pago: catálogo inicial con los medios más usados en Perú. Se
  // puede ampliar/editar/desactivar libremente desde Configuración -> Métodos
  // de pago. "tarjeta"/"banco" se mantienen inactivos solo para no romper
  // comprobantes viejos que ya los usaban antes de este catálogo dinámico.
  const metodoPagoCount = db.prepare('SELECT COUNT(*) AS n FROM metodos_pago').get().n;
  if (metodoPagoCount === 0) {
    const insertMetodo = db.prepare(
      'INSERT INTO metodos_pago (codigo, nombre, tipo, color, icono, orden, activo) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const metodos = [
      ['efectivo', 'Efectivo', 'efectivo', '#16a34a', '💵', 1, 1],
      ['yape', 'Yape', 'billetera', '#7c3aed', '📲', 2, 1],
      ['plin', 'Plin', 'billetera', '#00bcd4', '📱', 3, 1],
      ['pos', 'POS', 'pos', '#f59e0b', '💳', 4, 1],
      ['qr_bbva', 'QR BBVA', 'billetera', '#004b93', '🏦', 5, 1],
      ['transferencia_bcp', 'Transferencia BCP', 'transferencia', '#002a5c', '🏦', 6, 1],
      ['transferencia_interbank', 'Transferencia Interbank', 'transferencia', '#00a19a', '🏦', 7, 1],
      ['pago_link', 'Pago Link', 'link', '#e11d48', '🔗', 8, 1],
      ['otros', 'Otros', 'otro', '#64748b', '🔖', 9, 1],
      ['tarjeta', 'Tarjeta (antiguo)', 'pos', '#94a3b8', '💳', 90, 0],
      ['banco', 'Banco (antiguo)', 'transferencia', '#94a3b8', '🏦', 91, 0],
    ];
    metodos.forEach((m) => insertMetodo.run(...m));
  }

  // Series de documentos, por sede (ver el comentario de la tabla arriba).
  // Si la base viene de antes de que "series_config" tuviera sucursal_id, se
  // migra: la sede principal conserva exactamente la serie que ya usaba (no
  // le cambia el número a nadie de un día para otro) y a cada sede adicional
  // que ya existiera se le asigna una serie nueva, distinta de las demás.
  const serieConfigCols = db.prepare('PRAGMA table_info(series_config)').all();
  const serieConfigTieneSucursal = serieConfigCols.some((c) => c.name === 'sucursal_id');
  if (serieConfigCols.length > 0 && !serieConfigTieneSucursal) {
    const filasViejas = db.prepare('SELECT * FROM series_config').all();
    db.exec('ALTER TABLE series_config RENAME TO series_config_pre_sedes');
    db.exec(`
      CREATE TABLE series_config (
        tipo_documento TEXT NOT NULL,
        sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
        serie TEXT NOT NULL,
        siguiente_numero INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (tipo_documento, sucursal_id)
      )
    `);
    const sucursalesOrdenadas = db.prepare('SELECT id FROM sucursales ORDER BY es_principal DESC, id ASC').all();
    const insertMigrada = db.prepare(
      'INSERT INTO series_config (tipo_documento, sucursal_id, serie, siguiente_numero) VALUES (?, ?, ?, ?)'
    );
    const seriesPorTipo = db.prepare('SELECT serie FROM series_config WHERE tipo_documento = ?');
    db.transaction(() => {
      for (const fila of filasViejas) {
        sucursalesOrdenadas.forEach((suc, idx) => {
          if (idx === 0) {
            insertMigrada.run(fila.tipo_documento, suc.id, fila.serie, fila.siguiente_numero);
          } else {
            const existentes = seriesPorTipo.all(fila.tipo_documento).map((r) => r.serie);
            insertMigrada.run(fila.tipo_documento, suc.id, siguienteSerieDisponible(fila.tipo_documento, existentes), 1);
          }
        });
      }
    })();
    db.exec('DROP TABLE series_config_pre_sedes');
  }

  // Retrocompletado: toda sede (nueva o ya existente) recibe una fila por
  // cada tipo de documento conocido, con una serie propia si aún no tenía —
  // cubre tanto sedes creadas antes de que existiera este tipo de documento
  // (p.ej. orden_compra/orden_servicio) como sedes nuevas recién creadas.
  const todasLasSucursales = db.prepare('SELECT id FROM sucursales ORDER BY es_principal DESC, id ASC').all();
  const existeFila = db.prepare('SELECT 1 FROM series_config WHERE tipo_documento = ? AND sucursal_id = ?');
  const seriesPorTipoActual = db.prepare('SELECT serie FROM series_config WHERE tipo_documento = ?');
  const insertSiFalta = db.prepare(
    'INSERT INTO series_config (tipo_documento, sucursal_id, serie, siguiente_numero) VALUES (?, ?, ?, 1)'
  );
  for (const tipo of Object.keys(SERIE_BASE_POR_TIPO)) {
    for (const suc of todasLasSucursales) {
      if (existeFila.get(tipo, suc.id)) continue;
      const existentes = seriesPorTipoActual.all(tipo).map((r) => r.serie);
      insertSiFalta.run(tipo, suc.id, siguienteSerieDisponible(tipo, existentes));
    }
  }
  // Órdenes de compra/servicio se agregaron después — se siembran aparte
  // (con INSERT OR IGNORE) para que las bases ya existentes también las reciban.
  const insertSerieIgnore = db.prepare(
    'INSERT OR IGNORE INTO series_config (tipo_documento, serie, siguiente_numero) VALUES (?, ?, 1)'
  );
  insertSerieIgnore.run('orden_compra', 'OC01');
  insertSerieIgnore.run('orden_servicio', 'OS01');

  // Tipos de compra: se siembran con los mismos 5 que el formulario de
  // Compras venía usando hardcodeados, para no romper compras/órdenes ya
  // registradas. Editable desde Compras -> Tipos de Compra.
  const tipoCompraCount = db.prepare('SELECT COUNT(*) AS n FROM tipos_compra').get().n;
  if (tipoCompraCount === 0) {
    const insertTipoCompra = db.prepare(
      `INSERT INTO tipos_compra (categoria, nombre, glosa_observacion, clasificacion_libros, destino_compra)
       VALUES (?, ?, ?, ?, ?)`
    );
    const CATEGORIA_DEFAULT = 'Inversión en mercadería y activo fijo';
    insertTipoCompra.run(CATEGORIA_DEFAULT, 'Mercadería', 'Mercadería de Productos', 'Mercadería, materia prima, suministro, envases y embalajes', 'ingreso_inventario');
    insertTipoCompra.run(CATEGORIA_DEFAULT, 'Servicio', 'Servicios', 'Servicios prestados por terceros', 'centro_costo');
    insertTipoCompra.run(CATEGORIA_DEFAULT, 'Activo Fijo', 'Activo Fijo', 'Bienes de capital / activo fijo', 'centro_costo');
    insertTipoCompra.run(CATEGORIA_DEFAULT, 'Envase/Embalaje', 'Envase y Embalaje', 'Envases y embalajes', 'ingreso_inventario');
    insertTipoCompra.run(CATEGORIA_DEFAULT, 'Gastos Varios', 'Gastos Varios', 'Otros gastos no incluidos en el numeral 4', 'centro_costo');
  }

  // Tipos de inventario: se siembran con los mismos 5 que el formulario de
  // Productos venía usando hardcodeados, para no romper productos ya
  // registrados. Editable desde Inventario -> Tipos de Inventario.
  const tipoInventarioCount = db.prepare('SELECT COUNT(*) AS n FROM tipos_inventario').get().n;
  if (tipoInventarioCount === 0) {
    const insertTipoInventario = db.prepare('INSERT INTO tipos_inventario (nombre) VALUES (?)');
    ['MERCADERÍAS', 'MATERIA PRIMA', 'PRODUCTO TERMINADO', 'ACTIVO FIJO', 'SUMINISTROS'].forEach((nombre) => insertTipoInventario.run(nombre));
  }
  // Migración: productos ya guardados con los códigos viejos (sin tilde ni
  // espacio, ej. "MATERIA_PRIMA") pasan al nombre legible del catálogo
  // nuevo, para que el selector de Productos los reconozca de inmediato.
  const RENOMBRES_TIPO_INVENTARIO = {
    MERCADERIAS: 'MERCADERÍAS',
    MATERIA_PRIMA: 'MATERIA PRIMA',
    PRODUCTO_TERMINADO: 'PRODUCTO TERMINADO',
    ACTIVO_FIJO: 'ACTIVO FIJO',
  };
  const renombrarTipoInventario = db.prepare('UPDATE products SET tipo_inventario = ? WHERE tipo_inventario = ?');
  for (const [viejo, nuevo] of Object.entries(RENOMBRES_TIPO_INVENTARIO)) {
    renombrarTipoInventario.run(nuevo, viejo);
  }

  if (demo) {
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

    // Proveedores de ejemplo (Compras)
    const supplierCount = db.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n;
    if (supplierCount === 0) {
      const insertSupplier = db.prepare(
        'INSERT INTO suppliers (ruc, nombre, direccion, telefono, email) VALUES (?, ?, ?, ?, ?)'
      );
      insertSupplier.run('20100123456', 'Distribuidora Andina S.A.C.', 'Av. Argentina 456, Callao', '014123456', 'ventas@distandina.com');
      insertSupplier.run('20500987654', 'Importaciones del Pacífico E.I.R.L.', 'Jr. Lampa 789, Lima', '015987654', 'contacto@pacifico.com');
    }
  }

  // Promociones: se crean desde Inventario y se vinculan a productos que ya
  // existen (no a productos nuevos "inventados" para la promo). Dos tipos:
  // 'oferta' (un solo producto con precio o % especial, product_id +
  // tipo_descuento + precio_promocional/descuento_pct en la fila) y 'combo'
  // (2+ productos vendidos juntos a un precio_combo fijo, cada uno con su
  // cantidad en promocion_items) — mismo patrón cabecera+detalle que
  // recetas/receta_items. sucursal_id NULL = aplica en todas las sedes
  // (mismo criterio que metas_venta_sede/dotacion). Se aplican de forma
  // automática al registrar la venta (ver routes/invoices.js y
  // RegistroVenta.jsx) mientras estén activas y dentro de fecha_inicio/fin.
  db.exec(`
CREATE TABLE IF NOT EXISTS promociones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  sucursal_id INTEGER REFERENCES sucursales(id),
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  product_id INTEGER REFERENCES products(id),
  tipo_descuento TEXT,
  precio_promocional REAL,
  descuento_pct REAL,
  precio_combo REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS promocion_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promocion_id INTEGER NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  cantidad REAL NOT NULL DEFAULT 1
);
`);
  const invoiceItemColumnsPromo = db.prepare("PRAGMA table_info(invoice_items)").all().map((c) => c.name);
  if (!invoiceItemColumnsPromo.includes('promocion_id')) {
    db.exec('ALTER TABLE invoice_items ADD COLUMN promocion_id INTEGER REFERENCES promociones(id)');
  }

  // Referencia informativa a qué lote/serie se está moviendo en un traslado
  // entre sedes (para trazabilidad de vencimiento) — igual que
  // stock_movements.lote_id, no descuenta cantidad_actual del lote (ese
  // campo tampoco se descuenta en ningún otro flujo de la app hoy).
  const trasladoItemColumns = db.prepare("PRAGMA table_info(traslado_items)").all().map((c) => c.name);
  if (!trasladoItemColumns.includes('lote_id')) {
    db.exec('ALTER TABLE traslado_items ADD COLUMN lote_id INTEGER REFERENCES lotes(id)');
  }

  // Descuentos con nombre (Configuración → Descuentos): a diferencia de las
  // Promociones de Inventario (atadas a productos), estos son un % que se
  // aplica sobre el total de la venta completa (mismo campo
  // invoices.descuento_global_pct que ya existía), con nombre y vigencia
  // propios (ej. "Descuento Gimnasio" 10%) para que el vendedor lo elija de
  // una lista en vez de escribir el % a mano cada vez. sucursal_id NULL =
  // todas las sedes, mismo criterio que metas_venta_sede/promociones.
  db.exec(`
CREATE TABLE IF NOT EXISTS descuentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  porcentaje REAL NOT NULL,
  sucursal_id INTEGER REFERENCES sucursales(id),
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
`);
  const invoiceColumnsDescuento = db.prepare("PRAGMA table_info(invoices)").all().map((c) => c.name);
  if (!invoiceColumnsDescuento.includes('descuento_id')) {
    db.exec('ALTER TABLE invoices ADD COLUMN descuento_id INTEGER REFERENCES descuentos(id)');
  }
  // Mismo mecanismo para Nota de Venta Interna — también debe poder elegir
  // un descuento con nombre en vez de escribir el % a mano.
  const notaVentaColumnsDescuento = db.prepare("PRAGMA table_info(notas_venta)").all().map((c) => c.name);
  if (!notaVentaColumnsDescuento.includes('descuento_id')) {
    db.exec('ALTER TABLE notas_venta ADD COLUMN descuento_id INTEGER REFERENCES descuentos(id)');
  }

  // Planilla: registro real de apertura/cierre de turno de caja por
  // empleado (botones "Abrir caja"/"Cerrar caja" en /planilla) — no
  // reemplaza el saldo inicial de Efectivo de Caja y Bancos (que sigue
  // siendo por sede/día, sin cambios), es un registro de asistencia
  // aparte: cada empleado abre y cierra su propio turno, y solo
  // Gerencia/Supervisor puede ver los de todos (ver routes/planilla.js).
  db.exec(`
CREATE TABLE IF NOT EXISTS caja_turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  fecha TEXT NOT NULL,
  abierto_at TEXT NOT NULL DEFAULT (datetime('now')),
  cerrado_at TEXT
);
`);

  // Backfill: el toggle "Tablero de Ventas" (Configuración → Roles →
  // Inicio) es nuevo — antes de que existiera, cualquier rol llamado
  // "Supervisor" ya veía el Tablero de Ventas del Dashboard de forma
  // automática por su nombre (ver utils/permisos.js:puedeVerTableroVentas).
  // Para no quitarle ese acceso a nadie de golpe, se deja guardada aquí una
  // sola vez la fila explícita equivalente; de ahí en adelante Gerencia
  // decide todo desde Configuración → Roles, sin casos especiales por
  // nombre de rol.
  const rolesSupervisorBackfill = db.prepare("SELECT id FROM roles WHERE nombre = 'Supervisor'").all();
  const tieneAccionTableroBackfill = db.prepare(
    "SELECT 1 FROM role_acciones WHERE role_id = ? AND modulo = 'dashboard' AND accion = 'tablero_ventas'"
  );
  const insertarAccionTableroBackfill = db.prepare(
    "INSERT INTO role_acciones (role_id, modulo, accion, habilitado) VALUES (?, 'dashboard', 'tablero_ventas', 1)"
  );
  for (const r of rolesSupervisorBackfill) {
    if (!tieneAccionTableroBackfill.get(r.id)) insertarAccionTableroBackfill.run(r.id);
  }

  // Backfill: todo producto con stock que aun no tenga su propia fila en
  // sucursal_stock para la sede principal la recibe con su stock agregado
  // actual. Sin esto, esos productos aparecerian con stock cero en la sede
  // principal (separacion real por sede: sucursal_stock es la unica fuente,
  // sin fallback implicito hacia products.stock en tiempo de lectura). Corre
  // en cada arranque pero es barato: solo llena filas que faltan.
  const sucursalPrincipal = db.prepare('SELECT id FROM sucursales WHERE es_principal = 1').get();
  if (sucursalPrincipal) {
    const productosSinFila = db.prepare(
      `SELECT p.id, p.stock FROM products p
       WHERE p.tipo = 'producto' AND p.stock IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sucursal_stock ss WHERE ss.product_id = p.id AND ss.sucursal_id = ?)`
    ).all(sucursalPrincipal.id);
    const insertFilaSucursalStock = db.prepare('INSERT INTO sucursal_stock (product_id, sucursal_id, stock) VALUES (?, ?, ?)');
    for (const p of productosSinFila) {
      insertFilaSucursalStock.run(p.id, sucursalPrincipal.id, p.stock || 0);
    }
  }

  return db;
}

// --- Selección de la base de datos por empresa (multi-tenant) ---
//
// Cada empresa (la original de esta instancia + cada una que se registre
// desde "Registrar mi empresa") tiene su propio archivo .db, completamente
// aislado. Como casi todas las rutas hacen `const db = require('../db')` y
// llaman a `db.prepare(...)` directamente, en vez de pasar la conexión como
// parámetro por las ~30 tablas y 22 archivos de rutas, este módulo exporta un
// Proxy: cada llamada a un método de "db" se resuelve, en el momento, contra
// la base de datos de la empresa dueña de la petición en curso — guardada en
// un AsyncLocalStorage por el middleware de autenticación (ver
// middleware/auth.js). Fuera de una petición (arranque del servidor, scripts)
// cae en la base por defecto de siempre, así que nada de esto cambia el
// comportamiento de la instancia original.
const tenantStorage = new AsyncLocalStorage();
const openDatabases = new Map(); // filePath -> instancia better-sqlite3

function openTenantDb(filePath, seedOpts) {
  if (openDatabases.has(filePath)) return openDatabases.get(filePath);
  const database = new Database(filePath);
  initSchema(database, seedOpts);
  openDatabases.set(filePath, database);
  return database;
}

const DEFAULT_DB_PATH = path.join(DATA_DIR, 'crm.db');
const defaultDb = openTenantDb(DEFAULT_DB_PATH);

function runWithDb(database, fn) {
  return tenantStorage.run(database, fn);
}

function currentDb() {
  return tenantStorage.getStore() || defaultDb;
}

const helpers = { openTenantDb, runWithDb, currentDb, DEFAULT_DB_PATH, DATA_DIR };

const dbProxy = new Proxy(helpers, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    const database = currentDb();
    const value = database[prop];
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

module.exports = dbProxy;
