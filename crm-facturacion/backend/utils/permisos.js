const db = require('../db');

// Módulos reales del sistema que se pueden habilitar/deshabilitar por rol.
// "dashboard" solo se aplica en el frontend (la pantalla de Inicio comparte
// los mismos endpoints de /api/reports que Reportes, así que no tiene un
// candado propio en el backend).
const MODULOS = [
  { key: 'dashboard', label: 'Inicio' },
  { key: 'ventas', label: 'Ventas' },
  { key: 'compras', label: 'Compras' },
  { key: 'inventario', label: 'Inventario' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'caja', label: 'Caja y Bancos' },
  { key: 'reportes', label: 'Reportes' },
];

// gerencia = acceso total siempre. Sin rol asignado = compatibilidad (acceso
// total, como antes de que existiera este sistema). Con rol asignado, cada
// módulo depende de su toggle en role_permisos.
function permisosDeUsuario(user) {
  const mapa = {};
  if (!user) {
    MODULOS.forEach((m) => { mapa[m.key] = false; });
    return mapa;
  }
  if (user.role === 'gerencia' || !user.custom_role_id) {
    MODULOS.forEach((m) => { mapa[m.key] = true; });
    return mapa;
  }
  const filas = db.prepare('SELECT modulo, habilitado FROM role_permisos WHERE role_id = ?').all(user.custom_role_id);
  const porModulo = {};
  filas.forEach((f) => { porModulo[f.modulo] = !!f.habilitado; });
  MODULOS.forEach((m) => { mapa[m.key] = !!porModulo[m.key]; });
  return mapa;
}

function tienePermiso(user, modulo) {
  if (!user) return false;
  if (user.role === 'gerencia') return true;
  const userRow = db.prepare('SELECT custom_role_id FROM users WHERE id = ?').get(user.id);
  if (!userRow || !userRow.custom_role_id) return true;
  const perm = db.prepare('SELECT habilitado FROM role_permisos WHERE role_id = ? AND modulo = ?').get(userRow.custom_role_id, modulo);
  return !!(perm && perm.habilitado);
}

function requirePermiso(modulo) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
    if (tienePermiso(req.user, modulo)) return next();
    return res.status(403).json({ error: 'No tienes permiso para acceder a este módulo.' });
  };
}

// Para endpoints compartidos por dos pantallas (p.ej. Inicio y Reportes usan
// los mismos endpoints de /api/reports): basta con tener acceso a cualquiera
// de los módulos indicados.
function requireAlgunPermiso(modulos) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
    if (modulos.some((m) => tienePermiso(req.user, m))) return next();
    return res.status(403).json({ error: 'No tienes permiso para acceder a este módulo.' });
  };
}

module.exports = { MODULOS, permisosDeUsuario, requirePermiso, requireAlgunPermiso };
