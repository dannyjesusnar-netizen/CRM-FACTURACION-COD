// SUNAT no ofrece una API pública oficial para consultar RUC — solo su
// página web de "Consulta RUC" (pensada para humanos, no apta para
// automatizar sin infringir sus términos de uso). Por eso esta verificación
// usa un proveedor externo que sí expone una API real sobre esos mismos
// datos públicos (apis.net.pe, con plan gratuito limitado). Es una
// verificación de mejor esfuerzo, no un canal oficial de SUNAT:
//
// - Sin RUC_LOOKUP_TOKEN configurado, esta función no hace ninguna llamada
//   (igual que como se comportaba el sistema antes de que existiera) — el
//   registro sigue funcionando solo con la validación de formato (11 dígitos).
// - Si el servicio externo falla, está caído o tarda demasiado, tampoco se
//   bloquea el registro (falla "abierto": nunca le impedimos a alguien
//   registrar su empresa real por un problema de un tercero).
// - Solo se bloquea el registro cuando el proveedor externo respondió con
//   certeza que el RUC no existe o que está de baja/inactivo.
const TIMEOUT_MS = 6000;

async function consultarRuc(ruc) {
  const token = process.env.RUC_LOOKUP_TOKEN;
  if (!token) return { verificado: false, motivo: 'sin_configurar' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${encodeURIComponent(ruc)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { verificado: false, motivo: 'no_disponible' };
  }
  clearTimeout(timer);

  if (res.status === 404) {
    return { verificado: true, existe: false };
  }
  if (!res.ok) {
    return { verificado: false, motivo: 'error_servicio' };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { verificado: false, motivo: 'respuesta_invalida' };
  }
  if (!data || !data.numeroDocumento) {
    return { verificado: true, existe: false };
  }
  return {
    verificado: true,
    existe: true,
    razonSocial: data.nombre || data.razonSocial || null,
    estado: data.estado || null, // ej. "ACTIVO", "BAJA DE OFICIO", "BAJA PROVISIONAL"
    condicion: data.condicion || null, // ej. "HABIDO", "NO HABIDO"
    direccion: data.direccion || null,
  };
}

// Misma idea que consultarRuc, pero contra RENIEC (DNI) en vez de SUNAT
// (mismo proveedor apis.net.pe, mismo token) — para autocompletar el nombre
// del cliente al registrar una venta, no para la verificación de la propia
// empresa. Igual de "mejor esfuerzo": sin token no llama a nada, y si el
// proveedor falla simplemente no autocompleta (nunca bloquea la venta).
async function consultarDni(dni) {
  const token = process.env.RUC_LOOKUP_TOKEN;
  if (!token) return { verificado: false, motivo: 'sin_configurar' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`https://api.apis.net.pe/v2/reniec/dni?numero=${encodeURIComponent(dni)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { verificado: false, motivo: 'no_disponible' };
  }
  clearTimeout(timer);

  if (res.status === 404) {
    return { verificado: true, existe: false };
  }
  if (!res.ok) {
    return { verificado: false, motivo: 'error_servicio' };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { verificado: false, motivo: 'respuesta_invalida' };
  }
  // El nombre completo puede venir armado (nombreCompleto) o en partes
  // (nombres/apellidoPaterno/apellidoMaterno) según la versión del
  // proveedor — se arma a mano si hace falta, en vez de asumir un solo
  // formato de respuesta.
  const nombreCompleto = data?.nombreCompleto
    || [data?.nombres, data?.apellidoPaterno, data?.apellidoMaterno].filter(Boolean).join(' ').trim();
  if (!data || !nombreCompleto) {
    return { verificado: true, existe: false };
  }
  return { verificado: true, existe: true, nombreCompleto };
}

module.exports = { consultarRuc, consultarDni };
