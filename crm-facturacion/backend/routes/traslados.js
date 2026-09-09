const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getStockSucursal, setStockSucursal } = require('../utils/stock');
const { requirePermiso, requireAccion, esGerenciaOSupervisor } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('inventario'));

function requireAprobadorTraslados(req, res, next) {
  if (esGerenciaOSupervisor(req.user)) return next();
  return res.status(403).json({ error: 'Solo Gerencia o un Supervisor puede aprobar o rechazar traslados.' });
}

// GET /api/traslados?emisor=&desde=&hasta=&estado=
router.get('/', (req, res) => {
  const { emisor, desde, hasta, estado } = req.query;
  let sql = `
    SELECT t.*, so.nombre AS sucursal_origen_nombre, sd.nombre AS sucursal_destino_nombre,
           u.full_name AS emisor_nombre, ua.full_name AS aprobador_nombre
    FROM traslados t
    JOIN sucursales so ON so.id = t.sucursal_origen_id
    JOIN sucursales sd ON sd.id = t.sucursal_destino_id
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN users ua ON ua.id = t.aprobado_por
    WHERE 1=1
  `;
  const params = [];
  if (emisor) { sql += ' AND t.created_by = ?'; params.push(emisor); }
  if (estado) { sql += ' AND t.estado = ?'; params.push(estado); }
  // created_at está en UTC; se resta 5h para comparar contra el "hoy" de
  // Perú (ver hoyPeru()) — evita que un traslado de la noche desaparezca
  // del filtro "hasta: hoy" hasta el día siguiente.
  if (desde) { sql += " AND date(t.created_at, '-5 hours') >= date(?)"; params.push(desde); }
  if (hasta) { sql += " AND date(t.created_at, '-5 hours') <= date(?)"; params.push(hasta); }
  sql += ' ORDER BY t.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const traslado = db.prepare(
    `SELECT t.*, so.nombre AS sucursal_origen_nombre, sd.nombre AS sucursal_destino_nombre
     FROM traslados t
     JOIN sucursales so ON so.id = t.sucursal_origen_id
     JOIN sucursales sd ON sd.id = t.sucursal_destino_id
     WHERE t.id = ?`
  ).get(req.params.id);
  if (!traslado) return res.status(404).json({ error: 'Traslado no encontrado.' });
  const items = db.prepare(
    `SELECT ti.*, p.codigo, p.nombre, p.unidad, l.codigo_lote
     FROM traslado_items ti JOIN products p ON p.id = ti.product_id
     LEFT JOIN lotes l ON l.id = ti.lote_id
     WHERE ti.traslado_id = ?`
  ).all(req.params.id);
  res.json({ ...traslado, items });
});

// GET /api/traslados/stock/:productId -> stock por sucursal para un producto
router.get('/stock/:productId', (req, res) => {
  const sucursales = db.prepare('SELECT * FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, nombre ASC').all();
  const rows = sucursales.map((s) => ({
    sucursal_id: s.id,
    sucursal_nombre: s.nombre,
    stock: getStockSucursal(req.params.productId, s.id),
  }));
  res.json(rows);
});

// GET /api/traslados/lotes/:productId -> lotes/series activos de un producto,
// para que el traslado pueda referenciar de cuál se está moviendo stock
// (informativo, igual que stock_movements.lote_id; no lleva un saldo por sede).
router.get('/lotes/:productId', (req, res) => {
  const rows = db.prepare(
    `SELECT id, codigo_lote, tipo, fecha_vencimiento, cantidad_actual
     FROM lotes WHERE product_id = ? AND activo = 1
     ORDER BY (fecha_vencimiento IS NULL), date(fecha_vencimiento) ASC`
  ).all(req.params.productId);
  res.json(rows);
});

// POST /api/traslados — un vendedor de sede crea el traslado como "solicitud
// pendiente" (el stock NO se mueve todavía, queda a la espera de que
// Gerencia o un Supervisor lo apruebe). Gerencia/Supervisor siguen creando
// traslados que se completan directo, igual que siempre — son quienes
// aprobarían de todos modos, así que exigirles el mismo paso no evita nada.
router.post('/', requireAccion('inventario', 'traslados'), (req, res) => {
  const { sucursal_origen_id, sucursal_destino_id, items, observaciones } = req.body || {};
  if (!sucursal_origen_id || !sucursal_destino_id) {
    return res.status(400).json({ error: 'sucursal_origen_id y sucursal_destino_id son requeridos.' });
  }
  if (Number(sucursal_origen_id) === Number(sucursal_destino_id)) {
    return res.status(400).json({ error: 'La sucursal de origen y destino no pueden ser la misma.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un producto.' });
  }

  const origen = db.prepare('SELECT * FROM sucursales WHERE id = ?').get(sucursal_origen_id);
  const destino = db.prepare('SELECT * FROM sucursales WHERE id = ?').get(sucursal_destino_id);
  if (!origen || !destino) return res.status(404).json({ error: 'Sucursal no encontrada.' });

  for (const it of items) {
    const disponible = getStockSucursal(it.product_id, sucursal_origen_id);
    if (!it.cantidad || Number(it.cantidad) <= 0) {
      return res.status(400).json({ error: 'Cada producto debe tener una cantidad mayor a 0.' });
    }
    if (Number(it.cantidad) > disponible) {
      const prod = db.prepare('SELECT nombre FROM products WHERE id = ?').get(it.product_id);
      return res.status(400).json({
        error: `Stock insuficiente en ${origen.nombre} para "${prod?.nombre || it.product_id}" (disponible: ${disponible}).`,
      });
    }
    if (it.lote_id) {
      const lote = db.prepare('SELECT id FROM lotes WHERE id = ? AND product_id = ? AND activo = 1').get(it.lote_id, it.product_id);
      if (!lote) return res.status(400).json({ error: 'Uno de los lotes seleccionados no existe o no corresponde a ese producto.' });
    }
  }

  const requiereAprobacion = !esGerenciaOSupervisor(req.user);
  const estadoInicial = requiereAprobacion ? 'pendiente' : 'completado';

  const insertAll = db.transaction(() => {
    const maxCodigo = db.prepare('SELECT MAX(codigo) AS m FROM traslados').get().m || 0;
    const info = db.prepare(
      `INSERT INTO traslados (codigo, sucursal_origen_id, sucursal_destino_id, estado, observaciones, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(maxCodigo + 1, sucursal_origen_id, sucursal_destino_id, estadoInicial, observaciones || null, req.user?.id || null);
    const trasladoId = info.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO traslado_items (traslado_id, product_id, cantidad, lote_id) VALUES (?, ?, ?, ?)');
    for (const it of items) {
      insertItem.run(trasladoId, it.product_id, Number(it.cantidad), it.lote_id || null);
      if (!requiereAprobacion) {
        setStockSucursal(it.product_id, sucursal_origen_id, getStockSucursal(it.product_id, sucursal_origen_id) - Number(it.cantidad));
        setStockSucursal(it.product_id, sucursal_destino_id, getStockSucursal(it.product_id, sucursal_destino_id) + Number(it.cantidad));
      }
    }
    return trasladoId;
  });

  const trasladoId = insertAll();
  const traslado = db.prepare('SELECT * FROM traslados WHERE id = ?').get(trasladoId);
  const items2 = db.prepare('SELECT * FROM traslado_items WHERE traslado_id = ?').all(trasladoId);
  res.status(201).json({ ...traslado, items: items2 });
});

// POST /api/traslados/:id/aprobar — Gerencia o Supervisor únicamente. Recién
// acá se mueve el stock: se revalida la disponibilidad porque pudo cambiar
// desde que se pidió el traslado (ventas, otros traslados, etc.).
router.post('/:id/aprobar', requireAccion('inventario', 'traslados'), requireAprobadorTraslados, (req, res) => {
  const traslado = db.prepare('SELECT * FROM traslados WHERE id = ?').get(req.params.id);
  if (!traslado) return res.status(404).json({ error: 'Traslado no encontrado.' });
  if (traslado.estado !== 'pendiente') {
    return res.status(400).json({ error: 'Este traslado no está pendiente de aprobación.' });
  }

  const items = db.prepare('SELECT * FROM traslado_items WHERE traslado_id = ?').all(req.params.id);
  for (const it of items) {
    const disponible = getStockSucursal(it.product_id, traslado.sucursal_origen_id);
    if (it.cantidad > disponible) {
      const prod = db.prepare('SELECT nombre FROM products WHERE id = ?').get(it.product_id);
      return res.status(409).json({
        error: `Ya no hay stock suficiente para aprobar: "${prod?.nombre || it.product_id}" (disponible: ${disponible}, solicitado: ${it.cantidad}).`,
      });
    }
  }

  const run = db.transaction(() => {
    for (const it of items) {
      setStockSucursal(it.product_id, traslado.sucursal_origen_id, getStockSucursal(it.product_id, traslado.sucursal_origen_id) - it.cantidad);
      setStockSucursal(it.product_id, traslado.sucursal_destino_id, getStockSucursal(it.product_id, traslado.sucursal_destino_id) + it.cantidad);
    }
    db.prepare(
      "UPDATE traslados SET estado = 'completado', aprobado_por = ?, aprobado_at = datetime('now') WHERE id = ?"
    ).run(req.user.id, req.params.id);
  });
  run();
  res.json(db.prepare('SELECT * FROM traslados WHERE id = ?').get(req.params.id));
});

// POST /api/traslados/:id/rechazar { motivo? } — Gerencia o Supervisor
// únicamente. No mueve stock (nunca llegó a moverse), solo cambia el estado.
router.post('/:id/rechazar', requireAccion('inventario', 'traslados'), requireAprobadorTraslados, (req, res) => {
  const traslado = db.prepare('SELECT * FROM traslados WHERE id = ?').get(req.params.id);
  if (!traslado) return res.status(404).json({ error: 'Traslado no encontrado.' });
  if (traslado.estado !== 'pendiente') {
    return res.status(400).json({ error: 'Este traslado no está pendiente de aprobación.' });
  }
  const { motivo } = req.body || {};
  db.prepare(
    "UPDATE traslados SET estado = 'rechazado', aprobado_por = ?, aprobado_at = datetime('now'), motivo_rechazo = ? WHERE id = ?"
  ).run(req.user.id, (motivo || '').toString().trim() || null, req.params.id);
  res.json(db.prepare('SELECT * FROM traslados WHERE id = ?').get(req.params.id));
});

router.post('/:id/anular', requireAccion('inventario', 'traslados'), (req, res) => {
  const traslado = db.prepare('SELECT * FROM traslados WHERE id = ?').get(req.params.id);
  if (!traslado) return res.status(404).json({ error: 'Traslado no encontrado.' });
  if (traslado.estado !== 'completado') {
    return res.status(400).json({ error: 'Solo se puede anular un traslado completado (el stock ya se movió).' });
  }

  const items = db.prepare('SELECT * FROM traslado_items WHERE traslado_id = ?').all(req.params.id);
  const run = db.transaction(() => {
    for (const it of items) {
      setStockSucursal(it.product_id, traslado.sucursal_origen_id, getStockSucursal(it.product_id, traslado.sucursal_origen_id) + it.cantidad);
      setStockSucursal(it.product_id, traslado.sucursal_destino_id, getStockSucursal(it.product_id, traslado.sucursal_destino_id) - it.cantidad);
    }
    db.prepare("UPDATE traslados SET estado = 'anulado' WHERE id = ?").run(req.params.id);
  });
  run();
  res.json(db.prepare('SELECT * FROM traslados WHERE id = ?').get(req.params.id));
});

module.exports = router;
