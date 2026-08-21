const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { round2, buildResumen } = require('../utils/cajaCalculos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('caja'));
router.use(resolveSucursal);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/caja?fecha=YYYY-MM-DD&moneda=PEN|USD&empleado_id=
// El arqueo es un conteo de dinero físico/por método: nunca debe sumar soles
// y dólares como si fueran la misma unidad. Si no se especifica moneda, se
// asume PEN (igual que los caja_movimientos manuales, que siempre son en
// soles) — para ver el arqueo en dólares hay que filtrar explícitamente.
router.get('/', (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const moneda = req.query.moneda === 'USD' ? 'USD' : 'PEN';
  const empleadoId = req.query.empleado_id ? Number(req.query.empleado_id) : null;
  const resumen = buildResumen(fecha, req.sucursalId, { moneda, empleadoId });

  let movSql = `SELECT cm.*, u.full_name AS usuario_nombre FROM caja_movimientos cm
     LEFT JOIN users u ON u.id = cm.created_by
     WHERE cm.fecha = ? AND cm.sucursal_id = ?`;
  const movParams = [fecha, req.sucursalId];
  if (empleadoId) { movSql += ' AND cm.created_by = ?'; movParams.push(empleadoId); }
  if (moneda === 'USD') { movSql += ' AND 0 = 1'; } // movimientos manuales siempre son en soles
  movSql += ' ORDER BY cm.id DESC';
  const movimientos = db.prepare(movSql).all(...movParams);

  const totalGeneral = round2(resumen.reduce((s, r) => s + r.saldo_final, 0));
  res.json({ fecha, moneda, resumen, movimientos, totalGeneral });
});

// GET /api/caja/empleados -> empleados visibles en la sede activa, para el filtro "Cuenta"
router.get('/empleados', (req, res) => {
  const rows = db.prepare(
    `SELECT id, full_name FROM users
     WHERE activo = 1 AND (sucursal_id IS NULL OR sucursal_id = ?)
     ORDER BY full_name ASC`
  ).all(req.sucursalId);
  res.json(rows);
});

// PUT /api/caja/saldo-inicial { fecha, monto } -> solo aplica a Efectivo
router.put('/saldo-inicial', requireAccion('caja', 'apertura'), (req, res) => {
  const { fecha, monto } = req.body || {};
  if (!fecha || monto === undefined || monto === null || monto === '') {
    return res.status(400).json({ error: 'fecha y monto son requeridos.' });
  }
  const existing = db.prepare('SELECT id FROM caja_saldos_iniciales WHERE fecha = ? AND sucursal_id = ?').get(fecha, req.sucursalId);
  if (existing) {
    db.prepare(
      `UPDATE caja_saldos_iniciales SET saldo_inicial_efectivo = ?, created_by = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(Number(monto), req.user?.id || null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO caja_saldos_iniciales (fecha, sucursal_id, saldo_inicial_efectivo, created_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(fecha, req.sucursalId, Number(monto), req.user?.id || null);
  }
  res.json({ fecha, saldo_inicial_efectivo: Number(monto) });
});

const VALID_CATEGORIAS = {
  ingreso: ['cuentas_cobrar', 'transferencia', 'otros', 'ventas'],
  egreso: ['compras', 'cuentas_pagar', 'transferencia', 'otros'],
};

function metodoActivo(codigo) {
  return db.prepare('SELECT * FROM metodos_pago WHERE codigo = ? AND activo = 1').get(codigo);
}

// POST /api/caja/movimientos { fecha, tipo, medio, categoria, monto, descripcion }
router.post('/movimientos', requireAccion('caja', 'movimientos'), (req, res) => {
  const { fecha, tipo, medio, categoria, monto, descripcion } = req.body || {};
  if (!fecha || !tipo || !medio || !categoria || monto === undefined || monto === null || monto === '') {
    return res.status(400).json({ error: 'fecha, tipo, medio, categoria y monto son requeridos.' });
  }
  const montoNum = Number(monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: 'El monto debe ser un número mayor a 0.' });
  }
  if (!['ingreso', 'egreso'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido.' });
  }
  if (!metodoActivo(medio)) {
    return res.status(400).json({ error: 'medio invalido — no es un método de pago activo.' });
  }
  if (!(VALID_CATEGORIAS[tipo] || []).includes(categoria)) {
    return res.status(400).json({ error: 'categoria invalida para este tipo.' });
  }
  if (categoria === 'ventas' && medio !== 'otros') {
    return res.status(400).json({ error: 'Las ventas se calculan automáticamente desde los comprobantes emitidos con este método de pago.' });
  }
  if (categoria === 'transferencia' && medio === 'otros') {
    return res.status(400).json({ error: 'Las transferencias no aplican al método "Otros".' });
  }
  const info = db.prepare(
    `INSERT INTO caja_movimientos (fecha, tipo, medio, categoria, monto, descripcion, created_by, sucursal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(fecha, tipo, medio, categoria, montoNum, descripcion || null, req.user?.id || null, req.sucursalId);
  const row = db.prepare('SELECT * FROM caja_movimientos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// DELETE /api/caja/movimientos/:id
router.delete('/movimientos/:id', requireAccion('caja', 'eliminar_movimiento'), (req, res) => {
  const row = db.prepare('SELECT * FROM caja_movimientos WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!row) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  // Los movimientos que el sistema generó automáticamente a partir de un
  // comprobante (cobro, abono, pago mixto) no se pueden borrar sueltos: el
  // dinero ya quedó registrado también en invoices.monto_pagado/cobros, y
  // borrar solo el lado de Caja los desincroniza (el cliente queda "pagado"
  // sin que la caja lo refleje). Para revertirlo, anula el comprobante.
  if (row.invoice_id || row.nota_venta_id) {
    return res.status(400).json({ error: 'Este movimiento proviene de un comprobante y no se puede eliminar directamente — anula el comprobante para revertirlo.' });
  }
  db.prepare('DELETE FROM caja_movimientos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
