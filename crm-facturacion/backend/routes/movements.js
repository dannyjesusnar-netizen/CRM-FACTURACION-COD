const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { round2, ajustarStockSucursal, getStockSucursal, setStockSucursal } = require('../utils/stock');
const { requirePermiso, requireAccion, esGerenciaOSupervisor } = require('../utils/permisos');
const { analizarEtiqueta } = require('../utils/ocrEtiqueta');
const { analizarGuia } = require('../utils/ocrGuia');
const { parseGuiaXml, parseGuiaPdf } = require('../utils/guiaParser');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(requireAuth);
router.use(requirePermiso('inventario'));
router.use(resolveSucursal);

function requireGerenciaOSupervisorCanales(req, res, next) {
  if (esGerenciaOSupervisor(req.user)) return next();
  return res.status(403).json({ error: 'Solo Gerencia o un Supervisor puede administrar los canales de movimiento.' });
}

// GET /api/movements/canales — canales activos, para el selector al registrar
// un movimiento y para el filtro del listado.
router.get('/canales', (req, res) => {
  res.json(db.prepare('SELECT * FROM movimiento_canales WHERE activo = 1 ORDER BY id ASC').all());
});

// POST /api/movements/canales { nombre } — Gerencia/Supervisor únicamente.
router.post('/canales', requireGerenciaOSupervisorCanales, (req, res) => {
  const nombre = (req.body?.nombre || '').toString().trim();
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  try {
    const info = db.prepare('INSERT INTO movimiento_canales (nombre) VALUES (?)').run(nombre);
    res.status(201).json(db.prepare('SELECT * FROM movimiento_canales WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un canal con ese nombre.' });
    }
    res.status(500).json({ error: 'No se pudo crear el canal.' });
  }
});

// DELETE /api/movements/canales/:id — Gerencia/Supervisor únicamente. No
// borra movimientos históricos (su columna "canal" queda con el nombre tal
// cual quedó guardado en su momento), solo lo saca de la lista de opciones.
router.delete('/canales/:id', requireGerenciaOSupervisorCanales, (req, res) => {
  const canal = db.prepare('SELECT * FROM movimiento_canales WHERE id = ?').get(req.params.id);
  if (!canal) return res.status(404).json({ error: 'Canal no encontrado.' });
  db.prepare('DELETE FROM movimiento_canales WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

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

// GET /api/movements?product_id=&tipo=&canal=&from=&to=&q=
router.get('/', (req, res) => {
  const { product_id, tipo, canal, from, to, q } = req.query;
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
  if (canal) { sql += ' AND m.canal = ?'; params.push(canal); }
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
  const { product_id, cantidad, motivo, codigo_lote, fecha_vencimiento, canal } = req.body || {};
  if (!product_id || !cantidad) {
    return res.status(400).json({ error: 'product_id y cantidad son requeridos.' });
  }
  const canalFinal = (canal || '').toString().trim() || 'Compras';
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
        `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, canal, created_by, sucursal_id)
         VALUES (?, ?, 'ingreso_lote', ?, ?, ?, ?, ?, ?, ?)`
      ).run(product_id, loteInfo.lastInsertRowid, cant, updated.stock, motivo || null, codigoLote, canalFinal, req.user?.id || null, req.sucursalId);
    } else {
      db.prepare(
        `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, canal, created_by, sucursal_id)
         VALUES (?, 'ajuste', ?, ?, ?, ?, ?, ?)`
      ).run(product_id, cant, updated.stock, motivo || null, canalFinal, req.user?.id || null, req.sucursalId);
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
      const canalFila = (r.canal || '').toString().trim() || 'Compras';

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
          `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, canal, created_by, sucursal_id)
           VALUES (?, ?, 'ingreso_lote', ?, ?, ?, ?, ?, ?, ?)`
        ).run(prod.id, loteInfo.lastInsertRowid, cant, nuevoStock, motivo || null, codigoLote, canalFila, req.user?.id || null, req.sucursalId);
      } else {
        db.prepare(
          `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, canal, created_by, sucursal_id)
           VALUES (?, 'ajuste', ?, ?, ?, 'IMPORT-LOTES', ?, ?, ?)`
        ).run(prod.id, cant, nuevoStock, motivo || null, canalFila, req.user?.id || null, req.sucursalId);
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

// Quita tildes/mayúsculas y deja solo letras/números para poder comparar el
// texto leído por OCR contra el catálogo sin que un acento o un símbolo
// distinto arruine la comparación.
function normalizarTexto(s) {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sugiere el producto del catálogo cuyo nombre comparte más palabras (de 3+
// letras) con la descripción leída en la guía. Es solo una sugerencia — el
// usuario siempre puede cambiarla o dejarla en blanco antes de confirmar.
function mejorProductoParaDescripcion(descripcion, productos) {
  const palabras = normalizarTexto(descripcion).split(' ').filter((w) => w.length >= 3);
  if (palabras.length === 0) return null;
  let mejor = null;
  let mejorScore = 0;
  for (const p of productos) {
    const nombreNorm = normalizarTexto(p.nombre);
    const score = palabras.reduce((acc, palabra) => acc + (nombreNorm.includes(palabra) ? 1 : 0), 0);
    if (score > mejorScore) { mejorScore = score; mejor = p; }
  }
  return mejor;
}

// POST /api/movements/analizar-guia { foto_data_url } -> lee una foto de la
// guía de remisión COMPLETA del proveedor e intenta separar sus líneas de
// producto (cantidad + descripción), sugiriendo a qué producto del catálogo
// corresponde cada una. A diferencia de "analizar-etiqueta" (una sola foto
// por producto), acá se sube una sola foto de todo el documento — la lectura
// de una tabla escaneada es mucho menos confiable, así que el frontend
// siempre muestra las filas para revisión antes de cargarlas al inventario.
router.post('/analizar-guia', requireAccion('inventario', 'ajustes'), async (req, res) => {
  const { foto_data_url } = req.body || {};
  if (!esDataUrlImagen(foto_data_url)) {
    return res.status(400).json({ error: 'foto_data_url debe ser una imagen válida.' });
  }
  try {
    const resultado = await analizarGuia(foto_data_url);
    const productos = db.prepare("SELECT id, codigo, nombre FROM products WHERE tipo = 'producto'").all();
    const filas = resultado.filas_detectadas.map((f) => {
      const match = mejorProductoParaDescripcion(f.descripcion, productos);
      return {
        descripcion_detectada: f.descripcion,
        cantidad_detectada: f.cantidad,
        product_id: match ? match.id : null,
        producto_codigo: match ? match.codigo : null,
        producto_nombre: match ? match.nombre : null,
      };
    });
    // Se devuelve también el texto crudo del OCR: si no detectó ninguna fila
    // (o las detectó mal), el frontend lo muestra para poder ver qué leyó
    // realmente el sistema en esa foto y agregar las filas a mano.
    res.json({ filas, texto: resultado.texto });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo analizar la foto de la guía.' });
  }
});

// POST /api/movements/analizar-guia-archivo (multipart, campo "file") -> lee
// el XML (SUNAT/UBL) o PDF con texto embebido de la guía, SIN usar OCR: es la
// misma lectura estructurada que ya usa "Registrar Compra", reutilizada acá
// para poder cargar el inventario directo cuando se tiene el archivo real de
// la guía (no una foto/captura de pantalla) — mucho más confiable que leer
// una tabla chica desde una imagen.
router.post('/analizar-guia-archivo', requireAccion('inventario', 'ajustes'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sube un archivo de guía (XML o PDF).' });
  const nombreArchivo = (req.file.originalname || '').toLowerCase();
  const esXml = nombreArchivo.endsWith('.xml') || req.file.mimetype === 'text/xml' || req.file.mimetype === 'application/xml';
  const esPdf = nombreArchivo.endsWith('.pdf') || req.file.mimetype === 'application/pdf';

  let resultado;
  if (esXml) {
    resultado = await parseGuiaXml(req.file.buffer);
  } else if (esPdf) {
    resultado = await parseGuiaPdf(req.file.buffer);
  } else {
    return res.status(400).json({
      error: 'Formato no soportado. Sube el XML de la guía o un PDF con texto (no una foto/escaneo).',
    });
  }
  if (resultado.error) return res.status(422).json({ error: resultado.error });

  const productos = db.prepare("SELECT id, codigo, nombre, codigo_barras FROM products WHERE tipo = 'producto'").all();
  const filas = (resultado.items || []).map((it) => {
    let match = null;
    if (it.codigo) {
      match = productos.find((p) => p.codigo === it.codigo || p.codigo_barras === it.codigo);
    }
    if (!match) match = mejorProductoParaDescripcion(it.descripcion, productos);
    return {
      descripcion_detectada: it.descripcion,
      cantidad_detectada: it.cantidad,
      product_id: match ? match.id : null,
      producto_codigo: match ? match.codigo : null,
      producto_nombre: match ? match.nombre : null,
    };
  });

  res.json({
    filas,
    fuente: resultado.fuente,
    advertencia: resultado.advertencia || null,
    proveedor: resultado.razon_social || null,
    guia: resultado.guia_serie && resultado.guia_numero ? `${resultado.guia_serie}-${resultado.guia_numero}` : null,
  });
});

module.exports = router;
