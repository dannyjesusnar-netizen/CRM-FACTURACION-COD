const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso, requireAlgunPermiso, requireAccion } = require('../utils/permisos');
const { buildResumen } = require('../utils/cajaCalculos');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);
// Inicio (Dashboard) y Reportes comparten estos tres endpoints; el resto es
// exclusivo de la pantalla de Reportes.
const requireDashboardOReportes = requireAlgunPermiso(['dashboard', 'reportes']);
const requireReportes = requirePermiso('reportes');

// Resumen para el dashboard principal
router.get('/summary', requireDashboardOReportes, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = today.slice(0, 8) + '01';

  // Las notas de crédito restan de las ventas (netean), no se excluyen: si
  // se anula/devuelve parte de una venta, "Ventas del mes/hoy" debe bajar.
  const ventasMes = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total,
            COUNT(*) AS cantidad
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito'
     AND date(fecha_emision) >= date(?) AND sucursal_id = ?`
  ).get(startOfMonth, req.sucursalId);
  const ventasMesNc = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante = 'nota_credito'
     AND date(fecha_emision) >= date(?) AND sucursal_id = ?`
  ).get(startOfMonth, req.sucursalId);
  ventasMes.total = round2(ventasMes.total - ventasMesNc.total);

  const ventasHoy = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito'
     AND date(fecha_emision) = date(?) AND sucursal_id = ?`
  ).get(today, req.sucursalId);
  const ventasHoyNc = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante = 'nota_credito'
     AND date(fecha_emision) = date(?) AND sucursal_id = ?`
  ).get(today, req.sucursalId);
  ventasHoy.total = round2(ventasHoy.total - ventasHoyNc.total);

  const totalClientes = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  const totalProductos = db.prepare('SELECT COUNT(*) AS n FROM products WHERE activo = 1').get().n;
  const comprobantesAnulados = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE estado = 'anulado' AND sucursal_id = ?").get(req.sucursalId).n;

  const ultimasVentas = db.prepare(
    `SELECT i.id, i.tipo_comprobante, i.serie, i.numero, i.total, i.fecha_emision, i.estado, c.nombre AS cliente_nombre
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.sucursal_id = ?
     ORDER BY i.id DESC LIMIT 8`
  ).all(req.sucursalId);

  const topProductos = db.prepare(
    `SELECT p.nombre,
            SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.cantidad ELSE ii.cantidad END) AS cantidad_vendida,
            SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END) AS total_vendido
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     LEFT JOIN products p ON p.id = ii.product_id
     WHERE i.estado = 'emitido' AND i.sucursal_id = ?
     GROUP BY ii.product_id
     ORDER BY total_vendido DESC
     LIMIT 5`
  ).all(req.sucursalId);

  res.json({
    ventasMes,
    ventasHoy,
    totalClientes,
    totalProductos,
    comprobantesAnulados,
    ultimasVentas,
    topProductos,
  });
});

// Ventas agrupadas por dia dentro de un rango (para grafico de linea)
router.get('/ventas-por-dia', requireDashboardOReportes, (req, res) => {
  const { from, to } = req.query;
  const fromDate = from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const toDate = to || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT date(fecha_emision) AS dia,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total
     FROM invoices
     WHERE estado = 'emitido' AND sucursal_id = ?
       AND date(fecha_emision) BETWEEN date(?) AND date(?)
     GROUP BY date(fecha_emision)
     ORDER BY dia ASC`
  ).all(req.sucursalId, fromDate, toDate);
  res.json(rows);
});

// Ventas por tipo de comprobante
router.get('/ventas-por-tipo', requireDashboardOReportes, (req, res) => {
  const rows = db.prepare(
    `SELECT tipo_comprobante, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
     FROM invoices WHERE estado = 'emitido' AND sucursal_id = ?
     GROUP BY tipo_comprobante`
  ).all(req.sucursalId);
  res.json(rows);
});

// Top clientes por monto comprado
router.get('/top-clientes', requireReportes, (req, res) => {
  const rows = db.prepare(
    `SELECT c.id, c.nombre,
            COUNT(CASE WHEN i.tipo_comprobante != 'nota_credito' THEN i.id END) AS cantidad_compras,
            COALESCE(SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.total ELSE i.total END), 0) AS total_comprado
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.estado = 'emitido' AND i.sucursal_id = ?
     GROUP BY c.id
     ORDER BY total_comprado DESC
     LIMIT 10`
  ).all(req.sucursalId);
  res.json(rows);
});

// Ventas mensuales de un año (para "VENTAS MENSUALES")
router.get('/ventas-mensuales', requireReportes, (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = db.prepare(
    `SELECT strftime('%m', fecha_emision) AS mes,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total,
            COUNT(CASE WHEN tipo_comprobante != 'nota_credito' THEN 1 END) AS cantidad
     FROM invoices
     WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND sucursal_id = ?
     GROUP BY mes
     ORDER BY mes ASC`
  ).all(year, req.sucursalId);
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const byMonth = {};
  rows.forEach((r) => { byMonth[r.mes] = r; });
  const full = MESES.map((nombre, idx) => {
    const key = String(idx + 1).padStart(2, '0');
    const found = byMonth[key];
    return { mes: nombre, total: found ? found.total : 0, cantidad: found ? found.cantidad : 0 };
  });
  res.json(full);
});

// Ventas por vendedor (usuario que emitio el comprobante)
router.get('/ventas-por-vendedor', requireReportes, requireAccion('reportes', 'vendedor'), (req, res) => {
  const { month, year } = req.query;
  const y = year || String(new Date().getFullYear());
  let sql = `
    SELECT u.id, COALESCE(u.full_name, 'Sin asignar') AS vendedor,
           COUNT(CASE WHEN i.tipo_comprobante != 'nota_credito' THEN i.id END) AS cantidad,
           COALESCE(SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.total ELSE i.total END), 0) AS total,
           COALESCE(SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.subtotal ELSE i.subtotal END), 0) AS ventas_sin_igv
    FROM invoices i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.estado = 'emitido'
      AND strftime('%Y', i.fecha_emision) = ?
      AND i.sucursal_id = ?
  `;
  const params = [y, req.sucursalId];
  if (month) { sql += " AND strftime('%m', i.fecha_emision) = ?"; params.push(String(month).padStart(2, '0')); }
  sql += ' GROUP BY u.id ORDER BY total DESC';
  const rows = db.prepare(sql).all(...params);
  const totalGeneral = rows.reduce((s, r) => s + r.total, 0);
  const withPct = rows.map((r) => ({ ...r, porcentaje: totalGeneral ? round2((r.total / totalGeneral) * 100) : 0 }));
  res.json(withPct);
});

// Productos mas vendidos (lista completa, no solo top 5)
router.get('/productos-mas-vendidos', requireReportes, requireAccion('reportes', 'producto'), (req, res) => {
  const { month, year } = req.query;
  let sql = `
    SELECT p.id, COALESCE(p.nombre, ii.descripcion) AS nombre, COALESCE(p.unidad, '-') AS unidad,
           SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.cantidad ELSE ii.cantidad END) AS cantidad_vendida,
           SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END) AS total_vendido,
           COALESCE(SUM(CASE WHEN i.moneda = 'USD' THEN 0 WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END), 0) AS monto_soles,
           COALESCE(SUM(CASE WHEN i.moneda != 'USD' THEN 0 WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END), 0) AS monto_dolares
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE i.estado = 'emitido' AND i.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (year) { sql += " AND strftime('%Y', i.fecha_emision) = ?"; params.push(String(year)); }
  if (month) { sql += " AND strftime('%m', i.fecha_emision) = ?"; params.push(String(month).padStart(2, '0')); }
  sql += ' GROUP BY ii.product_id ORDER BY total_vendido DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// Cierre de Caja: Efectivo (arqueo del día) + Ventas por Documento + Ventas
// por Forma de Pago + Resultado de Turno (bruto/descuento/devoluciones/
// anulaciones/neto). "Turno" se aproxima como (fecha + empleado opcional),
// ya que el sistema no tiene un concepto de sesión/turno propio — es la
// misma granularidad que ya ofrece Caja y Bancos.
router.get('/cierre-caja', requireAlgunPermiso(['caja', 'reportes']), (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  const empleadoId = req.query.empleado_id ? Number(req.query.empleado_id) : null;
  const empleadoFiltro = empleadoId ? 'AND created_by = ?' : '';
  const baseParams = empleadoId ? [fecha, req.sucursalId, empleadoId] : [fecha, req.sucursalId];

  const efectivo = buildResumen(fecha, fecha, req.sucursalId, { moneda: 'PEN', empleadoId }).find((r) => r.codigo === 'efectivo') || null;

  // Boleta / Factura (invoices) + Nota de Venta Interna (tabla notas_venta,
  // separada desde que dejó de ser "boleta con forma_pago=abonado") — solo
  // comprobantes emitidos.
  const docRows = db.prepare(`
    SELECT
      CASE WHEN tipo_comprobante = 'factura' THEN 'factura' ELSE 'boleta' END AS doc,
      COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
    FROM invoices
    WHERE estado = 'emitido' AND tipo_comprobante IN ('boleta', 'factura')
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
    GROUP BY doc
  `).all(...baseParams);
  const docByKey = {};
  docRows.forEach((r) => { docByKey[r.doc] = { cantidad: r.cantidad, total: round2(r.total) }; });
  const nvDocRow = db.prepare(`
    SELECT COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total FROM notas_venta
    WHERE estado = 'emitido' AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);
  const ventas_por_documento = [
    { doc: 'boleta', label: 'Boleta', ...(docByKey.boleta || { cantidad: 0, total: 0 }) },
    { doc: 'nota_venta_interna', label: 'Nota de Venta Interna', cantidad: nvDocRow.cantidad, total: round2(nvDocRow.total) },
    { doc: 'factura', label: 'Factura', ...(docByKey.factura || { cantidad: 0, total: 0 }) },
  ];

  // "abonado" no es un método de pago real, es crédito — agrupar el total
  // completo de cada venta bajo un bucket genérico "Abonado" no reflejaba qué
  // dinero entró de verdad hoy. Por eso se excluye de la agrupación directa
  // y, más abajo, lo ya cobrado (vía cobros/nota_venta_cobros) se suma al
  // medio real con el que se cobró — ej. si el abono fue en Efectivo, cuenta
  // como Efectivo — y lo pendiente queda en su propio bucket.
  const formaPagoRows = db.prepare(`
    SELECT forma_pago, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
    FROM invoices
    WHERE estado = 'emitido' AND tipo_comprobante IN ('boleta', 'factura') AND forma_pago != 'abonado'
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
    GROUP BY forma_pago
  `).all(...baseParams);
  const nvFormaPagoRows = db.prepare(`
    SELECT forma_pago, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
    FROM notas_venta
    WHERE estado = 'emitido' AND forma_pago != 'abonado'
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
    GROUP BY forma_pago
  `).all(...baseParams);
  const formaPagoMap = {};
  formaPagoRows.forEach((r) => { formaPagoMap[r.forma_pago] = { cantidad: r.cantidad, total: r.total }; });
  nvFormaPagoRows.forEach((r) => {
    const prev = formaPagoMap[r.forma_pago] || { cantidad: 0, total: 0 };
    formaPagoMap[r.forma_pago] = { cantidad: prev.cantidad + r.cantidad, total: prev.total + r.total };
  });

  // Lo cobrado hoy de ventas "abonado" (Boleta/Factura y Nota de Venta
  // Interna) emitidas hoy: cada cobro (incluido el abono inicial al emitir)
  // se suma al medio real con el que se cobró.
  const cobradoAbonadoInvoices = db.prepare(`
    SELECT c.medio, COUNT(*) AS cantidad, COALESCE(SUM(c.monto), 0) AS total
    FROM cobros c JOIN invoices i ON i.id = c.invoice_id
    WHERE i.forma_pago = 'abonado' AND i.estado = 'emitido'
      AND date(i.fecha_emision) = date(?) AND i.sucursal_id = ? ${empleadoId ? 'AND i.created_by = ?' : ''}
    GROUP BY c.medio
  `).all(...baseParams);
  const cobradoAbonadoNv = db.prepare(`
    SELECT nvc.medio, COUNT(*) AS cantidad, COALESCE(SUM(nvc.monto), 0) AS total
    FROM nota_venta_cobros nvc JOIN notas_venta nv ON nv.id = nvc.nota_venta_id
    WHERE nv.forma_pago = 'abonado' AND nv.estado = 'emitido'
      AND date(nv.fecha_emision) = date(?) AND nv.sucursal_id = ? ${empleadoId ? 'AND nv.created_by = ?' : ''}
    GROUP BY nvc.medio
  `).all(...baseParams);
  [...cobradoAbonadoInvoices, ...cobradoAbonadoNv].forEach((r) => {
    const prev = formaPagoMap[r.medio] || { cantidad: 0, total: 0 };
    formaPagoMap[r.medio] = { cantidad: prev.cantidad + r.cantidad, total: prev.total + r.total };
  });

  // Lo que sigue pendiente (sin cobrar) de esas mismas ventas "abonado"
  // emitidas hoy, para no perder de vista cuánto sigue siendo crédito real.
  const pendienteAbonadoInvoices = db.prepare(`
    SELECT COUNT(*) AS cantidad, COALESCE(SUM(total - monto_pagado), 0) AS total
    FROM invoices WHERE forma_pago = 'abonado' AND estado = 'emitido'
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);
  const pendienteAbonadoNv = db.prepare(`
    SELECT COUNT(*) AS cantidad, COALESCE(SUM(total - monto_pagado), 0) AS total
    FROM notas_venta WHERE forma_pago = 'abonado' AND estado = 'emitido'
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);
  const pendienteAbonado = round2(pendienteAbonadoInvoices.total + pendienteAbonadoNv.total);
  const cantidadPendienteAbonado = pendienteAbonadoInvoices.cantidad + pendienteAbonadoNv.cantidad;

  const metodosPago = db.prepare('SELECT codigo, nombre, icono FROM metodos_pago').all();
  const ventas_por_forma_pago = Object.entries(formaPagoMap)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([forma_pago, v]) => {
      if (forma_pago === 'mixto') return { forma_pago, label: '🔀 Pago mixto', cantidad: v.cantidad, total: round2(v.total) };
      const metodo = metodosPago.find((m) => m.codigo === forma_pago);
      return { forma_pago, label: metodo ? `${metodo.icono} ${metodo.nombre}` : (forma_pago || 'Sin especificar'), cantidad: v.cantidad, total: round2(v.total) };
    });
  if (pendienteAbonado > 0) {
    ventas_por_forma_pago.push({
      forma_pago: 'pendiente_credito', label: '🕒 Pendiente por cobrar (crédito)',
      cantidad: cantidadPendienteAbonado, total: pendienteAbonado,
    });
  }

  // Resultado de turno: bruto (antes de cualquier descuento, todas las
  // líneas de boleta/factura + notas de venta interna sin importar el
  // estado), descuento (bruto - total facturado, incluye anuladas),
  // anulaciones (comprobantes anulados) y devoluciones (notas de crédito
  // emitidas — la Nota de Venta Interna no tiene concepto de NC) — el mismo
  // patrón de "netear NC" que usa el resto de reports.js.
  const brutoRow = db.prepare(`
    SELECT COALESCE(SUM(ii.cantidad * ii.precio_unitario), 0) AS bruto
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.tipo_comprobante IN ('boleta', 'factura')
      AND date(i.fecha_emision) = date(?) AND i.sucursal_id = ? ${empleadoId ? 'AND i.created_by = ?' : ''}
  `).get(...baseParams);
  const nvBrutoRow = db.prepare(`
    SELECT COALESCE(SUM(nvi.cantidad * nvi.precio_unitario), 0) AS bruto
    FROM nota_venta_items nvi
    JOIN notas_venta nv ON nv.id = nvi.nota_venta_id
    WHERE date(nv.fecha_emision) = date(?) AND nv.sucursal_id = ? ${empleadoId ? 'AND nv.created_by = ?' : ''}
  `).get(...baseParams);
  const totalTodosRow = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total FROM invoices
    WHERE tipo_comprobante IN ('boleta', 'factura')
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);
  const nvTotalTodosRow = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total FROM notas_venta
    WHERE date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);
  const anulacionesRow = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total FROM invoices
    WHERE tipo_comprobante IN ('boleta', 'factura') AND estado = 'anulado'
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);
  const nvAnulacionesRow = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total FROM notas_venta
    WHERE estado = 'anulado'
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);
  const devolucionesRow = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total FROM invoices
    WHERE tipo_comprobante = 'nota_credito' AND estado = 'emitido'
      AND date(fecha_emision) = date(?) AND sucursal_id = ? ${empleadoFiltro}
  `).get(...baseParams);

  const bruto = round2(brutoRow.bruto + nvBrutoRow.bruto);
  const totalTodos = totalTodosRow.total + nvTotalTodosRow.total;
  const descuento = round2(bruto - totalTodos);
  const anulaciones = round2(anulacionesRow.total + nvAnulacionesRow.total);
  const devoluciones = round2(devolucionesRow.total);
  const neto = round2(bruto - descuento - anulaciones - devoluciones);

  res.json({
    fecha,
    efectivo,
    ventas_por_documento,
    ventas_por_forma_pago,
    turno: { bruto, descuento, devoluciones, anulaciones, neto },
  });
});

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fillMeses(byMonth, factory) {
  return MESES.map((nombre, idx) => {
    const key = String(idx + 1).padStart(2, '0');
    return factory(nombre, byMonth[key]);
  });
}

// Informe tributario: ventas e IGV de ventas y compras por mes de un año.
// ISC/Recargos/ICBPER/Percepción no se registran en este sistema (no hay
// esos conceptos en Ventas/Compras), se muestran en 0 solo para mantener
// el mismo formato de columnas. Renta es una estimación simplificada
// (1.5% de ventas netas, método de pago a cuenta), no un cálculo tributario
// oficial: el sistema opera en modo simulado, sin validez tributaria real.
router.get('/informe-tributario', requireReportes, requireAccion('reportes', 'tributario'), (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const ventasRows = db.prepare(
    `SELECT strftime('%m', fecha_emision) AS mes,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -subtotal ELSE subtotal END), 0) AS ventas_netas,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -igv ELSE igv END), 0) AS igv_ventas
     FROM invoices
     WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND sucursal_id = ?
     GROUP BY mes`
  ).all(year, req.sucursalId);
  const comprasRows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(subtotal), 0) AS compras_netas,
            COALESCE(SUM(igv), 0) AS igv_compras
     FROM purchases
     WHERE estado = 'registrada' AND strftime('%Y', fecha) = ? AND sucursal_id = ?
     GROUP BY mes`
  ).all(year, req.sucursalId);

  const ventasByMonth = {};
  ventasRows.forEach((r) => { ventasByMonth[r.mes] = r; });
  const comprasByMonth = {};
  comprasRows.forEach((r) => { comprasByMonth[r.mes] = r; });

  let creditoDisponible = 0;
  const full = MESES.map((nombre, idx) => {
    const key = String(idx + 1).padStart(2, '0');
    const ventasNetas = ventasByMonth[key] ? ventasByMonth[key].ventas_netas : 0;
    const igvVentas = ventasByMonth[key] ? ventasByMonth[key].igv_ventas : 0;
    const comprasNetas = comprasByMonth[key] ? comprasByMonth[key].compras_netas : 0;
    const igvCompras = comprasByMonth[key] ? comprasByMonth[key].igv_compras : 0;

    const netoMes = round2(igvVentas - igvCompras);
    let igvMes;
    if (netoMes >= 0) {
      igvMes = round2(Math.max(0, netoMes - creditoDisponible));
      creditoDisponible = round2(Math.max(0, creditoDisponible - netoMes));
    } else {
      igvMes = 0;
      creditoDisponible = round2(creditoDisponible - netoMes);
    }

    return {
      periodo: nombre,
      ventas_netas: ventasNetas,
      isc_ventas: 0,
      recargos: 0,
      icbper_ventas: 0,
      compras_netas: comprasNetas,
      igv_ventas: igvVentas,
      igv_compras: igvCompras,
      igv_mes: igvMes,
      saldo_igv: creditoDisponible,
      renta: round2(ventasNetas * 0.015),
      percepcion_compras: 0,
      utilidad_contable: round2(ventasNetas - comprasNetas),
    };
  });
  res.json(full);
});

// Compras por mes de un año
router.get('/compras-por-mes', requireReportes, requireAccion('reportes', 'financieros'), (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
     FROM purchases
     WHERE estado = 'registrada' AND strftime('%Y', fecha) = ? AND sucursal_id = ?
     GROUP BY mes`
  ).all(year, req.sucursalId);
  const byMonth = {};
  rows.forEach((r) => { byMonth[r.mes] = r; });
  res.json(fillMeses(byMonth, (nombre, found) => ({
    mes: nombre, total: found ? found.total : 0, cantidad: found ? found.cantidad : 0,
  })));
});

// Ingresos (ventas) vs Gastos (compras + egresos de caja no relacionados a
// compras, para no duplicar) por mes de un año.
router.get('/ingreso-vs-gastos', requireReportes, requireAccion('reportes', 'financieros'), (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());

  const ventasRows = db.prepare(
    `SELECT strftime('%m', fecha_emision) AS mes,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total
     FROM invoices
     WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND sucursal_id = ?
     GROUP BY mes`
  ).all(year, req.sucursalId);
  const comprasRows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(total), 0) AS total
     FROM purchases WHERE estado = 'registrada' AND strftime('%Y', fecha) = ? AND sucursal_id = ?
     GROUP BY mes`
  ).all(year, req.sucursalId);
  const cajaEgresosRows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(monto), 0) AS total
     FROM caja_movimientos
     WHERE tipo = 'egreso' AND categoria != 'compras' AND strftime('%Y', fecha) = ? AND sucursal_id = ?
     GROUP BY mes`
  ).all(year, req.sucursalId);

  const ventasByMonth = {}; ventasRows.forEach((r) => { ventasByMonth[r.mes] = r.total; });
  const comprasByMonth = {}; comprasRows.forEach((r) => { comprasByMonth[r.mes] = r.total; });
  const egresosByMonth = {}; cajaEgresosRows.forEach((r) => { egresosByMonth[r.mes] = r.total; });

  const full = MESES.map((nombre, idx) => {
    const key = String(idx + 1).padStart(2, '0');
    const ingresos = round2(ventasByMonth[key] || 0);
    const gastos = round2((comprasByMonth[key] || 0) + (egresosByMonth[key] || 0));
    return { mes: nombre, ingresos, gastos, neto: round2(ingresos - gastos) };
  });
  res.json(full);
});

// Evolución de inventarios: movimiento neto de stock por mes (ingresos vs
// salidas registradas en el kardex). No reconstruye el stock histórico
// absoluto (el stock inicial de los productos de ejemplo no quedó
// registrado como movimiento), pero sí refleja fielmente el volumen de
// entradas/salidas de cada mes.
router.get('/evolucion-inventarios', requireReportes, requireAccion('reportes', 'financieros'), (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = db.prepare(
    `SELECT strftime('%m', created_at) AS mes,
            COALESCE(SUM(CASE WHEN cantidad > 0 THEN cantidad ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN cantidad < 0 THEN -cantidad ELSE 0 END), 0) AS salidas
     FROM stock_movements
     WHERE strftime('%Y', created_at) = ? AND sucursal_id = ?
     GROUP BY mes`
  ).all(year, req.sucursalId);
  const byMonth = {};
  rows.forEach((r) => { byMonth[r.mes] = r; });
  res.json(fillMeses(byMonth, (nombre, found) => ({
    mes: nombre,
    ingresos: found ? found.ingresos : 0,
    salidas: found ? found.salidas : 0,
    neto: found ? round2(found.ingresos - found.salidas) : 0,
  })));
});

module.exports = router;
