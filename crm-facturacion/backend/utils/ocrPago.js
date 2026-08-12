const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

// Datos de idioma empaquetados como dependencia npm (@tesseract.js-data/eng)
// en vez de descargarlos de un CDN en cada arranque — así funciona sin
// depender de que el servidor tenga salida a internet en ese momento.
const LANG_PATH = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

// tesseract.js descomprime el .traineddata la primera vez y lo cachea en
// disco para no repetir esa descompresión en cada request — se le da una
// carpeta propia (misma raíz que la base de datos) en vez de dejarlo caer
// en el directorio del código fuente.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'ocr-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Un solo worker reutilizado entre requests (crearlo de nuevo cada vez es
// lento — reinicializa el motor WASM). Se crea recién en el primer uso.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { langPath: LANG_PATH, gzip: true, cachePath: CACHE_DIR });
  }
  return workerPromise;
}

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
