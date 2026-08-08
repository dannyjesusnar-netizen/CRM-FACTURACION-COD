// Motor de cobro recurrente a los CLIENTES de esta empresa (ver
// utils/izipay.js y routes/suscripcionesClientes.js). Corre
// periódicamente (ver server.js) buscando suscripciones cuyo "próximo
// cobro" ya venció y con tarjeta guardada, y les cobra el monto mensual
// configurado. Es el análogo de utils/facturacionPlataforma.js, pero para
// clientes en vez de para la suscripción a la plataforma.
const db = require('../db');
const izipay = require('./izipay');
const { sumarUnMes } = require('./fechas');

async function cobrarSuscripcionCliente(suscripcion, cliente) {
  const resultado = await izipay.cobrar({
    monto: suscripcion.monto_mensual,
    moneda: suscripcion.moneda,
    paymentMethodToken: suscripcion.izipay_token,
    orderId: `sub-${suscripcion.id}-${Date.now()}`,
    email: cliente.email || 'sin-correo@example.com',
    descripcion: `Suscripción mensual — ${cliente.nombre}`,
  });
  const proximoCobro = sumarUnMes(suscripcion.proximo_cobro_at);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO client_suscripcion_pagos (suscripcion_id, monto, estado, izipay_cargo_id, mensaje)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      suscripcion.id,
      suscripcion.monto_mensual,
      resultado.exitoso ? 'exitoso' : 'fallido',
      resultado.cargoId || null,
      resultado.mensaje || null
    );
    db.prepare(
      `UPDATE client_suscripciones SET estado = ?, ultimo_cobro_at = date('now'), proximo_cobro_at = ? WHERE id = ?`
    ).run(resultado.exitoso ? 'activa' : 'pago_fallido', proximoCobro, suscripcion.id);
  })();
  return resultado;
}

// Procesa todas las suscripciones con cobro vencido. Nunca lanza: cada
// cobro fallido queda registrado, no interrumpe a los demás.
async function procesarCobrosClientesVencidos() {
  const pendientes = db.prepare(
    `SELECT cs.*, c.nombre AS cliente_nombre, c.email AS cliente_email
     FROM client_suscripciones cs
     JOIN clients c ON c.id = cs.client_id
     WHERE cs.estado IN ('activa', 'pago_fallido')
       AND cs.izipay_token IS NOT NULL
       AND cs.proximo_cobro_at IS NOT NULL
       AND cs.proximo_cobro_at <= date('now')`
  ).all();
  const resultados = [];
  for (const suscripcion of pendientes) {
    try {
      const resultado = await cobrarSuscripcionCliente(suscripcion, {
        nombre: suscripcion.cliente_nombre,
        email: suscripcion.cliente_email,
      });
      resultados.push({ suscripcionId: suscripcion.id, ...resultado });
    } catch (err) {
      resultados.push({ suscripcionId: suscripcion.id, exitoso: false, mensaje: err.message });
    }
  }
  return resultados;
}

module.exports = { procesarCobrosClientesVencidos, cobrarSuscripcionCliente };
