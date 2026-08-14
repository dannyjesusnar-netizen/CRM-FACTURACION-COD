const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { incrementarStock, ajustarStockSucursal, getStockSucursal, round2 } = require('../utils/stock');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { parseGuiaXml, parseGuiaPdf } = require('../utils/guiaParser');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(requireAuth);
router.use(requirePermiso('compras'));
router.use(resolveSucursal);

function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Empareja cada ítem leído de la guía con un producto ya existente (por
// código o por coincidencia de nombre), para dejar el combo pre-seleccionado
// en el formulario. Si no encuentra nada, el usuario lo elige a mano.
function emparejarProductos(items) {
  const productos = db.prepare("SELECT id, nombre, codigo, codigo_barras FROM products WHERE tipo = 'producto'").all();
  return items.map((it) => {
    let match = null;
    if (it.codigo) {
      match = productos.find((p) => p.codigo === it.codigo || p.codigo_barras === it.codigo);
    }
    if (!match && it.descripcion) {
      const desc = normalizar(it.descripcion);
      match = productos.find((p) => {
        const nombre = normalizar(p.nombre);
        return nombre === desc || nombre.includes(desc) || desc.includes(nombre);
      });
    }
    return { ...it, product_id: match ? match.id : null };
  });
}

// POST /api/purchases/parse-guia — sube la guía (XML SUNAT o PDF con texto)
// que entregó el proveedor y devuelve proveedor/serie-número/ítems para
// autocompletar el formulario de Registrar Compra. No consulta nada externo.
router.post('/parse-guia', requireAccion('compras', 'registrar_compra'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sube un archivo de guía (XML o PDF).' });
  const nombre = (req.file.originalname || '').toLowerCase();
  const esXml = nombre.endsWith('.xml') || req.file.mimetype === 'text/xml' || req.file.mimetype === 'application/xml';
  const esPdf = nombre.endsWith('.pdf') || req.file.mimetype === 'application/pdf';

  let resultado;
  if (esXml) {
    resultado = await parseGuiaXml(req.file.buffer);
  } else if (esPdf) {
    resultado = await parseGuiaPdf(req.file.buffer);
  } else {
    return res.status(400).json({
      error: 'Formato no soportado todavía. Sube el XML de la guía o un PDF con texto (no una foto/escaneo).',
    });
  }
  if (resultado.error) return res.status(422).json({ error: resultado.error });

  const supplier = resultado.ruc ? db.prepare('SELECT * FROM suppliers WHERE ruc = ?').get(resultado.ruc) : null;
  const items = emparejarProductos(resultado.items || []);

  res.json({
    fuente: resultado.fuente,
    advertencia: resultado.advertencia || null,
    ruc: resultado.ruc,
    razon_social: resultado.razon_social,
    guia_serie: resultado.guia_serie,
    guia_numero: resultado.guia_numero,
    supplier_id: supplier ? supplier.id : null,
    supplier_encontrado: !!supplier,
    items,
  });
});

const FORMAS_PAGO = ['efectivo', 'tarjeta', 'banco'];
const TIPOS_COMPROBANTE = ['factura', 'boleta', 'ticket', 'recibo_honorarios', 'otros'];
const MONEDAS = ['PEN', 'USD'];
const TIPOS_OPERACION = ['gravada_exportacion', 'no_gravada', 'sin_derecho_credito', 'no_gravado'];
const AFECTACIONES_IGV = ['gravado', 'exonerado', 'inafecto'];

function igvRate() {
  const row = db.prepare('SELECT igv_rate FROM empresa_config WHERE id = 1').get();
  return Number(row?.igv_rate) || 0.18;
}

function nextNumero() {
  const row = db.prepare('SELECT MAX(numero) AS maxNum FROM purchases').get();
  return (row.maxNum || 0) + 1;
}

// GET /api/purchases?estado=&supplier_id=&from=&to=&q=
router.get('/', (req, res) => {
  const { estado, supplier_id, from, to, q } = req.query;
  let sql = `
    SELECT p.*, s.nombre AS proveedor_nombre, s.ruc AS proveedor_ruc,
           u.full_name AS usuario_nombre, suc.nombre AS sucursal_nombre
    FROM purchases p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN sucursales suc ON suc.id = p.sucursal_id
    WHERE p.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
  if (supplier_id) { sql += ' AND p.supplier_id = ?'; params.push(supplier_id); }
  if (from) { sql += ' AND date(p.fecha) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(p.fecha) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (s.nombre LIKE ? OR s.ruc LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY p.fecha DESC, p.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const purchase = db.prepare(
    `SELECT p.*, s.nombre AS proveedor_nombre, s.ruc AS proveedor_ruc
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ? AND p.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada.' });
  const items = db.prepare(
    `SELECT pi.*, pr.nombre AS producto_nombre, pr.codigo AS producto_codigo
     FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ?`
  ).all(req.params.id);
  res.json({ ...purchase, items });
});

router.post('/', requireAccion('compras', 'registrar_compra'), (req, res) => {
  const {
    supplier_id, items, fecha, forma_pago, observaciones,
    tipo_comprobante, serie, numero_doc, moneda, tipo_cambio,
    tipo_compra, tipo_operacion, descuento_pct, percepcion,
    guia_serie, guia_numero,
  } = req.body || {};

  if (!supplier_id) return res.status(400).json({ error: 'Selecciona un proveedor.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  if (forma_pago && !FORMAS_PAGO.includes(forma_pago)) {
    return res.status(400).json({ error: 'forma_pago invalida. Use efectivo, tarjeta o banco.' });
  }
  if (!tipo_comprobante || !TIPOS_COMPROBANTE.includes(tipo_comprobante)) {
    return res.status(400).json({ error: 'Selecciona el tipo de documento.' });
  }
  if (!serie) return res.status(400).json({ error: 'La serie del documento es requerida.' });
  if (!numero_doc) return res.status(400).json({ error: 'El número del documento es requerido.' });
  if (!fecha) return res.status(400).json({ error: 'La fecha de emisión es requerida.' });
  if ((guia_serie && !guia_numero) || (!guia_serie && guia_numero)) {
    return res.status(400).json({ error: 'Completa la serie y el número de la guía de remisión, o deja ambos vacíos.' });
  }
  if (!moneda || !MONEDAS.includes(moneda)) {
    return res.status(400).json({ error: 'Selecciona la moneda.' });
  }
  const tipoCambio = moneda === 'USD' ? Number(tipo_cambio || 0) : 1;
  if (moneda === 'USD' && tipoCambio <= 0) {
    return res.status(400).json({ error: 'Ingresa un tipo de cambio válido.' });
  }
  if (!tipo_compra || !db.prepare('SELECT 1 FROM tipos_compra WHERE nombre = ? AND activo = 1').get(tipo_compra)) {
    return res.status(400).json({ error: 'Selecciona el tipo de compra.' });
  }
  if (!tipo_operacion || !TIPOS_OPERACION.includes(tipo_operacion)) {
    return res.status(400).json({ error: 'Selecciona el destino de la operación (Compra).' });
  }
  const descuentoPct = Number(descuento_pct || 0);
  if (descuentoPct < 0 || descuentoPct > 100) {
    return res.status(400).json({ error: 'El descuento debe estar entre 0 y 100%.' });
  }
  const percepcionMonto = round2(Number(percepcion || 0));
  if (percepcionMonto < 0) return res.status(400).json({ error: 'La percepción no puede ser negativa.' });

  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
  if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado.' });

  const rate = igvRate();
  let subtotalGravado = 0;
  let igvTotal = 0;
  let noGravado = 0;
  const preparedItems = [];
  for (const it of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) return res.status(404).json({ error: `Producto ${it.product_id} no encontrado.` });
    if (product.tipo !== 'producto' || product.stock === null) {
      return res.status(400).json({ error: `${product.nombre} es un servicio y no maneja stock.` });
    }
    const cantidad = Number(it.cantidad || 0);
    const costo_unitario = Number(it.costo_unitario || 0);
    if (cantidad <= 0) return res.status(400).json({ error: 'La cantidad de cada item debe ser mayor a 0.' });
    const afectacion_igv = AFECTACIONES_IGV.includes(it.afectacion_igv) ? it.afectacion_igv : 'gravado';
    const unidad = (it.unidad || 'UND').toString().slice(0, 20);

    const lineBruta = round2(cantidad * costo_unitario);
    const lineNeta = round2(lineBruta * (1 - descuentoPct / 100));
    if (afectacion_igv === 'gravado') {
      const igvLinea = round2(lineNeta - lineNeta / (1 + rate));
      subtotalGravado += lineNeta - igvLinea;
      igvTotal += igvLinea;
    } else {
      noGravado += lineNeta;
    }

    preparedItems.push({
      product_id: product.id, cantidad, costo_unitario, subtotal: lineBruta,
      observacion: it.observacion || null, unidad, afectacion_igv,
    });
  }

  subtotalGravado = round2(subtotalGravado);
  igvTotal = round2(igvTotal);
  noGravado = round2(noGravado);
  const total = round2(subtotalGravado + igvTotal + noGravado + percepcionMonto);

  const insertAll = db.transaction(() => {
    const numero = nextNumero();
    const info = db.prepare(
      `INSERT INTO purchases (
         numero, supplier_id, created_by, fecha, forma_pago, subtotal, igv, total, estado, observaciones, sucursal_id,
         tipo_comprobante, serie, numero_doc, moneda, tipo_cambio, tipo_compra, tipo_operacion, descuento_pct, percepcion, no_gravado,
         guia_serie, guia_numero
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'registrada', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      numero,
      supplier_id,
      req.user?.id || null,
      fecha || new Date().toISOString().slice(0, 10),
      forma_pago || 'efectivo',
      subtotalGravado,
      igvTotal,
      total,
      observaciones || null,
      req.sucursalId,
      tipo_comprobante,
      serie,
      numero_doc,
      moneda,
      tipoCambio,
      tipo_compra,
      tipo_operacion,
      descuentoPct,
      percepcionMonto,
      noGravado,
      guia_serie || null,
      guia_numero || null
    );
    const purchaseId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO purchase_items (purchase_id, product_id, cantidad, costo_unitario, subtotal, observacion, unidad, afectacion_igv)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const referencia = `COMPRA-${String(numero).padStart(5, '0')}`;

    for (const it of preparedItems) {
      insertItem.run(
        purchaseId, it.product_id, it.cantidad, it.costo_unitario, it.subtotal,
        it.observacion, it.unidad, it.afectacion_igv
      );
      incrementarStock(it.product_id, it.cantidad, {
        tipoMovimiento: 'compra',
        motivo: `Compra a ${supplier.nombre}`,
        referencia,
        userId: req.user?.id,
        sucursalId: req.sucursalId,
      });
    }
    return purchaseId;
  });

  const purchaseId = insertAll();
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
  const purchaseItems = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchaseId);
  res.status(201).json({ ...purchase, items: purchaseItems });
});

router.post('/:id/anular', requireAccion('compras', 'anular_compra'), (req, res) => {
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!purchase) return res.status(404).json({ error: 'Compra no encontrada.' });
  if (purchase.estado === 'anulada') {
    return res.status(400).json({ error: 'La compra ya esta anulada.' });
  }
  const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(req.params.id);
  // Se acumula por producto (no línea por línea) porque una compra puede
  // tener el mismo producto en más de un ítem — validar cada línea contra la
  // misma lectura de stock sin acumular permite vaciar el stock por debajo
  // de cero. Se valida contra el stock de ESTA sede (no el agregado de todas
  // las sedes): si parte de esta compra ya fue trasladada a otra sede, el
  // agregado puede alcanzar aunque esta sede específica ya no tenga nada.
  const requeridoPorProducto = new Map();
  for (const it of items) {
    requeridoPorProducto.set(it.product_id, (requeridoPorProducto.get(it.product_id) || 0) + it.cantidad);
  }
  for (const [productId, cantidadRequerida] of requeridoPorProducto) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) continue;
    const disponibleSede = getStockSucursal(productId, purchase.sucursal_id);
    if (disponibleSede < cantidadRequerida) {
      return res.status(409).json({
        error: `No se puede anular: ${product.nombre} ya no tiene stock suficiente en esta sede (parte de esta compra ya fue vendida o trasladada).`,
      });
    }
  }
  const referencia = `COMPRA-${String(purchase.numero).padStart(5, '0')}`;
  db.transaction(() => {
    db.prepare("UPDATE purchases SET estado = 'anulada' WHERE id = ?").run(req.params.id);
    for (const it of items) {
      incrementarStock(it.product_id, -it.cantidad, {
        tipoMovimiento: 'anulacion_compra',
        motivo: 'Anulación de compra',
        referencia,
        userId: req.user?.id,
        sucursalId: purchase.sucursal_id,
      });
    }
  })();
  const updated = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
