const db = require('../db');

const INGRESO_CATS = ['ventas', 'cuentas_cobrar', 'transferencia', 'otros'];
const EGRESO_CATS = ['compras', 'cuentas_pagar', 'transferencia', 'otros'];

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
//
// Los movimientos ligados a un comprobante (invoice_id, ver mixto/abonado/
// cobros) se excluyen del arqueo si ese comprobante terminó anulado — de lo
// contrario una venta anulada sigue apareciendo como dinero cobrado en Caja
// para siempre.
function movimientosSum(fecha, tipo, medio, categoria, sucursalId, moneda, empleadoId) {
  if (moneda === 'USD') return 0;
  let sql = `SELECT COALESCE(SUM(cm.monto), 0) AS total FROM caja_movimientos cm
     LEFT JOIN invoices i ON i.id = cm.invoice_id
     LEFT JOIN notas_venta nv ON nv.id = cm.nota_venta_id
     WHERE cm.fecha = ? AND cm.tipo = ? AND cm.medio = ? AND cm.categoria = ? AND cm.sucursal_id = ?
       AND (cm.invoice_id IS NULL OR i.estado != 'anulado')
       AND (cm.nota_venta_id IS NULL OR nv.estado != 'anulado')`;
  const params = [fecha, tipo, medio, categoria, sucursalId];
  if (empleadoId) { sql += ' AND cm.created_by = ?'; params.push(empleadoId); }
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
    // existe para Efectivo en soles, y solo tiene sentido sin más filtros
    // activos — es un monto real de un día puntual, no algo que se pueda
    // "acotar" por empleado, y no existe versión en dólares.
    let saldo_inicial = 0;
    if (m.codigo === 'efectivo' && moneda === 'PEN' && !empleadoId) {
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

module.exports = { round2, INGRESO_CATS, EGRESO_CATS, ventasAuto, movimientosSum, buildResumen };
