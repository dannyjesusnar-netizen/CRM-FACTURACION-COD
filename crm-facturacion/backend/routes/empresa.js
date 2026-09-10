const express = require('express');
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { buildInvoicePdf } = require('../utils/pdf');
const backup = require('../utils/backup');
const backblaze = require('../utils/backblaze');
const { hoyPeru } = require('../utils/fechas');
const { crearVerificadorHistorial } = require('../utils/inventarioSede');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const config = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  res.json(config);
});

const LOGO_MAX_BYTES = 1.5 * 1024 * 1024; // ~1.5MB en base64
const TAMANOS_PDF = ['A4', 'ticket_80mm'];

router.put('/', requireGerencia, (req, res) => {
  const {
    razon_social, ruc, nombre_comercial, direccion_fiscal, telefono, email,
    actividad_ciiu, actividad_mcc, departamento, provincia, distrito, logo_data_url,
    color_acento, mostrar_logo_pdf, mostrar_datos_contacto_pdf, tamano_pdf, terminos_condiciones_pdf,
    color_tablero_ventas,
  } = req.body || {};
  if (!razon_social || !ruc) {
    return res.status(400).json({ error: 'Razón social y RUC son requeridos.' });
  }
  if (!/^\d{11}$/.test(ruc)) {
    return res.status(400).json({ error: 'El RUC debe tener 11 dígitos.' });
  }
  if (logo_data_url && logo_data_url.length > LOGO_MAX_BYTES) {
    return res.status(400).json({ error: 'El logo es demasiado grande. Usa una imagen más liviana (máximo ~1MB).' });
  }
  if (color_acento && !/^#[0-9a-fA-F]{6}$/.test(color_acento)) {
    return res.status(400).json({ error: 'color_acento debe ser un color hexadecimal (ej. #0f4c81).' });
  }
  if (color_tablero_ventas && !/^#[0-9a-fA-F]{6}$/.test(color_tablero_ventas)) {
    return res.status(400).json({ error: 'color_tablero_ventas debe ser un color hexadecimal (ej. #16a34a).' });
  }
  if (tamano_pdf && !TAMANOS_PDF.includes(tamano_pdf)) {
    return res.status(400).json({ error: 'tamano_pdf inválido. Use A4 o ticket_80mm.' });
  }
  const existing = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  db.prepare(
    `UPDATE empresa_config SET razon_social = ?, ruc = ?, nombre_comercial = ?, direccion_fiscal = ?,
     telefono = ?, email = ?, actividad_ciiu = ?, actividad_mcc = ?, departamento = ?, provincia = ?, distrito = ?,
     logo_data_url = ?, color_acento = ?, mostrar_logo_pdf = ?, mostrar_datos_contacto_pdf = ?, tamano_pdf = ?,
     terminos_condiciones_pdf = ?, color_tablero_ventas = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1`
  ).run(
    razon_social,
    ruc,
    nombre_comercial || razon_social,
    direccion_fiscal || null,
    telefono || null,
    email || null,
    actividad_ciiu || null,
    actividad_mcc || null,
    departamento || null,
    provincia || null,
    distrito || null,
    logo_data_url !== undefined ? (logo_data_url || null) : existing?.logo_data_url || null,
    color_acento || existing?.color_acento || '#0f4c81',
    mostrar_logo_pdf !== undefined ? (mostrar_logo_pdf ? 1 : 0) : existing?.mostrar_logo_pdf ?? 1,
    mostrar_datos_contacto_pdf !== undefined ? (mostrar_datos_contacto_pdf ? 1 : 0) : existing?.mostrar_datos_contacto_pdf ?? 1,
    tamano_pdf || existing?.tamano_pdf || 'A4',
    terminos_condiciones_pdf !== undefined ? (terminos_condiciones_pdf || null) : existing?.terminos_condiciones_pdf || null,
    color_tablero_ventas || existing?.color_tablero_ventas || '#16a34a',
    req.user?.id || null
  );
  // Si esta sesión es de la instalación base (no de una empresa que ya se
  // auto-registró), su RUC recién configurado la da de alta en el registro
  // de la plataforma como un cliente más — ver tenantRegistry.js.
  if (!req.user?.ruc) {
    tenantRegistry.adoptarInstanciaBase({ ruc, razon_social: nombre_comercial || razon_social });
  }
  res.json(db.prepare('SELECT * FROM empresa_config WHERE id = 1').get());
});

// PUT /api/empresa/direccion { direccion_fiscal } -> edición rápida de la
// dirección principal, sin tener que reenviar todo el formulario de Datos
// de la empresa (razón social, RUC, etc.).
router.put('/direccion', requireGerencia, (req, res) => {
  const { direccion_fiscal } = req.body || {};
  if (!direccion_fiscal || !direccion_fiscal.trim()) {
    return res.status(400).json({ error: 'La dirección es requerida.' });
  }
  db.prepare(
    `UPDATE empresa_config SET direccion_fiscal = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1`
  ).run(direccion_fiscal.trim(), req.user?.id || null);
  res.json(db.prepare('SELECT * FROM empresa_config WHERE id = 1').get());
});

// PUT /api/empresa/igv-rate { igv_rate_pct } -> tasa de IGV en porcentaje
// (ej. 18 para 18%), se guarda internamente como fracción (0.18).
router.put('/igv-rate', requireGerencia, (req, res) => {
  const pct = Number(req.body?.igv_rate_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
    return res.status(400).json({ error: 'La tasa de IGV debe ser un porcentaje entre 0 y 30.' });
  }
  const igv_rate = Math.round(pct * 100) / 10000;
  db.prepare(
    `UPDATE empresa_config SET igv_rate = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1`
  ).run(igv_rate, req.user?.id || null);
  res.json(db.prepare('SELECT * FROM empresa_config WHERE id = 1').get());
});

// GET /api/empresa/comprobante-preview -> PDF de ejemplo con los datos/ajustes actuales,
// para previsualizar cómo se ve un comprobante real sin necesidad de emitir uno.
router.get('/comprobante-preview', requireGerencia, async (req, res) => {
  const primeraSucursal = db.prepare('SELECT nombre, direccion FROM sucursales ORDER BY es_principal DESC, id ASC LIMIT 1').get();
  const sampleInvoice = {
    tipo_comprobante: 'factura',
    serie: 'F001',
    numero: 1,
    fecha_emision: hoyPeru(),
    moneda: 'PEN',
    estado: 'emitido',
    forma_pago: 'efectivo',
    monto_pagado: 179.80,
    modo_emision: 'simulado',
    sunat_estado: null,
    sunat_hash: null,
    sunat_mensaje: null,
    cliente_nombre: 'CLIENTE DE EJEMPLO S.A.C.',
    cliente_tipo_documento: 'RUC',
    cliente_documento: '20123456789',
    cliente_direccion: 'Av. Ejemplo 123, Miraflores, Lima',
    cliente_telefono: '987 654 321',
    cliente_referencia: 'Cerca al parque, edificio azul',
    cliente_contacto: 'Ana Torres',
    vendedor_nombre: req.user?.full_name || 'Vendedor de ejemplo',
    sucursal_nombre: primeraSucursal?.nombre || null,
    sucursal_direccion: primeraSucursal?.direccion || null,
    subtotal: 152.37,
    igv: 27.43,
    total: 179.80,
    observaciones: 'Comprobante de ejemplo — solo para previsualizar el diseño.',
  };
  const sampleItems = [
    { descripcion: 'Producto de ejemplo A', cantidad: 2, unidad: 'NIU', codigo: 'P001', precio_unitario: 45.9, descuento_pct: 0, subtotal: 91.8 },
    { descripcion: 'Producto de ejemplo B', cantidad: 1, unidad: 'NIU', codigo: 'P002', precio_unitario: 87.99, descuento_pct: 5, subtotal: 87.99 },
  ];
  let doc;
  try {
    doc = await buildInvoicePdf(sampleInvoice, sampleItems, []);
  } catch (err) {
    console.error('Error generando la vista previa de diseño del comprobante:', err);
    return res.status(500).json({ error: 'No se pudo generar la vista previa del comprobante.' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="vista-previa-comprobante.pdf"');
  doc.pipe(res);
  doc.end();
});

// POST /api/empresa/borrar-datos-prueba -> vacía todas las tablas
// transaccionales/de ejemplo (ventas, clientes, productos, compras, caja,
// etc.) para dejar la instancia lista para operar con datos reales. NO
// toca usuarios, sedes, catálogos base (métodos de pago, tipos de compra,
// descuentos, canales de movimiento, roles/permisos) ni empresa_config —
// solo resetea el correlativo de cada serie de documento a 1. Requiere
// confirmar explícitamente el texto "BORRAR" además de ser Gerencia, por
// tratarse de una operación irreversible.
const TABLAS_DATOS_TRANSACCIONALES = [
  'invoice_item_lotes', 'invoice_items', 'cobros',
  'nota_venta_cobros', 'nota_venta_items', 'notas_venta',
  'invoices', 'stock_movements', 'lotes',
  'caja_saldos_iniciales', 'caja_movimientos', 'caja_turnos',
  'solicitudes_sede', 'sucursal_stock',
  'traslado_items', 'traslados',
  'receta_items', 'recetas', 'producciones', 'equivalencias',
  'purchase_items', 'purchases', 'purchase_order_items', 'purchase_orders', 'suppliers',
  'cotizacion_items', 'cotizaciones',
  'guia_items', 'guias_remitentes',
  'mensajes_soporte', 'pagos_qr',
  'promocion_items', 'promociones',
  'metas_venta_sede',
  'clients', 'products',
];

router.post('/borrar-datos-prueba', requireGerencia, (req, res) => {
  if (req.body?.confirmar !== 'BORRAR') {
    return res.status(400).json({ error: 'Confirmación requerida. Envía { "confirmar": "BORRAR" } para continuar.' });
  }
  const borrarTodo = db.transaction(() => {
    for (const tabla of TABLAS_DATOS_TRANSACCIONALES) {
      db.prepare(`DELETE FROM ${tabla}`).run();
    }
    db.prepare('UPDATE series_config SET siguiente_numero = 1').run();
    // "CLIENTES VARIOS" es el cliente genérico universal para ventas sin
    // datos de cliente — initSchema lo siembra siempre, se repone acá igual.
    db.prepare('INSERT INTO clients (tipo_documento, numero_documento, nombre) VALUES (?, ?, ?)')
      .run('DNI', '10000000', 'CLIENTES VARIOS');
  });
  db.pragma('foreign_keys = OFF');
  try {
    borrarTodo();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  res.json({ ok: true });
});

// GET /api/empresa/inventario-sede-preview?sucursal_id= -> de solo lectura,
// no borra ni modifica nada. Para cada producto con stock/movimiento en esa
// sede, dice si "Borrar inventario de sede" lo eliminaría del catálogo o
// solo le resetearía el stock — y en ese segundo caso, el o los motivos
// exactos por los que se conserva. Usa la misma lógica (crearVerificadorHistorial)
// que el borrado real, así que el reporte coincide 100% con lo que pasaría.
// Pensado para revisar antes de confirmar el borrado, o para explicar
// después por qué un producto puntual no desapareció.
router.get('/inventario-sede-preview', requireGerencia, (req, res) => {
  const sucursalId = Number(req.query.sucursal_id);
  const sucursal = sucursalId ? db.prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(sucursalId) : null;
  if (!sucursal) return res.status(404).json({ error: 'Selecciona una sede válida.' });

  const motivosDeConservacion = crearVerificadorHistorial(db);
  const filas = db.prepare(
    `SELECT ss.product_id, ss.stock AS stock_en_sede, p.codigo, p.nombre, p.stock AS stock_global
     FROM sucursal_stock ss JOIN products p ON p.id = ss.product_id
     WHERE ss.sucursal_id = ? ORDER BY p.codigo`
  ).all(sucursalId);

  const detalle = filas.map((f) => {
    const motivos = motivosDeConservacion(f.product_id, sucursalId);
    return {
      codigo: f.codigo,
      nombre: f.nombre,
      stock_en_sede: f.stock_en_sede,
      stock_global: f.stock_global,
      accion: motivos.length === 0 ? 'eliminar' : 'conservar',
      motivos,
    };
  });

  res.json({
    sede: sucursal.nombre,
    total: detalle.length,
    a_eliminar: detalle.filter((d) => d.accion === 'eliminar').length,
    a_conservar: detalle.filter((d) => d.accion === 'conservar').length,
    detalle,
  });
});

// POST /api/empresa/borrar-inventario-sede -> a diferencia de
// borrar-datos-prueba (que vacía TODA la instancia), esto borra el
// inventario de UNA sede puntual — pensado para limpiar lo que se cargó de
// prueba durante una migración (carga masiva + pruebas) antes de meter el
// archivo real con todo el historial definitivo, sin tocar otras sedes.
//
// Por cada producto con stock/movimiento en esa sede:
//   - Si el producto NO tiene ningún rastro fuera de esta sede (ni stock ni
//     movimientos en otra sede) NI historial real en ningún lado (venta,
//     compra, orden de compra, cotización, guía, traslado, receta o
//     promoción) — típicamente un producto cargado de prueba y nunca
//     usado de verdad — se BORRA POR COMPLETO del catálogo (producto,
//     lotes, equivalencias, alias de guía, stock y movimientos).
//   - Si el producto sí está compartido con otra sede o tiene cualquier
//     historial real, se conserva en el catálogo (para no romper esas
//     otras referencias) y solo se le resetea a 0 el stock/kardex de ESTA
//     sede.
// Requiere confirmar el texto "BORRAR", igual que borrar-datos-prueba.
//
// IMPORTANTE sobre la fila de sucursal_stock cuando el producto se
// conserva: se deja en 0 (nunca se borra la fila) porque un backfill que
// corre en cada arranque del servidor (ver db.js: "todo producto sin fila
// en sucursal_stock para la sede PRINCIPAL recibe su stock agregado
// actual") la recrearía sola en el próximo reinicio usando el stock de las
// OTRAS sedes, deshaciendo el reset silenciosamente si la sede borrada es
// la principal.
router.post('/borrar-inventario-sede', requireGerencia, (req, res) => {
  if (req.body?.confirmar !== 'BORRAR') {
    return res.status(400).json({ error: 'Confirmación requerida. Envía { "confirmar": "BORRAR" } para continuar.' });
  }
  const sucursalId = Number(req.body?.sucursal_id);
  const sucursal = sucursalId ? db.prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(sucursalId) : null;
  if (!sucursal) return res.status(404).json({ error: 'Selecciona una sede válida.' });

  const motivosDeConservacion = crearVerificadorHistorial(db);
  function esExclusivoYSinHistorial(productId) {
    return motivosDeConservacion(productId, sucursalId).length === 0;
  }

  const borrarInvoiceItemLotesDeLotes = db.prepare('DELETE FROM invoice_item_lotes WHERE lote_id IN (SELECT id FROM lotes WHERE product_id = ?)');
  const borrarLotesProducto = db.prepare('DELETE FROM lotes WHERE product_id = ?');
  const borrarEquivalenciasProducto = db.prepare('DELETE FROM equivalencias WHERE product_id = ?');
  const borrarAliasProducto = db.prepare('DELETE FROM product_aliases WHERE product_id = ?');
  const borrarMovimientosProducto = db.prepare('DELETE FROM stock_movements WHERE product_id = ?');
  const borrarStockProducto = db.prepare('DELETE FROM sucursal_stock WHERE product_id = ?');
  const borrarProducto = db.prepare('DELETE FROM products WHERE id = ?');
  const borrarMovimientosSede = db.prepare('DELETE FROM stock_movements WHERE product_id = ? AND sucursal_id = ?');
  const resetearStockSede = db.prepare('UPDATE sucursal_stock SET stock = 0 WHERE product_id = ? AND sucursal_id = ?');
  const reducirStockGlobal = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?');

  const resultado = db.transaction(() => {
    const filas = db.prepare('SELECT product_id, stock FROM sucursal_stock WHERE sucursal_id = ?').all(sucursalId);
    let productosEliminados = 0;
    let productosSoloReseteados = 0;
    let movimientosBorrados = 0;

    for (const f of filas) {
      if (esExclusivoYSinHistorial(f.product_id)) {
        borrarInvoiceItemLotesDeLotes.run(f.product_id);
        borrarLotesProducto.run(f.product_id);
        borrarEquivalenciasProducto.run(f.product_id);
        borrarAliasProducto.run(f.product_id);
        movimientosBorrados += borrarMovimientosProducto.run(f.product_id).changes;
        borrarStockProducto.run(f.product_id);
        borrarProducto.run(f.product_id);
        productosEliminados += 1;
      } else {
        if (f.stock !== 0) reducirStockGlobal.run(f.stock, f.product_id);
        movimientosBorrados += borrarMovimientosSede.run(f.product_id, sucursalId).changes;
        resetearStockSede.run(f.product_id, sucursalId);
        productosSoloReseteados += 1;
      }
    }
    return { productos_eliminados: productosEliminados, productos_solo_reseteados: productosSoloReseteados, movimientos_borrados: movimientosBorrados };
  })();

  res.json({ ok: true, sede: sucursal.nombre, ...resultado });
});

// Respaldos de la base de datos: además del respaldo automático diario (ver
// server.js), Gerencia puede crear uno al instante y descargar cualquiera de
// los últimos 7 guardados — todo dentro del mismo disco persistente. Todas
// las empresas de esta instancia comparten la misma carpeta de respaldos,
// así que cada operación se acota al nombreBase de la empresa actual (ver
// utils/backup.js) para que Gerencia de una empresa nunca vea ni pueda
// descargar el respaldo de otra.
router.get('/respaldos', requireGerencia, (req, res) => {
  res.json(backup.listarRespaldos(backup.nombreBaseDe(db.currentDb())));
});

// Le dice al frontend si, además del respaldo local, cada copia también se
// sube automáticamente a Backblaze B2 (ver utils/backblaze.js). Se activa
// solo configurando variables de entorno — no hay nada que guardar en la BD.
router.get('/respaldos-nube', requireGerencia, (req, res) => {
  res.json({ configurado: backblaze.estaConfigurado() });
});

router.post('/respaldos', requireGerencia, async (req, res) => {
  try {
    const nombre = await backup.crearRespaldo(db.currentDb());
    res.status(201).json({ nombre });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo crear el respaldo.' });
  }
});

router.get('/respaldos/:nombre/descargar', requireGerencia, (req, res) => {
  const ruta = backup.rutaRespaldo(req.params.nombre, backup.nombreBaseDe(db.currentDb()));
  if (!ruta) return res.status(404).json({ error: 'Respaldo no encontrado.' });
  res.download(ruta, req.params.nombre);
});

module.exports = router;
