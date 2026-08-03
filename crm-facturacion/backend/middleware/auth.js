const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'crm-facturacion-dev-secret-change-me';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Token faltante.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado.' });
  }
}

function requireGerencia(req, res, next) {
  if (!req.user || req.user.role !== 'gerencia') {
    return res.status(403).json({ error: 'Solo un usuario de Gerencia puede realizar esta acción.' });
  }
  next();
}

module.exports = { requireAuth, requireGerencia, JWT_SECRET };
