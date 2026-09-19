const crypto = require('crypto');
const db = require('../db');
const { resolveTenantDb } = require('../utils/tenant');

// Puerta de entrada para /api/bi/* — pensada para que una herramienta de BI
// externa (Power BI programado, sin persona detrás en el momento del
// refresco) se conecte sola, sin depender de una sesión de usuario que
// expira cada 12h. Usa un token propio (bi_tokens, ver db.js) en vez del JWT
// normal, y deliberadamente da acceso SOLO a routes/bi.js — nunca al resto
// de la API, aunque el token se filtre.
//
// La empresa (RUC) va en la URL porque, a diferencia del login normal, acá
// no hay JWT del que sacarlo — resolveTenantDb necesita saber a qué base
// mirar ANTES de poder siquiera validar el token.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokensMatch(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireBiToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Falta el token de BI (header Authorization: Bearer <token>).' });
  }

  const tenantDb = resolveTenantDb(req.params.ruc || null);
  if (!tenantDb) {
    return res.status(404).json({ error: 'Empresa no encontrada o no disponible.' });
  }

  db.runWithDb(tenantDb, () => {
    const hash = hashToken(token);
    const registrados = db.prepare('SELECT id, token_hash FROM bi_tokens').all();
    const match = registrados.find((r) => tokensMatch(r.token_hash, hash));
    if (!match) {
      return res.status(401).json({ error: 'Token de BI inválido o revocado.' });
    }
    db.prepare('UPDATE bi_tokens SET ultimo_uso_at = datetime(\'now\') WHERE id = ?').run(match.id);
    next();
  });
}

module.exports = { requireBiToken, hashToken };
