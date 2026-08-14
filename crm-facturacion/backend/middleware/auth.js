const jwt = require('jsonwebtoken');
const db = require('../db');
const { resolveTenantDb } = require('../utils/tenant');

const DEV_JWT_SECRET = 'crm-facturacion-dev-secret-change-me';
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;

// En producción, un JWT_SECRET adivinable (o el valor por defecto de
// desarrollo, público en este mismo archivo) permite forjar tokens válidos
// para cualquier tenant — es el equivalente a no tener autenticación.
// render.yaml ya genera uno real (generateValue: true), pero cualquier otro
// despliegue que se salte esa configuración debe fallar fuerte, no arrancar
// en silencio con la puerta abierta.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_JWT_SECRET) {
  throw new Error('JWT_SECRET no está configurado (o usa el valor de desarrollo) en un entorno de producción. Define una variable de entorno JWT_SECRET real antes de arrancar.');
}

// requireAuth valida el token y, a partir del RUC que quedó guardado en él al
// hacer login, resuelve con qué base de datos (empresa) debe trabajar el
// resto de la petición — así el mismo backend puede atender a varias
// empresas registradas sin que ninguna vea datos de otra (ver db.js).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Token faltante.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    const tenantDb = resolveTenantDb(payload.ruc);
    if (!tenantDb) {
      return res.status(403).json({ error: 'Esta empresa ya no está disponible.' });
    }
    db.runWithDb(tenantDb, next);
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

// Resuelve la sede activa de la petición en req.sucursalId. Un vendedor con
// sede fija (users.sucursal_id) siempre opera en esa sede, sin importar lo
// que mande el header (no puede "elegir" otra vía spoofing). Gerencia (u
// otro usuario sin sede fija) usa la sede que eligió en el selector, enviada
// en el header X-Sucursal-Id.
function resolveSucursal(req, res, next) {
  const userRow = db.prepare('SELECT sucursal_id FROM users WHERE id = ?').get(req.user.id);
  if (userRow && userRow.sucursal_id) {
    req.sucursalId = userRow.sucursal_id;
    return next();
  }
  const headerId = req.headers['x-sucursal-id'];
  if (!headerId) {
    return res.status(400).json({ error: 'Falta seleccionar una sede.' });
  }
  const sucursal = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(Number(headerId));
  if (!sucursal) {
    return res.status(400).json({ error: 'La sede seleccionada no existe o está desactivada.' });
  }
  req.sucursalId = sucursal.id;
  next();
}

module.exports = { requireAuth, requireGerencia, resolveSucursal, JWT_SECRET };
