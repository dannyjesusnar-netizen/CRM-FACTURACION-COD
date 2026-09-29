// SUNAT no ofrece una API pública oficial para consultar RUC ni RENIEC para
// DNI — solo sus páginas web pensadas para humanos, no aptas para
// automatizar sin infringir sus términos de uso. Por eso esta verificación
// usa un proveedor externo que sí expone una API real sobre esos mismos
// datos públicos: Perú API (https://peruapi.com), con plan gratuito
// limitado (50 consultas/día, 1,000/mes). Es una verificación de mejor
// esfuerzo, no un canal oficial de SUNAT/RENIEC:
//
// - Sin RUC_LOOKUP_TOKEN configurado, estas funciones no hacen ninguna
//   llamada — el registro/autocompletado sigue funcionando solo con la
//   validación de formato (11 dígitos para RUC, 8 para DNI).
// - Si el servicio externo falla, está caído o tarda demasiado, tampoco se
//   bloquea nada (falla "abierto": nunca le impedimos a alguien registrar
//   su empresa o un cliente real por un problema de un tercero).
// - Solo se bloquea el registro de empresa cuando el proveedor externo
//   respondió con certeza que el RUC no existe o que está de baja/inactivo.
//
// Ojo: el plan gratuito de Perú API limita a 1 IP autorizada (se configura
// en su panel, sección "IPs autorizadas") -- si la IP de salida del backend
// cambia (por ejemplo al mover de plan en Render), hay que volver a
// autorizarla ahí o esta verificación empieza a fallar "en silencio"
// (ok:false, motivo:error_servicio).
const TIMEOUT_MS = 6000;
const BASE_URL = 'https://peruapi.com/api';

async function llamar(path, numero) {
  const token = process.env.RUC_LOOKUP_TOKEN;
  if (!token) return { ok: false, motivo: 'sin_configurar' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}/${encodeURIComponent(numero)}`, {
      headers: { 'X-API-KEY': token },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.error(`[rucLookup] ${path}: no se pudo conectar con Perú API:`, err.message);
    return { ok: false, motivo: 'no_disponible' };
  }
  clearTimeout(timer);

  if (res.status === 404) {
    return { ok: true, existe: false };
  }
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    console.error(`[rucLookup] ${path}: Perú API respondió HTTP ${res.status}. Cuerpo: ${cuerpo.slice(0, 300)}`);
    return { ok: false, motivo: 'error_servicio' };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(`[rucLookup] ${path}: la respuesta no es JSON válido:`, err.message);
    return { ok: false, motivo: 'respuesta_invalida' };
  }

  // Perú API siempre responde HTTP 200 -- el resultado real (encontrado o
  // no) va en "code"/"mensaje" dentro del JSON, no en el status HTTP.
  if (String(data?.code) !== '200') {
    return { ok: true, existe: false };
  }
  return { ok: true, existe: true, data };
}

async function consultarRuc(ruc) {
  const res = await llamar('/ruc', ruc);
  if (!res.ok) return { verificado: false, motivo: res.motivo };
  if (!res.existe) return { verificado: true, existe: false };

  const data = res.data;
  const razonSocial = data?.razon_social || null;
  if (!razonSocial) {
    console.error('[rucLookup] /ruc: respuesta sin razon_social. JSON recibido:', JSON.stringify(data).slice(0, 500));
    return { verificado: true, existe: false };
  }
  return {
    verificado: true,
    existe: true,
    razonSocial,
    estado: data.estado || null, // ej. "ACTIVO", "BAJA DE OFICIO", "BAJA PROVISIONAL"
    condicion: data.condicion || null, // ej. "HABIDO", "NO HABIDO"
    direccion: data.direccion || null,
  };
}

// Misma idea que consultarRuc, pero contra RENIEC (DNI) en vez de SUNAT
// (mismo proveedor Perú API, mismo token) — para autocompletar el nombre
// del cliente al registrar una venta, no para la verificación de la propia
// empresa.
async function consultarDni(dni) {
  const res = await llamar('/dni', dni);
  if (!res.ok) return { verificado: false, motivo: res.motivo };
  if (!res.existe) return { verificado: true, existe: false };

  const data = res.data;
  const nombreCompleto = data?.cliente
    || [data?.nombres, data?.apellido_paterno, data?.apellido_materno].filter(Boolean).join(' ').trim();
  if (!nombreCompleto) {
    console.error('[rucLookup] /dni: respuesta sin nombre. JSON recibido:', JSON.stringify(data).slice(0, 500));
    return { verificado: true, existe: false };
  }
  return { verificado: true, existe: true, nombreCompleto };
}

module.exports = { consultarRuc, consultarDni };
