const db = require('../db');
const { round2 } = require('./cajaCalculos');

const CATEGORIAS = ['trainer', 'supervisor', 'vendedor'];

// Categoría de personal (users.categoria_staff) a la que pertenece el
// atribuido de una venta al crédito, para saber qué tope de
// limites_abonado le aplica. Gerencia no tiene tope (null).
function categoriaDe(userId) {
  if (!userId) return null;
  const u = db.prepare('SELECT categoria_staff, role FROM users WHERE id = ?').get(userId);
  if (!u || u.role === 'gerencia') return null;
  return CATEGORIAS.includes(u.categoria_staff) ? u.categoria_staff : null;
}

function limiteDe(categoria) {
  if (!categoria) return null;
  const fila = db.prepare('SELECT monto_maximo FROM limites_abonado WHERE categoria_staff = ?').get(categoria);
  return fila ? fila.monto_maximo : null;
}

// Excepción puntual de UNA persona (ver limites_abonado_usuario) — null si
// Gerencia nunca le puso una a esta persona.
function limiteOverrideDe(userId) {
  if (!userId) return null;
  const fila = db.prepare('SELECT monto_maximo FROM limites_abonado_usuario WHERE user_id = ?').get(userId);
  return fila ? fila.monto_maximo : null;
}

// Tope que de verdad le aplica a esta persona: su excepción individual si
// Gerencia le puso una, si no el de su categoría (trainer/supervisor/
// vendedor), si no null (sin tope). { limite, esPersonal } — esPersonal
// dice si el tope que ganó es la excepción individual, para el mensaje de
// error de validarLimiteAbonado.
function limiteEfectivoDe(userId, categoria) {
  const override = limiteOverrideDe(userId);
  if (override != null) return { limite: override, esPersonal: true };
  return { limite: limiteDe(categoria), esPersonal: false };
}

// Deuda pendiente total (ventas "abonado" emitidas, con saldo > 0)
// atribuida hoy a esta persona — mismo criterio de atribución que el
// Tablero de Ventas: COALESCE(atribuido_a, created_by). Suma Notas de
// Venta Interna (notas_venta, la única forma de vender al crédito hoy) y
// Facturas/Boletas (invoices) por si quedó alguna "abonado" de antes de
// que esa venta se moviera por completo a Nota de Venta Interna (ver
// routes/invoices.js POST /).
function deudaPendienteDe(userId) {
  const { t } = db.prepare(
    `SELECT COALESCE(SUM(total - monto_pagado), 0) AS t FROM invoices
     WHERE forma_pago = 'abonado' AND estado = 'emitido' AND tipo_comprobante != 'nota_credito'
       AND COALESCE(atribuido_a, created_by) = ?`
  ).get(userId);
  const { t: t2 } = db.prepare(
    `SELECT COALESCE(SUM(total - monto_pagado), 0) AS t FROM notas_venta
     WHERE forma_pago = 'abonado' AND estado = 'emitido'
       AND COALESCE(atribuido_a, created_by) = ?`
  ).get(userId);
  return round2(t + t2);
}

// Valida que atribuirle a `userId` una venta al crédito nueva, con
// `saldoPendienteNuevo` (total - monto pagado ahora) de saldo, no haga que
// su deuda pendiente total supere el tope de Gerencia para su categoría
// (Configuración → Métodos de pago → Límite de venta al crédito). Devuelve
// un mensaje de error listo para el 400, o null si no hay problema (incluye
// el caso sin tope configurado para esa categoría, o sin atribución
// resuelta — p.ej. venta de Gerencia).
function validarLimiteAbonado(userId, saldoPendienteNuevo) {
  if (!(saldoPendienteNuevo > 0)) return null;
  const categoria = categoriaDe(userId);
  if (!categoria) return null;
  const { limite, esPersonal } = limiteEfectivoDe(userId, categoria);
  if (limite == null) return null;
  const deudaActual = deudaPendienteDe(userId);
  const deudaTotal = round2(deudaActual + saldoPendienteNuevo);
  if (deudaTotal > limite + 0.005) {
    const persona = db.prepare('SELECT full_name FROM users WHERE id = ?').get(userId);
    const etiquetaCategoria = categoria === 'trainer' ? 'Trainer' : categoria === 'supervisor' ? 'Supervisor' : 'Vendedor';
    const etiquetaCategoriaPlural = categoria === 'trainer' ? 'Trainers' : categoria === 'supervisor' ? 'Supervisores' : 'Vendedores';
    const origenTope = esPersonal
      ? 'que Gerencia le puso a esta persona en particular'
      : `que Gerencia puso para ${etiquetaCategoriaPlural}`;
    return `${persona?.full_name || 'Esta persona'} (${etiquetaCategoria}) ya tiene S/ ${deudaActual.toFixed(2)} en ventas abonadas sin cobrar — con esta venta llegaría a S/ ${deudaTotal.toFixed(2)}, por encima del tope de S/ ${limite.toFixed(2)} ${origenTope}.`;
  }
  return null;
}

module.exports = {
  CATEGORIAS, categoriaDe, limiteDe, limiteOverrideDe, limiteEfectivoDe, deudaPendienteDe, validarLimiteAbonado,
};
