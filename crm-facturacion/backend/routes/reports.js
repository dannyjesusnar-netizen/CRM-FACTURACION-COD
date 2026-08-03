const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Resumen para el dashboard principal
router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = today.slice(0, 8) + '01';

  // Las notas de crédito restan de las ventas (netean), no se excluyen: si
  // se anula/devuelve parte de una venta, "Ventas del mes/hoy" debe bajar.
  const ventasMes = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total,
            COUNT(*) AS cantidad
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito'
     AND date(fecha_emision) >= date(?)`
  ).get(startOfMonth);
  const ventasMesNc = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante = 'nota_credito'
     AND date(fecha_emision) >= date(?)`
  ).get(startOfMonth);
  ventasMes.total = round2(ventasMes.total - ventasMesNc.total);

  const ventasHoy = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito'
     AND date(fecha_emision) = date(?)`
  ).get(today);
  const ventasHoyNc = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante = 'nota_credito'
     AND date(fecha_emision) = date(?)`
  ).get(today);
  ventasHoy.total = round2(ventasHoy.total - ventasHoyNc.total);

  const totalClientes = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  const totalProductos = db.prepare('SELECT COUNT(*) AS n FROM products WHERE activo = 1').get().n;
  const comprobantesAnulados = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE estado = 'anulado'").get().n;

  const ultimasVentas = db.prepare(
    `SELECT i.id, i.tipo_comprobante, i.serie, i.numero, i.total, i.fecha_emision, i.estado, c.nombre AS cliente_nombre
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ORDER BY i.id DESC LIMIT 8`
  ).all();

  const topProductos = db.prepare(
    `SELECT p.nombre,
            SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.cantidad ELSE ii.cantidad END) AS cantidad_vendida,
            SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END) AS total_vendido
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     LEFT JOIN products p ON p.id = ii.product_id
     WHERE i.estado = 'emitido'
     GROUP BY ii.product_id
     ORDER BY total_vendido DESC
     LIMIT 5`
  ).all();

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
router.get('/ventas-por-dia', (req, res) => {
  const { from, to } = req.query;
  const fromDate = from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const toDate = to || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT date(fecha_emision) AS dia,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total
     FROM invoices
     WHERE estado = 'emitido'
       AND date(fecha_emision) BETWEEN date(?) AND date(?)
     GROUP BY date(fecha_emision)
     ORDER BY dia ASC`
  ).all(fromDate, toDate);
  res.json(rows);
});

// Ventas por tipo de comprobante
router.get('/ventas-por-tipo', (req, res) => {
  const rows = db.prepare(
    `SELECT tipo_comprobante, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
     FROM invoices WHERE estado = 'emitido'
     GROUP BY tipo_comprobante`
  ).all();
  res.json(rows);
});

// Top clientes por monto comprado
router.get('/top-clientes', (req, res) => {
  const rows = db.prepare(
    `SELECT c.id, c.nombre,
            COUNT(CASE WHEN i.tipo_comprobante != 'nota_credito' THEN i.id END) AS cantidad_compras,
            COALESCE(SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.total ELSE i.total END), 0) AS total_comprado
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.estado = 'emitido'
     GROUP BY c.id
     ORDER BY total_comprado DESC
     LIMIT 10`
  ).all();
  res.json(rows);
});

// Ventas mensuales de un año (para "VENTAS MENSUALES")
router.get('/ventas-mensuales', (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = db.prepare(
    `SELECT strftime('%m', fecha_emision) AS mes,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total,
            COUNT(CASE WHEN tipo_comprobante != 'nota_credito' THEN 1 END) AS cantidad
     FROM invoices
     WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ?
     GROUP BY mes
     ORDER BY mes ASC`
  ).all(year);
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
router.get('/ventas-por-vendedor', (req, res) => {
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
  `;
  const params = [y];
  if (month) { sql += " AND strftime('%m', i.fecha_emision) = ?"; params.push(String(month).padStart(2, '0')); }
  sql += ' GROUP BY u.id ORDER BY total DESC';
  const rows = db.prepare(sql).all(...params);
  const totalGeneral = rows.reduce((s, r) => s + r.total, 0);
  const withPct = rows.map((r) => ({ ...r, porcentaje: totalGeneral ? round2((r.total / totalGeneral) * 100) : 0 }));
  res.json(withPct);
});

// Productos mas vendidos (lista completa, no solo top 5)
router.get('/productos-mas-vendidos', (req, res) => {
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
    WHERE i.estado = 'emitido'
  `;
  const params = [];
  if (year) { sql += " AND strftime('%Y', i.fecha_emision) = ?"; params.push(String(year)); }
  if (month) { sql += " AND strftime('%m', i.fecha_emision) = ?"; params.push(String(month).padStart(2, '0')); }
  sql += ' GROUP BY ii.product_id ORDER BY total_vendido DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
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
router.get('/informe-tributario', (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const ventasRows = db.prepare(
    `SELECT strftime('%m', fecha_emision) AS mes,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -subtotal ELSE subtotal END), 0) AS ventas_netas,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -igv ELSE igv END), 0) AS igv_ventas
     FROM invoices
     WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ?
     GROUP BY mes`
  ).all(year);
  const comprasRows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(subtotal), 0) AS compras_netas,
            COALESCE(SUM(igv), 0) AS igv_compras
     FROM purchases
     WHERE estado = 'registrada' AND strftime('%Y', fecha) = ?
     GROUP BY mes`
  ).all(year);

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
router.get('/compras-por-mes', (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
     FROM purchases
     WHERE estado = 'registrada' AND strftime('%Y', fecha) = ?
     GROUP BY mes`
  ).all(year);
  const byMonth = {};
  rows.forEach((r) => { byMonth[r.mes] = r; });
  res.json(fillMeses(byMonth, (nombre, found) => ({
    mes: nombre, total: found ? found.total : 0, cantidad: found ? found.cantidad : 0,
  })));
});

// Ingresos (ventas) vs Gastos (compras + egresos de caja no relacionados a
// compras, para no duplicar) por mes de un año.
router.get('/ingreso-vs-gastos', (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());

  const ventasRows = db.prepare(
    `SELECT strftime('%m', fecha_emision) AS mes,
            COALESCE(SUM(CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END), 0) AS total
     FROM invoices
     WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ?
     GROUP BY mes`
  ).all(year);
  const comprasRows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(total), 0) AS total
     FROM purchases WHERE estado = 'registrada' AND strftime('%Y', fecha) = ?
     GROUP BY mes`
  ).all(year);
  const cajaEgresosRows = db.prepare(
    `SELECT strftime('%m', fecha) AS mes, COALESCE(SUM(monto), 0) AS total
     FROM caja_movimientos
     WHERE tipo = 'egreso' AND categoria != 'compras' AND strftime('%Y', fecha) = ?
     GROUP BY mes`
  ).all(year);

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
router.get('/evolucion-inventarios', (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = db.prepare(
    `SELECT strftime('%m', created_at) AS mes,
            COALESCE(SUM(CASE WHEN cantidad > 0 THEN cantidad ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN cantidad < 0 THEN -cantidad ELSE 0 END), 0) AS salidas
     FROM stock_movements
     WHERE strftime('%Y', created_at) = ?
     GROUP BY mes`
  ).all(year);
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
