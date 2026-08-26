const { getWorker } = require('./ocrWorker');

// Líneas que casi siempre aparecen en el encabezado/pie de una guía de
// remisión (datos del emisor, destinatario, transporte, totales) y nunca en
// una línea de producto — se descartan antes de intentar leer cantidad +
// descripción, para no confundirlas con un ítem.
const PALABRAS_IGNORAR = /(ruc|dni|gu[ií]a|remit|factura|boleta|comprobante|fecha|se[ñn]or|direcci|placa|conductor|transport|motivo|traslado|peso|bulto|total|subtotal|igv|observ|destino|punto\s*de|partida|llegada|emisor|destinatario|n[uú]mero|orden\s*de|raz[oó]n\s*social|representante|firma|c[oó]digo\s*postal)/i;

const UNIDAD = 'UND?\\.?|UNID\\.?|KG\\.?|GR\\.?|LT\\.?|ML\\.?|GLN\\.?|CAJA|PAQ\\.?|PQT\\.?|BLS\\.?|DOC\\.?|NIU';

function limpiarDescripcion(t) {
  return t.replace(/\s{2,}/g, ' ').replace(/^[\s.\-–—:]+|[\s.\-–—:]+$/g, '').trim();
}

// Intenta leer "cantidad + descripción" de una línea de texto reconocida,
// probando primero con la cantidad al inicio (el formato más común en
// guías: "2 UND Proteína Whey 1kg") y si no calza, con la cantidad al final
// ("Proteína Whey 1kg ... 2 UND").
function extraerFila(linea) {
  let m = linea.match(new RegExp(`^\\s*(\\d{1,4}(?:[.,]\\d{1,2})?)\\s*(?:${UNIDAD})?\\s+([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9\\s.,\\-/]{2,80})$`, 'i'));
  if (m) {
    const descripcion = limpiarDescripcion(m[2]);
    if (descripcion.length >= 3) return { cantidad: parseFloat(m[1].replace(',', '.')), descripcion };
  }
  m = linea.match(new RegExp(`^([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9\\s.,\\-/]{2,80}?)\\s+(\\d{1,4}(?:[.,]\\d{1,2})?)\\s*(?:${UNIDAD})?\\s*$`, 'i'));
  if (m) {
    const descripcion = limpiarDescripcion(m[1]);
    if (descripcion.length >= 3) return { cantidad: parseFloat(m[2].replace(',', '.')), descripcion };
  }
  return null;
}

// Recorre línea por línea el texto reconocido y devuelve las que parecen
// filas de producto (cantidad + descripción) — es una lectura best-effort:
// una tabla escaneada rara vez conserva sus columnas alineadas en el texto
// OCR, así que el usuario siempre revisa y corrige antes de confirmar.
function extraerFilas(texto) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const filas = [];
  for (const linea of lineas) {
    if (PALABRAS_IGNORAR.test(linea)) continue;
    if (!/\d/.test(linea)) continue;
    const fila = extraerFila(linea);
    if (fila && fila.cantidad > 0 && fila.cantidad < 10000) filas.push(fila);
  }
  return filas;
}

// Recibe la foto de una guía de remisión completa (Buffer o data URL) y
// devuelve el texto reconocido más las filas de producto que se pudieron
// inferir. Puede devolver un arreglo vacío si el OCR no logró separar
// ninguna línea reconocible — el usuario siempre puede agregar filas a mano.
async function analizarGuia(imagen) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagen);
  return {
    texto: data.text,
    filas_detectadas: extraerFilas(data.text),
  };
}

module.exports = { analizarGuia };
