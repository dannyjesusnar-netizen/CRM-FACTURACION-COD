const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const categoria = (req.query.categoria || '').trim();
  let sql = 'SELECT * FROM products WHERE activo = 1';
  const params = [];
  if (q) {
    sql += ' AND (nombre LIKE ? OR codigo LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (categoria) {
    sql += ' AND categoria = ?';
    params.push(categoria);
  }
  sql += ' ORDER BY nombre ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/categorias', (req, res) => {
  const rows = db.prepare(
    "SELECT DISTINCT categoria FROM products WHERE categoria IS NOT NULL AND categoria != '' ORDER BY categoria ASC"
  ).all();
  res.json(rows.map((r) => r.categoria));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { codigo, nombre, descripcion, tipo, categoria, unidad, precio_unitario, stock, stock_minimo } = req.body || {};
  if (!codigo || !nombre || precio_unitario === undefined) {
    return res.status(400).json({ error: 'codigo, nombre y precio_unitario son requeridos.' });
  }
  try {
    const info = db.prepare(
      `INSERT INTO products (codigo, nombre, descripcion, tipo, categoria, unidad, precio_unitario, stock, stock_minimo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      codigo,
      nombre,
      descripcion || null,
      tipo || 'producto',
      categoria || 'General',
      unidad || 'NIU',
      Number(precio_unitario),
      tipo === 'servicio' ? null : Number(stock || 0),
      tipo === 'servicio' ? null : Number(stock_minimo || 0)
    );
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un producto con ese codigo.' });
    }
    res.status(500).json({ error: 'Error al crear producto.' });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado.' });
  const { codigo, nombre, descripcion, tipo, categoria, unidad, precio_unitario, stock, stock_minimo, activo } = req.body || {};
  db.prepare(
    `UPDATE products SET codigo = ?, nombre = ?, descripcion = ?, tipo = ?, categoria = ?, unidad = ?,
     precio_unitario = ?, stock = ?, stock_minimo = ?, activo = ?
     WHERE id = ?`
  ).run(
    codigo ?? existing.codigo,
    nombre ?? existing.nombre,
    descripcion ?? existing.descripcion,
    tipo ?? existing.tipo,
    categoria ?? existing.categoria,
    unidad ?? existing.unidad,
    precio_unitario !== undefined ? Number(precio_unitario) : existing.precio_unitario,
    stock !== undefined ? Number(stock) : existing.stock,
    stock_minimo !== undefined ? Number(stock_minimo) : existing.stock_minimo,
    activo !== undefined ? Number(activo) : existing.activo,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado.' });
  // Soft delete para no romper historicos de facturas
  db.prepare('UPDATE products SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
