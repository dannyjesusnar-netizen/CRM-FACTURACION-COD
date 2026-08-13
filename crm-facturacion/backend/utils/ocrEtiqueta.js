const { getWorker } = require('./ocrWorker');

// Busca un número de lote en el texto reconocido de una etiqueta: primero
// cerca de la palabra "lote"/"lot", y si no aparece, no arriesga nada (a
// diferencia del monto en un comprobante, un código alfanumérico cualquiera
// del texto no es un buen candidato a "adivinar").
function extraerLote(texto) {
  const m = texto.match(/lote?\.?\s*[:#nº°]*\s*([a-z0-9][a-z0-9\-\/]{2,19})/i);
  if (m) return m[1].toUpperCase();
  const m2 = texto.match(/\blot\.?\s*[:#nº°]*\s*([a-z0-9][a-z0-9\-\/]{2,19})/i);
  if (m2) return m2[1].toUpperCase();
  return null;
}

// Normaliza año/mes/día (como strings) a "YYYY-MM-DD"; devuelve null si el
// mes o el día quedan fuera de rango (evita devolver una fecha inválida por
// una mala lectura del OCR).
function normalizarFecha(anio, mes, dia) {
  const a = anio.padStart(4, '0');
  const m = Number(mes);
  const d = Number(dia);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Busca cualquier fecha reconocible en un fragmento de texto, probando los
// formatos más comunes en empaques peruanos: AAAA-MM-DD, DD/MM/AAAA y, si
// solo hay mes y año impresos (frecuente en productos envasados), MM/AAAA
// (se asume el día 1 de ese mes).
function buscarFechaEnTexto(t) {
  let m = t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return normalizarFecha(m[1], m[2], m[3]);
  m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return normalizarFecha(m[3], m[2], m[1]);
  m = t.match(/(\d{1,2})[\/\-.](\d{4})/);
  if (m) return normalizarFecha(m[2], m[1], '1');
  return null;
}

// Busca la fecha de vencimiento: prioriza el texto cercano a una palabra
// clave de vencimiento (vence/venc/exp/caduca/best before) para no confundir
// con una fecha de fabricación impresa en la misma etiqueta; si no hay
// palabra clave reconocible, prueba con cualquier fecha del texto completo.
function extraerFechaVencimiento(texto) {
  const keyword = /(vence|vencimiento|venc\.?|exp\.?|expira|caduca|caducidad|best\s*before|use\s*by)/i;
  const idx = texto.search(keyword);
  if (idx >= 0) {
    const ventana = texto.slice(idx, idx + 40);
    const fecha = buscarFechaEnTexto(ventana);
    if (fecha) return fecha;
  }
  return buscarFechaEnTexto(texto);
}

// Recibe la foto de una etiqueta (Buffer o data URL) y devuelve el texto
// reconocido más el lote/vencimiento que se pudieron inferir — cualquiera de
// los dos puede salir null si el OCR no encontró nada; el usuario siempre
// revisa y puede corregir antes de guardar la fila.
async function analizarEtiqueta(imagen) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagen);
  return {
    texto: data.text,
    codigo_lote_detectado: extraerLote(data.text),
    fecha_vencimiento_detectada: extraerFechaVencimiento(data.text),
  };
}

module.exports = { analizarEtiqueta };
