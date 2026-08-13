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

// Un solo worker reutilizado entre requests y entre features (comprobantes
// de pago, etiquetas de producto, etc.) — crearlo de nuevo cada vez es lento
// (reinicializa el motor WASM). Se crea recién en el primer uso.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { langPath: LANG_PATH, gzip: true, cachePath: CACHE_DIR });
  }
  return workerPromise;
}

module.exports = { getWorker };
