const db = require('../db');

// Módulos reales del sistema que se pueden habilitar/deshabilitar por rol.
// "dashboard" en sí (la pantalla de Inicio) solo se aplica en el frontend —
// comparte los mismos endpoints de /api/reports que Reportes — pero su
// acción "tablero_ventas" sí tiene candado propio en el backend (ver
// puedeVerTableroVentas más abajo).
const MODULOS = [
  { key: 'dashboard', label: 'Inicio' },
  { key: 'ventas', label: 'Ventas' },
  { key: 'compras', label: 'Compras' },
  { key: 'inventario', label: 'Inventario' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'caja', label: 'Caja y Bancos' },
  { key: 'reportes', label: 'Reportes' },
];

// Acciones específicas dentro de cada módulo. Cuando un rol tiene el módulo
// habilitado, estas son las que se muestran como sub-permisos (desglosable).
// Si un módulo está deshabilitado, ninguna de sus acciones aplica sin
// importar lo que diga esta tabla.
const ACCIONES_POR_MODULO = {
  // "tablero_ventas" es la única acción de todo este archivo cuyo "sin fila
  // guardada" significa NO tiene acceso (default: false) en vez del
  // default-true del resto del sistema — es una vista ejecutiva que cruza
  // todas las sedes, así que cada rol debe ganarla explícitamente desde
  // Configuración → Roles → Inicio, nunca solo por tener "Inicio" prendido.
  // Ver puedeVerTableroVentas() más abajo y su uso en routes/roles.js.
  dashboard: [
    { key: 'tablero_ventas', label: 'Tablero de Ventas (rankings, metas y totales entre sedes)', grupo: 'Inicio', default: false },
  ],
  ventas: [
    { key: 'factura', label: 'Facturas', grupo: 'Comprobantes' },
    { key: 'boleta', label: 'Boletas', grupo: 'Comprobantes' },
    { key: 'nota_credito', label: 'Notas de crédito', grupo: 'Comprobantes' },
    { key: 'cotizacion', label: 'Cotizaciones', grupo: 'Comprobantes' },
    { key: 'guia_remision', label: 'Guías de remisión', grupo: 'Comprobantes' },
    { key: 'abonado', label: 'Abonados (venta a crédito)', grupo: 'Cuentas por cobrar' },
    { key: 'cuentas_por_cobrar', label: 'Ver cuentas por cobrar', grupo: 'Cuentas por cobrar' },
    { key: 'registrar_cobro', label: 'Registrar cobro', grupo: 'Cuentas por cobrar' },
    { key: 'anular_comprobante', label: 'Anular comprobante', grupo: 'Otros' },
  ],
  compras: [
    { key: 'registrar_compra', label: 'Registrar compra', grupo: 'Compras' },
    { key: 'anular_compra', label: 'Anular compra', grupo: 'Compras' },
    { key: 'proveedores', label: 'Gestionar proveedores', grupo: 'Proveedores' },
    { key: 'tipos_compra', label: 'Gestionar tipos de compra', grupo: 'Configuración' },
  ],
  inventario: [
    { key: 'productos', label: 'Crear / editar productos', grupo: 'Catálogo' },
    { key: 'lotes', label: 'Lotes y vencimientos', grupo: 'Catálogo' },
    { key: 'ajustes', label: 'Ajustes de stock', grupo: 'Movimientos' },
    { key: 'conteo', label: 'Conteo de inventario', grupo: 'Movimientos' },
    { key: 'importacion', label: 'Importación masiva', grupo: 'Movimientos' },
    { key: 'traslados', label: 'Traslados entre sedes', grupo: 'Movimientos' },
    { key: 'produccion', label: 'Producción / recetas', grupo: 'Movimientos' },
  ],
  clientes: [
    { key: 'crear_editar', label: 'Crear / editar clientes', grupo: 'Clientes' },
    { key: 'eliminar', label: 'Eliminar clientes', grupo: 'Clientes' },
  ],
  caja: [
    { key: 'apertura', label: 'Apertura / saldo inicial', grupo: 'Caja' },
    { key: 'movimientos', label: 'Registrar ingresos / egresos', grupo: 'Caja' },
    { key: 'eliminar_movimiento', label: 'Eliminar movimiento', grupo: 'Caja' },
  ],
  reportes: [
    { key: 'tributario', label: 'Reporte tributario', grupo: 'Reportes' },
    { key: 'vendedor', label: 'Reporte por vendedor', grupo: 'Reportes' },
    { key: 'producto', label: 'Reporte por producto', grupo: 'Reportes' },
    { key: 'financieros', label: 'Reportes financieros', grupo: 'Reportes' },
  ],
};

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

// Acción específica dentro de un módulo (p.ej. ventas -> "abonado"). Si el
// módulo en sí está apagado, la acción tampoco aplica. Si el módulo está
// prendido pero no hay fila para esa acción todavía (rol creado antes de que
// existiera esta tabla, o acción nueva agregada después), se permite por
// defecto — así no se le quita acceso a nadie de golpe.
function tieneAccion(user, modulo, accion) {
  if (!user) return false;
  if (user.role === 'gerencia') return true;
  const userRow = db.prepare('SELECT custom_role_id FROM users WHERE id = ?').get(user.id);
  if (!userRow || !userRow.custom_role_id) return true;
  if (!tienePermiso(user, modulo)) return false;
  const fila = db.prepare(
    'SELECT habilitado FROM role_acciones WHERE role_id = ? AND modulo = ? AND accion = ?'
  ).get(userRow.custom_role_id, modulo, accion);
  if (!fila) return true;
  return !!fila.habilitado;
}

// Reatribuir una venta a otro Trainer/Supervisor desde Facturas (distinto de
// ver el Tablero de Ventas): sigue reservado a Gerencia o al rol
// personalizado "Supervisor", sin pasar por Configuración → Roles.
function esGerenciaOSupervisor(user) {
  if (!user) return false;
  if (user.role === 'gerencia') return true;
  const userRow = db.prepare('SELECT custom_role_id FROM users WHERE id = ?').get(user.id);
  if (!userRow || !userRow.custom_role_id) return false;
  const role = db.prepare('SELECT nombre FROM roles WHERE id = ?').get(userRow.custom_role_id);
  return role?.nombre === 'Supervisor';
}

function requireGerenciaOSupervisor(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
  if (esGerenciaOSupervisor(req.user)) return next();
  return res.status(403).json({ error: 'Solo Gerencia o un Supervisor puede reatribuir esta venta.' });
}

// Acceso al Tablero de Ventas ejecutivo (cross-sede, en Dashboard): Gerencia
// siempre; cualquier otro rol solo si Configuración → Roles → Inicio →
// "Tablero de Ventas" está prendido explícitamente para ese rol
// (role_acciones), sin el default-true ni la compatibilidad "sin
// custom_role_id = acceso total" que sí aplican al resto de tienePermiso/
// tieneAccion — un Cajero (o cualquier otro rol sin ese toggle) no debe ver
// las cifras de todas las sedes solo por tener "Inicio" prendido.
function puedeVerTableroVentas(user) {
  if (!user) return false;
  if (user.role === 'gerencia') return true;
  const userRow = db.prepare('SELECT custom_role_id FROM users WHERE id = ?').get(user.id);
  if (!userRow || !userRow.custom_role_id) return false;
  if (!tienePermiso(user, 'dashboard')) return false;
  const fila = db.prepare(
    'SELECT habilitado FROM role_acciones WHERE role_id = ? AND modulo = ? AND accion = ?'
  ).get(userRow.custom_role_id, 'dashboard', 'tablero_ventas');
  return !!(fila && fila.habilitado);
}

function requireTableroVentas(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
  if (puedeVerTableroVentas(req.user)) return next();
  return res.status(403).json({ error: 'No tienes permiso para ver el Tablero de Ventas.' });
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

// requireAccion('ventas', 'abonado') como middleware de ruta completa.
// Para casos donde la acción depende del body (p.ej. tipo_comprobante),
// usar tieneAccion(...) directamente dentro del handler.
function requireAccion(modulo, accion) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
    if (tieneAccion(req.user, modulo, accion)) return next();
    return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
  };
}

module.exports = {
  MODULOS,
  ACCIONES_POR_MODULO,
  permisosDeUsuario,
  tienePermiso,
  requirePermiso,
  requireAlgunPermiso,
  tieneAccion,
  requireAccion,
  esGerenciaOSupervisor,
  requireGerenciaOSupervisor,
  puedeVerTableroVentas,
  requireTableroVentas,
};
