// Endpoints de datos para el asistente ODIN (ver frontend/src/components/OdinWidget.jsx).
// No hay ningún modelo de IA detrás de esto — son consultas directas a la
// base de datos de la empresa (gratis, sin costo por uso), pensadas para que
// ODIN pueda responder cosas útiles a los vendedores sin depender de
// soporte humano ni de un servicio de pago.
const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);

// GET /api/odin/resumen -> lo que un vendedor de esa sede necesita saber al
// abrir el CRM: comprobantes rechazados/con error sin resolver, boletas que
// llevan más de un día "pendientes" (deberían haberse confirmado ya con el
// resumen diario de SUNAT) y productos con stock por debajo del mínimo.
router.get('/resumen', (req, res) => {
  const sucursalId = req.sucursalId;

  const comprobantesProblema = db.prepare(
    `SELECT tipo_comprobante, serie, numero, sunat_estado, sunat_mensaje
     FROM invoices
     WHERE sucursal_id = ? AND estado = 'emitido' AND sunat_estado IN ('rechazado', 'error')
     ORDER BY id DESC LIMIT 5`
  ).all(sucursalId);
  const totalComprobantesProblema = db.prepare(
    `SELECT COUNT(*) AS n FROM invoices
     WHERE sucursal_id = ? AND estado = 'emitido' AND sunat_estado IN ('rechazado', 'error')`
  ).get(sucursalId).n;

  // Una boleta queda "pendiente" el mismo día que se emite (SUNAT la valida
  // recién con el resumen diario) — eso es normal. Si sigue pendiente al día
  // siguiente o después, ya vale la pena que alguien la revise.
  const pendientesViejas = db.prepare(
    `SELECT COUNT(*) AS n FROM invoices
     WHERE sucursal_id = ? AND estado = 'emitido' AND sunat_estado = 'pendiente'
       AND date(fecha_emision) < date('now', '-1 day')`
  ).get(sucursalId).n;

  const stockBajo = db.prepare(
    `SELECT p.nombre, p.codigo, COALESCE(ss.stock, 0) AS stock, p.stock_minimo
     FROM products p LEFT JOIN sucursal_stock ss ON ss.product_id = p.id AND ss.sucursal_id = ?
     WHERE p.activo = 1 AND p.tipo = 'producto' AND p.stock_minimo > 0
       AND COALESCE(ss.stock, 0) <= p.stock_minimo
     ORDER BY (COALESCE(ss.stock, 0) * 1.0 / p.stock_minimo) ASC
     LIMIT 5`
  ).all(sucursalId);
  const totalStockBajo = db.prepare(
    `SELECT COUNT(*) AS n FROM products p LEFT JOIN sucursal_stock ss ON ss.product_id = p.id AND ss.sucursal_id = ?
     WHERE p.activo = 1 AND p.tipo = 'producto' AND p.stock_minimo > 0 AND COALESCE(ss.stock, 0) <= p.stock_minimo`
  ).get(sucursalId).n;

  res.json({
    comprobantesProblema,
    totalComprobantesProblema,
    pendientesViejas,
    stockBajo,
    totalStockBajo,
  });
});

// GET /api/odin/stock?q=texto -> productos de esa sede cuyo nombre o código
// coincide, con el stock real de la sede activa (no el agregado global).
router.get('/stock', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const rows = db.prepare(
    `SELECT p.nombre, p.codigo, COALESCE(ss.stock, 0) AS stock
     FROM products p LEFT JOIN sucursal_stock ss ON ss.product_id = p.id AND ss.sucursal_id = ?
     WHERE p.activo = 1 AND p.tipo = 'producto' AND (p.nombre LIKE ? OR p.codigo LIKE ?)
     ORDER BY p.nombre ASC LIMIT 8`
  ).all(req.sucursalId, like, like);
  res.json(rows);
});

module.exports = router;
