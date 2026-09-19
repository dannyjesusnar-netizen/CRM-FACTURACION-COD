// Endpoints de solo lectura para herramientas de BI externas (Power BI
// programado, sin sesión de usuario) — ver middleware/biAuth.js. Nada acá
// escribe datos; son espejos de lo que ya se ve en el Tablero de Ventas,
// pero en filas planas listas para que Power Query las cargue directo.
const express = require('express');
const db = require('../db');
const { requireBiToken } = require('../middleware/biAuth');

const router = express.Router({ mergeParams: true });
router.use(requireBiToken);

// GET /api/bi/:ruc/ventas-staff?categoria=trainer|supervisor|vendedor&desde=&hasta=
// Cada fila es un comprobante (boleta/factura/nota de crédito/nota de venta
// interna) atribuido a un Entrenador o Supervisor (o Vendedor, si se pide) —
// mismo criterio que el Ranking del Tablero: se atribuye a
// invoices.atribuido_a si el vendedor eligió esa opción al emitir, o a
// created_by si no. Sin "categoria", trae Entrenadores + Supervisores
// juntos (lo típico para el reporte que Organic sube a Power BI).
// Sin "desde"/"hasta", trae todo el historial — Power BI recarga el feed
// completo en cada refresco programado, no hace falta paginar para el
// volumen de datos de una PYME.
router.get('/ventas-staff', (req, res) => {
  const categorias = req.query.categoria
    ? [String(req.query.categoria)]
    : ['trainer', 'supervisor'];
  const desde = req.query.desde || '2000-01-01';
  const hasta = req.query.hasta || '2999-12-31';

  const placeholders = categorias.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT u.full_name AS empleado, u.categoria_staff AS categoria, sd.nombre AS sede,
           x.fecha, x.tipo_comprobante, x.serie, x.numero, x.cliente, x.total
    FROM (
      SELECT i.atribuido_a, i.created_by, i.sucursal_id, i.fecha_emision AS fecha,
             i.tipo_comprobante, i.serie, i.numero, c.nombre AS cliente,
             CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.total ELSE i.total END AS total
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.estado = 'emitido' AND date(i.fecha_emision) BETWEEN date(?) AND date(?)
      UNION ALL
      SELECT nv.atribuido_a, nv.created_by, nv.sucursal_id, nv.fecha_emision AS fecha,
             'nota_venta' AS tipo_comprobante, nv.serie, nv.numero, c.nombre AS cliente,
             nv.total AS total
      FROM notas_venta nv
      LEFT JOIN clients c ON c.id = nv.client_id
      WHERE nv.estado = 'emitido' AND date(nv.fecha_emision) BETWEEN date(?) AND date(?)
    ) x
    JOIN users u ON u.id = COALESCE(x.atribuido_a, x.created_by)
    LEFT JOIN sucursales sd ON sd.id = x.sucursal_id
    WHERE u.categoria_staff IN (${placeholders})
    ORDER BY x.fecha, x.numero
  `).all(desde, hasta, desde, hasta, ...categorias);

  res.json(rows);
});

module.exports = router;
