// Genera el próximo código de serie disponible para un tipo de documento,
// sin repetir ninguna de las que ya usa otra sede — SUNAT exige que cada
// punto de emisión (sede) tenga su propia serie por tipo de documento.
// No toca la base de datos: recibe la lista de series ya usadas y devuelve
// la siguiente libre, para poder reutilizarse tanto en la migración de
// esquema (db.js) como al crear una sede nueva en caliente (utils/series.js).
const SERIE_BASE_POR_TIPO = {
  factura: 'F001',
  boleta: 'B001',
  nota_credito: 'FC01',
  cotizacion: 'CL02',
  guia_remitente: 'TL02',
  orden_compra: 'OC01',
  orden_servicio: 'OS01',
};

function siguienteSerieDisponible(tipo, seriesExistentes) {
  const plantilla = seriesExistentes[0] || SERIE_BASE_POR_TIPO[tipo] || 'S001';
  const match = plantilla.match(/^(.*?)(\d+)$/);
  if (!match) return seriesExistentes.includes(plantilla) ? `${plantilla}2` : plantilla;
  const [, prefijo, digitos] = match;
  const usados = new Set(
    seriesExistentes
      .map((s) => s.match(/^(.*?)(\d+)$/))
      .filter((m) => m && m[1] === prefijo)
      .map((m) => Number(m[2]))
  );
  let n = Number(digitos) || 1;
  while (usados.has(n)) n++;
  return `${prefijo}${String(n).padStart(digitos.length, '0')}`;
}

module.exports = { SERIE_BASE_POR_TIPO, siguienteSerieDisponible };
