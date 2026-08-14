const jwt = require('jsonwebtoken');

const DEV_JWT_SECRET = 'panel-central-dev-secret-change-me';
const JWT_SECRET = process.env.PANEL_JWT_SECRET || DEV_JWT_SECRET;

// Ver el mismo candado en crm-facturacion/backend/middleware/auth.js: sin
// esto, un PANEL_JWT_SECRET no configurado en producción permite forjar
// tokens de acceso al panel de administración de todas las empresas.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_JWT_SECRET) {
  throw new Error('PANEL_JWT_SECRET no está configurado (o usa el valor de desarrollo) en un entorno de producción. Define una variable de entorno PANEL_JWT_SECRET real antes de arrancar.');
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Token faltante.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado.' });
  }
}

module.exports = { requireAuth, JWT_SECRET };
