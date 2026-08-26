const { getWorker } = require('./ocrWorker');

// Encabezado que casi toda guía de remisión peruana imprime justo antes de
// la tabla de ítems ("BIENES A TRANSPORTAR" / "BIENES POR TRANSPORTAR" /
// "BIENES TRANSPORTADOS", según el formato del emisor). Todo lo que viene
// ANTES de esta línea es encabezado del documento (RUC, remitente,
// destinatario, transportista) — nunca hay ítems ahí, así que ignorarlo de
// entrada evita falsos positivos con esos números (RUC, placa, fechas).
const ENCABEZADO_BIENES = /bienes\s*(a|por)?\s*transportar|bienes\s*transportad[oa]s?/i;

// Líneas que casi siempre aparecen en el encabezado/pie de una guía de
// remisión (datos del emisor, destinatario, transporte, totales) y nunca en
// una línea de producto — se descartan antes de intentar leer cantidad +
// descripción, para no confundirlas con un ítem.
const PALABRAS_IGNORAR = /(ruc|dni|gu[ií]a|remit|factura|boleta|comprobante|fecha|se[ñn]or|direcci|placa|conductor|transport|motivo|traslado|peso\s*bruto|bulto|total|subtotal|igv|observ|destino|punto\s*de|partida|llegada|emisor|destinatario|n[uú]mero\s*de|orden\s*de|raz[oó]n\s*social|representante|firma|c[oó]digo\s*postal)/i;

// Unidades de medida comunes, incluidas las que usa el catálogo oficial de
// SUNAT tal cual aparecen impresas en una Guía de Remisión Electrónica
// ("UNIDAD (ZZ)", "KILOGRAMO (KGM)", etc. — el código entre paréntesis es un
// token aparte, se ignora al buscar la unidad).
const UNIDAD = 'UNIDAD(?:ES)?|UND?\\.?|UNID\\.?|KILOGRAMO|KG\\.?|GRAMO|GR\\.?|LITRO|LT\\.?|MILILITRO|ML\\.?|GAL[oó]N|GLN\\.?|CAJA|PAQUETE|PAQ\\.?|PQT\\.?|BOLSA|BLS\\.?|DOCENA|DOC\\.?|METRO|MTR?\\.?|PAR|CIENTO|MILLAR|NIU';
const UNIDAD_TOKEN = new RegExp(`^(${UNIDAD})$`, 'i');

function limpiarDescripcion(t) {
  return t.replace(/\s{2,}/g, ' ').replace(/^[\s.\-–—:]+|[\s.\-–—:]+$/g, '').trim();
}

function pareceCantidadToken(tok) {
  return /^\d{1,4}(?:[.,]\d{1,2})?$/.test(tok);
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

// Un token es "unidad" si, al quitarle paréntesis (el código SUNAT que suele
// venir pegado, ej. "(ZZ)"), calza con la lista de unidades conocida.
function esTokenUnidad(tok) {
  return UNIDAD_TOKEN.test((tok || '').replace(/[()]/g, ''));
}

// Segundo intento, más permisivo, para filas con más columnas de las que
// "extraerFila" sabe leer (ítem, código, unidad, descripción mezclados en
// cualquier orden — muy común cuando el OCR lee una tabla real con líneas y
// columnas). Prioriza el número que tiene una unidad de medida PEGADA (a 1
// token de distancia) por ser la señal más confiable de cuál es la
// cantidad; solo si ninguno califica se prueba a 2 tokens (para tolerar un
// código SUNAT entre medio, ej. "UNIDAD (ZZ) 6.00") — probar primero la
// distancia más corta evita que un número de ítem cualquiera ("1", "2") le
// gane a la cantidad real solo por tener la unidad un poco más lejos en esa
// misma línea. Si ninguno califica, usa el ÚLTIMO número de la línea — en
// el formato estándar de una Guía de Remisión Electrónica SUNAT la cantidad
// es la última columna de la fila (después de descripción y unidad), igual
// que en una factura.
function extraerFilaGenerica(linea) {
  const tokens = linea.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let idxCantidad = -1;
  busquedaPorDistancia:
  for (const distancia of [1, 2]) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (!pareceCantidadToken(tokens[i])) continue;
      if (esTokenUnidad(tokens[i - distancia]) || esTokenUnidad(tokens[i + distancia])) {
        idxCantidad = i;
        break busquedaPorDistancia;
      }
    }
  }
  if (idxCantidad === -1) {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (pareceCantidadToken(tokens[i])) { idxCantidad = i; break; }
    }
  }
  if (idxCantidad === -1) return null;

  const cantidad = parseFloat(tokens[idxCantidad].replace(',', '.'));
  // Además de la cantidad y la unidad, se descartan de la descripción: un
  // código entre paréntesis pegado a la unidad (ej. "(ZZ)") y la columna
  // "Bien normalizado" ("NO"/"SI") que trae toda Guía de Remisión
  // Electrónica SUNAT — ninguno de los dos aporta al nombre del producto.
  const textoTokens = tokens.filter((t, i) => {
    if (i === idxCantidad || esTokenUnidad(t)) return false;
    if (/^\(.*\)$/.test(t)) return false;
    if (/^(no|si)$/i.test(t)) return false;
    return /[a-zA-ZÀ-ÿ]{2,}/.test(t);
  });
  const descripcion = limpiarDescripcion(textoTokens.join(' '));
  if (descripcion.length < 3) return null;
  return { cantidad, descripcion };
}

// Recorre línea por línea el texto reconocido y devuelve las que parecen
// filas de producto (cantidad + descripción) — es una lectura best-effort:
// una tabla escaneada rara vez conserva sus columnas alineadas en el texto
// OCR, así que el usuario siempre revisa y corrige antes de confirmar.
function extraerFilas(texto) {
  const lineasCrudas = texto.split(/\r?\n/).map((l) => l.trim());
  const idxAncla = lineasCrudas.findIndex((l) => ENCABEZADO_BIENES.test(l));
  const lineas = (idxAncla >= 0 ? lineasCrudas.slice(idxAncla + 1) : lineasCrudas).filter(Boolean);

  const filas = [];
  for (const linea of lineas) {
    if (PALABRAS_IGNORAR.test(linea)) continue;
    if (!/\d/.test(linea)) continue;
    const fila = extraerFila(linea) || extraerFilaGenerica(linea);
    if (fila && fila.cantidad > 0 && fila.cantidad < 10000) filas.push(fila);
  }
  return filas;
}

// Recibe la foto de una guía de remisión completa (Buffer o data URL) y
// devuelve el texto reconocido más las filas de producto que se pudieron
// inferir. Puede devolver un arreglo vacío si el OCR no logró separar
// ninguna línea reconocible — el usuario siempre puede agregar filas a mano,
// y el texto completo se expone para poder revisar qué leyó realmente el
// OCR cuando la lectura automática no encuentra nada.
async function analizarGuia(imagen) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagen);
  return {
    texto: data.text,
    filas_detectadas: extraerFilas(data.text),
  };
}

module.exports = { analizarGuia };
