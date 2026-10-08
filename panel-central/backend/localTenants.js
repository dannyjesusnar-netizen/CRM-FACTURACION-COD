// Cuando panel-central corre co-desplegado junto a una instancia de
// crm-facturacion (mismo proceso Node, mismo disco — ver
// crm-facturacion/backend/server.js y render.yaml, que monta este panel
// bajo /panel dentro del mismo servicio), las empresas que se registraron
// ahí mismo vía "Registrar mi empresa" deben verse automáticamente acá,
// sin pedir URL ni token: viven en el mismo proceso, no hace falta ni
// siquiera una llamada HTTP. Si panel-central corriera solo (sin esa
// instancia al lado), esto queda deshabilitado sin romper nada — el resto
// del panel (empresas agregadas a mano con su propia URL) sigue
// funcionando igual.
const bcrypt = require('bcryptjs');

let tenantRegistry = null;
let resolveTenantDb = null;
let crmDb = null;
let sembrarSeriesParaSucursal = null;
try {
  tenantRegistry = require('../../crm-facturacion/backend/tenantRegistry');
  resolveTenantDb = require('../../crm-facturacion/backend/utils/tenant').resolveTenantDb;
  crmDb = require('../../crm-facturacion/backend/db');
  sembrarSeriesParaSucursal = require('../../crm-facturacion/backend/utils/series').sembrarSeriesParaSucursal;
} catch {
  tenantRegistry = null;
  resolveTenantDb = null;
  crmDb = null;
  sembrarSeriesParaSucursal = null;
}

function disponible() {
  return Boolean(tenantRegistry);
}

// El número de sucursales de cada empresa vive en su propia base aislada
// (cross-db, ver listarMensajes más abajo para la misma técnica) — se
// calcula por fila al listar, no es costoso porque todo corre en el mismo
// proceso (sin red). Incluye a la instalación base (ver
// tenantRegistry.js:adoptarInstanciaBase): su db_file ya apunta a la base
// de siempre, así que resolveTenantDb la resuelve igual que a cualquiera.
function sucursalesCount(ruc) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  return crmDb.runWithDb(tenantDb, () => crmDb.prepare('SELECT COUNT(*) AS n FROM sucursales WHERE activo = 1').get().n);
}

// Cuántas solicitudes de sede siguen sin resolver — para el badge del botón
// "Solicitudes" en la tabla, sin tener que abrir el modal para saberlo.
function solicitudesSedePendientesCount(ruc) {
  if (!resolveTenantDb || !crmDb) return 0;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return 0;
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare(`SELECT COUNT(*) AS n FROM solicitudes_sede WHERE estado = 'pendiente'`).get().n
  );
}

function listarEmpresas() {
  if (!tenantRegistry) return [];
  return tenantRegistry.listTodos().map((t) => ({
    ...t,
    ingreso_total: tenantRegistry.ingresoTotal(t.ruc),
    sucursales_count: sucursalesCount(t.ruc),
    solicitudes_sede_pendientes: solicitudesSedePendientesCount(t.ruc),
    documentos_mes: documentosPorSede(t.ruc)?.total?.total ?? 0,
  }));
}

function encontrar(ruc) {
  if (!tenantRegistry) return null;
  return tenantRegistry.findTenant(ruc);
}

// Crea una empresa de demostración lista para mostrar: siembra el mismo
// set de datos de ejemplo que trae la instalación base (3 sedes, 8
// productos, 3 clientes, y los 3 usuarios de siempre: admin/00000000/
// admin123, vendedor1/45678912 y vendedor2/87654321, ambos vendedor123 —
// ver crm-facturacion/backend/db.js:initSchema, opción "demo"). A
// diferencia de "Registrar mi empresa" (que crea un tenant vacío,
// demo:false, en estado "pendiente" hasta que Gerencia la apruebe), esta
// la crea y aprueba de una sola vez el propio dueño de la plataforma, sin
// pasar por esa cola — no es un cliente real pidiendo acceso, es una
// demo para mostrar.
function crearEmpresaDemo({ ruc, razon_social }) {
  if (!tenantRegistry || !resolveTenantDb || !crmDb) return { error: 'No disponible.' };
  if (!/^\d{11}$/.test(ruc || '')) return { error: 'El RUC debe tener 11 dígitos.' };
  const razonSocialLimpia = (razon_social || '').trim();
  if (!razonSocialLimpia) return { error: 'La razón social es requerida.' };
  if (tenantRegistry.findTenant(ruc)) return { error: 'Ese RUC ya está registrado.' };

  const tenant = tenantRegistry.crearTenant({ ruc, razon_social: razonSocialLimpia });
  crmDb.openTenantDb(tenant.db_file, {
    demo: true,
    empresa: { razon_social: razonSocialLimpia, ruc, nombre_comercial: razonSocialLimpia },
  });
  tenantRegistry.aprobarTenant(ruc);
  return { tenant: tenantRegistry.findTenant(ruc) };
}

function setTipoNegocio(ruc, tipo) {
  if (!tenantRegistry) return { error: 'No disponible.' };
  return tenantRegistry.setTipoNegocio(ruc, tipo);
}

function aprobar(ruc) {
  return tenantRegistry.aprobarTenant(ruc);
}

function rechazar(ruc) {
  return tenantRegistry.rechazarTenant(ruc);
}

function activar(ruc) {
  return tenantRegistry.activarTenant(ruc);
}

function desactivar(ruc) {
  return tenantRegistry.desactivarTenant(ruc);
}

function setCosto(ruc, datos) {
  return tenantRegistry.setCosto(ruc, datos);
}

function setSedesLibres(ruc, cantidad) {
  return tenantRegistry.setSedesLibres(ruc, cantidad);
}

function listarPagos(ruc) {
  return tenantRegistry.listarPagos(ruc);
}

// Los mensajes que le escriben al asistente ODIN (widget del CRM) viven en
// la base de datos AISLADA de cada empresa (crm-facturacion/backend/db.js
// es multi-tenant: un archivo .db por RUC), no en el registro central de
// tenantRegistry. Por eso hace falta resolver esa base puntual y correr la
// consulta dentro de ella — mismo patrón que usa
// crm-facturacion/backend/routes/auth.js al registrar una empresa nueva.
function listarMensajes(ruc) {
  if (!resolveTenantDb || !crmDb) return [];
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return [];
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare('SELECT * FROM mensajes_soporte ORDER BY created_at DESC').all()
  );
}

function marcarMensajeLeido(ruc, id) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  return crmDb.runWithDb(tenantDb, () => {
    crmDb.prepare('UPDATE mensajes_soporte SET leido = 1 WHERE id = ?').run(id);
    return crmDb.prepare('SELECT * FROM mensajes_soporte WHERE id = ?').get(id);
  });
}

// Solicitudes de sede (cuando la empresa ya usó sus sedes libres, ver
// crm-facturacion/backend/routes/sucursales.js) — mismo cross-db que
// listarMensajes.
function listarSolicitudesSede(ruc) {
  if (!resolveTenantDb || !crmDb) return [];
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return [];
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare('SELECT * FROM solicitudes_sede ORDER BY created_at DESC').all()
  );
}

// Aprobar una solicitud crea la sede tal cual fue pedida (con su propia
// serie de comprobantes, igual que POST /api/sucursales del CRM) dentro de
// la base de esa empresa, y deja la solicitud marcada como resuelta.
// Rechazarla solo cambia su estado, sin tocar nada más. Si la sede ya no se
// puede crear (p.ej. otra con el mismo nombre se creó mientras tanto), no
// se toca el estado de la solicitud y se informa el motivo para reintentar.
function resolverSolicitudSede(ruc, id, { aprobar, respuesta }) {
  if (!resolveTenantDb || !crmDb) return { error: 'No disponible.' };
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return { error: 'No disponible.' };
  return crmDb.runWithDb(tenantDb, () => {
    const solicitud = crmDb.prepare('SELECT * FROM solicitudes_sede WHERE id = ?').get(id);
    if (!solicitud) return { error: 'Solicitud no encontrada.' };
    if (solicitud.estado !== 'pendiente') return { error: 'Esta solicitud ya fue resuelta.' };

    if (aprobar) {
      const yaExiste = crmDb.prepare('SELECT id FROM sucursales WHERE nombre = ?').get(solicitud.nombre);
      if (yaExiste) {
        return { error: `Ya existe una sede llamada "${solicitud.nombre}" — pide que la empresa la solicite de nuevo con otro nombre.` };
      }
      const info = crmDb.prepare('INSERT INTO sucursales (nombre, direccion) VALUES (?, ?)').run(solicitud.nombre, solicitud.direccion);
      if (sembrarSeriesParaSucursal) sembrarSeriesParaSucursal(info.lastInsertRowid);
    }

    crmDb.prepare(
      `UPDATE solicitudes_sede SET estado = ?, respuesta = ?, resuelto_at = datetime('now') WHERE id = ?`
    ).run(aprobar ? 'aprobada' : 'rechazada', respuesta || null, id);
    return { solicitud: crmDb.prepare('SELECT * FROM solicitudes_sede WHERE id = ?').get(id) };
  });
}

// Cuántos documentos emitió cada sede de esta empresa en el mes (Boletas,
// Facturas, Notas de Crédito y Notas de Venta Interna por separado, más el
// total), y el total de toda la empresa al pie -- mismo cross-db que
// listarMensajes. Por defecto es el mes/año actual; se puede pedir otro con
// { anio, mes }. Este conteo es a propósito exclusivo de este panel (QORIA
// Central) -- ni Gerencia ni ningún rol dentro del propio CRM de la empresa
// debe ver cuánto factura cada una de sus sedes comparado con las demás
// desde el panel de la plataforma, así que no existe un endpoint equivalente
// en crm-facturacion.
function documentosPorSede(ruc, { anio, mes } = {}) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  const ahora = new Date();
  const anioStr = String(anio || ahora.getFullYear());
  const mesPad = String(mes || ahora.getMonth() + 1).padStart(2, '0');
  return crmDb.runWithDb(tenantDb, () => {
    const rows = crmDb.prepare(`
      SELECT s.id, s.nombre,
        COALESCE(SUM(CASE WHEN d.tipo = 'boleta' THEN 1 ELSE 0 END), 0) AS boletas,
        COALESCE(SUM(CASE WHEN d.tipo = 'factura' THEN 1 ELSE 0 END), 0) AS facturas,
        COALESCE(SUM(CASE WHEN d.tipo = 'nota_credito' THEN 1 ELSE 0 END), 0) AS notas_credito,
        COALESCE(SUM(CASE WHEN d.tipo = 'nota_venta' THEN 1 ELSE 0 END), 0) AS notas_venta
      FROM sucursales s
      LEFT JOIN (
        SELECT sucursal_id, tipo_comprobante AS tipo FROM invoices
        WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
        UNION ALL
        SELECT sucursal_id, 'nota_venta' AS tipo FROM notas_venta
        WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
      ) d ON d.sucursal_id = s.id
      WHERE s.activo = 1
      GROUP BY s.id
    `).all(anioStr, mesPad, anioStr, mesPad);

    const sedes = rows
      .map((r) => ({
        sucursal_id: r.id,
        sede: r.nombre,
        boletas: r.boletas,
        facturas: r.facturas,
        notas_credito: r.notas_credito,
        notas_venta: r.notas_venta,
        total: r.boletas + r.facturas + r.notas_credito + r.notas_venta,
      }))
      .sort((a, b) => b.total - a.total);

    const total = sedes.reduce((acc, s) => ({
      boletas: acc.boletas + s.boletas,
      facturas: acc.facturas + s.facturas,
      notas_credito: acc.notas_credito + s.notas_credito,
      notas_venta: acc.notas_venta + s.notas_venta,
      total: acc.total + s.total,
    }), { boletas: 0, facturas: 0, notas_credito: 0, notas_venta: 0, total: 0 });

    return { anio: Number(anioStr), mes: Number(mesPad), sedes, total };
  });
}

// Mismo reporte que documentosPorSede, pero para TODAS las empresas de esta
// instancia a la vez — para el área de Reportes de QORIA Central ("¿qué
// sede de qué empresa emite más?"), en vez de tener que abrirlas una por
// una. Devuelve cada sede de cada empresa en una sola lista plana (más
// fácil de ordenar/leer que agruparlas por empresa), más un total general.
function documentosPorSedeTodasLasEmpresas({ anio, mes } = {}) {
  if (!tenantRegistry) return { anio, mes, empresas: [], sedes: [], total: { boletas: 0, facturas: 0, notas_credito: 0, notas_venta: 0, total: 0 } };
  const tenants = tenantRegistry.listTodos();
  const sedes = [];
  let anioResuelto = anio;
  let mesResuelto = mes;
  for (const t of tenants) {
    const resultado = documentosPorSede(t.ruc, { anio, mes });
    if (!resultado) continue;
    anioResuelto = resultado.anio;
    mesResuelto = resultado.mes;
    for (const s of resultado.sedes) {
      sedes.push({ ...s, ruc: t.ruc, razon_social: t.razon_social });
    }
  }
  sedes.sort((a, b) => b.total - a.total);
  const total = sedes.reduce((acc, s) => ({
    boletas: acc.boletas + s.boletas,
    facturas: acc.facturas + s.facturas,
    notas_credito: acc.notas_credito + s.notas_credito,
    notas_venta: acc.notas_venta + s.notas_venta,
    total: acc.total + s.total,
  }), { boletas: 0, facturas: 0, notas_credito: 0, notas_venta: 0, total: 0 });
  return { anio: anioResuelto, mes: mesResuelto, sedes, total };
}

// Cuentas de empleados de esa empresa (mismo cross-db que listarMensajes),
// para poder restablecerles la clave desde acá cuando lo pidan.
function listarUsuarios(ruc) {
  if (!resolveTenantDb || !crmDb) return [];
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return [];
  return crmDb.runWithDb(tenantDb, () =>
    crmDb.prepare('SELECT id, full_name, nombres, apellidos, dni, email, role, activo FROM users ORDER BY nombres ASC, full_name ASC').all()
  );
}

function restablecerClave(ruc, userId, password) {
  if (!resolveTenantDb || !crmDb) return null;
  const tenantDb = resolveTenantDb(ruc);
  if (!tenantDb) return null;
  return crmDb.runWithDb(tenantDb, () => {
    const existing = crmDb.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) return null;
    crmDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), userId);
    return crmDb.prepare('SELECT id, full_name, nombres, apellidos, dni, email, role, activo FROM users WHERE id = ?').get(userId);
  });
}

module.exports = {
  disponible, listarEmpresas, encontrar, crearEmpresaDemo, aprobar, rechazar, activar, desactivar, setCosto, setSedesLibres,
  setTipoNegocio, listarPagos, listarMensajes, marcarMensajeLeido, listarSolicitudesSede, resolverSolicitudSede,
  listarUsuarios, restablecerClave, documentosPorSede, documentosPorSedeTodasLasEmpresas,
};
