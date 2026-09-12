// SUNAT no ofrece una API pública oficial para consultar RUC ni RENIEC para
// DNI — solo sus páginas web pensadas para humanos, no aptas para
// automatizar sin infringir sus términos de uso. Por eso esta verificación
// usa un proveedor externo que sí expone una API real sobre esos mismos
// datos públicos: Decolecta (https://decolecta.com), con plan gratuito
// limitado. Es una verificación de mejor esfuerzo, no un canal oficial de
// SUNAT/RENIEC:
//
// - Sin RUC_LOOKUP_TOKEN configurado, estas funciones no hacen ninguna
//   llamada — el registro/autocompletado sigue funcionando solo con la
//   validación de formato (11 dígitos para RUC, 8 para DNI).
// - Si el servicio externo falla, está caído o tarda demasiado, tampoco se
//   bloquea nada (falla "abierto": nunca le impedimos a alguien registrar
//   su empresa o un cliente real por un problema de un tercero).
// - Solo se bloquea el registro de empresa cuando el proveedor externo
//   respondió con certeza que el RUC no existe o que está de baja/inactivo.
const TIMEOUT_MS = 6000;
const BASE_URL = 'https://api.decolecta.com/v1';

async function llamar(path, numero) {
  const token = process.env.RUC_LOOKUP_TOKEN;
  if (!token) return { ok: false, motivo: 'sin_configurar' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}?numero=${encodeURIComponent(numero)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.error(`[rucLookup] ${path}: no se pudo conectar con Decolecta:`, err.message);
    return { ok: false, motivo: 'no_disponible' };
  }
  clearTimeout(timer);

  if (res.status === 404) {
    return { ok: true, existe: false };
  }
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    console.error(`[rucLookup] ${path}: Decolecta respondió HTTP ${res.status}. Cuerpo: ${cuerpo.slice(0, 300)}`);
    return { ok: false, motivo: 'error_servicio' };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(`[rucLookup] ${path}: la respuesta no es JSON válido:`, err.message);
    return { ok: false, motivo: 'respuesta_invalida' };
  }
  return { ok: true, existe: true, data };
}

async function consultarRuc(ruc) {
  const res = await llamar('/sunat/ruc', ruc);
  if (!res.ok) return { verificado: false, motivo: res.motivo };
  if (!res.existe) return { verificado: true, existe: false };

  const data = res.data;
  // Nombres de campo defensivos: no hay una única convención documentada
  // entre versiones/proveedores compatibles (camelCase vs snake_case).
  const razonSocial = data?.razon_social || data?.razonSocial || data?.nombre_o_razon_social || data?.nombre || null;
  if (!data || !razonSocial) {
    console.error('[rucLookup] /sunat/ruc: respuesta 200 sin campo de razón social reconocido. JSON recibido:', JSON.stringify(data).slice(0, 500));
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
// (mismo proveedor Decolecta, mismo token) — para autocompletar el nombre
// del cliente al registrar una venta, no para la verificación de la propia
// empresa.
async function consultarDni(dni) {
  const res = await llamar('/reniec/dni', dni);
  if (!res.ok) return { verificado: false, motivo: res.motivo };
  if (!res.existe) return { verificado: true, existe: false };

  const data = res.data;
  // El nombre completo puede venir armado en un solo campo o en partes,
  // con distintas convenciones de nombre de campo según el proveedor -- se
  // arma a mano si hace falta, en vez de asumir un solo formato.
  const nombreCompleto = data?.full_name || data?.nombreCompleto || data?.nombre_completo
    || [
      data?.first_name || data?.nombres,
      data?.first_last_name || data?.apellidoPaterno || data?.apellido_paterno,
      data?.second_last_name || data?.apellidoMaterno || data?.apellido_materno,
    ].filter(Boolean).join(' ').trim();
  if (!data || !nombreCompleto) {
    console.error('[rucLookup] /reniec/dni: respuesta 200 sin campo de nombre reconocido. JSON recibido:', JSON.stringify(data).slice(0, 500));
    return { verificado: true, existe: false };
  }
  return { verificado: true, existe: true, nombreCompleto };
}

module.exports = { consultarRuc, consultarDni };
