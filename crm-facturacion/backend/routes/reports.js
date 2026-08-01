const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Resumen para el dashboard principal
router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = today.slice(0, 8) + '01';

  const ventasMes = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito'
     AND date(fecha_emision) >= date(?)`
  ).get(startOfMonth);

  const ventasHoy = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
     FROM invoices WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito'
     AND date(fecha_emision) = date(?)`
  ).get(today);

  const totalClientes = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  const totalProductos = db.prepare('SELECT COUNT(*) AS n FROM products WHERE activo = 1').get().n;
  const comprobantesAnulados = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE estado = 'anulado'").get().n;

  const ultimasVentas = db.prepare(
    `SELECT i.id, i.tipo_comprobante, i.serie, i.numero, i.total, i.fecha_emision, i.estado, c.nombre AS cliente_nombre
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ORDER BY i.id DESC LIMIT 8`
  ).all();

  const topProductos = db.prepare(
    `SELECT p.nombre, SUM(ii.cantidad) AS cantidad_vendida, SUM(ii.subtotal) AS total_vendido
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
    `SELECT date(fecha_emision) AS dia, COALESCE(SUM(total), 0) AS total
     FROM invoices
     WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito'
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
    `SELECT c.id, c.nombre, COUNT(i.id) AS cantidad_compras, COALESCE(SUM(i.total), 0) AS total_comprado
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.estado = 'emitido' AND i.tipo_comprobante != 'nota_credito'
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
    `SELECT strftime('%m', fecha_emision) AS mes, COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
     FROM invoices
     WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito' AND strftime('%Y', fecha_emision) = ?
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
    SELECT u.id, COALESCE(u.full_name, 'Sin asignar') AS vendedor, COUNT(i.id) AS cantidad,
           COALESCE(SUM(i.total), 0) AS total
    FROM invoices i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.estado = 'emitido' AND i.tipo_comprobante != 'nota_credito'
      AND strftime('%Y', i.fecha_emision) = ?
  `;
  const params = [y];
  if (month) { sql += " AND strftime('%m', i.fecha_emision) = ?"; params.push(String(month).padStart(2, '0')); }
  sql += ' GROUP BY u.id ORDER BY total DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// Productos mas vendidos (lista completa, no solo top 5)
router.get('/productos-mas-vendidos', (req, res) => {
  const { month, year } = req.query;
  let sql = `
    SELECT p.id, COALESCE(p.nombre, ii.descripcion) AS nombre, COALESCE(p.unidad, '-') AS unidad,
           SUM(ii.cantidad) AS cantidad_vendida, SUM(ii.subtotal) AS total_vendido
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

// Informe tributario: ventas netas e IGV por mes de un año
router.get('/informe-tributario', (req, res) => {
  const year = req.query.year || String(new Date().getFullYear());
  const rows = db.prepare(
    `SELECT strftime('%m', fecha_emision) AS mes, COALESCE(SUM(subtotal), 0) AS ventas_netas,
            COALESCE(SUM(igv), 0) AS igv_ventas
     FROM invoices
     WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito' AND strftime('%Y', fecha_emision) = ?
     GROUP BY mes
     ORDER BY mes ASC`
  ).all(year);
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const byMonth = {};
  rows.forEach((r) => { byMonth[r.mes] = r; });
  const full = MESES.map((nombre, idx) => {
    const key = String(idx + 1).padStart(2, '0');
    const found = byMonth[key];
    return { periodo: nombre, ventas_netas: found ? found.ventas_netas : 0, igv_ventas: found ? found.igv_ventas : 0 };
  });
  res.json(full);
});

module.exports = router;
