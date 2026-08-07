const db = require('../db');

// Dónde vive cada tipo de documento y cómo se filtra su MAX(numero) real.
const TABLA_POR_TIPO = {
  factura: { tabla: 'invoices', where: "tipo_comprobante = 'factura'" },
  boleta: { tabla: 'invoices', where: "tipo_comprobante = 'boleta'" },
  nota_credito: { tabla: 'invoices', where: "tipo_comprobante = 'nota_credito'" },
  cotizacion: { tabla: 'cotizaciones', where: '1 = 1' },
  guia_remitente: { tabla: 'guias_remitentes', where: '1 = 1' },
};

function getSerieConfig(tipo) {
  return db.prepare('SELECT * FROM series_config WHERE tipo_documento = ?').get(tipo);
}

function listSeries() {
  return db.prepare('SELECT * FROM series_config').all();
}

// Serie y siguiente número real para emitir: el mayor entre lo ya usado en
// los datos (por si Gerencia nunca tocó esta pantalla) y lo configurado
// manualmente — nunca puede retroceder ni pisar un número ya emitido.
function siguienteNumero(tipo) {
  const cfg = getSerieConfig(tipo);
  const destino = TABLA_POR_TIPO[tipo];
  if (!cfg || !destino) return null;
  const row = db.prepare(
    `SELECT MAX(numero) AS maxNum FROM ${destino.tabla} WHERE ${destino.where} AND serie = ?`
  ).get(cfg.serie);
  const desdeData = (row.maxNum || 0) + 1;
  return { serie: cfg.serie, numero: Math.max(desdeData, cfg.siguiente_numero) };
}

module.exports = { TABLA_POR_TIPO, getSerieConfig, listSeries, siguienteNumero };
