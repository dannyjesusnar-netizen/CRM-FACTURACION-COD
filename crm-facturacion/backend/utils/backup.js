const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('../db');
const backblaze = require('./backblaze');

// Los respaldos viven primero en el mismo disco persistente (DATA_DIR), en
// su propia carpeta. Usamos better-sqlite3's .backup() (no una simple copia
// de archivo) porque la base trabaja en modo WAL: los cambios recientes
// pueden estar todavía en el .db-wal y no en el .db principal, así que
// copiar el archivo a mano podría dejar el respaldo incompleto.
//
// Si además se configuró Backblaze B2 (ver utils/backblaze.js), cada
// respaldo se sube también ahí — así, si el disco de Render se pierde o se
// corrompe, el respaldo más reciente sigue existiendo en otro lugar. Es
// opcional: sin esas variables de entorno, todo sigue funcionando igual que
// antes, solo con el respaldo local.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const MAX_RESPALDOS = 7;

// Todas las empresas de esta instancia (la del despliegue original + cada
// una que se auto-registra desde "Registrar mi empresa", ver
// tenantRegistry.js) comparten esta misma carpeta de respaldos — así que
// cada respaldo se nombra con el mismo nombre de archivo que ya identifica a
// esa empresa (el .db de la instalación original se llama "crm", el de una
// empresa auto-registrada es su RUC, ver tenantRegistry.tenantDbPath). Sin
// esto, dos empresas pisarían el respaldo de la otra (mismo nombre de
// archivo) o, peor, una podría listar/descargar el respaldo de otra.
function nombreBaseDe(sourceDb) {
  return path.basename(sourceDb.name, '.db');
}

function limpiarRespaldosViejos(nombreBase) {
  const archivos = fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith(`${nombreBase}-`) && f.endsWith('.db'))
    .sort()
    .reverse();
  archivos.slice(MAX_RESPALDOS).forEach((f) => fs.unlinkSync(path.join(BACKUPS_DIR, f)));
}

async function crearRespaldo(sourceDb) {
  const nombreBase = nombreBaseDe(sourceDb);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreArchivo = `${nombreBase}-${timestamp}.db`;
  const destino = path.join(BACKUPS_DIR, nombreArchivo);
  await sourceDb.backup(destino);
  limpiarRespaldosViejos(nombreBase);
  if (backblaze.estaConfigurado()) {
    // No se espera (await) a propósito: si Backblaze falla o está lento, el
    // respaldo local ya quedó guardado y no debe verse afectado.
    backblaze.subirArchivo(destino, nombreArchivo)
      .then(() => backblaze.limpiarViejosRemotos(`${nombreBase}-`))
      .catch((err) => console.error('Error subiendo el respaldo a Backblaze B2:', err.message));
  }
  return nombreArchivo;
}

function listarRespaldos(nombreBase) {
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith(`${nombreBase}-`) && f.endsWith('.db'))
    .sort()
    .reverse()
    .map((nombre) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, nombre));
      return { nombre, tamano_bytes: stat.size, creado_en: stat.mtime.toISOString() };
    });
}

// Solo permite nombres con el formato exacto que nosotros generamos, y solo
// dentro del nombreBase de la empresa que pide la descarga — evita tanto un
// path traversal (alguien pidiendo un archivo arbitrario del disco) como que
// una empresa descargue el respaldo de otra adivinando su nombre de archivo.
// nombreBase siempre es "crm" o un RUC (solo dígitos, ver tenantDbPath), así
// que es seguro interpolarlo directo en el regex.
function rutaRespaldo(nombre, nombreBase) {
  const nombreValido = new RegExp(`^${nombreBase}-[0-9T-]+Z\\.db$`);
  if (!nombreValido.test(nombre)) return null;
  const ruta = path.join(BACKUPS_DIR, nombre);
  if (!fs.existsSync(ruta)) return null;
  return ruta;
}

module.exports = { crearRespaldo, listarRespaldos, rutaRespaldo, nombreBaseDe, BACKUPS_DIR };
