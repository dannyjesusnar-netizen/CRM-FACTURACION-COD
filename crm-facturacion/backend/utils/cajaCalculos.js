const db = require('../db');

const INGRESO_CATS = ['ventas', 'cuentas_cobrar', 'transferencia', 'otros'];
const EGRESO_CATS = ['compras', 'cuentas_pagar', 'transferencia', 'otros'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Ventas cobradas directamente (no abonado) con este método: se leen tal
// cual de invoices.forma_pago, no de caja_movimientos — es la fuente de
// verdad de "cuánto se vendió con Yape/Efectivo/POS/..." en el rango
// desde-hasta (un solo día cuando desde === hasta).
// moneda/empleadoId son opcionales: acotan a una moneda (invoices.moneda) y/o
// a quien registró la venta (invoices.created_by).
//
// Las Notas de Venta Interna (tabla notas_venta) pagadas de una vez con este
// método también cuentan aquí — solo las que NO son "abonado", porque esas
// se cobran vía caja_movimientos categoria 'cuentas_cobrar' (ver
// movimientosSum), no como venta directa.
function ventasAuto(desde, hasta, codigoMetodo, sucursalId, moneda, empleadoId) {
  let sql = `SELECT COALESCE(SUM(total), 0) AS total FROM invoices
     WHERE date(fecha_emision) BETWEEN date(?) AND date(?) AND forma_pago = ? AND estado = 'emitido'
       AND tipo_comprobante != 'nota_credito' AND sucursal_id = ?`;
  const params = [desde, hasta, codigoMetodo, sucursalId];
  if (moneda) { sql += ' AND moneda = ?'; params.push(moneda); }
  if (empleadoId) { sql += ' AND created_by = ?'; params.push(empleadoId); }
  const totalInvoices = db.prepare(sql).get(...params).total;

  let sqlNv = `SELECT COALESCE(SUM(total), 0) AS total FROM notas_venta
     WHERE date(fecha_emision) BETWEEN date(?) AND date(?) AND forma_pago = ? AND estado = 'emitido' AND sucursal_id = ?`;
  const paramsNv = [desde, hasta, codigoMetodo, sucursalId];
  if (moneda) { sqlNv += ' AND moneda = ?'; paramsNv.push(moneda); }
  if (empleadoId) { sqlNv += ' AND created_by = ?'; paramsNv.push(empleadoId); }
  const totalNotasVenta = db.prepare(sqlNv).get(...paramsNv).total;

  return round2(totalInvoices + totalNotasVenta);
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
function movimientosSum(desde, hasta, tipo, medio, categoria, sucursalId, moneda, empleadoId) {
  if (moneda === 'USD') return 0;
  let sql = `SELECT COALESCE(SUM(cm.monto), 0) AS total FROM caja_movimientos cm
     LEFT JOIN invoices i ON i.id = cm.invoice_id
     LEFT JOIN notas_venta nv ON nv.id = cm.nota_venta_id
     WHERE cm.fecha BETWEEN ? AND ? AND cm.tipo = ? AND cm.medio = ? AND cm.categoria = ? AND cm.sucursal_id = ?
       AND (cm.invoice_id IS NULL OR i.estado != 'anulado')
       AND (cm.nota_venta_id IS NULL OR nv.estado != 'anulado')`;
  const params = [desde, hasta, tipo, medio, categoria, sucursalId];
  if (empleadoId) { sql += ' AND cm.created_by = ?'; params.push(empleadoId); }
  const row = db.prepare(sql).get(...params);
  return round2(row.total);
}

// Total vendido "abonado" (crédito) en el rango, sin importar cuánto se
// cobró realmente — es lo que se está fiando ese día, no dinero en caja.
// Por eso NO se mezcla con ingresos.ventas de los métodos reales: lo que sí
// se cobra de un abono ya cuenta aparte, bajo el método real usado (ver
// movimientosSum categoria 'cuentas_cobrar').
function totalAbonadoDia(desde, hasta, sucursalId, moneda, empleadoId) {
  let sqlInv = `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad FROM invoices
     WHERE forma_pago = 'abonado' AND estado = 'emitido' AND tipo_comprobante IN ('boleta', 'factura')
       AND date(fecha_emision) BETWEEN date(?) AND date(?) AND sucursal_id = ?`;
  const paramsInv = [desde, hasta, sucursalId];
  if (moneda) { sqlInv += ' AND moneda = ?'; paramsInv.push(moneda); }
  if (empleadoId) { sqlInv += ' AND created_by = ?'; paramsInv.push(empleadoId); }
  const inv = db.prepare(sqlInv).get(...paramsInv);

  let sqlNv = `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad FROM notas_venta
     WHERE forma_pago = 'abonado' AND estado = 'emitido'
       AND date(fecha_emision) BETWEEN date(?) AND date(?) AND sucursal_id = ?`;
  const paramsNv = [desde, hasta, sucursalId];
  if (moneda) { sqlNv += ' AND moneda = ?'; paramsNv.push(moneda); }
  if (empleadoId) { sqlNv += ' AND created_by = ?'; paramsNv.push(empleadoId); }
  const nv = db.prepare(sqlNv).get(...paramsNv);

  return { total: round2(inv.total + nv.total), cantidad: inv.cantidad + nv.cantidad };
}

// Arqueo del período (uno por cada método de pago activo: Efectivo, Yape,
// Plin, POS, ... según lo que Gerencia tenga configurado en Configuración ->
// Métodos de pago). desde/hasta delimitan el rango — para el arqueo de un
// solo día se llama con desde === hasta, igual que siempre.
//
// Efectivo es el único con "saldo inicial" real (billetes físicos en caja):
// para un rango se toma el saldo con el que abrió el primer día (desde), y
// saldo_final = ese saldo_inicial + ingresos del rango completo - egresos
// del rango completo — o sea, cuánto quedaría en caja al cierre de "hasta".
function buildResumen(desde, hasta, sucursalId, { moneda, empleadoId } = {}) {
  const metodos = db.prepare('SELECT * FROM metodos_pago WHERE activo = 1 ORDER BY orden ASC, id ASC').all();
  const resumen = metodos.map((m) => {
    const ingresos = {
      // Ventas con un solo método (forma_pago directo) + el tramo que le
      // corresponde a este método en ventas con "pago mixto" (que se
      // registran como caja_movimientos categoria 'ventas', uno por medio).
      ventas: round2(
        ventasAuto(desde, hasta, m.codigo, sucursalId, moneda, empleadoId)
        + movimientosSum(desde, hasta, 'ingreso', m.codigo, 'ventas', sucursalId, moneda, empleadoId)
      ),
      cuentas_cobrar: movimientosSum(desde, hasta, 'ingreso', m.codigo, 'cuentas_cobrar', sucursalId, moneda, empleadoId),
      transferencia: movimientosSum(desde, hasta, 'ingreso', m.codigo, 'transferencia', sucursalId, moneda, empleadoId),
      otros: movimientosSum(desde, hasta, 'ingreso', m.codigo, 'otros', sucursalId, moneda, empleadoId),
    };
    ingresos.total = round2(INGRESO_CATS.reduce((s, c) => s + ingresos[c], 0));

    const egresos = {
      compras: movimientosSum(desde, hasta, 'egreso', m.codigo, 'compras', sucursalId, moneda, empleadoId),
      cuentas_pagar: movimientosSum(desde, hasta, 'egreso', m.codigo, 'cuentas_pagar', sucursalId, moneda, empleadoId),
      transferencia: movimientosSum(desde, hasta, 'egreso', m.codigo, 'transferencia', sucursalId, moneda, empleadoId),
      otros: movimientosSum(desde, hasta, 'egreso', m.codigo, 'otros', sucursalId, moneda, empleadoId),
    };
    egresos.total = round2(EGRESO_CATS.reduce((s, c) => s + egresos[c], 0));

    // El saldo inicial (billetes físicos con los que abrió la caja) solo
    // existe para Efectivo en soles, y solo tiene sentido sin más filtros
    // activos — es un monto real del primer día del rango, no algo que se
    // pueda "acotar" por empleado, y no existe versión en dólares.
    let saldo_inicial = 0;
    if (m.codigo === 'efectivo' && moneda === 'PEN' && !empleadoId) {
      const saldoRow = db.prepare('SELECT saldo_inicial_efectivo FROM caja_saldos_iniciales WHERE fecha = ? AND sucursal_id = ?').get(desde, sucursalId);
      saldo_inicial = saldoRow ? saldoRow.saldo_inicial_efectivo : 0;
    }
    const saldo_final = round2(saldo_inicial + ingresos.total - egresos.total);

    return {
      codigo: m.codigo, nombre: m.nombre, tipo: m.tipo, color: m.color, icono: m.icono,
      saldo_inicial, ingresos, egresos, saldo_final,
    };
  });

  // "Abonados" no es un método de pago real (no hay billetes que contar
  // aparte), así que no forma parte del catálogo metodos_pago ni de
  // saldo_final (queda en 0 a propósito, para no inflar el total general de
  // caja) — es solo informativo: cuánto se vendió a crédito hoy, para que
  // Gerencia lo vea junto a Efectivo/Yape/Plin igual que pidió.
  const abonadoDia = totalAbonadoDia(desde, hasta, sucursalId, moneda, empleadoId);
  resumen.push({
    codigo: 'abonado', nombre: 'Abonados', tipo: 'credito', color: '#f59e0b', icono: '🧾',
    saldo_inicial: 0,
    ingresos: { ventas: abonadoDia.total, cuentas_cobrar: 0, transferencia: 0, otros: 0, total: abonadoDia.total },
    egresos: { compras: 0, cuentas_pagar: 0, transferencia: 0, otros: 0, total: 0 },
    saldo_final: 0,
    cantidad: abonadoDia.cantidad,
  });

  return resumen;
}

module.exports = { round2, INGRESO_CATS, EGRESO_CATS, ventasAuto, movimientosSum, buildResumen };
