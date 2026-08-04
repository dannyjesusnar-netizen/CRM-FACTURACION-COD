const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { getStockSucursal, setStockSucursal, round2 } = require('../utils/stock');
const { requirePermiso } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('inventario'));
router.use(resolveSucursal);

// El stock que se muestra siempre es el de la sede activa (no el agregado de
// toda la empresa) — coherente con la separación real por sede: lo que ve el
// usuario es lo que hay físicamente en su sede.
function conStockDeSede(row, sucursalId) {
  if (!row || row.tipo !== 'producto' || row.stock === null) return row;
  return { ...row, stock_total: row.stock, stock: getStockSucursal(row.id, sucursalId) };
}

// proveedor_nombre: proveedor de la compra más reciente registrada para ese
// producto (no es un campo propio del producto, se deriva del historial de Compras).
const PROVEEDOR_SUBQUERY = `(
  SELECT s.nombre FROM purchase_items pi
  JOIN purchases pu ON pu.id = pi.purchase_id
  JOIN suppliers s ON s.id = pu.supplier_id
  WHERE pi.product_id = p.id AND pu.estado = 'registrada'
  ORDER BY pu.fecha DESC, pu.id DESC LIMIT 1
) AS proveedor_nombre`;

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const categoria = (req.query.categoria || '').trim();
  let sql = `SELECT p.*, ${PROVEEDOR_SUBQUERY} FROM products p WHERE p.activo = 1`;
  const params = [];
  if (q) {
    sql += ' AND (p.nombre LIKE ? OR p.codigo LIKE ? OR p.codigo_barras LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (categoria) {
    sql += ' AND p.categoria = ?';
    params.push(categoria);
  }
  sql += ' ORDER BY p.nombre ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => conStockDeSede(r, req.sucursalId)));
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
  res.json(conStockDeSede(row, req.sucursalId));
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
    const newId = info.lastInsertRowid;
    // El "Stock inicial" del formulario es el stock en la sede donde se está
    // creando el producto, no un total mágico repartido entre todas las sedes.
    if (tipo === 'producto' && Number(stock || 0) > 0) {
      setStockSucursal(newId, req.sucursalId, Number(stock || 0));
    }
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(newId);
    res.status(201).json(conStockDeSede(row, req.sucursalId));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un producto con ese codigo.' });
    }
    res.status(500).json({ error: 'Error al crear producto.' });
  }
});

// POST /api/products/carga-masiva { rows: [{ codigo, nombre, categoria, unidad,
// precio_unitario, stock, stock_minimo, precio_compra, codigo_barras }] }
// Crea productos nuevos (por código) o actualiza los que ya existen. El
// stock de cada fila es el de la sede activa, igual que en el alta/edición
// individual.
router.post('/carga-masiva', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows es requerido y debe tener al menos una fila.' });
  }
  const creados = [];
  const actualizados = [];
  const errores = [];

  for (const r of rows) {
    const codigo = (r.codigo || '').toString().trim();
    const nombre = (r.nombre || '').toString().trim();
    const precioUnitario = Number(r.precio_unitario);
    if (!codigo || !nombre || Number.isNaN(precioUnitario)) {
      errores.push({ codigo: codigo || '(vacío)', error: 'codigo, nombre y precio_unitario son requeridos (precio_unitario debe ser numérico).' });
      continue;
    }
    const unidad = (r.unidad || 'NIU').toString().trim() || 'NIU';
    const tipo = tipoDesdeUnidad(unidad);
    const stock = tipo === 'servicio' ? null : Number(r.stock || 0);
    const stockMinimo = tipo === 'servicio' ? null : Number(r.stock_minimo || 0);
    const precioCompra = r.precio_compra === undefined || r.precio_compra === '' ? null : Number(r.precio_compra);
    const categoria = (r.categoria || 'General').toString().trim() || 'General';
    const codigoBarras = (r.codigo_barras || '').toString().trim() || null;

    const existing = db.prepare('SELECT * FROM products WHERE codigo = ?').get(codigo);
    try {
      if (existing) {
        const nuevoAgregado = tipo === 'servicio' || stock === null
          ? existing.stock
          : round2(existing.stock + (stock - getStockSucursal(existing.id, req.sucursalId)));
        db.prepare(
          `UPDATE products SET nombre = ?, categoria = ?, unidad = ?, tipo = ?, precio_unitario = ?, precio_compra = ?,
           codigo_barras = ?, stock = ?, stock_minimo = ? WHERE id = ?`
        ).run(nombre, categoria, unidad, tipo, precioUnitario, precioCompra, codigoBarras, nuevoAgregado, stockMinimo, existing.id);
        if (tipo !== 'servicio') setStockSucursal(existing.id, req.sucursalId, stock);
        actualizados.push({ codigo, nombre });
      } else {
        const info = db.prepare(
          `INSERT INTO products (codigo, codigo_barras, nombre, tipo, categoria, unidad, precio_compra, precio_unitario, stock, stock_minimo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(codigo, codigoBarras, nombre, tipo, categoria, unidad, precioCompra, precioUnitario, stock, stockMinimo);
        if (tipo !== 'servicio' && stock > 0) setStockSucursal(info.lastInsertRowid, req.sucursalId, stock);
        creados.push({ codigo, nombre });
      }
    } catch (err) {
      errores.push({ codigo, error: 'No se pudo guardar esta fila.' });
    }
  }

  res.json({ creados, actualizados, errores });
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

  // El campo "stock" del formulario es el stock de la sede activa (igual que
  // se muestra en la lista); el agregado se ajusta por la diferencia para no
  // perder de vista lo que hay en las demás sedes.
  let nuevoAgregado = existing.stock;
  if (tipo !== 'servicio' && stock !== undefined && existing.stock !== null) {
    const actualSede = getStockSucursal(req.params.id, req.sucursalId);
    const diferencia = Number(stock) - actualSede;
    nuevoAgregado = round2(existing.stock + diferencia);
  }

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
    tipo === 'servicio' ? null : nuevoAgregado,
    tipo === 'servicio' ? null : (stock_minimo !== undefined ? Number(stock_minimo) : existing.stock_minimo),
    palabras_clave ?? existing.palabras_clave,
    activo !== undefined ? Number(activo) : existing.activo,
    req.params.id
  );
  if (tipo !== 'servicio' && stock !== undefined) {
    setStockSucursal(req.params.id, req.sucursalId, Number(stock));
  }
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(conStockDeSede(row, req.sucursalId));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado.' });
  // Soft delete para no romper historicos de facturas
  db.prepare('UPDATE products SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
