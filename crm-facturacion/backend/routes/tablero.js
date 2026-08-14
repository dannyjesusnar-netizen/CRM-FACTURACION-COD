const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireGerenciaOSupervisor } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerenciaOSupervisor);

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function anioMes(req) {
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = Number(req.query.mes) || new Date().getMonth() + 1;
  return { anio, mes, mesPad: String(mes).padStart(2, '0') };
}

// sucursal_id opcional: sin valor = todas las sedes (vista ejecutiva por
// defecto); con valor = el "dashboard" de esa sede en particular.
function sedeFiltro(req) {
  const raw = req.query.sucursal_id;
  return raw ? Number(raw) : null;
}

function conPorcentaje(rows) {
  const total = rows.reduce((acc, r) => acc + r.venta, 0);
  return rows.map((r) => ({
    ...r,
    cantidad: round2(r.cantidad),
    venta: round2(r.venta),
    porcentaje: total ? round2((r.venta / total) * 100) : 0,
  }));
}

// Misma lógica que products.js: la marca de un producto es su Proveedor
// asignado directamente, o si no tiene, el proveedor de su compra más
// reciente.
const PROVEEDOR_SUBQUERY = `COALESCE(
  (SELECT s.nombre FROM suppliers s WHERE s.id = p.proveedor_id),
  (
    SELECT s.nombre FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    JOIN suppliers s ON s.id = pu.supplier_id
    WHERE pi.product_id = p.id AND pu.estado = 'registrada'
    ORDER BY pu.fecha DESC, pu.id DESC LIMIT 1
  )
)`;
const MARCA_EXPR = `COALESCE(${PROVEEDOR_SUBQUERY}, 'Sin marca')`;

// Ranking Trainers/Vendedores/Supervisores: venta y % de cumplimiento de
// meta por empleado de esa categoría, cruzando todas las sedes. La meta no
// se asigna persona por persona: Gerencia asigna un pool por sede+categoría
// (metas_venta_sede) que se reparte en partes iguales entre los empleados
// activos de esa categoría en esa sede.
router.get('/ranking-personal', (req, res) => {
  const categoria = req.query.categoria;
  if (!['trainer', 'vendedor', 'supervisor'].includes(categoria)) {
    return res.status(400).json({ error: 'categoria inválida. Use trainer, vendedor o supervisor.' });
  }
  const { anio, mes, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const rows = db.prepare(`
    SELECT u.id AS user_id, u.full_name AS nombre, u.turno, u.sucursal_id, s.nombre AS sede,
           COALESCE(SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.total ELSE i.total END), 0) AS venta
    FROM users u
    LEFT JOIN sucursales s ON s.id = u.sucursal_id
    LEFT JOIN invoices i ON i.created_by = u.id AND i.estado = 'emitido'
      AND strftime('%Y', i.fecha_emision) = ? AND strftime('%m', i.fecha_emision) = ?
    WHERE u.categoria_staff = ? AND u.activo = 1
      AND (? IS NULL OR u.sucursal_id = ?)
    GROUP BY u.id
  `).all(String(anio), mesPad, categoria, sucursalId, sucursalId);

  const pools = db.prepare(
    'SELECT sucursal_id, monto_meta FROM metas_venta_sede WHERE categoria_staff = ? AND anio = ? AND mes = ?'
  ).all(categoria, anio, mes);
  const poolMap = new Map(pools.map((p) => [p.sucursal_id, p.monto_meta]));
  const conteos = db.prepare(
    `SELECT sucursal_id, COUNT(*) AS cantidad FROM users
     WHERE categoria_staff = ? AND activo = 1 AND sucursal_id IS NOT NULL GROUP BY sucursal_id`
  ).all(categoria);
  const conteoMap = new Map(conteos.map((c) => [c.sucursal_id, c.cantidad]));

  const withPct = rows.map((r) => {
    const cantidad = conteoMap.get(r.sucursal_id) || 0;
    const pool = poolMap.get(r.sucursal_id) || 0;
    const meta = cantidad > 0 ? pool / cantidad : 0;
    return {
      user_id: r.user_id, nombre: r.nombre, turno: r.turno, sede: r.sede,
      venta: round2(r.venta), meta: round2(meta),
      porcentaje: meta > 0 ? round2((r.venta / meta) * 100) : null,
    };
  });
  withPct.sort((a, b) => {
    if (a.porcentaje === null && b.porcentaje === null) return b.venta - a.venta;
    if (a.porcentaje === null) return 1;
    if (b.porcentaje === null) return -1;
    return b.porcentaje - a.porcentaje;
  });
  res.json(withPct);
});

// Resumen por sede: venta, meta (suma de los pools de vendedores + trainers
// asignados a esa sede ese mes) y % de cumplimiento, más el total general
// para la tarjeta "Ventas Totales".
router.get('/resumen-sedes', (req, res) => {
  const { anio, mes, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const ventaPorSede = db.prepare(`
    SELECT s.id, s.nombre,
      COALESCE(SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.total ELSE i.total END), 0) AS venta
    FROM sucursales s
    LEFT JOIN invoices i ON i.sucursal_id = s.id AND i.estado = 'emitido'
      AND strftime('%Y', i.fecha_emision) = ? AND strftime('%m', i.fecha_emision) = ?
    WHERE s.activo = 1
      AND (? IS NULL OR s.id = ?)
    GROUP BY s.id
  `).all(String(anio), mesPad, sucursalId, sucursalId);

  const metaPorSede = db.prepare(
    `SELECT sucursal_id AS id, SUM(monto_meta) AS meta FROM metas_venta_sede
     WHERE anio = ? AND mes = ? GROUP BY sucursal_id`
  ).all(anio, mes);
  const metaMap = new Map(metaPorSede.map((r) => [r.id, r.meta]));

  const sedes = ventaPorSede
    .map((s) => {
      const meta = metaMap.get(s.id) || 0;
      return {
        sucursal_id: s.id,
        sede: s.nombre,
        venta: round2(s.venta),
        meta: round2(meta),
        porcentaje: meta > 0 ? round2((s.venta / meta) * 100) : null,
      };
    })
    .sort((a, b) => b.venta - a.venta);

  const ventasTotales = round2(sedes.reduce((acc, s) => acc + s.venta, 0));
  const metaTotal = round2(sedes.reduce((acc, s) => acc + s.meta, 0));
  res.json({
    sedes,
    total: {
      venta: ventasTotales,
      meta: metaTotal,
      porcentaje: metaTotal > 0 ? round2((ventasTotales / metaTotal) * 100) : null,
    },
    ventas_totales: ventasTotales,
  });
});

// Total por marca (Proveedor asignado al producto).
router.get('/total-por-marca', (req, res) => {
  const { anio, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const rows = db.prepare(`
    SELECT ${MARCA_EXPR} AS marca,
      SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.cantidad ELSE ii.cantidad END) AS cantidad,
      SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END) AS venta
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE i.estado = 'emitido'
      AND strftime('%Y', i.fecha_emision) = ? AND strftime('%m', i.fecha_emision) = ?
      AND (? IS NULL OR i.sucursal_id = ?)
    GROUP BY ${MARCA_EXPR}
    ORDER BY venta DESC
  `).all(String(anio), mesPad, sucursalId, sucursalId);
  res.json(conPorcentaje(rows));
});

// Total por producto (agrupado por categoría del producto).
router.get('/total-por-producto', (req, res) => {
  const { anio, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const rows = db.prepare(`
    SELECT COALESCE(p.categoria, 'Sin categoría') AS categoria,
      SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.cantidad ELSE ii.cantidad END) AS cantidad,
      SUM(CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END) AS venta
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE i.estado = 'emitido'
      AND strftime('%Y', i.fecha_emision) = ? AND strftime('%m', i.fecha_emision) = ?
      AND (? IS NULL OR i.sucursal_id = ?)
    GROUP BY COALESCE(p.categoria, 'Sin categoría')
    ORDER BY venta DESC
  `).all(String(anio), mesPad, sucursalId, sucursalId);
  res.json(conPorcentaje(rows));
});

module.exports = router;
