const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/equivalencias?product_id=
router.get('/', (req, res) => {
  const { product_id } = req.query;
  if (!product_id) return res.status(400).json({ error: 'product_id es requerido.' });
  const rows = db.prepare('SELECT * FROM equivalencias WHERE product_id = ? AND activo = 1 ORDER BY id ASC').all(product_id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { product_id, nombre, factor, precio, stock_minimo, stock_maximo } = req.body || {};
  if (!product_id || !nombre || !factor || Number(factor) <= 0) {
    return res.status(400).json({ error: 'product_id, nombre y factor (mayor a 0) son requeridos.' });
  }
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado.' });

  const info = db.prepare(
    `INSERT INTO equivalencias (product_id, nombre, factor, precio, stock_minimo, stock_maximo)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    product_id,
    nombre,
    Number(factor),
    precio !== undefined && precio !== null && precio !== '' ? Number(precio) : null,
    stock_minimo !== undefined && stock_minimo !== null && stock_minimo !== '' ? Number(stock_minimo) : null,
    stock_maximo !== undefined && stock_maximo !== null && stock_maximo !== '' ? Number(stock_maximo) : null
  );
  res.status(201).json(db.prepare('SELECT * FROM equivalencias WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM equivalencias WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Equivalencia no encontrada.' });
  db.prepare('DELETE FROM equivalencias WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
