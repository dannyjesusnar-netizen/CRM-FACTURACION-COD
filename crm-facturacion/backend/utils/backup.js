const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('../db');

// Los respaldos viven en el mismo disco persistente (DATA_DIR), en su propia
// carpeta — no dependen de ningún servicio externo. Usamos better-sqlite3's
// .backup() (no una simple copia de archivo) porque la base trabaja en modo
// WAL: los cambios recientes pueden estar todavía en el .db-wal y no en el
// .db principal, así que copiar el archivo a mano podría dejar el respaldo
// incompleto.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const MAX_RESPALDOS = 7;
const NOMBRE_BASE = 'crm';

function limpiarRespaldosViejos() {
  const archivos = fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith(`${NOMBRE_BASE}-`) && f.endsWith('.db'))
    .sort()
    .reverse();
  archivos.slice(MAX_RESPALDOS).forEach((f) => fs.unlinkSync(path.join(BACKUPS_DIR, f)));
}

async function crearRespaldo(sourceDb) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreArchivo = `${NOMBRE_BASE}-${timestamp}.db`;
  const destino = path.join(BACKUPS_DIR, nombreArchivo);
  await sourceDb.backup(destino);
  limpiarRespaldosViejos();
  return nombreArchivo;
}

function listarRespaldos() {
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith(`${NOMBRE_BASE}-`) && f.endsWith('.db'))
    .sort()
    .reverse()
    .map((nombre) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, nombre));
      return { nombre, tamano_bytes: stat.size, creado_en: stat.mtime.toISOString() };
    });
}

// Solo permite nombres con el formato exacto que nosotros generamos — evita
// que alguien pida un archivo arbitrario del disco vía path traversal.
const NOMBRE_VALIDO = /^crm-[0-9T-]+Z\.db$/;

function rutaRespaldo(nombre) {
  if (!NOMBRE_VALIDO.test(nombre)) return null;
  const ruta = path.join(BACKUPS_DIR, nombre);
  if (!fs.existsSync(ruta)) return null;
  return ruta;
}

module.exports = { crearRespaldo, listarRespaldos, rutaRespaldo, BACKUPS_DIR };
