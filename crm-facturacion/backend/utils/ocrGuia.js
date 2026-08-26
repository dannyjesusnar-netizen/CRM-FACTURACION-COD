const sharp = require('sharp');
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
// "UN.DAD"/"UNDAD" se agregan porque el OCR confunde consistentemente la "I"
// de "UNIDAD" con un punto o directamente se la come — se vio en varias
// pruebas contra guías reales, no es un caso aislado.
const UNIDAD = 'UNIDAD(?:ES)?|UN\\.?DAD|UND?\\.?|UNID\\.?|KILOGRAMO|KG\\.?|GRAMO|GR\\.?|LITRO|LT\\.?|MILILITRO|ML\\.?|GAL[oó]N|GLN\\.?|CAJA|PAQUETE|PAQ\\.?|PQT\\.?|BOLSA|BLS\\.?|DOCENA|DOC\\.?|METRO|MTR?\\.?|PAR|CIENTO|MILLAR|NIU';
const UNIDAD_TOKEN = new RegExp(`^(${UNIDAD})$`, 'i');

function limpiarDescripcion(t) {
  return t.replace(/\s{2,}/g, ' ').replace(/^[\s.\-–—:]+|[\s.\-–—:]+$/g, '').trim();
}

// Permite puntuación suelta pegada al número (ej. "6.00)" cuando el OCR
// arrastra el paréntesis de cierre de la unidad hacia la cantidad) — el
// valor real se sigue extrayendo con parseFloat, que ya ignora esa cola.
function pareceCantidadToken(tok) {
  return /^\d{1,4}(?:[.,]\d{1,2})?[)\].,;:]*$/.test(tok || '');
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

// Un token es "unidad" si, al quitarle símbolos pegados (paréntesis del
// código SUNAT, puntuación suelta que deja el OCR), calza con la lista de
// unidades conocida.
function esTokenUnidad(tok) {
  return UNIDAD_TOKEN.test((tok || '').replace(/[()[\].,;:]/g, ''));
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

// Convierte lo que llegó (Buffer o data URL) en algo que sharp() pueda leer.
function paraSharp(imagen) {
  if (Buffer.isBuffer(imagen)) return imagen;
  if (typeof imagen === 'string' && imagen.startsWith('data:')) {
    return Buffer.from(imagen.split(',')[1], 'base64');
  }
  return imagen;
}

// Aplana blocks -> paragraphs -> lines (estructura que devuelve tesseract.js
// cuando se pide output.blocks) en una lista plana de { text, bbox }.
function extraerLineasConBbox(data) {
  const lineas = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        lineas.push({ text: (l.text || '').trim(), bbox: l.bbox });
      }
    }
  }
  return lineas;
}

// Líneas que marcan el final de la tabla de bienes (arranca el resto del
// documento: peso, datos del traslado, indicadores, etc.) — se usan junto
// con ENCABEZADO_BIENES para acotar verticalmente dónde está la tabla en la
// imagen, no solo en el texto.
const FIN_TABLA = /peso\s*bruto|datos\s*del\s*traslado|modalidad\s*de\s*traslado|indicador\s*de|observ|total\s*de\s*bultos/i;

// Devuelve el rango vertical (en píxeles de la imagen) que ocupa la tabla de
// bienes, a partir de las líneas con sus coordenadas. null si no se
// encontró el encabezado "bienes por/a transportar" en esta lectura.
function encontrarRangoTabla(lineasConBbox) {
  const idxAncla = lineasConBbox.findIndex((l) => ENCABEZADO_BIENES.test(l.text));
  if (idxAncla === -1) return null;
  let idxFin = -1;
  for (let i = idxAncla + 1; i < lineasConBbox.length; i += 1) {
    if (FIN_TABLA.test(lineasConBbox[i].text)) { idxFin = i; break; }
  }
  const lineasTabla = idxFin === -1 ? lineasConBbox.slice(idxAncla) : lineasConBbox.slice(idxAncla, idxFin);
  if (lineasTabla.length === 0) return null;
  return {
    top: Math.min(...lineasTabla.map((l) => l.bbox.y0)),
    bottom: Math.max(...lineasTabla.map((l) => l.bbox.y1)),
  };
}

// Recibe la foto de una guía de remisión completa (Buffer o data URL) y
// devuelve el texto reconocido más las filas de producto que se pudieron
// inferir. Hace dos lecturas: la primera sobre la página completa, para
// ubicar en qué franja de píxeles está la tabla de bienes; si la encuentra,
// recorta esa franja de la imagen ORIGINAL (a su resolución real, sin el
// resto de la página) y la agranda solo a ella antes de leerla de nuevo —
// como ya no hay que repartir la resolución en toda la página, la tabla
// queda con muchos más píxeles por letra que si se agrandara la imagen
// entera. Si el recorte no encuentra filas (o el encabezado no aparece en
// esta foto, p.ej. porque el usuario ya la recortó de entrada), se usa el
// resultado de la lectura completa. El texto completo se expone siempre
// para poder revisar qué leyó realmente el OCR cuando la lectura automática
// no encuentra nada.
async function analizarGuia(imagen) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagen, {}, { text: true, blocks: true });
  const filasCompletas = extraerFilas(data.text);

  const rango = encontrarRangoTabla(extraerLineasConBbox(data));
  if (rango) {
    try {
      const buffer = paraSharp(imagen);
      const metadata = await sharp(buffer).metadata();
      const margen = 8;
      const top = Math.max(0, rango.top - margen);
      const height = Math.min(metadata.height - top, (rango.bottom - rango.top) + margen * 2);
      if (height > 0) {
        const anchoObjetivo = Math.min(metadata.width * 4, 4200);
        // Además de agrandar, se pasa a blanco y negro puro (sin grises
        // intermedios): las líneas y el sombreado de las celdas de una tabla
        // con bordes confunden mucho al OCR (se prueba con y sin esto contra
        // guías reales — sin binarizar, filas enteras salen ilegibles que
        // con esto sí se separan, aunque ninguna de las dos formas es
        // perfecta en una tabla con letra muy chica).
        const recorte = await sharp(buffer)
          .extract({ left: 0, top, width: metadata.width, height })
          .resize({ width: Math.round(anchoObjetivo) })
          .grayscale()
          .threshold(150)
          .jpeg({ quality: 92 })
          .toBuffer();
        const { data: dataRecorte } = await worker.recognize(recorte);
        const filasRecorte = extraerFilas(dataRecorte.text);
        // Se prefiere el recorte solo si de verdad encontró MÁS filas que la
        // lectura completa — el recorte no siempre gana (el contraste fijo
        // que se le aplica puede perjudicar filas que la lectura completa sí
        // leía bien), así que ante empate o menos filas se descarta y se usa
        // la lectura completa de abajo.
        if (filasRecorte.length > filasCompletas.length) {
          return {
            texto: `${data.text}\n\n--- Segunda lectura (solo la tabla, ampliada) ---\n${dataRecorte.text}`,
            filas_detectadas: filasRecorte,
          };
        }
      }
    } catch (err) {
      // Si el recorte falla por cualquier motivo (imagen no soportada,
      // franja inválida, etc.), se sigue con la lectura de la página
      // completa de abajo — nunca debe tumbar el análisis.
    }
  }

  return {
    texto: data.text,
    filas_detectadas: filasCompletas,
  };
}

module.exports = { analizarGuia };
