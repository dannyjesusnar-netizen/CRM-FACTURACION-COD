// Cliente HTTP servidor-a-servidor hacia la superficie /api/platform/* de
// cada instancia de cliente. Nunca se llama desde el navegador: el token de
// esa instancia vive solo aqui, en el backend del panel.
const TIMEOUT_MS = 45000; // tolera el "cold start" de servicios Render free tier dormidos

async function platformRequest(company, path, { method = 'GET', body } = {}) {
  const url = `${company.render_url.replace(/\/+$/, '')}/api/platform${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Platform-Token': company.platform_token,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      const e = new Error('No se pudo contactar la instancia. Puede estar iniciando (hasta ~30s si estaba dormida) o la URL configurada es incorrecta.');
      e.code = 'UNREACHABLE';
      throw e;
    }
    const e = new Error('No se pudo contactar la instancia. Revisa la URL configurada.');
    e.code = 'UNREACHABLE';
    throw e;
  }
  clearTimeout(timer);

  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin cuerpo JSON */ }

  if (res.status === 401 || res.status === 404) {
    const e = new Error(data?.error || 'Token de plataforma incorrecto o no configurado en esa instancia.');
    e.code = 'AUTH';
    throw e;
  }
  if (!res.ok) {
    const e = new Error(data?.error || 'La instancia respondió con un error.');
    e.code = 'CLIENT_ERROR';
    throw e;
  }
  return data;
}

module.exports = { platformRequest };
