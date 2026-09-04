// Adaptador de Backblaze B2 (almacenamiento en la nube tipo S3, con una capa
// gratuita de 10GB) para subir automáticamente cada respaldo de la base de
// datos fuera del disco de Render — así, si ese disco se pierde o se
// corrompe, el respaldo más reciente sigue existiendo en otro lugar. Ver
// utils/backup.js (quien llama a este adaptador) y el README, sección
// "Copia de seguridad en la nube".
//
// Usa la API nativa de B2 (no el SDK de AWS, para no sumar una dependencia
// pesada solo para esto) — mismo criterio que utils/izipay.js.

const fs = require('fs');
const crypto = require('crypto');

const B2_KEY_ID = process.env.B2_KEY_ID || null; // "keyID" de una Application Key de B2 (no la cuenta maestra)
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY || null;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID || null;

const PREFIJO = 'crm-'; // debe coincidir con NOMBRE_BASE de utils/backup.js
const MAX_RESPALDOS_REMOTOS = 14;

function estaConfigurado() {
  return Boolean(B2_KEY_ID && B2_APPLICATION_KEY && B2_BUCKET_ID);
}

// b2_authorize_account no lleva cuerpo — solo autenticación básica con el
// keyId/applicationKey de la Application Key creada en el dashboard de B2.
async function autorizar() {
  const auth = Buffer.from(`${B2_KEY_ID}:${B2_APPLICATION_KEY}`).toString('base64');
  const res = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.message || `Backblaze rechazó la autorización (HTTP ${res.status}).`);
  return data; // { apiUrl, authorizationToken, ... }
}

async function obtenerUrlDeSubida(sesion) {
  const res = await fetch(`${sesion.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: sesion.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: B2_BUCKET_ID }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.message || `Backblaze no entregó una URL de subida (HTTP ${res.status}).`);
  return data; // { uploadUrl, authorizationToken }
}

// Sube un archivo de respaldo local a B2. Se llama solo cuando
// estaConfigurado() es cierto (ver utils/backup.js), y si algo falla acá el
// respaldo local ya se creó de todas formas — quien llama solo debe
// registrar el error, nunca dejar que interrumpa el respaldo local.
async function subirArchivo(rutaLocal, nombreArchivo) {
  const contenido = fs.readFileSync(rutaLocal);
  const sha1 = crypto.createHash('sha1').update(contenido).digest('hex');
  const sesion = await autorizar();
  const subida = await obtenerUrlDeSubida(sesion);
  const res = await fetch(subida.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: subida.authorizationToken,
      'Content-Type': 'application/x-sqlite3',
      'X-Bz-File-Name': encodeURIComponent(nombreArchivo),
      'X-Bz-Content-Sha1': sha1,
    },
    body: contenido,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.message || `Backblaze rechazó la subida (HTTP ${res.status}).`);
  return data;
}

async function listarArchivosRemotos(sesion) {
  const res = await fetch(`${sesion.apiUrl}/b2api/v2/b2_list_file_names`, {
    method: 'POST',
    headers: { Authorization: sesion.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: B2_BUCKET_ID, prefix: PREFIJO, maxFileCount: 1000 }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.message || `Backblaze no pudo listar los archivos (HTTP ${res.status}).`);
  return data.files || []; // [{ fileId, fileName, ... }]
}

// Igual que limpiarRespaldosViejos() en utils/backup.js, pero en la nube:
// conserva solo los más recientes para no acumular almacenamiento sin
// límite (aunque con la capa gratuita de B2 una base de este tamaño
// tardaría años en acercarse al límite).
async function limpiarViejosRemotos() {
  const sesion = await autorizar();
  const archivos = (await listarArchivosRemotos(sesion)).sort((a, b) => b.fileName.localeCompare(a.fileName));
  const viejos = archivos.slice(MAX_RESPALDOS_REMOTOS);
  for (const archivo of viejos) {
    await fetch(`${sesion.apiUrl}/b2api/v2/b2_delete_file_version`, {
      method: 'POST',
      headers: { Authorization: sesion.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: archivo.fileName, fileId: archivo.fileId }),
    });
  }
}

module.exports = { estaConfigurado, subirArchivo, limpiarViejosRemotos };
