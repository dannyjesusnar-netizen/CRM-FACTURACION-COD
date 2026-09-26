// Página pública (sin login) del link que se genera desde el Tablero de
// Ventas (ver routes/tablero.js: POST/GET/DELETE /tablero/link-publico).
// Igual que routes/pagoPublico.js, la empresa (RUC) va en la URL porque acá
// no hay JWT del que sacarla. Muestra SOLO totales agregados por sede y por
// línea (Organic/Fit) — nunca el Ranking Personal con nombres de empleados,
// que sigue siendo interno.
const express = require('express');
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { resolveTenantDb } = require('../utils/tenant');

const router = express.Router();

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const LINEA_LABEL = { organic: 'Organic', fit: 'Fit' };

// Mismo criterio que ITEMS_VENDIDOS_SUBQUERY en routes/tablero.js: Boletas/
// Facturas/Notas de Crédito (invoice_items) + Notas de Venta Interna
// (nota_venta_items), en base devengado.
const ITEMS_VENDIDOS_SUBQUERY = `
  SELECT ii.product_id,
    CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END AS subtotal
  FROM invoice_items ii
  JOIN invoices i ON i.id = ii.invoice_id
  WHERE i.estado = 'emitido' AND strftime('%Y', i.fecha_emision) = ? AND strftime('%m', i.fecha_emision) = ?
    AND (? IS NULL OR i.sucursal_id = ?)
  UNION ALL
  SELECT nvi.product_id, nvi.subtotal AS subtotal
  FROM nota_venta_items nvi
  JOIN notas_venta nv ON nv.id = nvi.nota_venta_id
  WHERE nv.estado = 'emitido' AND strftime('%Y', nv.fecha_emision) = ? AND strftime('%m', nv.fecha_emision) = ?
    AND (? IS NULL OR nv.sucursal_id = ?)
`;

router.get('/:ruc/:token', (req, res) => {
  const { ruc, token } = req.params;

  const tenant = tenantRegistry.findTenant(ruc);
  if (!tenant) {
    const empresaBase = db.runWithDb(db.openTenantDb(db.DEFAULT_DB_PATH), () =>
      db.prepare('SELECT ruc FROM empresa_config WHERE id = 1').get()
    );
    if (!empresaBase?.ruc || empresaBase.ruc !== ruc) {
      return res.status(404).json({ error: 'Este link no existe o ya no está disponible.' });
    }
  } else if (tenant.estado !== 'aprobado') {
    return res.status(404).json({ error: 'Este link no existe o ya no está disponible.' });
  }

  const tenantDb = resolveTenantDb(ruc);
  db.runWithDb(tenantDb, () => {
    const link = db.prepare('SELECT sucursal_id FROM dashboard_publico_links WHERE token = ? AND activo = 1').get(token);
    if (!link) {
      return res.status(404).json({ error: 'Este link no existe o ya no está disponible.' });
    }
    db.prepare("UPDATE dashboard_publico_links SET ultimo_uso_at = datetime('now') WHERE token = ?").run(token);

    const sucursalId = link.sucursal_id;
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const mes = Number(req.query.mes) || new Date().getMonth() + 1;
    const mesPad = String(mes).padStart(2, '0');

    const empresa = db.prepare(
      'SELECT razon_social, nombre_comercial, logo_data_url, color_tablero_ventas FROM empresa_config WHERE id = 1'
    ).get();

    const ventaPorSede = db.prepare(`
      SELECT s.id, s.nombre, COALESCE(SUM(v.monto), 0) AS venta
      FROM sucursales s
      LEFT JOIN (
        SELECT sucursal_id, CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END AS monto
        FROM invoices
        WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
        UNION ALL
        SELECT sucursal_id, total AS monto
        FROM notas_venta
        WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
      ) v ON v.sucursal_id = s.id
      WHERE s.activo = 1
        AND (? IS NULL OR s.id = ?)
      GROUP BY s.id
    `).all(String(anio), mesPad, String(anio), mesPad, sucursalId, sucursalId);

    const metaPorSede = db.prepare(
      `SELECT sucursal_id AS id, SUM(monto_meta) AS meta FROM metas_venta_sede
       WHERE anio = ? AND mes = ? GROUP BY sucursal_id`
    ).all(anio, mes);
    const metaMap = new Map(metaPorSede.map((r) => [r.id, r.meta]));

    const sedes = ventaPorSede.map((s) => {
      const meta = metaMap.get(s.id) || 0;
      return {
        sede: s.nombre,
        venta: round2(s.venta),
        meta: round2(meta),
        porcentaje: meta > 0 ? round2((s.venta / meta) * 100) : null,
      };
    });
    const totalVenta = round2(sedes.reduce((acc, s) => acc + s.venta, 0));
    const totalMeta = round2(sedes.reduce((acc, s) => acc + s.meta, 0));

    const rowsLinea = db.prepare(`
      SELECT COALESCE(p.linea, 'sin_linea') AS linea, SUM(x.subtotal) AS venta
      FROM (${ITEMS_VENDIDOS_SUBQUERY}) x
      LEFT JOIN products p ON p.id = x.product_id
      GROUP BY COALESCE(p.linea, 'sin_linea')
      ORDER BY venta DESC
    `).all(String(anio), mesPad, sucursalId, sucursalId, String(anio), mesPad, sucursalId, sucursalId);
    const totalLineaVenta = rowsLinea.reduce((acc, r) => acc + r.venta, 0);
    const lineas = rowsLinea.map((r) => ({
      label: LINEA_LABEL[r.linea] || 'Sin línea',
      venta: round2(r.venta),
      porcentaje: totalLineaVenta ? round2((r.venta / totalLineaVenta) * 100) : 0,
    }));

    const sedeUnica = sucursalId === null ? null : db.prepare('SELECT nombre FROM sucursales WHERE id = ?').get(sucursalId);

    res.json({
      empresa: {
        nombre: empresa?.nombre_comercial || empresa?.razon_social || 'Empresa',
        logo_data_url: empresa?.logo_data_url || null,
        color: empresa?.color_tablero_ventas || '#16a34a',
      },
      alcance: sucursalId === null ? 'Todas las sedes' : (sedeUnica?.nombre || 'Sede'),
      anio,
      mes,
      sedes,
      total: { venta: totalVenta, meta: totalMeta, porcentaje: totalMeta > 0 ? round2((totalVenta / totalMeta) * 100) : null },
      lineas,
    });
  });
});

module.exports = router;
