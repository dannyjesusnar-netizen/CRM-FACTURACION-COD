const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { round2, ajustarStockSucursal, getStockSucursal, setStockSucursal } = require('../utils/stock');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { analizarEtiqueta } = require('../utils/ocrEtiqueta');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('inventario'));
router.use(resolveSucursal);

// cliente_proveedor: nombre del proveedor o cliente del documento que originó
// el movimiento, resuelto a partir de la referencia (no es un campo propio
// del movimiento). Solo se resuelve para movimientos ligados a una Compra o
// a un comprobante de Ventas; el resto queda en blanco.
const CLIENTE_PROVEEDOR_SUBQUERY = `(
  SELECT s.nombre FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id
  WHERE 'COMPRA-' || printf('%05d', pu.numero) = m.referencia LIMIT 1
), (
  SELECT c.nombre FROM invoices i JOIN clients c ON c.id = i.client_id
  WHERE i.serie || '-' || printf('%06d', i.numero) = m.referencia LIMIT 1
)`;

// GET /api/movements?product_id=&tipo=&from=&to=&q=
router.get('/', (req, res) => {
  const { product_id, tipo, from, to, q } = req.query;
  let sql = `
    SELECT m.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo, u.full_name AS usuario_nombre,
           COALESCE(${CLIENTE_PROVEEDOR_SUBQUERY}) AS cliente_proveedor
    FROM stock_movements m
    JOIN products p ON p.id = m.product_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (product_id) { sql += ' AND m.product_id = ?'; params.push(product_id); }
  if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }
  if (from) { sql += ' AND date(m.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(m.created_at) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (p.nombre LIKE ? OR p.codigo LIKE ? OR m.referencia LIKE ? OR m.motivo LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY m.id DESC LIMIT 300';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// POST /api/movements  { product_id, cantidad, motivo, codigo_lote?, fecha_vencimiento? }  -- ajuste manual (+ ingreso / - salida)
// Si es un ingreso (cantidad > 0) y viene codigo_lote, se crea el lote junto con el
// movimiento en la misma transacción (mismo patrón que POST /api/lotes).
router.post('/', requireAccion('inventario', 'ajustes'), (req, res) => {
  const { product_id, cantidad, motivo, codigo_lote, fecha_vencimiento } = req.body || {};
  if (!product_id || !cantidad) {
    return res.status(400).json({ error: 'product_id y cantidad son requeridos.' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  if (product.tipo === 'servicio' || product.stock === null) {
    return res.status(400).json({ error: 'No se puede ajustar stock de un servicio.' });
  }

  const cant = Number(cantidad);
  if (cant < 0 && Math.abs(cant) > getStockSucursal(product_id, req.sucursalId)) {
    return res.status(409).json({ error: `Stock insuficiente en esta sede (disponible: ${getStockSucursal(product_id, req.sucursalId)}).` });
  }
  const codigoLote = cant > 0 ? (codigo_lote || '').toString().trim() : '';
  if (codigo_lote && cant <= 0) {
    return res.status(400).json({ error: 'El lote solo puede registrarse en un ingreso (cantidad positiva).' });
  }

  const insertAll = db.transaction(() => {
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(cant, product_id);
    const updated = db.prepare('SELECT stock FROM products WHERE id = ?').get(product_id);
    ajustarStockSucursal(product_id, req.sucursalId, cant);

    if (codigoLote) {
      const loteInfo = db.prepare(
        `INSERT INTO lotes (product_id, codigo_lote, tipo, fecha_vencimiento, cantidad_inicial, cantidad_actual, created_by)
         VALUES (?, ?, 'lote', ?, ?, ?, ?)`
      ).run(product_id, codigoLote, fecha_vencimiento || null, cant, cant, req.user?.id || null);
      db.prepare(
        `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
         VALUES (?, ?, 'ingreso_lote', ?, ?, ?, ?, ?, ?)`
      ).run(product_id, loteInfo.lastInsertRowid, cant, updated.stock, motivo || null, codigoLote, req.user?.id || null, req.sucursalId);
    } else {
      db.prepare(
        `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, created_by, sucursal_id)
         VALUES (?, 'ajuste', ?, ?, ?, ?, ?)`
      ).run(product_id, cant, updated.stock, motivo || null, req.user?.id || null, req.sucursalId);
    }
    return updated.stock;
  });

  const stockFinal = insertAll();
  res.status(201).json({ ok: true, stock: stockFinal });
});

// POST /api/movements/conteo  { product_id, cantidad_contada, motivo }  -- Inventario Físico
router.post('/conteo', requireAccion('inventario', 'conteo'), (req, res) => {
  const { product_id, cantidad_contada, motivo } = req.body || {};
  if (!product_id || cantidad_contada === undefined || cantidad_contada === null || cantidad_contada === '') {
    return res.status(400).json({ error: 'product_id y cantidad_contada son requeridos.' });
  }
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado.' });
  if (prod.tipo !== 'producto' || prod.stock === null) {
    return res.status(400).json({ error: 'Solo los productos (no servicios) tienen inventario físico.' });
  }

  const contado = Number(cantidad_contada);
  const actual = getStockSucursal(product_id, req.sucursalId);
  const diferencia = round2(contado - actual);

  if (diferencia !== 0) {
    db.transaction(() => {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(diferencia, product_id);
      const nuevoAgregado = db.prepare('SELECT stock FROM products WHERE id = ?').get(product_id).stock;
      setStockSucursal(product_id, req.sucursalId, contado);
      db.prepare(
        `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
         VALUES (?, 'ajuste', ?, ?, ?, 'INV-FISICO', ?, ?)`
      ).run(product_id, diferencia, nuevoAgregado, motivo ? `Inventario físico: ${motivo}` : 'Inventario físico', req.user?.id || null, req.sucursalId);
    })();
  }

  res.json({ diferencia, stock_anterior: actual, stock_nuevo: contado });
});

// POST /api/movements/importar  { rows: [{ codigo, stock_real }] }  -- Importar Stock Real
router.post('/importar', requireAccion('inventario', 'importacion'), (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows es requerido y debe tener al menos una fila.' });
  }
  const aplicados = [];
  const errores = [];

  db.transaction(() => {
    for (const r of rows) {
      const codigo = (r.codigo || '').toString().trim();
      const stockReal = Number(r.stock_real);
      if (!codigo || Number.isNaN(stockReal)) {
        errores.push({ codigo: codigo || '(vacío)', error: 'Fila inválida (código o stock_real faltante/no numérico).' });
        continue;
      }
      const prod = db.prepare('SELECT * FROM products WHERE codigo = ?').get(codigo);
      if (!prod) {
        errores.push({ codigo, error: 'Producto no encontrado.' });
        continue;
      }
      if (prod.tipo !== 'producto' || prod.stock === null) {
        errores.push({ codigo, error: 'No es un producto con stock (es un servicio).' });
        continue;
      }
      const actual = getStockSucursal(prod.id, req.sucursalId);
      const diferencia = round2(stockReal - actual);
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(diferencia, prod.id);
      const nuevoAgregado = db.prepare('SELECT stock FROM products WHERE id = ?').get(prod.id).stock;
      setStockSucursal(prod.id, req.sucursalId, stockReal);
      if (diferencia !== 0) {
        db.prepare(
          `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
           VALUES (?, 'ajuste', ?, ?, 'Importación de stock real', 'IMPORT-STOCK', ?, ?)`
        ).run(prod.id, diferencia, nuevoAgregado, req.user?.id || null, req.sucursalId);
      }
      aplicados.push({ codigo, producto: prod.nombre, stock_anterior: actual, stock_nuevo: stockReal, diferencia });
    }
  })();

  res.json({ aplicados, errores });
});

// POST /api/movements/importar-lotes
// { rows: [{ codigo, cantidad, codigo_lote?, fecha_vencimiento?, motivo? }] }
// -- Carga masiva de stock (ingresos), cada fila reutiliza el mismo flujo que
// POST /api/movements: si trae codigo_lote crea el lote, si no es un ajuste simple.
router.post('/importar-lotes', requireAccion('inventario', 'ajustes'), (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows es requerido y debe tener al menos una fila.' });
  }
  const aplicados = [];
  const errores = [];

  db.transaction(() => {
    for (const r of rows) {
      const codigo = (r.codigo || '').toString().trim();
      const cant = Number(r.cantidad);
      const codigoLote = (r.codigo_lote || '').toString().trim();
      const fechaVencimiento = (r.fecha_vencimiento || '').toString().trim();
      const motivo = (r.motivo || '').toString().trim();

      if (!codigo || !Number.isFinite(cant) || cant <= 0) {
        errores.push({ codigo: codigo || '(vacío)', error: 'Fila inválida (código o cantidad faltante/no es un ingreso positivo).' });
        continue;
      }
      const prod = db.prepare('SELECT * FROM products WHERE codigo = ?').get(codigo);
      if (!prod) {
        errores.push({ codigo, error: 'Producto no encontrado.' });
        continue;
      }
      if (prod.tipo !== 'producto' || prod.stock === null) {
        errores.push({ codigo, error: 'No es un producto con stock (es un servicio).' });
        continue;
      }

      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(cant, prod.id);
      const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(prod.id).stock;
      ajustarStockSucursal(prod.id, req.sucursalId, cant);

      if (codigoLote) {
        const loteInfo = db.prepare(
          `INSERT INTO lotes (product_id, codigo_lote, tipo, fecha_vencimiento, cantidad_inicial, cantidad_actual, created_by)
           VALUES (?, ?, 'lote', ?, ?, ?, ?)`
        ).run(prod.id, codigoLote, fechaVencimiento || null, cant, cant, req.user?.id || null);
        db.prepare(
          `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
           VALUES (?, ?, 'ingreso_lote', ?, ?, ?, ?, ?, ?)`
        ).run(prod.id, loteInfo.lastInsertRowid, cant, nuevoStock, motivo || null, codigoLote, req.user?.id || null, req.sucursalId);
      } else {
        db.prepare(
          `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
           VALUES (?, 'ajuste', ?, ?, ?, 'IMPORT-LOTES', ?, ?)`
        ).run(prod.id, cant, nuevoStock, motivo || null, req.user?.id || null, req.sucursalId);
      }

      aplicados.push({ codigo, producto: prod.nombre, cantidad: cant, codigo_lote: codigoLote || null, stock_nuevo: nuevoStock });
    }
  })();

  res.json({ aplicados, errores });
});

function esDataUrlImagen(s) {
  return typeof s === 'string' && s.startsWith('data:image/');
}

// POST /api/movements/analizar-etiqueta { foto_data_url } -> intenta leer el
// N.º de lote y la fecha de vencimiento desde la foto de la etiqueta de un
// producto (pantalla "Cargar Stock por Fotos"). Cualquiera de los dos puede
// salir null si el OCR no encontró nada — es solo una sugerencia, el usuario
// siempre revisa y puede corregir antes de agregar la fila.
router.post('/analizar-etiqueta', requireAccion('inventario', 'ajustes'), async (req, res) => {
  const { foto_data_url } = req.body || {};
  if (!esDataUrlImagen(foto_data_url)) {
    return res.status(400).json({ error: 'foto_data_url debe ser una imagen válida.' });
  }
  try {
    const resultado = await analizarEtiqueta(foto_data_url);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo analizar la foto. Completa el lote y vencimiento manualmente.' });
  }
});

module.exports = router;
