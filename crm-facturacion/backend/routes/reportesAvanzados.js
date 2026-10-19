const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso } = require('../utils/permisos');
const { hoyPeru } = require('../utils/fechas');

// 10 reportes de inventario/ventas pedidos por Gerencia, separados de
// routes/reports.js (que ya pasaba las 750 líneas) para no seguir haciendo
// crecer ese archivo monolítico.
const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);
const requireReportes = requirePermiso('reportes');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Sede: por defecto la sede donde está parado el usuario. Gerencia además
// puede pedir ?todas_las_sedes=1 para ver el consolidado de toda la empresa,
// o ?sucursal_id=<id> para ver una sede específica distinta a la suya (ej.
// San Borja estando parado en Miraflores) — mismo criterio que ya usa
// routes/tablero.js (sedeFiltro) para el Tablero de Ventas.
function sedeIdFiltro(req) {
  if (req.user.role !== 'gerencia') return { sucursalId: req.sucursalId, todas: false };
  if (req.query.todas_las_sedes === '1') return { sucursalId: null, todas: true };
  if (req.query.sucursal_id) return { sucursalId: Number(req.query.sucursal_id), todas: false };
  return { sucursalId: req.sucursalId, todas: false };
}

// Rango de fechas por defecto para los reportes basados en ventas/compras:
// el mes calendario en curso (hora de Perú), si no se manda desde/hasta.
function rangoFechas(req) {
  const hoy = hoyPeru();
  const desde = req.query.desde || `${hoy.slice(0, 7)}-01`;
  const hasta = req.query.hasta || hoy;
  return { desde, hasta };
}

// Mismo criterio que products.js/reports.js (PROVEEDOR_SUBQUERY/proveedorExpr):
// el proveedor "efectivo" de un producto es el que tiene asignado directo, o
// si no tiene, el de su compra más reciente.
function proveedorExpr(alias) {
  return `COALESCE(
    (SELECT s.nombre FROM suppliers s WHERE s.id = ${alias}.proveedor_id),
    (
      SELECT s.nombre FROM purchase_items pi
      JOIN purchases pu ON pu.id = pi.purchase_id
      JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pi.product_id = ${alias}.id AND pu.estado = 'registrada'
      ORDER BY pu.fecha DESC, pu.id DESC LIMIT 1
    ),
    'Sin proveedor'
  )`;
}

// --------------------------------------------------------------------------
// 1) Top 20 productos — cuáles lideran las ventas (cantidad y monto).
// GET /top-productos?desde=&hasta=&todas_las_sedes=
router.get('/top-productos', requireReportes, (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const { sucursalId, todas } = sedeIdFiltro(req);
  const params = [];
  let sql = `
    SELECT p.id, p.codigo, p.nombre, p.categoria,
           SUM(ii.cantidad) AS cantidad,
           SUM(ii.subtotal + ii.igv_item) AS venta
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id
    WHERE i.estado = 'emitido' AND i.tipo_comprobante IN ('boleta', 'factura')
      AND date(i.fecha_emision) >= date(?) AND date(i.fecha_emision) <= date(?)
  `;
  params.push(desde, hasta);
  if (!todas) { sql += ' AND i.sucursal_id = ?'; params.push(sucursalId); }
  sql += ' GROUP BY p.id ORDER BY venta DESC LIMIT 20';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => ({ ...r, venta: round2(r.venta) })));
});

// --------------------------------------------------------------------------
// 2) Productos más rentables — dónde se gana más dinero (margen = venta -
// costo de compra), no solo lo que más se vende.
// GET /productos-rentables?desde=&hasta=&todas_las_sedes=
router.get('/productos-rentables', requireReportes, (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const { sucursalId, todas } = sedeIdFiltro(req);
  const params = [];
  let sql = `
    SELECT p.id, p.codigo, p.nombre, p.categoria,
           SUM(ii.cantidad) AS cantidad,
           SUM(ii.subtotal + ii.igv_item) AS venta,
           SUM(ii.cantidad * COALESCE(p.precio_compra, 0)) AS costo
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id
    WHERE i.estado = 'emitido' AND i.tipo_comprobante IN ('boleta', 'factura')
      AND date(i.fecha_emision) >= date(?) AND date(i.fecha_emision) <= date(?)
  `;
  params.push(desde, hasta);
  if (!todas) { sql += ' AND i.sucursal_id = ?'; params.push(sucursalId); }
  sql += ' GROUP BY p.id';
  const rows = db.prepare(sql).all(...params);
  const conMargen = rows.map((r) => {
    const margen = r.venta - r.costo;
    return {
      ...r, venta: round2(r.venta), costo: round2(r.costo), margen: round2(margen),
      margen_pct: r.venta > 0 ? round2((margen / r.venta) * 100) : 0,
    };
  });
  conMargen.sort((a, b) => b.margen - a.margen);
  res.json(conMargen);
});

// --------------------------------------------------------------------------
// 3) Stock crítico — productos bajo su stock mínimo, para no perder ventas
// por falta de inventario.
// GET /stock-critico?todas_las_sedes=
router.get('/stock-critico', requireReportes, (req, res) => {
  const { sucursalId, todas } = sedeIdFiltro(req);
  const stockSql = todas
    ? `(SELECT COALESCE(SUM(ss.stock), 0) FROM sucursal_stock ss WHERE ss.product_id = p.id)`
    : `(SELECT COALESCE(ss.stock, 0) FROM sucursal_stock ss WHERE ss.product_id = p.id AND ss.sucursal_id = ?)`;
  const sql = `
    SELECT * FROM (
      SELECT p.id, p.codigo, p.nombre, p.categoria, p.stock_minimo,
             ${stockSql} AS stock_actual
      FROM products p
      WHERE p.activo = 1 AND p.unidad != 'ZZ' AND p.stock_minimo > 0
    ) t
    WHERE stock_actual <= stock_minimo
    ORDER BY (stock_minimo - stock_actual) DESC
  `;
  const params = todas ? [] : [sucursalId];
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => ({ ...r, faltante: round2(r.stock_minimo - r.stock_actual) })));
});

// --------------------------------------------------------------------------
// 4) Inventario inmovilizado — productos con stock pero sin ventas
// recientes: dinero detenido sin movimiento.
// GET /inventario-inmovilizado?dias=&todas_las_sedes=
router.get('/inventario-inmovilizado', requireReportes, (req, res) => {
  const dias = Math.max(1, Number(req.query.dias) || 60);
  const { sucursalId, todas } = sedeIdFiltro(req);
  const stockSql = todas
    ? `(SELECT COALESCE(SUM(ss.stock), 0) FROM sucursal_stock ss WHERE ss.product_id = p.id)`
    : `(SELECT COALESCE(ss.stock, 0) FROM sucursal_stock ss WHERE ss.product_id = p.id AND ss.sucursal_id = ?)`;
  const ultimaVentaSql = todas
    ? `(SELECT MAX(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id AND sm.tipo = 'venta')`
    : `(SELECT MAX(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id AND sm.tipo = 'venta' AND sm.sucursal_id = ?)`;
  const sql = `
    SELECT * FROM (
      SELECT p.id, p.codigo, p.nombre, p.categoria, COALESCE(p.precio_compra, 0) AS precio_compra,
             ${stockSql} AS stock_actual, ${ultimaVentaSql} AS ultima_venta
      FROM products p
      WHERE p.activo = 1 AND p.unidad != 'ZZ'
    ) t
    WHERE stock_actual > 0 AND (ultima_venta IS NULL OR date(ultima_venta, '-5 hours') < date('now', '-5 hours', '-' || ${dias} || ' days'))
    ORDER BY (stock_actual * precio_compra) DESC
  `;
  const params = todas ? [] : [sucursalId, sucursalId];
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => ({
    ...r,
    valor_inmovilizado: round2(r.stock_actual * r.precio_compra),
    ultima_venta: r.ultima_venta ? r.ultima_venta.slice(0, 10) : null,
  })));
});

// --------------------------------------------------------------------------
// 5) Próximos a vencer — reduce pérdidas por caducidad (agrupado por
// producto; el detalle lote por lote ya existe en GET /lotes).
// GET /proximos-vencer?dias=&todas_las_sedes=
router.get('/proximos-vencer', requireReportes, (req, res) => {
  const dias = Math.max(1, Number(req.query.dias) || 30);
  const hoy = hoyPeru();
  const limite = db.prepare("SELECT date(?, '+' || ? || ' days') AS f").get(hoy, dias).f;
  const sql = `
    SELECT p.id, p.codigo, p.nombre, p.categoria, COALESCE(p.precio_compra, 0) AS precio_compra,
           SUM(l.cantidad_actual) AS cantidad, MIN(l.fecha_vencimiento) AS vence_mas_proximo
    FROM lotes l
    JOIN products p ON p.id = l.product_id
    WHERE l.activo = 1 AND l.cantidad_actual > 0 AND l.fecha_vencimiento IS NOT NULL
      AND l.fecha_vencimiento <= ?
    GROUP BY p.id
    ORDER BY vence_mas_proximo ASC
  `;
  const rows = db.prepare(sql).all(limite);
  res.json(rows.map((r) => ({
    ...r,
    valor: round2(r.cantidad * r.precio_compra),
    estado: r.vence_mas_proximo < hoy ? 'vencido' : 'por_vencer',
  })));
});

// --------------------------------------------------------------------------
// 6) Compras sugeridas — cuánto y cuándo comprar, según stock mínimo y
// velocidad de venta de los últimos 30 días.
// GET /compras-sugeridas?todas_las_sedes=
router.get('/compras-sugeridas', requireReportes, (req, res) => {
  const { sucursalId, todas } = sedeIdFiltro(req);
  const stockSql = todas
    ? `(SELECT COALESCE(SUM(ss.stock), 0) FROM sucursal_stock ss WHERE ss.product_id = p.id)`
    : `(SELECT COALESCE(ss.stock, 0) FROM sucursal_stock ss WHERE ss.product_id = p.id AND ss.sucursal_id = ?)`;
  const ventaSql = todas
    ? `(SELECT COALESCE(SUM(ii.cantidad), 0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.product_id = p.id AND i.estado = 'emitido' AND i.tipo_comprobante IN ('boleta','factura')
          AND date(i.fecha_emision) >= date('now', '-30 days'))`
    : `(SELECT COALESCE(SUM(ii.cantidad), 0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.product_id = p.id AND i.estado = 'emitido' AND i.tipo_comprobante IN ('boleta','factura')
          AND date(i.fecha_emision) >= date('now', '-30 days') AND i.sucursal_id = ?)`;
  const params = todas ? [] : [sucursalId, sucursalId];
  const sql = `
    SELECT * FROM (
      SELECT p.id, p.codigo, p.nombre, p.categoria, p.stock_minimo,
             ${proveedorExpr('p')} AS proveedor,
             ${stockSql} AS stock_actual, ${ventaSql} AS venta_30_dias
      FROM products p
      WHERE p.activo = 1 AND p.unidad != 'ZZ' AND p.stock_minimo > 0
    ) t
    WHERE stock_actual <= stock_minimo
    ORDER BY (stock_minimo - stock_actual) DESC
  `;
  const rows = db.prepare(sql).all(...params);
  // Cobertura objetivo: 15 días de venta promedio además de volver a tocar
  // el mínimo — si el producto no tiene historial de venta, al menos
  // alcanza para llegar de nuevo al mínimo.
  const DIAS_COBERTURA_OBJETIVO = 15;
  res.json(rows.map((r) => {
    const ventaDiariaPromedio = r.venta_30_dias / 30;
    const cantidadSugerida = Math.max(
      0,
      Math.ceil(ventaDiariaPromedio * DIAS_COBERTURA_OBJETIVO + (r.stock_minimo - r.stock_actual))
    );
    return { ...r, venta_diaria_promedio: round2(ventaDiariaPromedio), cantidad_sugerida: cantidadSugerida };
  }));
});

// --------------------------------------------------------------------------
// 7) Ventas por hora y día — qué horarios y días de la semana son fuertes.
// GET /ventas-por-hora-dia?desde=&hasta=&todas_las_sedes=
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
router.get('/ventas-por-hora-dia', requireReportes, (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const { sucursalId, todas } = sedeIdFiltro(req);
  const base = `
    FROM invoices i
    WHERE i.estado = 'emitido' AND i.tipo_comprobante IN ('boleta', 'factura')
      AND date(i.fecha_emision) >= date(?) AND date(i.fecha_emision) <= date(?)
      ${todas ? '' : 'AND i.sucursal_id = ?'}
  `;
  const params = todas ? [desde, hasta] : [desde, hasta, sucursalId];

  const porHora = db.prepare(`
    SELECT CAST(strftime('%H', i.created_at, '-5 hours') AS INTEGER) AS hora,
           COUNT(*) AS cantidad, SUM(i.total) AS venta
    ${base}
    GROUP BY hora ORDER BY hora ASC
  `).all(...params);

  const porDia = db.prepare(`
    SELECT CAST(strftime('%w', i.created_at, '-5 hours') AS INTEGER) AS dia_semana,
           COUNT(*) AS cantidad, SUM(i.total) AS venta
    ${base}
    GROUP BY dia_semana ORDER BY dia_semana ASC
  `).all(...params);

  res.json({
    por_hora: porHora.map((r) => ({ ...r, venta: round2(r.venta) })),
    por_dia: porDia.map((r) => ({ ...r, dia_semana_label: DIAS_SEMANA[r.dia_semana], venta: round2(r.venta) })),
  });
});

// --------------------------------------------------------------------------
// 8) Ticket promedio — cuánto gasta cada cliente en promedio por compra.
// GET /ticket-promedio?desde=&hasta=&todas_las_sedes=
router.get('/ticket-promedio', requireReportes, (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const { sucursalId, todas } = sedeIdFiltro(req);
  const where = `
    WHERE i.estado = 'emitido' AND i.tipo_comprobante IN ('boleta', 'factura')
      AND date(i.fecha_emision) >= date(?) AND date(i.fecha_emision) <= date(?)
      ${todas ? '' : 'AND i.sucursal_id = ?'}
  `;
  const params = todas ? [desde, hasta] : [desde, hasta, sucursalId];

  const general = db.prepare(`
    SELECT COUNT(*) AS cantidad_ventas, COALESCE(SUM(i.total), 0) AS total
    FROM invoices i ${where}
  `).get(...params);

  const porCliente = db.prepare(`
    SELECT c.id, c.nombre, COUNT(*) AS compras, SUM(i.total) AS total
    FROM invoices i JOIN clients c ON c.id = i.client_id
    ${where}
    GROUP BY c.id ORDER BY total DESC LIMIT 20
  `).all(...params);

  res.json({
    general: {
      cantidad_ventas: general.cantidad_ventas,
      total: round2(general.total),
      ticket_promedio: general.cantidad_ventas > 0 ? round2(general.total / general.cantidad_ventas) : 0,
    },
    por_cliente: porCliente.map((r) => ({
      ...r, total: round2(r.total), ticket_promedio: round2(r.total / r.compras),
    })),
  });
});

// --------------------------------------------------------------------------
// 9) Combos más vendidos — para diseñar promociones basadas en compras
// reales (solo promociones tipo 'combo', no ofertas simples de 1 producto).
// GET /combos-mas-vendidos?desde=&hasta=&todas_las_sedes=
router.get('/combos-mas-vendidos', requireReportes, (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const { sucursalId, todas } = sedeIdFiltro(req);
  const params = [];
  let sql = `
    SELECT pr.id, pr.nombre, pr.combo_modo,
           SUM(ii.cantidad) AS cantidad,
           SUM(ii.subtotal + ii.igv_item) AS venta,
           COUNT(DISTINCT ii.invoice_id) AS veces_vendido
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN promociones pr ON pr.id = ii.promocion_id AND pr.tipo = 'combo'
    WHERE i.estado = 'emitido' AND i.tipo_comprobante IN ('boleta', 'factura')
      AND date(i.fecha_emision) >= date(?) AND date(i.fecha_emision) <= date(?)
  `;
  params.push(desde, hasta);
  if (!todas) { sql += ' AND i.sucursal_id = ?'; params.push(sucursalId); }
  sql += ' GROUP BY pr.id ORDER BY venta DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => ({ ...r, venta: round2(r.venta) })));
});

// --------------------------------------------------------------------------
// 10) Rendimiento por proveedor — volumen y frecuencia de compra, para
// negociar mejores condiciones.
// GET /rendimiento-proveedor?desde=&hasta=&todas_las_sedes=
router.get('/rendimiento-proveedor', requireReportes, (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const { sucursalId, todas } = sedeIdFiltro(req);
  const params = [];
  let sql = `
    SELECT s.id, s.nombre,
           COUNT(DISTINCT pu.id) AS cantidad_compras,
           COUNT(DISTINCT pi.product_id) AS productos_distintos,
           SUM(pi.cantidad) AS unidades_compradas,
           SUM(pi.subtotal) AS total_comprado,
           MAX(pu.fecha) AS ultima_compra
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    JOIN suppliers s ON s.id = pu.supplier_id
    WHERE pu.estado = 'registrada'
      AND date(pu.fecha) >= date(?) AND date(pu.fecha) <= date(?)
  `;
  params.push(desde, hasta);
  if (!todas) { sql += ' AND pu.sucursal_id = ?'; params.push(sucursalId); }
  sql += ' GROUP BY s.id ORDER BY total_comprado DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => ({
    ...r, total_comprado: round2(r.total_comprado),
    ticket_promedio_compra: round2(r.total_comprado / r.cantidad_compras),
  })));
});

module.exports = router;
