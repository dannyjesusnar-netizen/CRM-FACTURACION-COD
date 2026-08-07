const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('caja'));
router.use(resolveSucursal);

const INGRESO_CATS = ['ventas', 'cuentas_cobrar', 'transferencia', 'otros'];
const EGRESO_CATS = ['compras', 'cuentas_pagar', 'transferencia', 'otros'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Ventas cobradas directamente (no abonado) con este método: se leen tal
// cual de invoices.forma_pago, no de caja_movimientos — es la fuente de
// verdad de "cuánto se vendió hoy con Yape/Efectivo/POS/...".
// moneda/empleadoId son opcionales: acotan a una moneda (invoices.moneda) y/o
// a quien registró la venta (invoices.created_by).
function ventasAuto(fecha, codigoMetodo, sucursalId, moneda, empleadoId) {
  let sql = `SELECT COALESCE(SUM(total), 0) AS total FROM invoices
     WHERE date(fecha_emision) = date(?) AND forma_pago = ? AND estado = 'emitido'
       AND tipo_comprobante != 'nota_credito' AND sucursal_id = ?`;
  const params = [fecha, codigoMetodo, sucursalId];
  if (moneda) { sql += ' AND moneda = ?'; params.push(moneda); }
  if (empleadoId) { sql += ' AND created_by = ?'; params.push(empleadoId); }
  const row = db.prepare(sql).get(...params);
  return round2(row.total);
}

// Los movimientos manuales (y los que el sistema registra automáticamente al
// abonar/cobrar una venta) no llevan moneda propia — siempre fueron en
// soles. Por eso, cuando se filtra por Dólares, estas líneas se excluyen
// entero (no hay nada en USD que mostrar ahí) en vez de sumarlas mal.
function movimientosSum(fecha, tipo, medio, categoria, sucursalId, moneda, empleadoId) {
  if (moneda === 'USD') return 0;
  let sql = `SELECT COALESCE(SUM(monto), 0) AS total FROM caja_movimientos
     WHERE fecha = ? AND tipo = ? AND medio = ? AND categoria = ? AND sucursal_id = ?`;
  const params = [fecha, tipo, medio, categoria, sucursalId];
  if (empleadoId) { sql += ' AND created_by = ?'; params.push(empleadoId); }
  const row = db.prepare(sql).get(...params);
  return round2(row.total);
}

// Arqueo del día, uno por cada método de pago activo (Efectivo, Yape, Plin,
// POS, ... según lo que Gerencia tenga configurado en Configuración ->
// Métodos de pago). Efectivo es el único con "saldo inicial" real (billetes
// físicos en caja); el resto no arrastra saldo de un día a otro.
function buildResumen(fecha, sucursalId, { moneda, empleadoId } = {}) {
  const metodos = db.prepare('SELECT * FROM metodos_pago WHERE activo = 1 ORDER BY orden ASC, id ASC').all();
  return metodos.map((m) => {
    const ingresos = {
      // Ventas con un solo método (forma_pago directo) + el tramo que le
      // corresponde a este método en ventas con "pago mixto" (que se
      // registran como caja_movimientos categoria 'ventas', uno por medio).
      ventas: round2(
        ventasAuto(fecha, m.codigo, sucursalId, moneda, empleadoId)
        + movimientosSum(fecha, 'ingreso', m.codigo, 'ventas', sucursalId, moneda, empleadoId)
      ),
      cuentas_cobrar: movimientosSum(fecha, 'ingreso', m.codigo, 'cuentas_cobrar', sucursalId, moneda, empleadoId),
      transferencia: movimientosSum(fecha, 'ingreso', m.codigo, 'transferencia', sucursalId, moneda, empleadoId),
      otros: movimientosSum(fecha, 'ingreso', m.codigo, 'otros', sucursalId, moneda, empleadoId),
    };
    ingresos.total = round2(INGRESO_CATS.reduce((s, c) => s + ingresos[c], 0));

    const egresos = {
      compras: movimientosSum(fecha, 'egreso', m.codigo, 'compras', sucursalId, moneda, empleadoId),
      cuentas_pagar: movimientosSum(fecha, 'egreso', m.codigo, 'cuentas_pagar', sucursalId, moneda, empleadoId),
      transferencia: movimientosSum(fecha, 'egreso', m.codigo, 'transferencia', sucursalId, moneda, empleadoId),
      otros: movimientosSum(fecha, 'egreso', m.codigo, 'otros', sucursalId, moneda, empleadoId),
    };
    egresos.total = round2(EGRESO_CATS.reduce((s, c) => s + egresos[c], 0));

    // El saldo inicial (billetes físicos con los que abrió la caja) solo
    // existe para Efectivo, y solo tiene sentido sin filtros activos — es un
    // monto real de un día puntual, no algo que se pueda "acotar" por
    // empleado o dividir por moneda.
    let saldo_inicial = 0;
    if (m.codigo === 'efectivo' && !moneda && !empleadoId) {
      const saldoRow = db.prepare('SELECT saldo_inicial_efectivo FROM caja_saldos_iniciales WHERE fecha = ? AND sucursal_id = ?').get(fecha, sucursalId);
      saldo_inicial = saldoRow ? saldoRow.saldo_inicial_efectivo : 0;
    }
    const saldo_final = round2(saldo_inicial + ingresos.total - egresos.total);

    return {
      codigo: m.codigo, nombre: m.nombre, tipo: m.tipo, color: m.color, icono: m.icono,
      saldo_inicial, ingresos, egresos, saldo_final,
    };
  });
}

// GET /api/caja?fecha=YYYY-MM-DD&moneda=PEN|USD&empleado_id=
router.get('/', (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const moneda = ['PEN', 'USD'].includes(req.query.moneda) ? req.query.moneda : null;
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
  res.json({ fecha, resumen, movimientos, totalGeneral });
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
  if (!fecha || !tipo || !medio || !categoria || !monto) {
    return res.status(400).json({ error: 'fecha, tipo, medio, categoria y monto son requeridos.' });
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
  ).run(fecha, tipo, medio, categoria, Number(monto), descripcion || null, req.user?.id || null, req.sucursalId);
  const row = db.prepare('SELECT * FROM caja_movimientos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// DELETE /api/caja/movimientos/:id
router.delete('/movimientos/:id', requireAccion('caja', 'eliminar_movimiento'), (req, res) => {
  const row = db.prepare('SELECT * FROM caja_movimientos WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!row) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  db.prepare('DELETE FROM caja_movimientos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
