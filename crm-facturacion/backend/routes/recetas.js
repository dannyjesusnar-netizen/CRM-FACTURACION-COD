const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { consumirStock, incrementarStock, getStockSucursal } = require('../utils/stock');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);

router.get('/', (req, res) => {
  const { q, desde, hasta } = req.query;
  let sql = `
    SELECT r.*, p.codigo AS producto_salida_codigo, p.nombre AS producto_salida_nombre, p.unidad AS producto_salida_unidad
    FROM recetas r JOIN products p ON p.id = r.product_id_salida
    WHERE r.activo = 1
  `;
  const params = [];
  if (q) { sql += ' AND (r.nombre LIKE ? OR p.nombre LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (desde) { sql += ' AND date(r.created_at) >= date(?)'; params.push(desde); }
  if (hasta) { sql += ' AND date(r.created_at) <= date(?)'; params.push(hasta); }
  sql += ' ORDER BY r.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const receta = db.prepare(
    `SELECT r.*, p.codigo AS producto_salida_codigo, p.nombre AS producto_salida_nombre, p.unidad AS producto_salida_unidad
     FROM recetas r JOIN products p ON p.id = r.product_id_salida WHERE r.id = ?`
  ).get(req.params.id);
  if (!receta) return res.status(404).json({ error: 'Receta no encontrada.' });
  const items = db.prepare(
    `SELECT ri.*, p.codigo, p.nombre, p.unidad, p.stock FROM receta_items ri JOIN products p ON p.id = ri.product_id WHERE ri.receta_id = ?`
  ).all(req.params.id);
  res.json({ ...receta, items });
});

router.post('/', (req, res) => {
  const { nombre, descripcion, product_id_salida, cantidad_salida, tipo_produccion, items } = req.body || {};
  if (!nombre || !product_id_salida || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'nombre, product_id_salida e items (insumos) son requeridos.' });
  }
  const salida = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id_salida);
  if (!salida) return res.status(404).json({ error: 'Producto de salida no encontrado.' });
  if (salida.tipo !== 'producto') return res.status(400).json({ error: 'El producto de salida debe ser de tipo "producto".' });

  const insertAll = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO recetas (nombre, descripcion, product_id_salida, cantidad_salida, tipo_produccion, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nombre, descripcion || null, product_id_salida, Number(cantidad_salida || 1), tipo_produccion || 'automatico', req.user?.id || null);
    const recetaId = info.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO receta_items (receta_id, product_id, cantidad) VALUES (?, ?, ?)');
    for (const it of items) {
      if (!it.product_id || !it.cantidad) continue;
      insertItem.run(recetaId, it.product_id, Number(it.cantidad));
    }
    return recetaId;
  });

  const recetaId = insertAll();
  const receta = db.prepare('SELECT * FROM recetas WHERE id = ?').get(recetaId);
  const items2 = db.prepare('SELECT * FROM receta_items WHERE receta_id = ?').all(recetaId);
  res.status(201).json({ ...receta, items: items2 });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM recetas WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Receta no encontrada.' });
  db.prepare('UPDATE recetas SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/recetas/:id/producir { cantidad_lotes }
router.post('/:id/producir', (req, res) => {
  const { cantidad_lotes } = req.body || {};
  const lotes = Number(cantidad_lotes || 1);
  if (!lotes || lotes <= 0) return res.status(400).json({ error: 'cantidad_lotes debe ser mayor a 0.' });

  const receta = db.prepare('SELECT * FROM recetas WHERE id = ? AND activo = 1').get(req.params.id);
  if (!receta) return res.status(404).json({ error: 'Receta no encontrada.' });
  const items = db.prepare('SELECT * FROM receta_items WHERE receta_id = ?').all(req.params.id);

  for (const it of items) {
    const necesario = it.cantidad * lotes;
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    const disponibleSede = prod ? getStockSucursal(it.product_id, req.sucursalId) : 0;
    if (!prod || disponibleSede < necesario) {
      return res.status(400).json({
        error: `Stock insuficiente en esta sede de "${prod?.nombre || it.product_id}" (necesario: ${necesario}, disponible: ${disponibleSede}).`,
      });
    }
  }

  const run = db.transaction(() => {
    const info = db.prepare('INSERT INTO producciones (receta_id, cantidad_lotes, created_by) VALUES (?, ?, ?)')
      .run(req.params.id, lotes, req.user?.id || null);
    const produccionId = info.lastInsertRowid;
    const referencia = `PROD-${String(produccionId).padStart(5, '0')}`;
    for (const it of items) {
      consumirStock(it.product_id, it.cantidad * lotes, {
        tipoMovimiento: 'produccion_consumo',
        motivo: `Consumo receta "${receta.nombre}"`,
        referencia,
        userId: req.user?.id,
        sucursalId: req.sucursalId,
      });
    }
    incrementarStock(receta.product_id_salida, receta.cantidad_salida * lotes, {
      tipoMovimiento: 'produccion_ingreso',
      motivo: `Producción receta "${receta.nombre}"`,
      referencia,
      userId: req.user?.id,
      sucursalId: req.sucursalId,
    });
    return produccionId;
  });

  const produccionId = run();
  res.status(201).json({ id: produccionId, receta_id: Number(req.params.id), cantidad_lotes: lotes });
});

module.exports = router;
