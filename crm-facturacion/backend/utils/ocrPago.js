const { getWorker } = require('./ocrWorker');

// Busca un monto en soles en el texto reconocido: primero cerca del
// símbolo "S/", y si no aparece, cualquier número con dos decimales — así
// cubre capturas donde el OCR no logró leer bien el símbolo de moneda.
function extraerMonto(texto) {
  const conSimbolo = texto.match(/s\/\.?\s*(\d{1,4}(?:[.,]\d{1,2})?)/i);
  if (conSimbolo) return Math.round(parseFloat(conSimbolo[1].replace(',', '.')) * 100) / 100;
  const decimal = texto.match(/\b(\d{1,4}[.,]\d{2})\b/);
  if (decimal) return Math.round(parseFloat(decimal[1].replace(',', '.')) * 100) / 100;
  return null;
}

function detectarMedio(texto) {
  const t = texto.toLowerCase();
  if (t.includes('yape')) return 'yape';
  if (t.includes('plin')) return 'plin';
  return null;
}

// Busca una hora en el texto reconocido (formato "HH:MM" de 12 o 24 horas,
// con o sin "a.m./p.m.") — los comprobantes de Yape/Plin siempre muestran la
// hora del pago. Es informativo, no bloquea el registro si no se detecta.
function extraerHora(texto) {
  const conPeriodo = texto.match(/\b(\d{1,2}):(\d{2})\s*(a\.?\s?m\.?|p\.?\s?m\.?)/i);
  if (conPeriodo) {
    const periodo = /p/i.test(conPeriodo[3]) ? 'p.m.' : 'a.m.';
    return `${conPeriodo[1]}:${conPeriodo[2]} ${periodo}`;
  }
  const sinPeriodo = texto.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (sinPeriodo) return `${sinPeriodo[1]}:${sinPeriodo[2]}`;
  return null;
}

// Recibe la imagen como Buffer o data URL y devuelve el texto reconocido
// más el monto/medio/hora que se pudieron inferir (cualquiera puede salir
// null si el OCR no encontró nada reconocible — el usuario siempre confirma
// o corrige antes de guardar).
async function analizarComprobante(imagen) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagen);
  return {
    texto: data.text,
    monto_detectado: extraerMonto(data.text),
    medio_detectado: detectarMedio(data.text),
    hora_detectada: extraerHora(data.text),
  };
}

module.exports = { analizarComprobante };
