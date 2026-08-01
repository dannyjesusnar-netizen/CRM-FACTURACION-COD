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

// La unidad "ZZ" (Servicio) determina si el producto es un servicio (sin stock);
// cualquier otra unidad se trata como un bien físico con stock.
function tipoDesdeUnidad(unidad) {
  return unidad === 'ZZ' ? 'servicio' : 'producto';
}

router.post('/', (req, res) => {
  const {
    codigo, codigo_barras, nombre, descripcion, categoria, unidad,
    afectacion_igv, control, tipo_inventario, tipo_clasificacion, subtipo_clasificacion,
    peso, favorito, precio_compra, precio_unitario, stock, stock_minimo, palabras_clave,
  } = req.body || {};
  if (!codigo || !nombre || precio_unitario === undefined) {
    return res.status(400).json({ error: 'codigo, nombre y precio_unitario son requeridos.' });
  }
  const tipo = tipoDesdeUnidad(unidad || 'NIU');
  try {
    const info = db.prepare(
      `INSERT INTO products (
         codigo, codigo_barras, nombre, descripcion, tipo, categoria, unidad,
         afectacion_igv, control, tipo_inventario, tipo_clasificacion, subtipo_clasificacion,
         peso, favorito, precio_compra, precio_unitario, stock, stock_minimo, palabras_clave
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      codigo,
      codigo_barras || null,
      nombre,
      descripcion || null,
      tipo,
      categoria || 'General',
      unidad || 'NIU',
      afectacion_igv || 'gravado',
      control || 'ninguno',
      tipo_inventario || 'MERCADERIAS',
      tipo_clasificacion || 'Otros',
      subtipo_clasificacion || 'Otros',
      peso === undefined || peso === '' ? null : Number(peso),
      favorito ? 1 : 0,
      precio_compra === undefined || precio_compra === '' ? null : Number(precio_compra),
      Number(precio_unitario),
      tipo === 'servicio' ? null : Number(stock || 0),
      tipo === 'servicio' ? null : Number(stock_minimo || 0),
      palabras_clave || null
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
  const {
    codigo, codigo_barras, nombre, descripcion, categoria, unidad,
    afectacion_igv, control, tipo_inventario, tipo_clasificacion, subtipo_clasificacion,
    peso, favorito, precio_compra, precio_unitario, stock, stock_minimo, palabras_clave, activo,
  } = req.body || {};
  const unidadFinal = unidad ?? existing.unidad;
  const tipo = tipoDesdeUnidad(unidadFinal);
  db.prepare(
    `UPDATE products SET codigo = ?, codigo_barras = ?, nombre = ?, descripcion = ?, tipo = ?, categoria = ?, unidad = ?,
     afectacion_igv = ?, control = ?, tipo_inventario = ?, tipo_clasificacion = ?, subtipo_clasificacion = ?,
     peso = ?, favorito = ?, precio_compra = ?, precio_unitario = ?, stock = ?, stock_minimo = ?, palabras_clave = ?, activo = ?
     WHERE id = ?`
  ).run(
    codigo ?? existing.codigo,
    codigo_barras ?? existing.codigo_barras,
    nombre ?? existing.nombre,
    descripcion ?? existing.descripcion,
    tipo,
    categoria ?? existing.categoria,
    unidadFinal,
    afectacion_igv ?? existing.afectacion_igv,
    control ?? existing.control,
    tipo_inventario ?? existing.tipo_inventario,
    tipo_clasificacion ?? existing.tipo_clasificacion,
    subtipo_clasificacion ?? existing.subtipo_clasificacion,
    peso === undefined ? existing.peso : (peso === '' ? null : Number(peso)),
    favorito === undefined ? existing.favorito : (favorito ? 1 : 0),
    precio_compra === undefined ? existing.precio_compra : (precio_compra === '' ? null : Number(precio_compra)),
    precio_unitario !== undefined ? Number(precio_unitario) : existing.precio_unitario,
    tipo === 'servicio' ? null : (stock !== undefined ? Number(stock) : existing.stock),
    tipo === 'servicio' ? null : (stock_minimo !== undefined ? Number(stock_minimo) : existing.stock_minimo),
    palabras_clave ?? existing.palabras_clave,
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
