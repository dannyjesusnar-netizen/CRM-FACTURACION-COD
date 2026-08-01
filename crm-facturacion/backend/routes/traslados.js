const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getStockSucursal, setStockSucursal } = require('../utils/stock');

const router = express.Router();
router.use(requireAuth);

// GET /api/traslados?emisor=&desde=&hasta=&estado=
router.get('/', (req, res) => {
  const { emisor, desde, hasta, estado } = req.query;
  let sql = `
    SELECT t.*, so.nombre AS sucursal_origen_nombre, sd.nombre AS sucursal_destino_nombre,
           u.full_name AS emisor_nombre
    FROM traslados t
    JOIN sucursales so ON so.id = t.sucursal_origen_id
    JOIN sucursales sd ON sd.id = t.sucursal_destino_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE 1=1
  `;
  const params = [];
  if (emisor) { sql += ' AND t.created_by = ?'; params.push(emisor); }
  if (estado) { sql += ' AND t.estado = ?'; params.push(estado); }
  if (desde) { sql += " AND date(t.created_at) >= date(?)"; params.push(desde); }
  if (hasta) { sql += " AND date(t.created_at) <= date(?)"; params.push(hasta); }
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
    `SELECT ti.*, p.codigo, p.nombre, p.unidad FROM traslado_items ti JOIN products p ON p.id = ti.product_id WHERE ti.traslado_id = ?`
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

router.post('/', (req, res) => {
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
  }

  const insertAll = db.transaction(() => {
    const maxCodigo = db.prepare('SELECT MAX(codigo) AS m FROM traslados').get().m || 0;
    const info = db.prepare(
      `INSERT INTO traslados (codigo, sucursal_origen_id, sucursal_destino_id, estado, observaciones, created_by)
       VALUES (?, ?, ?, 'completado', ?, ?)`
    ).run(maxCodigo + 1, sucursal_origen_id, sucursal_destino_id, observaciones || null, req.user?.id || null);
    const trasladoId = info.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO traslado_items (traslado_id, product_id, cantidad) VALUES (?, ?, ?)');
    for (const it of items) {
      insertItem.run(trasladoId, it.product_id, Number(it.cantidad));
      setStockSucursal(it.product_id, sucursal_origen_id, getStockSucursal(it.product_id, sucursal_origen_id) - Number(it.cantidad));
      setStockSucursal(it.product_id, sucursal_destino_id, getStockSucursal(it.product_id, sucursal_destino_id) + Number(it.cantidad));
    }
    return trasladoId;
  });

  const trasladoId = insertAll();
  const traslado = db.prepare('SELECT * FROM traslados WHERE id = ?').get(trasladoId);
  const items2 = db.prepare('SELECT * FROM traslado_items WHERE traslado_id = ?').all(trasladoId);
  res.status(201).json({ ...traslado, items: items2 });
});

router.post('/:id/anular', (req, res) => {
  const traslado = db.prepare('SELECT * FROM traslados WHERE id = ?').get(req.params.id);
  if (!traslado) return res.status(404).json({ error: 'Traslado no encontrado.' });
  if (traslado.estado === 'anulado') return res.status(400).json({ error: 'El traslado ya está anulado.' });

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
