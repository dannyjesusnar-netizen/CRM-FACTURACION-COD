const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { buildInvoicePdf } = require('../utils/pdf');
const { consumirStock, incrementarStock, ajustarStockSucursal, StockInsuficienteError } = require('../utils/stock');
const { emitirComprobante, estaConfigurado } = require('../utils/facturacionElectronica');
const { requirePermiso, requireAccion, requireAlgunPermiso, tieneAccion, tienePermiso } = require('../utils/permisos');
const { siguienteNumero } = require('../utils/series');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);

// Tipos de comprobante que este router emite (deben existir en series_config).
const TIPOS_COMPROBANTE = ['factura', 'boleta', 'nota_credito'];

function igvRate() {
  const row = db.prepare('SELECT igv_rate FROM empresa_config WHERE id = 1').get();
  return Number(row?.igv_rate) || 0.18;
}

// Tipos de Nota de Crédito que revierten una entrega física de mercadería
// (por eso devuelven stock); el resto son ajustes puramente financieros y
// no mueven inventario (descuentos, corrección de descripción, etc.).
const TIPOS_NOTA_DEVUELVEN_STOCK = ['anulacion_operacion', 'anulacion_error_ruc', 'devolucion_total', 'devolucion_item'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Cuentas por cobrar es visible tanto desde Ventas como desde Caja y Bancos
// (pantalla "Cuentas por Cobrar" enlazada desde ambas), así que estos tres
// endpoints se registran ANTES del candado general `requirePermiso('ventas')`
// de más abajo: alcanza con tener el módulo Caja habilitado, o el desglose
// existente por acción dentro de Ventas (para no perder esa granularidad).
function requireVerCuentasPorCobrar(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
  if (tienePermiso(req.user, 'caja') || tieneAccion(req.user, 'ventas', 'cuentas_por_cobrar')) return next();
  return res.status(403).json({ error: 'No tienes permiso para ver cuentas por cobrar.' });
}
function requireRegistrarCobro(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autenticado.' });
  if (tienePermiso(req.user, 'caja') || tieneAccion(req.user, 'ventas', 'registrar_cobro')) return next();
  return res.status(403).json({ error: 'No tienes permiso para registrar cobros.' });
}

// GET /api/invoices/deudas -> ventas "abonado" con saldo pendiente (cuentas por cobrar)
router.get('/deudas', requireVerCuentasPorCobrar, (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.tipo_comprobante, i.serie, i.numero, i.fecha_emision, i.total, i.monto_pagado,
           (i.total - i.monto_pagado) AS saldo,
           c.id AS client_id, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
           c.tipo_documento AS cliente_tipo_documento, c.telefono AS cliente_telefono
    FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE i.sucursal_id = ? AND i.forma_pago = 'abonado' AND i.estado = 'emitido'
      AND (i.total - i.monto_pagado) > 0.005
    ORDER BY i.fecha_emision ASC, i.id ASC
  `).all(req.sucursalId);
  res.json(rows.map((r) => ({ ...r, saldo: round2(r.saldo) })));
});

// GET /api/invoices/:id/cobros -> historial de abonos/cobros de una venta "abonado"
router.get('/:id/cobros', requireVerCuentasPorCobrar, (req, res) => {
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  const rows = db.prepare(
    `SELECT co.*, u.full_name AS usuario_nombre FROM cobros co
     LEFT JOIN users u ON u.id = co.created_by
     WHERE co.invoice_id = ? ORDER BY co.id DESC`
  ).all(req.params.id);
  res.json(rows);
});

// POST /api/invoices/:id/cobros { monto, medio, observacion } -> registra un cobro contra el saldo pendiente
router.post('/:id/cobros', requireRegistrarCobro, (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  if (invoice.forma_pago !== 'abonado') {
    return res.status(400).json({ error: 'Este comprobante no es una venta abonada.' });
  }
  if (invoice.estado !== 'emitido') {
    return res.status(400).json({ error: 'El comprobante está anulado.' });
  }
  const { monto, medio, observacion } = req.body || {};
  if (!esMetodoPagoValido(medio)) {
    return res.status(400).json({ error: 'Selecciona un método de pago válido.' });
  }
  const saldoActual = round2(invoice.total - invoice.monto_pagado);
  const montoNum = round2(Number(monto || 0));
  if (montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
  if (montoNum > saldoActual + 0.005) {
    return res.status(400).json({ error: `El monto no puede superar el saldo pendiente (S/ ${saldoActual.toFixed(2)}).` });
  }
  const client = db.prepare('SELECT nombre FROM clients WHERE id = ?').get(invoice.client_id);
  const referenciaComprobante = `${invoice.serie}-${String(invoice.numero).padStart(6, '0')}`;
  const hoy = new Date().toISOString().slice(0, 10);

  const registrar = db.transaction(() => {
    db.prepare('UPDATE invoices SET monto_pagado = monto_pagado + ? WHERE id = ?').run(montoNum, invoice.id);
    db.prepare(
      `INSERT INTO cobros (invoice_id, monto, medio, observacion, created_by) VALUES (?, ?, ?, ?, ?)`
    ).run(invoice.id, montoNum, medio, observacion || null, req.user?.id || null);
    db.prepare(
      `INSERT INTO caja_movimientos (fecha, tipo, medio, categoria, monto, descripcion, created_by, sucursal_id)
       VALUES (?, 'ingreso', ?, 'cuentas_cobrar', ?, ?, ?, ?)`
    ).run(hoy, medio, montoNum, `Cobro - ${referenciaComprobante} - ${client?.nombre || ''}`, req.user?.id || null, req.sucursalId);
  });
  registrar();

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  res.json({ ...updated, saldo: round2(updated.total - updated.monto_pagado) });
});

router.use(requirePermiso('ventas'));

// GET /api/invoices/siguiente-numero?tipo=factura -> { serie, numero } sugerido para el formulario
router.get('/siguiente-numero', (req, res) => {
  const tipo = req.query.tipo;
  if (!TIPOS_COMPROBANTE.includes(tipo)) return res.status(400).json({ error: 'tipo invalido.' });
  const sugerido = siguienteNumero(tipo, req.sucursalId);
  res.json(sugerido);
});

// GET /api/invoices/entrenadores — entrenadores activos de la sede actual,
// para el selector "Atribuir venta a" en RegistroVenta.jsx. Sin permiso de
// Gerencia (a diferencia de /api/users): cualquier vendedor que registra una
// venta debe poder ver esta lista, no solo administrar empleados.
router.get('/entrenadores', (req, res) => {
  const entrenadores = db.prepare(
    `SELECT id, full_name FROM users WHERE activo = 1 AND categoria_staff = 'trainer' AND sucursal_id = ?
     ORDER BY full_name ASC`
  ).all(req.sucursalId);
  res.json(entrenadores);
});

// GET /api/invoices/buscar?tipo=&serie=&numero= -> comprobante original (para Nota de Credito -> Recuperar)
router.get('/buscar', (req, res) => {
  const { tipo, serie, numero } = req.query;
  const invoice = db.prepare(
    `SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.tipo_comprobante = ? AND i.serie = ? AND i.numero = ?`
  ).get(tipo, serie, Number(numero));
  if (!invoice) return res.status(404).json({ error: 'No se encontró un comprobante con esos datos.' });
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoice.id);
  res.json({ ...invoice, items });
});

// GET /api/invoices?tipo=&estado=&client_id=&from=&to=&q=
router.get('/', (req, res) => {
  const { tipo, estado, client_id, from, to, q } = req.query;
  let sql = `
    SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
           u.full_name AS vendedor_nombre
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (tipo) { sql += ' AND i.tipo_comprobante = ?'; params.push(tipo); }
  if (estado) { sql += ' AND i.estado = ?'; params.push(estado); }
  if (client_id) { sql += ' AND i.client_id = ?'; params.push(client_id); }
  if (from) { sql += ' AND date(i.fecha_emision) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(i.fecha_emision) <= date(?)'; params.push(to); }
  if (q) {
    sql += ' AND (c.nombre LIKE ? OR c.numero_documento LIKE ? OR i.serie LIKE ? OR CAST(i.numero AS TEXT) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY i.fecha_emision DESC, i.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const invoice = db.prepare(
    `SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion
     FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ? AND i.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  res.json({ ...invoice, items });
});

const CLIENTE_GENERICO_DOCUMENTO = '10000000'; // "CLIENTES VARIOS", sembrado en db.js

// El único valor "especial" que no es un método de pago real (venta a
// crédito). Todo lo demás sale del catálogo dinámico de metodos_pago.
function esMetodoPagoValido(codigo) {
  if (!codigo) return false;
  return !!db.prepare('SELECT 1 FROM metodos_pago WHERE codigo = ? AND activo = 1').get(codigo);
}

router.post('/', async (req, res) => {
  const {
    tipo_comprobante, client_id, items, moneda, observaciones, fecha_emision, forma_pago,
    numero: numeroManual, descuento_global_pct,
    modifica_tipo, modifica_serie, modifica_numero, tipo_nota,
    monto_pagado: montoPagadoBody, medio_abono, pagos, atribuido_a_id,
  } = req.body || {};

  if (!['factura', 'boleta', 'nota_credito'].includes(tipo_comprobante)) {
    return res.status(400).json({ error: 'tipo_comprobante invalido. Use factura, boleta o nota_credito.' });
  }
  if (!tieneAccion(req.user, 'ventas', tipo_comprobante)) {
    return res.status(403).json({ error: 'No tienes permiso para emitir este tipo de comprobante.' });
  }
  if (!client_id) return res.status(400).json({ error: 'client_id es requerido.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }
  const esMixto = forma_pago === 'mixto';
  if (forma_pago && forma_pago !== 'abonado' && forma_pago !== 'mixto' && !esMetodoPagoValido(forma_pago)) {
    return res.status(400).json({ error: 'forma_pago invalida. Debe ser un método de pago activo, "abonado" o "mixto".' });
  }
  if (forma_pago === 'abonado' && !tieneAccion(req.user, 'ventas', 'abonado')) {
    return res.status(403).json({ error: 'No tienes permiso para registrar ventas abonadas.' });
  }
  // Pago mixto: la venta queda pagada por completo (no es crédito), solo que
  // repartida entre 2+ métodos reales (ej. S/ 50 en efectivo + el resto por
  // Yape) — cada uno se registra como su propio cobro/movimiento de caja.
  let pagosMixto = [];
  if (esMixto) {
    if (!Array.isArray(pagos) || pagos.length < 2) {
      return res.status(400).json({ error: 'Un pago mixto necesita al menos dos métodos de pago.' });
    }
    for (const p of pagos) {
      if (!esMetodoPagoValido(p?.medio)) {
        return res.status(400).json({ error: 'Uno de los métodos de pago del pago mixto no es válido.' });
      }
      if (!(Number(p.monto) > 0)) {
        return res.status(400).json({ error: 'Cada monto del pago mixto debe ser mayor a 0.' });
      }
    }
    pagosMixto = pagos.map((p) => ({ medio: p.medio, monto: round2(Number(p.monto)) }));
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });

  // atribuido_a_id: quien registra la venta puede elegir que cuente para un
  // entrenador de su misma sede en vez de para él mismo, solo para el
  // ranking del Tablero de Ventas (ver comentario de la columna en db.js).
  let atribuidoA = null;
  if (atribuido_a_id) {
    const entrenador = db.prepare(
      'SELECT id FROM users WHERE id = ? AND activo = 1 AND categoria_staff = ? AND sucursal_id = ?'
    ).get(atribuido_a_id, 'trainer', req.sucursalId);
    if (!entrenador) {
      return res.status(400).json({ error: 'El entrenador seleccionado no existe o no pertenece a esta sede.' });
    }
    atribuidoA = entrenador.id;
  }

  if (tipo_comprobante === 'factura' && client.tipo_documento !== 'RUC') {
    return res.status(400).json({ error: 'Para emitir factura el cliente debe tener RUC.' });
  }

  const esAbonado = forma_pago === 'abonado';
  if (esAbonado && client.numero_documento === CLIENTE_GENERICO_DOCUMENTO) {
    return res.status(400).json({ error: 'Para una venta abonada selecciona un cliente real — no puede quedar a nombre de "Clientes Varios".' });
  }
  let medioAbono = null;
  if (esAbonado && Number(montoPagadoBody || 0) > 0) {
    if (!esMetodoPagoValido(medio_abono)) {
      return res.status(400).json({ error: 'Selecciona un método de pago válido para el abono.' });
    }
    medioAbono = medio_abono;
  }

  const descuentoGlobalPct = Math.min(100, Math.max(0, Number(descuento_global_pct || 0)));

  const tasaIgv = igvRate();
  let totalBruto = 0;
  let igvBruto = 0;
  const preparedItems = items.map((it) => {
    const cantidad = Number(it.cantidad || 1);
    const precio_unitario = Number(it.precio_unitario || 0);
    const descuentoPct = Math.min(100, Math.max(0, Number(it.descuento_pct || 0)));
    const lineBruta = cantidad * precio_unitario;
    const lineNeta = round2(lineBruta - lineBruta * (descuentoPct / 100));

    const prod = it.product_id ? db.prepare('SELECT afectacion_igv FROM products WHERE id = ?').get(it.product_id) : null;
    const gravado = !prod || prod.afectacion_igv === 'gravado' || prod.afectacion_igv === 'gratuito';
    const subtotalLinea = gravado ? round2(lineNeta / (1 + tasaIgv)) : lineNeta;
    const igvLinea = gravado ? round2(lineNeta - subtotalLinea) : 0;

    totalBruto += lineNeta;
    igvBruto += igvLinea;

    return {
      product_id: it.product_id || null,
      descripcion: it.descripcion || '',
      cantidad,
      precio_unitario,
      descuento_pct: descuentoPct,
      subtotal: lineNeta,
      igv_item: igvLinea,
    };
  });

  totalBruto = round2(totalBruto);
  igvBruto = round2(igvBruto);
  const total = round2(totalBruto * (1 - descuentoGlobalPct / 100));
  const ratio = totalBruto > 0 ? total / totalBruto : 1;
  const igv = round2(igvBruto * ratio);
  const subtotal = round2(total - igv);

  if (esMixto) {
    const sumaPagos = round2(pagosMixto.reduce((s, p) => s + p.monto, 0));
    if (Math.abs(sumaPagos - total) > 0.01) {
      return res.status(400).json({ error: `La suma de los pagos (S/ ${sumaPagos.toFixed(2)}) debe ser igual al total (S/ ${total.toFixed(2)}).` });
    }
  }
  // Para efectivo/tarjeta/banco se asume pagado por completo (igual que
  // siempre). Para "abonado" es lo que el cliente entregó ahora (puede ser
  // 0 hasta el total) — el resto queda como saldo pendiente.
  const montoPagado = esAbonado ? Math.min(total, Math.max(0, round2(Number(montoPagadoBody || 0)))) : total;

  const { serie, numero: numeroSugerido } = siguienteNumero(tipo_comprobante, req.sucursalId);
  const fechaEmisionFinal = fecha_emision || new Date().toISOString().slice(0, 10);

  const insertAll = db.transaction(() => {
    const numero = numeroManual ? Number(numeroManual) : numeroSugerido;
    const info = db.prepare(
      `INSERT INTO invoices (
         tipo_comprobante, serie, numero, client_id, created_by, fecha_emision, moneda,
         subtotal, igv, descuento_global_pct, total, estado, observaciones, forma_pago, monto_pagado,
         modifica_tipo, modifica_serie, modifica_numero, tipo_nota, sucursal_id, atribuido_a
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitido', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tipo_comprobante,
      serie,
      numero,
      client_id,
      req.user?.id || null,
      fechaEmisionFinal,
      moneda || 'PEN',
      subtotal,
      igv,
      descuentoGlobalPct,
      total,
      observaciones || null,
      forma_pago || 'efectivo',
      montoPagado,
      tipo_comprobante === 'nota_credito' ? (modifica_tipo || null) : null,
      tipo_comprobante === 'nota_credito' ? (modifica_serie || null) : null,
      tipo_comprobante === 'nota_credito' && modifica_numero ? Number(modifica_numero) : null,
      tipo_comprobante === 'nota_credito' ? (tipo_nota || null) : null,
      req.sucursalId,
      atribuidoA
    );
    const invoiceId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO invoice_items (invoice_id, product_id, descripcion, cantidad, precio_unitario, descuento_pct, subtotal, igv_item)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const referenciaComprobante = `${serie}-${String(numero).padStart(6, '0')}`;

    for (const it of preparedItems) {
      const itemInfo = insertItem.run(
        invoiceId, it.product_id, it.descripcion, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal, it.igv_item
      );
      const invoiceItemId = itemInfo.lastInsertRowid;

      if (it.product_id) {
        if (tipo_comprobante === 'nota_credito') {
          if (TIPOS_NOTA_DEVUELVEN_STOCK.includes(tipo_nota)) {
            incrementarStock(it.product_id, it.cantidad, {
              tipoMovimiento: 'nota_credito_devolucion',
              motivo: `Nota de crédito - devolución de stock (${tipo_nota})`,
              referencia: referenciaComprobante,
              userId: req.user?.id,
              sucursalId: req.sucursalId,
            });
          }
          // Para notas de crédito puramente financieras (descuentos, corrección,
          // bonificación, etc.) no se mueve stock: la mercadería ya fue entregada.
        } else {
          consumirStock(it.product_id, it.cantidad, {
            tipoMovimiento: 'venta',
            motivo: `Venta - ${tipo_comprobante}`,
            referencia: referenciaComprobante,
            userId: req.user?.id,
            invoiceItemId,
            sucursalId: req.sucursalId,
          });
        }
      }
    }

    // Abono inicial de una venta "abonado": queda registrado en el historial
    // de cobros de esa venta y como ingreso real en Caja (cuentas_cobrar) —
    // el resto del total queda pendiente en /invoices/deudas.
    if (esAbonado && montoPagado > 0) {
      db.prepare(
        `INSERT INTO cobros (invoice_id, monto, medio, observacion, created_by) VALUES (?, ?, ?, ?, ?)`
      ).run(invoiceId, montoPagado, medioAbono, 'Abono al emitir la venta', req.user?.id || null);
      db.prepare(
        `INSERT INTO caja_movimientos (fecha, tipo, medio, categoria, monto, descripcion, created_by, sucursal_id)
         VALUES (?, 'ingreso', ?, 'cuentas_cobrar', ?, ?, ?, ?)`
      ).run(fechaEmisionFinal, medioAbono, montoPagado, `Abono - ${referenciaComprobante} - ${client.nombre}`, req.user?.id || null, req.sucursalId);
    }

    // Pago mixto: la venta ya está pagada por completo, pero repartida entre
    // varios métodos — cada tramo queda como su propio cobro y como ingreso
    // de Caja (categoria 'ventas') para que el arqueo por método cuadre.
    if (esMixto) {
      const insertCobro = db.prepare(
        `INSERT INTO cobros (invoice_id, monto, medio, observacion, created_by) VALUES (?, ?, ?, ?, ?)`
      );
      const insertCajaMov = db.prepare(
        `INSERT INTO caja_movimientos (fecha, tipo, medio, categoria, monto, descripcion, created_by, sucursal_id)
         VALUES (?, 'ingreso', ?, 'ventas', ?, ?, ?, ?)`
      );
      for (const p of pagosMixto) {
        insertCobro.run(invoiceId, p.monto, p.medio, 'Pago mixto', req.user?.id || null);
        insertCajaMov.run(fechaEmisionFinal, p.medio, p.monto, `Venta (pago mixto) - ${referenciaComprobante} - ${client.nombre}`, req.user?.id || null, req.sucursalId);
      }
    }
    return invoiceId;
  });

  let invoiceId;
  try {
    invoiceId = insertAll();
  } catch (err) {
    if (err instanceof StockInsuficienteError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
  let invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  let invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);

  // La venta ya quedó confirmada localmente (stock, kardex, numeración) antes
  // de intentar el envío a SUNAT: un fallo del OSE no debe perder la venta,
  // solo queda registrada como no validada (sunat_estado='error').
  if (estaConfigurado()) {
    const itemsConCodigo = invoiceItems.map((it) => ({
      ...it,
      codigo_producto: it.product_id ? db.prepare('SELECT codigo FROM products WHERE id = ?').get(it.product_id)?.codigo : null,
    }));
    const resultado = await emitirComprobante(invoice, itemsConCodigo, client);
    db.prepare(
      `UPDATE invoices SET modo_emision = ?, sunat_estado = ?, sunat_hash = ?, sunat_pdf_url = ?,
       sunat_xml_url = ?, sunat_cdr_url = ?, sunat_mensaje = ? WHERE id = ?`
    ).run(
      resultado.modo_emision || 'real',
      resultado.sunat_estado || null,
      resultado.sunat_hash || null,
      resultado.sunat_pdf_url || null,
      resultado.sunat_xml_url || null,
      resultado.sunat_cdr_url || null,
      resultado.sunat_mensaje || null,
      invoiceId
    );
    invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  }

  res.status(201).json({ ...invoice, items: invoiceItems });
});

// POST /api/invoices/preview-pdf -> genera un PDF de vista previa con el
// diseño real del comprobante, a partir de los datos que el usuario ya tiene
// cargados en el formulario. No guarda nada: no consume numeración, no
// descuenta stock, no registra cobros. Se usa antes de confirmar la emisión.
router.post('/preview-pdf', async (req, res) => {
  const {
    tipo_comprobante, client_id, items, moneda, observaciones, fecha_emision,
    forma_pago, numero, serie, descuento_global_pct, monto_pagado, medio_abono, pagos,
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un producto para previsualizar.' });
  }

  const client = client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id) : null;
  const descuentoGlobalPct = Math.min(100, Math.max(0, Number(descuento_global_pct || 0)));

  const tasaIgvPreview = igvRate();
  let totalBruto = 0;
  let igvBruto = 0;
  const preparedItems = items.map((it) => {
    const cantidad = Number(it.cantidad || 1);
    const precio_unitario = Number(it.precio_unitario || 0);
    const descuentoPct = Math.min(100, Math.max(0, Number(it.descuento_pct || 0)));
    const lineBruta = cantidad * precio_unitario;
    const lineNeta = round2(lineBruta - lineBruta * (descuentoPct / 100));
    const prod = it.product_id ? db.prepare('SELECT afectacion_igv, codigo, unidad FROM products WHERE id = ?').get(it.product_id) : null;
    const gravado = !prod || prod.afectacion_igv === 'gravado' || prod.afectacion_igv === 'gratuito';
    const subtotalLinea = gravado ? round2(lineNeta / (1 + tasaIgvPreview)) : lineNeta;
    const igvLinea = gravado ? round2(lineNeta - subtotalLinea) : 0;
    totalBruto += lineNeta;
    igvBruto += igvLinea;
    return {
      descripcion: it.descripcion || '', cantidad, precio_unitario, descuento_pct: descuentoPct,
      subtotal: lineNeta, igv_item: igvLinea, codigo: prod?.codigo || null, unidad: prod?.unidad || 'NIU',
    };
  });
  totalBruto = round2(totalBruto);
  igvBruto = round2(igvBruto);
  const total = round2(totalBruto * (1 - descuentoGlobalPct / 100));
  const ratio = totalBruto > 0 ? total / totalBruto : 1;
  const igv = round2(igvBruto * ratio);
  const subtotal = round2(total - igv);

  const esAbonado = forma_pago === 'abonado';
  const esMixto = forma_pago === 'mixto';
  const montoPagado = esAbonado ? Math.min(total, Math.max(0, round2(Number(monto_pagado || 0)))) : total;

  const sucursal = db.prepare('SELECT nombre, direccion FROM sucursales WHERE id = ?').get(req.sucursalId);
  const fechaFinal = fecha_emision || new Date().toISOString().slice(0, 10);

  const invoicePreview = {
    tipo_comprobante: ['factura', 'boleta', 'nota_credito', 'cotizacion'].includes(tipo_comprobante) ? tipo_comprobante : 'boleta',
    serie: serie || siguienteNumero(tipo_comprobante, req.sucursalId)?.serie || 'B001',
    numero: numero || 0,
    fecha_emision: fechaFinal,
    moneda: moneda || 'PEN',
    estado: 'emitido',
    forma_pago: forma_pago || 'efectivo',
    monto_pagado: montoPagado,
    modo_emision: 'simulado',
    sunat_estado: null,
    sunat_hash: null,
    cliente_nombre: client?.nombre || 'CLIENTE DE EJEMPLO',
    cliente_tipo_documento: client?.tipo_documento || '-',
    cliente_documento: client?.numero_documento || '-',
    cliente_direccion: client?.direccion || '',
    cliente_telefono: client?.telefono || '',
    cliente_referencia: client?.referencia || '',
    cliente_contacto: client?.contacto || '',
    vendedor_nombre: req.user?.full_name || '',
    sucursal_nombre: sucursal?.nombre || null,
    sucursal_direccion: sucursal?.direccion || null,
    subtotal, igv, total,
    observaciones: observaciones || '',
  };

  let cobrosPreview = [];
  if (esAbonado && montoPagado > 0) {
    cobrosPreview = [{ monto: montoPagado, medio: medio_abono || 'efectivo', created_at: fechaFinal }];
  } else if (esMixto && Array.isArray(pagos)) {
    cobrosPreview = pagos
      .filter((p) => p && p.medio && Number(p.monto) > 0)
      .map((p) => ({ monto: Number(p.monto), medio: p.medio, created_at: fechaFinal }));
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="vista-previa.pdf"');
  const doc = await buildInvoicePdf(invoicePreview, preparedItems, cobrosPreview);
  doc.pipe(res);
  doc.end();
});

router.post('/:id/anular', requireAccion('ventas', 'anular_comprobante'), (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  if (invoice.estado === 'anulado') {
    return res.status(400).json({ error: 'El comprobante ya esta anulado.' });
  }

  const referenciaComprobante = `${invoice.serie}-${String(invoice.numero).padStart(6, '0')}`;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  const esNotaCreditoConDevolucion = invoice.tipo_comprobante === 'nota_credito' && TIPOS_NOTA_DEVUELVEN_STOCK.includes(invoice.tipo_nota);
  const esNotaCreditoFinanciera = invoice.tipo_comprobante === 'nota_credito' && !esNotaCreditoConDevolucion;

  // Si la nota de crédito devolvió stock al emitirse, anularla debe revertir esa
  // devolución; para eso hace falta que exista stock suficiente para descontar.
  if (esNotaCreditoConDevolucion) {
    for (const it of items) {
      if (!it.product_id) continue;
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (prod && prod.tipo === 'producto' && prod.stock < it.cantidad) {
        return res.status(409).json({
          error: `No se puede anular: ${prod.nombre} ya no tiene stock suficiente (parte de esa devolución ya fue vendida o trasladada).`,
        });
      }
    }
  }

  db.prepare("UPDATE invoices SET estado = 'anulado' WHERE id = ?").run(req.params.id);

  for (const it of items) {
    if (!it.product_id) continue;
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!prod || prod.tipo !== 'producto' || prod.stock === null) continue;

    if (esNotaCreditoFinanciera) {
      // Ajuste puramente financiero: nunca movió stock, tampoco al anularla.
      continue;
    }

    if (esNotaCreditoConDevolucion) {
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.cantidad, it.product_id);
      const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product_id).stock;
      ajustarStockSucursal(it.product_id, invoice.sucursal_id, -it.cantidad);
      db.prepare(
        `INSERT INTO stock_movements (product_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
         VALUES (?, 'anulacion', ?, ?, 'Anulación de nota de crédito (revierte devolución)', ?, ?, ?)`
      ).run(it.product_id, -it.cantidad, nuevoStock, referenciaComprobante, req.user?.id || null, invoice.sucursal_id);
      continue;
    }

    // Factura/Boleta: restaurar exactamente los lotes/series de donde se descontó esta venta
    const itemLotes = db.prepare('SELECT * FROM invoice_item_lotes WHERE invoice_item_id = ?').all(it.id);
    for (const il of itemLotes) {
      db.prepare('UPDATE lotes SET cantidad_actual = cantidad_actual + ? WHERE id = ?').run(il.cantidad, il.lote_id);
    }
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.cantidad, it.product_id);
    const nuevoStock = db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product_id).stock;
    ajustarStockSucursal(it.product_id, invoice.sucursal_id, it.cantidad);
    db.prepare(
      `INSERT INTO stock_movements (product_id, lote_id, tipo, cantidad, stock_resultante, motivo, referencia, created_by, sucursal_id)
       VALUES (?, ?, 'anulacion', ?, ?, 'Anulación de comprobante', ?, ?, ?)`
    ).run(it.product_id, itemLotes[0]?.lote_id || null, it.cantidad, nuevoStock, referenciaComprobante, req.user?.id || null, invoice.sucursal_id);
  }

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.get('/:id/pdf', async (req, res) => {
  const invoice = db.prepare(
    `SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion,
            c.telefono AS cliente_telefono, c.referencia AS cliente_referencia, c.contacto AS cliente_contacto,
            u.full_name AS vendedor_nombre, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion
     FROM invoices i
     JOIN clients c ON c.id = i.client_id
     LEFT JOIN users u ON u.id = i.created_by
     LEFT JOIN sucursales s ON s.id = i.sucursal_id
     WHERE i.id = ? AND i.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!invoice) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  const items = db.prepare(
    `SELECT ii.*, p.codigo AS codigo, p.unidad AS unidad FROM invoice_items ii
     LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ?`
  ).all(req.params.id);
  const cobros = invoice.forma_pago === 'abonado'
    ? db.prepare('SELECT * FROM cobros WHERE invoice_id = ? ORDER BY id ASC').all(invoice.id)
    : [];

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.serie}-${invoice.numero}.pdf"`);
  const doc = await buildInvoicePdf(invoice, items, cobros);
  doc.pipe(res);
  doc.end();
});

module.exports = router;
