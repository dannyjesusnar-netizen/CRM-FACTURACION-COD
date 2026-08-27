// Lee una guía de remisión que el proveedor ya entregó (XML electrónico
// SUNAT/UBL, o PDF con texto embebido) para autocompletar proveedor,
// serie-número y los productos/cantidades en "Registrar Compra". Nunca
// consulta a terceros ni a SUNAT: solo procesa el archivo que el usuario
// sube, así que no hay ningún problema de origen/licitud de datos.
//
// El XML es una fuente estructurada y confiable (se toma tal cual). El PDF
// es texto libre con layout variable entre proveedores, así que la
// extracción de ítems es "mejor esfuerzo" con expresiones regulares y
// siempre debe marcarse para que el usuario la revise antes de guardar.
const { XMLParser } = require('fast-xml-parser');
const { PDFParse } = require('pdf-parse');

function findFirst(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null) return null;
    cur = cur[key];
  }
  return cur == null ? null : cur;
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

async function parseGuiaXml(buffer) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });
  let doc;
  try {
    doc = parser.parse(buffer.toString('utf8'));
  } catch {
    return { fuente: 'xml', error: 'No se pudo leer el XML. ¿Es un archivo de guía de remisión válido?' };
  }
  const root = doc.DespatchAdvice || doc.despatchAdvice;
  if (!root) {
    return { fuente: 'xml', error: 'El XML no parece ser una guía de remisión SUNAT (falta DespatchAdvice).' };
  }

  const idFull = findFirst(root, ['ID']);
  let guia_serie = null, guia_numero = null;
  if (idFull) {
    const idStr = typeof idFull === 'object' ? (idFull['#text'] ?? '') : String(idFull);
    const m = idStr.match(/([A-Z]{1}\d{3})-?(\d+)/i);
    if (m) { guia_serie = m[1].toUpperCase(); guia_numero = String(Number(m[2])); }
  }

  const remitenteParty = findFirst(root, ['DespatchSupplierParty', 'Party']);
  const ruc = findFirst(remitenteParty, ['PartyIdentification', 'ID']);
  const rucStr = ruc && typeof ruc === 'object' ? ruc['#text'] : ruc;
  const razonSocial = findFirst(remitenteParty, ['PartyLegalEntity', 'RegistrationName']);

  const lines = asArray(root.DespatchLine);
  const items = lines.map((line) => {
    const descripcion = findFirst(line, ['Item', 'Description']) || '';
    const codigo = findFirst(line, ['Item', 'SellersItemIdentification', 'ID']) || null;
    const qty = line.DeliveredQuantity;
    const cantidad = qty && typeof qty === 'object' ? Number(qty['#text'] || 0) : Number(qty || 0);
    const unidad = qty && typeof qty === 'object' ? (qty['@_unitCode'] || 'NIU') : 'NIU';
    return {
      descripcion: String(typeof descripcion === 'object' ? descripcion['#text'] || '' : descripcion).trim(),
      codigo: codigo && typeof codigo === 'object' ? codigo['#text'] : codigo,
      cantidad: cantidad || 0,
      unidad,
    };
  }).filter((it) => it.descripcion && it.cantidad > 0);

  return {
    fuente: 'xml',
    ruc: rucStr ? String(rucStr).trim() : null,
    razon_social: razonSocial ? String(razonSocial).trim() : null,
    guia_serie, guia_numero,
    items,
  };
}

const UNIDADES_CONOCIDAS = ['UND', 'NIU', 'KG', 'KGM', 'LT', 'LTR', 'CJA', 'PAQ', 'GAL', 'BLL', 'ZZ'];

// Muchos PDFs de la Guía de Remisión Electrónica de SUNAT (los que salen de
// "imprimir a PDF" el visor web) conservan tabuladores entre columnas, con
// las columnas en un orden distinto al de una factura de línea corrida:
// "Descripción \t código GTIN + Unidad (código) \t ítem NO/SI cantidad".
// Se detecta esta forma primero por ser la más común y sin ambigüedad
// (a diferencia del heurístico por espacios de más abajo, pensado para
// otros formatos de proveedor con una sola línea de texto por ítem).
function extraerItemsPorTabulador(lineas) {
  const items = [];
  for (const linea of lineas) {
    if (!linea.includes('\t')) continue;
    const partes = linea.split('\t').map((p) => p.trim()).filter(Boolean);
    if (partes.length < 2) continue;

    const ultima = partes[partes.length - 1];
    const mItem = ultima.match(/^\d{1,4}\s+(?:NO|SI)\s+(\d+(?:[.,]\d+)?)$/i);
    if (!mItem) continue;
    const cantidad = Number(mItem[1].replace(',', '.'));
    if (!cantidad || cantidad <= 0) continue;

    const descripcion = partes[0];
    if (!descripcion || descripcion.length < 3 || !/[a-zA-Z]/.test(descripcion)) continue;

    let unidad = 'NIU';
    for (const parte of partes.slice(1, -1)) {
      const mUnidad = parte.match(new RegExp(`\\b(${UNIDADES_CONOCIDAS.join('|')})\\b`, 'i'));
      if (mUnidad) { unidad = mUnidad[1].toUpperCase(); break; }
    }
    items.push({ descripcion, codigo: null, cantidad, unidad });
  }
  return items;
}

// Línea típica de detalle de otros formatos: "1  Producto XYZ 500gr  10.00
// UND". El nombre del producto suele traer números (presentaciones,
// medidas), así que en vez de prohibir dígitos en la descripción se usa la
// POSICIÓN de los tokens: primer token = correlativo, último (o penúltimo,
// si hay unidad) = cantidad, y todo lo demás en medio es la descripción.
function extraerItemsPorEspacios(lineas) {
  const items = [];
  for (const linea of lineas) {
    const l = linea.trim();
    if (!l || l.length < 4) continue;
    const tokens = l.split(/\s+/);
    if (tokens.length < 3 || !/^\d{1,4}$/.test(tokens[0])) continue;

    let rest = tokens.slice(1);
    let unidad = 'NIU';
    const last = rest[rest.length - 1];
    if (last && UNIDADES_CONOCIDAS.includes(last.toUpperCase())) {
      unidad = last.toUpperCase();
      rest = rest.slice(0, -1);
    }
    const qtyToken = rest[rest.length - 1];
    if (!qtyToken || !/^\d+(\.\d+)?$/.test(qtyToken)) continue;
    const cantidad = Number(qtyToken);
    const descripcion = rest.slice(0, -1).join(' ').trim();
    if (descripcion.length < 3 || cantidad <= 0) continue;

    items.push({ descripcion, codigo: null, cantidad, unidad });
  }
  return items;
}

// PDF: sin estructura fija, así que se hace lectura de texto + heurísticas.
// Siempre se marca con advertencia para que el usuario revise antes de guardar.
async function parseGuiaPdf(buffer) {
  let text;
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = result.text || '';
  } catch {
    return { fuente: 'pdf', error: 'No se pudo leer el PDF.' };
  }
  if (!text.trim()) {
    return {
      fuente: 'pdf',
      error: 'Este PDF no tiene texto legible (parece ser una imagen escaneada). Sube el XML de la guía, o ingresa los productos manualmente.',
    };
  }

  const rucMatch = text.match(/RUC\s*(?:N[°ºo.]?)?\s*:?\s*(\d{11})/i);
  const guiaMatch = text.match(/\b([A-Z]{1,4}\d{2,4})\s*-\s*(\d{1,8})\b/);
  // Nombre del remitente: la primera línea que termina en un sufijo societario
  // (S.A.C., S.A., E.I.R.L., etc.) — en el layout del visor de SUNAT esa línea
  // aparece cerca del encabezado, antes de los datos del destinatario (que sí
  // trae RUC pegado en la misma línea y por eso no calza con este patrón).
  const lineaEmpresa = text.split(/\r?\n/).find((l) => /\b(S\.?A\.?C?\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?)\s*$/i.test(l.trim()) && l.trim().length <= 80);
  const nombreMatch = text.match(/(?:Se[ñn]or\(es\)|Raz[oó]n Social|Proveedor)\s*:?\s*([^\n\r]{3,80})/i);
  const razonSocial = lineaEmpresa ? lineaEmpresa.trim() : (nombreMatch ? nombreMatch[1].trim() : null);

  const lineas = text.split(/\r?\n/);
  const items = extraerItemsPorTabulador(lineas);
  const itemsFinal = items.length > 0 ? items : extraerItemsPorEspacios(lineas);

  return {
    fuente: 'pdf',
    ruc: rucMatch ? rucMatch[1] : null,
    razon_social: razonSocial,
    guia_serie: guiaMatch ? guiaMatch[1].toUpperCase() : null,
    guia_numero: guiaMatch ? String(Number(guiaMatch[2])) : null,
    items: itemsFinal,
    advertencia: 'Extracción aproximada desde PDF: revisa productos, cantidades y proveedor antes de guardar.',
  };
}

module.exports = { parseGuiaXml, parseGuiaPdf };
