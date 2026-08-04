const crypto = require('crypto');

// Puerta de entrada para el panel central (herramienta propia del dueño del
// producto, fuera de esta app). Se autentica con un secreto por-despliegue
// (PLATFORM_TOKEN, configurado solo por variable de entorno en Render — igual
// que NUBEFACT_TOKEN/MAX_SUCURSALES) en vez de con la sesión de un empleado.
// Sin la variable configurada, /api/platform/* no existe (404): nunca un
// "abierto por accidente" con token vacío.
const PLATFORM_TOKEN = process.env.PLATFORM_TOKEN || null;

function tokensMatch(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requirePlatformToken(req, res, next) {
  if (!PLATFORM_TOKEN) {
    return res.status(404).json({ error: 'Ruta no encontrada.' });
  }
  const header = req.headers['x-platform-token'];
  if (!header || !tokensMatch(String(header), PLATFORM_TOKEN)) {
    return res.status(401).json({ error: 'Token de plataforma inválido.' });
  }
  next();
}

module.exports = { requirePlatformToken };
