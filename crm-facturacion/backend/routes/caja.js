const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const INGRESO_CATS = ['ventas', 'cuentas_cobrar', 'transferencia', 'otros'];
const EGRESO_CATS = ['compras', 'cuentas_pagar', 'transferencia', 'otros'];
const MEDIOS_TB = ['tarjeta', 'banco', 'otros'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function ventasAuto(fecha, medio) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total FROM invoices
     WHERE date(fecha_emision) = date(?) AND forma_pago = ? AND estado = 'emitido'
       AND tipo_comprobante != 'nota_credito'`
  ).get(fecha, medio);
  return round2(row.total);
}

function movimientosSum(fecha, tipo, medio, categoria) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM caja_movimientos
     WHERE fecha = ? AND tipo = ? AND medio = ? AND categoria = ?`
  ).get(fecha, tipo, medio, categoria);
  return round2(row.total);
}

function buildEfectivo(fecha) {
  const ingresos = {
    ventas: ventasAuto(fecha, 'efectivo'),
    cuentas_cobrar: movimientosSum(fecha, 'ingreso', 'efectivo', 'cuentas_cobrar'),
    transferencia: movimientosSum(fecha, 'ingreso', 'efectivo', 'transferencia'),
    otros: movimientosSum(fecha, 'ingreso', 'efectivo', 'otros'),
  };
  ingresos.total = round2(INGRESO_CATS.reduce((s, c) => s + ingresos[c], 0));

  const egresos = {
    compras: movimientosSum(fecha, 'egreso', 'efectivo', 'compras'),
    cuentas_pagar: movimientosSum(fecha, 'egreso', 'efectivo', 'cuentas_pagar'),
    transferencia: movimientosSum(fecha, 'egreso', 'efectivo', 'transferencia'),
    otros: movimientosSum(fecha, 'egreso', 'efectivo', 'otros'),
  };
  egresos.total = round2(EGRESO_CATS.reduce((s, c) => s + egresos[c], 0));

  const saldoRow = db.prepare('SELECT saldo_inicial_efectivo FROM caja_saldos_iniciales WHERE fecha = ?').get(fecha);
  const saldo_inicial = saldoRow ? saldoRow.saldo_inicial_efectivo : 0;
  const saldo_final = round2(saldo_inicial + ingresos.total - egresos.total);

  return { saldo_inicial, ingresos, egresos, saldo_final };
}

function porMedio(fecha, tipo, categoria, medios) {
  const out = {};
  for (const m of medios) {
    out[m] = categoria === 'ventas' && m !== 'otros' ? ventasAuto(fecha, m) : movimientosSum(fecha, tipo, m, categoria);
  }
  out.total = round2(medios.reduce((s, m) => s + out[m], 0));
  return out;
}

function buildTarjetaBanco(fecha) {
  const ingresos = {
    ventas: porMedio(fecha, 'ingreso', 'ventas', MEDIOS_TB),
    cuentas_cobrar: porMedio(fecha, 'ingreso', 'cuentas_cobrar', MEDIOS_TB),
    transferencia: porMedio(fecha, 'ingreso', 'transferencia', ['tarjeta', 'banco']),
    otros: porMedio(fecha, 'ingreso', 'otros', MEDIOS_TB),
  };
  ingresos.total = round2(INGRESO_CATS.reduce((s, c) => s + ingresos[c].total, 0));

  const egresos = {
    compras: porMedio(fecha, 'egreso', 'compras', MEDIOS_TB),
    cuentas_pagar: porMedio(fecha, 'egreso', 'cuentas_pagar', MEDIOS_TB),
    transferencia: porMedio(fecha, 'egreso', 'transferencia', ['tarjeta', 'banco']),
    otros: porMedio(fecha, 'egreso', 'otros', MEDIOS_TB),
  };
  egresos.total = round2(EGRESO_CATS.reduce((s, c) => s + egresos[c].total, 0));

  const saldo_final = round2(ingresos.total - egresos.total);
  return { ingresos, egresos, saldo_final };
}

// GET /api/caja?fecha=YYYY-MM-DD
router.get('/', (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const efectivo = buildEfectivo(fecha);
  const tarjeta_banco = buildTarjetaBanco(fecha);
  const movimientos = db.prepare(
    `SELECT cm.*, u.full_name AS usuario_nombre FROM caja_movimientos cm
     LEFT JOIN users u ON u.id = cm.created_by
     WHERE cm.fecha = ? ORDER BY cm.id DESC`
  ).all(fecha);
  res.json({ fecha, efectivo, tarjeta_banco, movimientos });
});

// PUT /api/caja/saldo-inicial { fecha, monto }
router.put('/saldo-inicial', (req, res) => {
  const { fecha, monto } = req.body || {};
  if (!fecha || monto === undefined || monto === null || monto === '') {
    return res.status(400).json({ error: 'fecha y monto son requeridos.' });
  }
  db.prepare(
    `INSERT INTO caja_saldos_iniciales (fecha, saldo_inicial_efectivo, created_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(fecha) DO UPDATE SET saldo_inicial_efectivo = excluded.saldo_inicial_efectivo, updated_at = datetime('now')`
  ).run(fecha, Number(monto), req.user?.id || null);
  res.json({ fecha, saldo_inicial_efectivo: Number(monto) });
});

const VALID_MEDIOS = ['efectivo', 'tarjeta', 'banco', 'otros'];
const VALID_CATEGORIAS = {
  ingreso: ['cuentas_cobrar', 'transferencia', 'otros', 'ventas'],
  egreso: ['compras', 'cuentas_pagar', 'transferencia', 'otros'],
};

// POST /api/caja/movimientos { fecha, tipo, medio, categoria, monto, descripcion }
router.post('/movimientos', (req, res) => {
  const { fecha, tipo, medio, categoria, monto, descripcion } = req.body || {};
  if (!fecha || !tipo || !medio || !categoria || !monto) {
    return res.status(400).json({ error: 'fecha, tipo, medio, categoria y monto son requeridos.' });
  }
  if (!['ingreso', 'egreso'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido.' });
  }
  if (!VALID_MEDIOS.includes(medio)) {
    return res.status(400).json({ error: 'medio invalido.' });
  }
  if (!(VALID_CATEGORIAS[tipo] || []).includes(categoria)) {
    return res.status(400).json({ error: 'categoria invalida para este tipo.' });
  }
  if (categoria === 'ventas' && medio !== 'otros') {
    return res.status(400).json({ error: 'Las ventas en efectivo, tarjeta y banco se calculan automáticamente desde los comprobantes emitidos.' });
  }
  if (categoria === 'transferencia' && medio === 'otros') {
    return res.status(400).json({ error: 'Las transferencias solo aplican a Tarjeta o Banco.' });
  }
  const info = db.prepare(
    `INSERT INTO caja_movimientos (fecha, tipo, medio, categoria, monto, descripcion, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(fecha, tipo, medio, categoria, Number(monto), descripcion || null, req.user?.id || null);
  const row = db.prepare('SELECT * FROM caja_movimientos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// DELETE /api/caja/movimientos/:id
router.delete('/movimientos/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM caja_movimientos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  db.prepare('DELETE FROM caja_movimientos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
