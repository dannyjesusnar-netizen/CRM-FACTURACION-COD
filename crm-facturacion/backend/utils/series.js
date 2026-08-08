const db = require('../db');
const { siguienteSerieDisponible } = require('./serieCodegen');

// Dónde vive cada tipo de documento y cómo se filtra su MAX(numero) real.
const TABLA_POR_TIPO = {
  factura: { tabla: 'invoices', where: "tipo_comprobante = 'factura'", columnaNumero: 'numero' },
  boleta: { tabla: 'invoices', where: "tipo_comprobante = 'boleta'", columnaNumero: 'numero' },
  nota_credito: { tabla: 'invoices', where: "tipo_comprobante = 'nota_credito'", columnaNumero: 'numero' },
  cotizacion: { tabla: 'cotizaciones', where: '1 = 1', columnaNumero: 'numero' },
  guia_remitente: { tabla: 'guias_remitentes', where: '1 = 1', columnaNumero: 'numero' },
  // Órdenes de compra/servicio no tienen columna "numero" secuencial por serie
  // (esa columna es un correlativo interno compartido entre ambos tipos) —
  // usan "numero_doc", el mismo campo de texto que el formulario ya guarda.
  orden_compra: { tabla: 'purchase_orders', where: "tipo_documento = 'orden_compra'", columnaNumero: 'CAST(numero_doc AS INTEGER)' },
  orden_servicio: { tabla: 'purchase_orders', where: "tipo_documento = 'orden_servicio'", columnaNumero: 'CAST(numero_doc AS INTEGER)' },
};

function getSerieConfig(tipo, sucursalId) {
  return db.prepare('SELECT * FROM series_config WHERE tipo_documento = ? AND sucursal_id = ?').get(tipo, sucursalId);
}

function listSeries(sucursalId) {
  return db.prepare('SELECT * FROM series_config WHERE sucursal_id = ?').all(sucursalId);
}

// Serie y siguiente número real para emitir, para la sede dada: el mayor
// entre lo ya usado en los datos (por si Gerencia nunca tocó esta pantalla)
// y lo configurado manualmente — nunca puede retroceder ni pisar un número
// ya emitido. Cada sede tiene su propia serie (nunca compartida con otra),
// así que filtrar por "serie" ya aísla los datos de esta sede sin necesidad
// de un JOIN adicional por sucursal_id.
function siguienteNumero(tipo, sucursalId) {
  const cfg = getSerieConfig(tipo, sucursalId);
  const destino = TABLA_POR_TIPO[tipo];
  if (!cfg || !destino) return null;
  const row = db.prepare(
    `SELECT MAX(${destino.columnaNumero}) AS maxNum FROM ${destino.tabla} WHERE ${destino.where} AND serie = ?`
  ).get(cfg.serie);
  const desdeData = (row.maxNum || 0) + 1;
  return { serie: cfg.serie, numero: Math.max(desdeData, cfg.siguiente_numero) };
}

// Crea, con una serie propia (nunca repetida entre sedes), la fila de cada
// tipo de documento para una sede nueva — se llama al crear una sede desde
// Configuración -> Sucursales.
function sembrarSeriesParaSucursal(sucursalId) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO series_config (tipo_documento, sucursal_id, serie, siguiente_numero) VALUES (?, ?, ?, 1)'
  );
  for (const tipo of Object.keys(TABLA_POR_TIPO)) {
    const existentes = db.prepare('SELECT serie FROM series_config WHERE tipo_documento = ?').all(tipo).map((r) => r.serie);
    insert.run(tipo, sucursalId, siguienteSerieDisponible(tipo, existentes));
  }
}

module.exports = { TABLA_POR_TIPO, getSerieConfig, listSeries, siguienteNumero, sembrarSeriesParaSucursal };
