const fs = require('fs');
const path = require('path');
const { createWorker, PSM } = require('tesseract.js');

// Datos de idioma empaquetados como dependencia npm (@tesseract.js-data/eng
// y /spa) en vez de descargarlos de un CDN en cada arranque — así funciona
// sin depender de que el servidor tenga salida a internet en ese momento.
// Se usan los dos idiomas juntos porque el mismo worker se reutiliza para
// comprobantes de pago (bastante texto en español) y para guías de remisión
// (documentos en español con formato SUNAT) — antes solo se cargaba inglés,
// lo que hacía prácticamente inservible la lectura de una guía completa.
const ENG_DATA_DIR = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
const SPA_DATA_DIR = path.join(path.dirname(require.resolve('@tesseract.js-data/spa/package.json')), '4.0.0_best_int');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'ocr-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// tesseract.js espera que todos los idiomas de un worker multi-idioma vivan
// en la misma carpeta (langPath) — como eng y spa vienen de dos paquetes npm
// distintos, sus .traineddata.gz (ya empaquetados, sin red) se copian una
// sola vez a una carpeta común.
const LANG_PATH = path.join(DATA_DIR, 'ocr-lang-data');
if (!fs.existsSync(LANG_PATH)) fs.mkdirSync(LANG_PATH, { recursive: true });
for (const [nombre, origen] of [['eng', ENG_DATA_DIR], ['spa', SPA_DATA_DIR]]) {
  const destino = path.join(LANG_PATH, `${nombre}.traineddata.gz`);
  if (!fs.existsSync(destino)) fs.copyFileSync(path.join(origen, `${nombre}.traineddata.gz`), destino);
}

// tesseract.js descomprime el .traineddata la primera vez y lo cachea en
// disco para no repetir esa descompresión en cada request — se le da una
// carpeta propia (misma raíz que la base de datos) en vez de dejarlo caer
// en el directorio del código fuente.

// Un solo worker reutilizado entre requests y entre features (comprobantes
// de pago, etiquetas de producto, guías, etc.) — crearlo de nuevo cada vez es
// lento (reinicializa el motor WASM). Se crea recién en el primer uso.
// IMPORTANTE: sin este setParameters, la lectura queda notablemente peor —
// se probó directamente contra una foto real de guía (con caché de datos de
// idioma recién creado, para descartar cualquier caché corrupto) y el mismo
// worker, con la misma imagen, leyó filas de la tabla como texto reconocible
// ("SNICKER PROTEICO DE ALMENDRA") CON este setParameters, y como ruido
// ilegible sin él — aunque tessedit_pageseg_mode "debería" venir en AUTO por
// defecto según el código fuente de tesseract.js, en la práctica no calza.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng+spa', 1, { langPath: LANG_PATH, gzip: true, cachePath: CACHE_DIR })
      .then(async (worker) => {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        return worker;
      });
  }
  return workerPromise;
}

module.exports = { getWorker };
