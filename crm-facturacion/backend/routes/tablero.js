const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireTableroVentas, requireAccionSupervisor } = require('../utils/permisos');
const { calcularRankingPersonal } = require('../utils/rankingPersonal');

const router = express.Router();
router.use(requireAuth);
router.use(requireTableroVentas);

const requireCompartirTablero = requireAccionSupervisor(
  'compartir_tablero',
  'No tienes permiso para administrar el link público del Tablero de Ventas.'
);

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function anioMes(req) {
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const mes = Number(req.query.mes) || new Date().getMonth() + 1;
  return { anio, mes, mesPad: String(mes).padStart(2, '0') };
}

// Gerencia: sucursal_id opcional — sin valor ve todas las sedes (vista
// ejecutiva por defecto), con valor ve el "dashboard" de esa sede en
// particular. Un Supervisor, en cambio, siempre queda pegado a la sede a la
// que está asignado — sin importar qué sucursal_id le pase al query param —
// para que no pueda ver la facturación de otras sedes que no le
// corresponden (requireTableroVentas solo valida el permiso, no la sede).
function sedeFiltro(req) {
  if (req.user.role !== 'gerencia') {
    const row = db.prepare('SELECT sucursal_id FROM users WHERE id = ?').get(req.user.id);
    return row?.sucursal_id || null;
  }
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
// meta por empleado de esa categoría, cruzando todas las sedes. La venta se
// atribuye a invoices.atribuido_a si el vendedor eligió esa opción al
// emitir el comprobante (ver routes/invoices.js), o a created_by (quien lo
// registró) si no. La meta no se asigna persona por persona: Gerencia
// asigna un pool por sede+categoría (metas_venta_sede) que se reparte entre
// la dotación asignada a mano para ese equipo (metas_venta_sede.dotacion);
// si no se asignó ninguna dotación (0), se reparte entre los empleados
// activos de esa categoría en esa sede, como antes de que existiera ese
// campo.
router.get('/ranking-personal', (req, res) => {
  const categoria = req.query.categoria;
  if (!['trainer', 'vendedor', 'supervisor'].includes(categoria)) {
    return res.status(400).json({ error: 'categoria inválida. Use trainer, vendedor o supervisor.' });
  }
  const { anio, mes } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  res.json(calcularRankingPersonal(categoria, anio, mes, sucursalId));
});

// Detalle de cada venta que compone el ranking de arriba — para exportar a
// Excel, no para mostrar en pantalla (el ranking ya resume lo que hace
// falta ver). Cada fila es un comprobante real (Boleta/Factura/Nota de
// Crédito/Nota de Venta Interna) atribuido a un empleado de esa categoría,
// con el mismo criterio de atribución que /ranking-personal
// (COALESCE(atribuido_a, created_by)) y el mismo filtro de sede.
router.get('/ranking-personal/detalle', (req, res) => {
  const categoria = req.query.categoria;
  if (!['trainer', 'vendedor', 'supervisor'].includes(categoria)) {
    return res.status(400).json({ error: 'categoria inválida. Use trainer, vendedor o supervisor.' });
  }
  const { anio, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const rows = db.prepare(`
    SELECT u.full_name AS entrenador, sd.nombre AS sede, x.fecha, x.tipo_comprobante,
           x.serie, x.numero, x.cliente, x.total
    FROM (
      SELECT i.atribuido_a, i.created_by, i.sucursal_id, i.fecha_emision AS fecha,
             i.tipo_comprobante, i.serie, i.numero, c.nombre AS cliente,
             CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -i.total ELSE i.total END AS total
      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.estado = 'emitido' AND strftime('%Y', i.fecha_emision) = ? AND strftime('%m', i.fecha_emision) = ?
      UNION ALL
      SELECT nv.atribuido_a, nv.created_by, nv.sucursal_id, nv.fecha_emision AS fecha,
             'nota_venta' AS tipo_comprobante, nv.serie, nv.numero, c.nombre AS cliente,
             nv.total AS total
      FROM notas_venta nv
      LEFT JOIN clients c ON c.id = nv.client_id
      WHERE nv.estado = 'emitido' AND strftime('%Y', nv.fecha_emision) = ? AND strftime('%m', nv.fecha_emision) = ?
    ) x
    JOIN users u ON u.id = COALESCE(x.atribuido_a, x.created_by)
    LEFT JOIN sucursales sd ON sd.id = x.sucursal_id
    WHERE u.categoria_staff = ? AND u.activo = 1
      AND (? IS NULL OR u.sucursal_id = ?)
    ORDER BY u.full_name, x.fecha, x.numero
  `).all(String(anio), mesPad, String(anio), mesPad, categoria, sucursalId, sucursalId);
  res.json(rows.map((r) => ({ ...r, total: round2(r.total) })));
});

// Resumen por sede: venta, meta (suma de los pools de vendedores + trainers
// asignados a esa sede ese mes) y % de cumplimiento, más el total general
// para la tarjeta "Ventas Totales".
router.get('/resumen-sedes', (req, res) => {
  const { anio, mes, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
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

// GET /api/tablero/ventas-dia-por-sede?fecha=YYYY-MM-DD -> cuánto vendió
// cada sede en un día puntual (por defecto hoy), para comparar el día
// entre sedes de un vistazo -- distinto de /resumen-sedes, que es siempre
// por mes calendario completo (y compara contra la meta mensual, que no
// tiene un equivalente diario real).
router.get('/ventas-dia-por-sede', (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  const sucursalId = sedeFiltro(req);
  const ventaPorSede = db.prepare(`
    SELECT s.id, s.nombre, COALESCE(SUM(v.monto), 0) AS venta
    FROM sucursales s
    LEFT JOIN (
      SELECT sucursal_id, CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END AS monto
      FROM invoices
      WHERE estado = 'emitido' AND date(fecha_emision) = date(?)
      UNION ALL
      SELECT sucursal_id, total AS monto
      FROM notas_venta
      WHERE estado = 'emitido' AND date(fecha_emision) = date(?)
    ) v ON v.sucursal_id = s.id
    WHERE s.activo = 1
      AND (? IS NULL OR s.id = ?)
    GROUP BY s.id
  `).all(fecha, fecha, sucursalId, sucursalId);

  const sedes = ventaPorSede
    .map((s) => ({ sucursal_id: s.id, sede: s.nombre, venta: round2(s.venta) }))
    .sort((a, b) => b.venta - a.venta);
  const ventasTotales = round2(sedes.reduce((acc, s) => acc + s.venta, 0));

  res.json({ fecha, sedes, total: { venta: ventasTotales } });
});

// Ítems vendidos del mes/sede, juntando Boletas/Facturas (invoice_items, con
// nota de crédito restando) y Notas de Venta Interna (nota_venta_items) —
// esta última es la única que admite forma_pago "Abonado" (crédito), así que
// sin este UNION esas ventas quedaban fuera de Total por Marca/Producto
// aunque sí se cuentan (en base devengado, igual que una factura a crédito)
// en Ranking y Resumen Sedes.
const ITEMS_VENDIDOS_SUBQUERY = `
  SELECT ii.product_id,
    CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.cantidad ELSE ii.cantidad END AS cantidad,
    CASE WHEN i.tipo_comprobante = 'nota_credito' THEN -ii.subtotal ELSE ii.subtotal END AS subtotal
  FROM invoice_items ii
  JOIN invoices i ON i.id = ii.invoice_id
  WHERE i.estado = 'emitido' AND strftime('%Y', i.fecha_emision) = ? AND strftime('%m', i.fecha_emision) = ?
    AND (? IS NULL OR i.sucursal_id = ?)
  UNION ALL
  SELECT nvi.product_id, nvi.cantidad AS cantidad, nvi.subtotal AS subtotal
  FROM nota_venta_items nvi
  JOIN notas_venta nv ON nv.id = nvi.nota_venta_id
  WHERE nv.estado = 'emitido' AND strftime('%Y', nv.fecha_emision) = ? AND strftime('%m', nv.fecha_emision) = ?
    AND (? IS NULL OR nv.sucursal_id = ?)
`;

// Total por marca (Proveedor asignado al producto).
router.get('/total-por-marca', (req, res) => {
  const { anio, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const rows = db.prepare(`
    SELECT ${MARCA_EXPR} AS marca, SUM(x.cantidad) AS cantidad, SUM(x.subtotal) AS venta
    FROM (${ITEMS_VENDIDOS_SUBQUERY}) x
    LEFT JOIN products p ON p.id = x.product_id
    GROUP BY ${MARCA_EXPR}
    ORDER BY venta DESC
  `).all(String(anio), mesPad, sucursalId, sucursalId, String(anio), mesPad, sucursalId, sucursalId);
  res.json(conPorcentaje(rows));
});

const LINEA_LABEL = { organic: 'Organic', fit: 'Fit' };

// Total por línea propia (Organic / Fit) — mismo patrón que total-por-marca,
// agrupando por products.linea en vez de por proveedor. Los productos sin
// línea asignada se agrupan en "Sin línea" para que la suma siga cuadrando
// con el total de ventas real (no se pierden productos silenciosamente).
router.get('/total-por-linea', (req, res) => {
  const { anio, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const rows = db.prepare(`
    SELECT COALESCE(p.linea, 'sin_linea') AS linea, SUM(x.cantidad) AS cantidad, SUM(x.subtotal) AS venta
    FROM (${ITEMS_VENDIDOS_SUBQUERY}) x
    LEFT JOIN products p ON p.id = x.product_id
    GROUP BY COALESCE(p.linea, 'sin_linea')
    ORDER BY venta DESC
  `).all(String(anio), mesPad, sucursalId, sucursalId, String(anio), mesPad, sucursalId, sucursalId);
  res.json(conPorcentaje(rows).map((r) => ({ ...r, label: LINEA_LABEL[r.linea] || 'Sin línea' })));
});

// Total por producto (agrupado por categoría del producto).
router.get('/total-por-producto', (req, res) => {
  const { anio, mesPad } = anioMes(req);
  const sucursalId = sedeFiltro(req);
  const rows = db.prepare(`
    SELECT COALESCE(p.categoria, 'Sin categoría') AS categoria, SUM(x.cantidad) AS cantidad, SUM(x.subtotal) AS venta
    FROM (${ITEMS_VENDIDOS_SUBQUERY}) x
    LEFT JOIN products p ON p.id = x.product_id
    GROUP BY COALESCE(p.categoria, 'Sin categoría')
    ORDER BY venta DESC
  `).all(String(anio), mesPad, sucursalId, sucursalId, String(anio), mesPad, sucursalId, sucursalId);
  res.json(conPorcentaje(rows));
});

// Link público (sin login) para compartir el resumen de ventas por sede —
// ver routes/dashboardPublico.js, que lo consume. A diferencia de
// sedeFiltro (que en Gerencia respeta el query param, es decir "lo que
// tiene elegido en el selector en este momento"), acá el alcance es fijo
// para que el link no cambie de significado según lo que Gerencia esté
// mirando en pantalla al copiarlo: Gerencia siempre comparte "todas las
// sedes", un Supervisor siempre comparte su propia sede asignada.
function sedeDelLinkPublico(req) {
  if (req.user.role === 'gerencia') return null;
  const row = db.prepare('SELECT sucursal_id FROM users WHERE id = ?').get(req.user.id);
  return row?.sucursal_id || null;
}

function filaLinkPublico(sucursalId) {
  return sucursalId === null
    ? db.prepare('SELECT id, token, activo FROM dashboard_publico_links WHERE sucursal_id IS NULL ORDER BY id DESC LIMIT 1').get()
    : db.prepare('SELECT id, token, activo FROM dashboard_publico_links WHERE sucursal_id = ? ORDER BY id DESC LIMIT 1').get(sucursalId);
}

// Reservado a Gerencia o a un rol con "Permisos de Supervisor → Compartir
// Tablero" (no a cualquier otro rol con acceso al Tablero de Ventas): es la
// única acción de esta pantalla que expone datos de la empresa sin
// necesidad de sesión.
router.get('/link-publico', requireCompartirTablero, (req, res) => {
  const fila = filaLinkPublico(sedeDelLinkPublico(req));
  res.json({ token: fila && fila.activo ? fila.token : null });
});

// Idempotente: si ya hay un link activo para este alcance, devuelve el
// mismo token (no lo rota cada vez que alguien le da "Copiar"). Si estaba
// revocado o nunca existió, genera uno nuevo.
router.post('/link-publico', requireCompartirTablero, (req, res) => {
  const sucursalId = sedeDelLinkPublico(req);
  const fila = filaLinkPublico(sucursalId);
  if (fila && fila.activo) return res.json({ token: fila.token });
  const token = crypto.randomBytes(24).toString('hex');
  if (fila) {
    db.prepare(
      "UPDATE dashboard_publico_links SET token = ?, activo = 1, created_by = ?, created_at = datetime('now'), ultimo_uso_at = NULL WHERE id = ?"
    ).run(token, req.user.id, fila.id);
  } else {
    db.prepare(
      'INSERT INTO dashboard_publico_links (token, sucursal_id, created_by) VALUES (?, ?, ?)'
    ).run(token, sucursalId, req.user.id);
  }
  res.status(201).json({ token });
});

// Revocar invalida el link ya compartido; volver a generarlo emite un
// token nuevo (no reactiva el viejo), para que un link filtrado no pueda
// "revivir" solo.
router.delete('/link-publico', requireCompartirTablero, (req, res) => {
  const fila = filaLinkPublico(sedeDelLinkPublico(req));
  if (fila) db.prepare('UPDATE dashboard_publico_links SET activo = 0 WHERE id = ?').run(fila.id);
  res.json({ ok: true });
});

module.exports = router;
