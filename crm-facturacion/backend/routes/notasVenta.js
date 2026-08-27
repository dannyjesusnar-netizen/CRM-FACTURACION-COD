const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso, requireAccion, tieneAccion, tienePermiso, requireGerenciaOSupervisor } = require('../utils/permisos');
const { siguienteNumero } = require('../utils/series');
const { resolverDescuentoPct } = require('../utils/descuentos');
const { consumirStock, incrementarStock, StockInsuficienteError } = require('../utils/stock');
const { buildNotaVentaPdf } = require('../utils/pdf');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const CLIENTE_GENERICO_DOCUMENTO = '10000000'; // "CLIENTES VARIOS", sembrado en db.js

// El único valor "especial" que no es un método de pago real (venta a
// crédito). Todo lo demás sale del catálogo dinámico de metodos_pago.
function esMetodoPagoValido(codigo) {
  if (!codigo) return false;
  return !!db.prepare('SELECT 1 FROM metodos_pago WHERE codigo = ? AND activo = 1').get(codigo);
}

// Cuentas por cobrar es visible tanto desde Ventas como desde Caja y Bancos,
// así que estos tres endpoints se registran ANTES del candado general
// `requirePermiso('ventas')` de más abajo — mismo patrón que invoices.js.
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

// GET /api/notas-venta/deudas -> notas de venta "abonado" con saldo pendiente
router.get('/deudas', requireVerCuentasPorCobrar, (req, res) => {
  const rows = db.prepare(`
    SELECT nv.id, nv.serie, nv.numero, nv.fecha_emision, nv.moneda, nv.total, nv.monto_pagado,
           (nv.total - nv.monto_pagado) AS saldo,
           c.id AS client_id, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
           c.tipo_documento AS cliente_tipo_documento, c.telefono AS cliente_telefono,
           u.full_name AS vendedor_nombre
    FROM notas_venta nv JOIN clients c ON c.id = nv.client_id
    LEFT JOIN users u ON u.id = nv.created_by
    WHERE nv.sucursal_id = ? AND nv.forma_pago = 'abonado' AND nv.estado = 'emitido'
      AND (nv.total - nv.monto_pagado) > 0.005
    ORDER BY nv.fecha_emision ASC, nv.id ASC
  `).all(req.sucursalId);
  res.json(rows.map((r) => ({ ...r, saldo: round2(r.saldo) })));
});

// GET /api/notas-venta/:id/cobros -> historial de abonos de una nota de venta "abonado"
router.get('/:id/cobros', requireVerCuentasPorCobrar, (req, res) => {
  const nv = db.prepare('SELECT id FROM notas_venta WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  const rows = db.prepare(
    `SELECT nvc.*, u.full_name AS usuario_nombre FROM nota_venta_cobros nvc
     LEFT JOIN users u ON u.id = nvc.created_by
     WHERE nvc.nota_venta_id = ? ORDER BY nvc.id DESC`
  ).all(req.params.id);
  res.json(rows);
});

// POST /api/notas-venta/:id/cobros { monto, medio, observacion } -> registra un cobro contra el saldo pendiente
router.post('/:id/cobros', requireRegistrarCobro, (req, res) => {
  const nv = db.prepare('SELECT * FROM notas_venta WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  if (nv.forma_pago !== 'abonado') {
    return res.status(400).json({ error: 'Esta nota de venta no es a crédito (abonado).' });
  }
  if (nv.estado !== 'emitido') {
    return res.status(400).json({ error: 'La nota de venta está anulada.' });
  }
  const { monto, medio, observacion } = req.body || {};
  if (!esMetodoPagoValido(medio)) {
    return res.status(400).json({ error: 'Selecciona un método de pago válido.' });
  }
  const saldoActual = round2(nv.total - nv.monto_pagado);
  const montoNum = round2(Number(monto || 0));
  if (montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
  if (montoNum > saldoActual + 0.005) {
    return res.status(400).json({ error: `El monto no puede superar el saldo pendiente (S/ ${saldoActual.toFixed(2)}).` });
  }
  const client = db.prepare('SELECT nombre FROM clients WHERE id = ?').get(nv.client_id);
  const referencia = `${nv.serie}-${String(nv.numero).padStart(6, '0')}`;
  const hoy = new Date().toISOString().slice(0, 10);

  const registrar = db.transaction(() => {
    db.prepare('UPDATE notas_venta SET monto_pagado = monto_pagado + ? WHERE id = ?').run(montoNum, nv.id);
    db.prepare(
      `INSERT INTO nota_venta_cobros (nota_venta_id, monto, medio, observacion, created_by) VALUES (?, ?, ?, ?, ?)`
    ).run(nv.id, montoNum, medio, observacion || null, req.user?.id || null);
    db.prepare(
      `INSERT INTO caja_movimientos (fecha, tipo, medio, categoria, monto, descripcion, created_by, sucursal_id, nota_venta_id)
       VALUES (?, 'ingreso', ?, 'cuentas_cobrar', ?, ?, ?, ?, ?)`
    ).run(hoy, medio, montoNum, `Cobro - ${referencia} - ${client?.nombre || ''}`, req.user?.id || null, req.sucursalId, nv.id);
  });
  registrar();

  const updated = db.prepare('SELECT * FROM notas_venta WHERE id = ?').get(nv.id);
  res.json({ ...updated, saldo: round2(updated.total - updated.monto_pagado) });
});

router.use(requirePermiso('ventas'));

router.get('/siguiente-numero', (req, res) => {
  res.json(siguienteNumero('nota_venta', req.sucursalId));
});

// GET /api/notas-venta?estado=&client_id=&from=&to=&q=&forma_pago=
// "subtotal" e "igv" se devuelven como alias de total/0 — la Nota de Venta
// no tiene desglose de IGV (no es un comprobante fiscal) — así el frontend
// puede mostrarla en la misma tabla que facturas/boletas sin casos especiales.
router.get('/', (req, res) => {
  const { estado, client_id, from, to, q, forma_pago } = req.query;
  let sql = `
    SELECT nv.*, nv.total AS subtotal, 0 AS igv,
           c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
           u.full_name AS vendedor_nombre, au.full_name AS atribuido_nombre
    FROM notas_venta nv
    LEFT JOIN clients c ON c.id = nv.client_id
    LEFT JOIN users u ON u.id = nv.created_by
    LEFT JOIN users au ON au.id = nv.atribuido_a
    WHERE nv.sucursal_id = ?
  `;
  const params = [req.sucursalId];
  if (estado) { sql += ' AND nv.estado = ?'; params.push(estado); }
  if (client_id) { sql += ' AND nv.client_id = ?'; params.push(client_id); }
  if (from) { sql += ' AND date(nv.fecha_emision) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(nv.fecha_emision) <= date(?)'; params.push(to); }
  if (forma_pago) { sql += ' AND nv.forma_pago = ?'; params.push(forma_pago); }
  if (q) {
    sql += ' AND (c.nombre LIKE ? OR c.numero_documento LIKE ? OR CAST(nv.numero AS TEXT) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY nv.fecha_emision DESC, nv.id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const nv = db.prepare(
    `SELECT nv.*, nv.total AS subtotal, 0 AS igv,
            c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento, c.direccion AS cliente_direccion,
            c.tipo_documento AS cliente_tipo_documento,
            u.full_name AS vendedor_nombre, au.full_name AS atribuido_nombre
     FROM notas_venta nv
     LEFT JOIN clients c ON c.id = nv.client_id
     LEFT JOIN users u ON u.id = nv.created_by
     LEFT JOIN users au ON au.id = nv.atribuido_a
     WHERE nv.id = ? AND nv.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  const items = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(req.params.id);
  res.json({ ...nv, items });
});

router.post('/', requireAccion('ventas', 'nota_venta'), (req, res) => {
  const {
    client_id, items, moneda, observaciones, fecha_emision,
    descuento_id, numero: numeroManual, forma_pago,
    monto_pagado: montoPagadoBody, medio_abono, atribuido_a_id,
  } = req.body || {};

  if (!client_id) return res.status(400).json({ error: 'client_id es requerido.' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un item.' });
  }

  // atribuido_a_id: igual que en invoices.js — quien registra la nota de
  // venta puede elegir que cuente para un Trainer/Supervisor de su misma
  // sede en el Ranking del Tablero de Ventas.
  let atribuidoA = null;
  if (atribuido_a_id) {
    const entrenador = db.prepare(
      `SELECT id FROM users WHERE id = ? AND activo = 1 AND categoria_staff IN ('trainer', 'supervisor')
       AND (sucursal_id IS NULL OR sucursal_id = ?)`
    ).get(atribuido_a_id, req.sucursalId);
    if (!entrenador) {
      return res.status(400).json({ error: 'La persona seleccionada no existe o no pertenece a esta sede.' });
    }
    atribuidoA = entrenador.id;
  }
  for (const it of items) {
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio_unitario);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return res.status(400).json({ error: 'Cantidad inválida en un item.' });
    if (!Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: 'Precio unitario inválido en un item.' });
  }

  const esAbonado = forma_pago === 'abonado';
  if (forma_pago && forma_pago !== 'abonado' && !esMetodoPagoValido(forma_pago)) {
    return res.status(400).json({ error: 'forma_pago invalida. Debe ser un método de pago activo o "abonado".' });
  }
  if (esAbonado && !tieneAccion(req.user, 'ventas', 'abonado')) {
    return res.status(403).json({ error: 'No tienes permiso para registrar notas de venta a crédito (abonado).' });
  }
  if (esAbonado && client.numero_documento === CLIENTE_GENERICO_DOCUMENTO) {
    return res.status(400).json({ error: 'Para una nota de venta abonada selecciona un cliente real — no puede quedar a nombre de "Clientes Varios".' });
  }
  const medioAbono = esAbonado && Number(montoPagadoBody || 0) > 0 ? medio_abono : null;
  if (esAbonado && Number(montoPagadoBody || 0) > 0 && !esMetodoPagoValido(medioAbono)) {
    return res.status(400).json({ error: 'Selecciona un método de pago válido para el abono inicial.' });
  }

  // El % de descuento global nunca se acepta a mano — solo se resuelve a
  // partir de un descuento_id vigente (Configuración → Descuentos).
  let descuentoGlobalPct;
  try {
    descuentoGlobalPct = resolverDescuentoPct(descuento_id, req.sucursalId);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  // Sin IGV: el total de cada línea es el importe final tal cual, sin
  // separar impuesto — es exactamente lo que diferencia a este documento
  // de una Boleta/Factura reales.
  let totalBruto = 0;
  const preparedItems = items.map((it) => {
    const cantidad = Number(it.cantidad);
    const precio_unitario = Number(it.precio_unitario);
    const descuentoPct = Math.min(100, Math.max(0, Number(it.descuento_pct || 0)));
    const lineBruta = cantidad * precio_unitario;
    const lineNeta = round2(lineBruta - lineBruta * (descuentoPct / 100));
    totalBruto += lineNeta;
    return {
      product_id: it.product_id || null,
      descripcion: it.descripcion || '',
      cantidad,
      precio_unitario,
      descuento_pct: descuentoPct,
      subtotal: lineNeta,
    };
  });

  totalBruto = round2(totalBruto);
  const total = round2(totalBruto * (1 - descuentoGlobalPct / 100));
  // Para efectivo/tarjeta/banco se asume pagado por completo. Para "abonado"
  // es lo que el cliente entregó ahora (puede ser 0 hasta el total) — el
  // resto queda como saldo pendiente en /notas-venta/deudas.
  const montoPagado = esAbonado ? Math.min(total, Math.max(0, round2(Number(montoPagadoBody || 0)))) : total;

  const { serie, numero: numeroSugerido } = siguienteNumero('nota_venta', req.sucursalId);
  const fechaEmisionFinal = fecha_emision || new Date().toISOString().slice(0, 10);
  const referencia = `${serie}-${String(numeroManual || numeroSugerido).padStart(6, '0')}`;

  const insertAll = db.transaction(() => {
    const numero = numeroManual ? Number(numeroManual) : numeroSugerido;
    const info = db.prepare(
      `INSERT INTO notas_venta (serie, numero, client_id, created_by, sucursal_id, fecha_emision, moneda, descuento_global_pct, total, forma_pago, monto_pagado, estado, observaciones, atribuido_a, descuento_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitido', ?, ?, ?)`
    ).run(
      serie,
      numero,
      client_id,
      req.user?.id || null,
      req.sucursalId,
      fechaEmisionFinal,
      moneda || 'PEN',
      descuentoGlobalPct,
      total,
      forma_pago || 'efectivo',
      montoPagado,
      observaciones || null,
      atribuidoA,
      descuento_id || null
    );
    const notaVentaId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO nota_venta_items (nota_venta_id, product_id, descripcion, cantidad, precio_unitario, descuento_pct, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of preparedItems) {
      insertItem.run(notaVentaId, it.product_id, it.descripcion, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal);
      if (it.product_id) {
        consumirStock(it.product_id, it.cantidad, {
          tipoMovimiento: 'venta',
          motivo: 'Venta - nota de venta (sin IGV)',
          referencia,
          userId: req.user?.id,
          sucursalId: req.sucursalId,
        });
      }
    }

    // Abono inicial de una nota de venta "abonado": queda registrado en el
    // historial de cobros y como ingreso real en Caja (cuentas_cobrar) — el
    // resto del total queda pendiente en /notas-venta/deudas.
    if (esAbonado && montoPagado > 0) {
      db.prepare(
        `INSERT INTO nota_venta_cobros (nota_venta_id, monto, medio, observacion, created_by) VALUES (?, ?, ?, ?, ?)`
      ).run(notaVentaId, montoPagado, medioAbono, 'Abono al emitir la nota de venta', req.user?.id || null);
      db.prepare(
        `INSERT INTO caja_movimientos (fecha, tipo, medio, categoria, monto, descripcion, created_by, sucursal_id, nota_venta_id)
         VALUES (?, 'ingreso', ?, 'cuentas_cobrar', ?, ?, ?, ?, ?)`
      ).run(fechaEmisionFinal, medioAbono, montoPagado, `Abono - ${referencia} - ${client.nombre}`, req.user?.id || null, req.sucursalId, notaVentaId);
    }
    return notaVentaId;
  });

  let notaVentaId;
  try {
    notaVentaId = insertAll();
  } catch (err) {
    if (err instanceof StockInsuficienteError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  const nv = db.prepare('SELECT *, total AS subtotal, 0 AS igv FROM notas_venta WHERE id = ?').get(notaVentaId);
  const nvItems = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(notaVentaId);
  res.status(201).json({ ...nv, items: nvItems });
});

router.post('/:id/anular', requireAccion('ventas', 'anular_comprobante'), (req, res) => {
  const nv = db.prepare('SELECT * FROM notas_venta WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  if (nv.estado === 'anulado') return res.status(400).json({ error: 'La nota de venta ya está anulada.' });

  const items = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(nv.id);
  const referencia = `${nv.serie}-${String(nv.numero).padStart(6, '0')}`;
  const anular = db.transaction(() => {
    for (const it of items) {
      if (it.product_id) {
        incrementarStock(it.product_id, it.cantidad, {
          tipoMovimiento: 'anulacion',
          motivo: 'Anulación de nota de venta',
          referencia,
          userId: req.user?.id,
          sucursalId: req.sucursalId,
        });
      }
    }
    db.prepare("UPDATE notas_venta SET estado = 'anulado' WHERE id = ?").run(nv.id);
  });
  anular();
  res.json(db.prepare('SELECT *, total AS subtotal, 0 AS igv FROM notas_venta WHERE id = ?').get(nv.id));
});

// PUT /api/notas-venta/:id/atribuido-a { atribuido_a_id } — mismo patrón que
// PUT /api/invoices/:id/atribuido-a: Gerencia o Supervisor corrige, después
// de emitida, a nombre de quién cuenta esta nota de venta en el Ranking.
router.put('/:id/atribuido-a', requireGerenciaOSupervisor, (req, res) => {
  const nv = db.prepare('SELECT * FROM notas_venta WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  if (nv.estado === 'anulado') {
    return res.status(400).json({ error: 'No se puede reatribuir una nota de venta anulada.' });
  }
  const { atribuido_a_id } = req.body || {};
  let atribuidoA = null;
  if (atribuido_a_id) {
    const entrenador = db.prepare(
      `SELECT id FROM users WHERE id = ? AND activo = 1 AND categoria_staff IN ('trainer', 'supervisor')
       AND (sucursal_id IS NULL OR sucursal_id = ?)`
    ).get(atribuido_a_id, nv.sucursal_id);
    if (!entrenador) {
      return res.status(400).json({ error: 'La persona seleccionada no existe o no pertenece a esta sede.' });
    }
    atribuidoA = entrenador.id;
  }
  db.prepare('UPDATE notas_venta SET atribuido_a = ? WHERE id = ?').run(atribuidoA, req.params.id);
  const updated = db.prepare(
    `SELECT nv.*, u.full_name AS vendedor_nombre, au.full_name AS atribuido_nombre
     FROM notas_venta nv LEFT JOIN users u ON u.id = nv.created_by LEFT JOIN users au ON au.id = nv.atribuido_a
     WHERE nv.id = ?`
  ).get(req.params.id);
  res.json(updated);
});

router.get('/:id/pdf', async (req, res) => {
  const nv = db.prepare(
    `SELECT nv.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion
     FROM notas_venta nv LEFT JOIN clients c ON c.id = nv.client_id
     WHERE nv.id = ? AND nv.sucursal_id = ?`
  ).get(req.params.id, req.sucursalId);
  if (!nv) return res.status(404).json({ error: 'Nota de venta interna no encontrada.' });
  const items = db.prepare('SELECT * FROM nota_venta_items WHERE nota_venta_id = ?').all(nv.id);
  const empresa = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nv.serie}-${String(nv.numero).padStart(6, '0')}.pdf"`);
  const doc = await buildNotaVentaPdf(nv, items, empresa);
  doc.pipe(res);
  doc.end();
});

module.exports = router;
