// Cobro recurrente mensual a los clientes de esta empresa (tarjeta
// guardada vía Izipay). Independiente del cobro de la suscripción a la
// plataforma (routes/suscripcion.js) — ver utils/izipay.js.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const izipay = require('../utils/izipay');
const { sumarUnMes } = require('../utils/fechas');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('clientes'));

function suscripcionDeCliente(clientId) {
  return db.prepare(
    `SELECT cs.*, c.nombre AS cliente_nombre, c.email AS cliente_email
     FROM client_suscripciones cs JOIN clients c ON c.id = cs.client_id
     WHERE cs.client_id = ?`
  ).get(clientId);
}

router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT cs.*, c.nombre AS cliente_nombre
     FROM client_suscripciones cs JOIN clients c ON c.id = cs.client_id
     ORDER BY c.nombre ASC`
  ).all();
  res.json(rows);
});

router.get('/:clientId', (req, res) => {
  const suscripcion = suscripcionDeCliente(req.params.clientId);
  if (!suscripcion) return res.status(404).json({ error: 'Este cliente no tiene una suscripción configurada.' });
  const historial = db.prepare(
    'SELECT * FROM client_suscripcion_pagos WHERE suscripcion_id = ? ORDER BY created_at DESC'
  ).all(suscripcion.id);
  res.json({ ...suscripcion, historial, izipay_configurado: izipay.estaConfigurado() });
});

// Pide el formToken para pintar el formulario embebido de Izipay. El monto
// se manda de una vez porque Izipay cobra el primer mes al registrar la
// tarjeta (formAction ASK_REGISTER_PAY, ver utils/izipay.js).
router.post('/:clientId/form-token', requireAccion('clientes', 'gestionar_suscripciones'), async (req, res) => {
  const { monto_mensual, moneda } = req.body || {};
  const monto = Number(monto_mensual || 0);
  if (monto <= 0) return res.status(400).json({ error: 'Ingresa el monto mensual antes de agregar la tarjeta.' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });
  try {
    const resultado = await izipay.crearFormularioRegistro({
      monto,
      moneda: moneda || 'PEN',
      orderId: `sub-cliente-${client.id}-${Date.now()}`,
      email: client.email || 'sin-correo@example.com',
    });
    if (resultado.simulado) return res.status(503).json({ error: resultado.mensaje });
    res.json({ formToken: resultado.formToken, izipay_public_key: resultado.publicKey });
  } catch (err) {
    res.status(502).json({ error: err.message || 'No se pudo iniciar el registro de la tarjeta con Izipay.' });
  }
});

// Crea o actualiza la suscripción de un cliente. Si viene kr_answer/kr_hash
// (respuesta del formulario embebido tras guardar la tarjeta), valida el
// pago y guarda el token; si no vienen, solo actualiza monto/día.
router.post('/:clientId', requireAccion('clientes', 'gestionar_suscripciones'), (req, res) => {
  const { monto_mensual, dia_cobro, moneda, kr_answer, kr_hash } = req.body || {};
  const monto = Number(monto_mensual || 0);
  const dia = Number(dia_cobro || 1);
  if (monto <= 0) return res.status(400).json({ error: 'El monto mensual debe ser mayor a 0.' });
  if (dia < 1 || dia > 28) return res.status(400).json({ error: 'El día de cobro debe estar entre 1 y 28.' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });

  let datosTarjeta = null;
  if (kr_answer) {
    const confirmacion = izipay.confirmarRegistro({ krAnswer: kr_answer, krHash: kr_hash });
    if (!confirmacion.exitoso) return res.status(400).json({ error: confirmacion.mensaje });
    datosTarjeta = confirmacion;
  }

  const existente = suscripcionDeCliente(req.params.clientId);
  const hoy = new Date().toISOString().slice(0, 10);

  if (!existente) {
    const info = db.prepare(
      `INSERT INTO client_suscripciones (
         client_id, monto_mensual, dia_cobro, moneda, izipay_token, tarjeta_marca, tarjeta_ultimos4,
         estado, fecha_inicio, ultimo_cobro_at, proximo_cobro_at, created_by, sucursal_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.params.clientId, monto, dia, moneda || 'PEN',
      datosTarjeta?.paymentMethodToken || null, datosTarjeta?.marca || null, datosTarjeta?.ultimos4 || null,
      datosTarjeta ? 'activa' : 'sin_tarjeta',
      datosTarjeta ? hoy : null,
      datosTarjeta ? hoy : null,
      datosTarjeta ? sumarUnMes(hoy) : null,
      req.user?.id || null, req.user?.sucursal_id || null
    );
    return res.status(201).json(suscripcionDeCliente(req.params.clientId) || { id: info.lastInsertRowid });
  }

  if (datosTarjeta) {
    db.prepare(
      `UPDATE client_suscripciones SET monto_mensual = ?, dia_cobro = ?, moneda = ?,
         izipay_token = ?, tarjeta_marca = ?, tarjeta_ultimos4 = ?, estado = 'activa',
         fecha_inicio = COALESCE(fecha_inicio, ?), ultimo_cobro_at = ?,
         proximo_cobro_at = COALESCE(proximo_cobro_at, ?)
       WHERE client_id = ?`
    ).run(
      monto, dia, moneda || 'PEN', datosTarjeta.paymentMethodToken, datosTarjeta.marca, datosTarjeta.ultimos4,
      hoy, hoy, sumarUnMes(hoy), req.params.clientId
    );
  } else {
    db.prepare('UPDATE client_suscripciones SET monto_mensual = ?, dia_cobro = ? WHERE client_id = ?')
      .run(monto, dia, req.params.clientId);
  }
  res.json(suscripcionDeCliente(req.params.clientId));
});

router.post('/:clientId/pausar', requireAccion('clientes', 'gestionar_suscripciones'), (req, res) => {
  const existente = suscripcionDeCliente(req.params.clientId);
  if (!existente) return res.status(404).json({ error: 'Este cliente no tiene una suscripción configurada.' });
  db.prepare("UPDATE client_suscripciones SET estado = 'pausada' WHERE client_id = ?").run(req.params.clientId);
  res.json(suscripcionDeCliente(req.params.clientId));
});

router.post('/:clientId/reanudar', requireAccion('clientes', 'gestionar_suscripciones'), (req, res) => {
  const existente = suscripcionDeCliente(req.params.clientId);
  if (!existente) return res.status(404).json({ error: 'Este cliente no tiene una suscripción configurada.' });
  if (!existente.izipay_token) return res.status(400).json({ error: 'Este cliente no tiene tarjeta guardada, no se puede reanudar.' });
  db.prepare("UPDATE client_suscripciones SET estado = 'activa' WHERE client_id = ?").run(req.params.clientId);
  res.json(suscripcionDeCliente(req.params.clientId));
});

router.delete('/:clientId', requireAccion('clientes', 'gestionar_suscripciones'), (req, res) => {
  const existente = suscripcionDeCliente(req.params.clientId);
  if (!existente) return res.status(404).json({ error: 'Este cliente no tiene una suscripción configurada.' });
  db.prepare(
    "UPDATE client_suscripciones SET izipay_token = NULL, tarjeta_marca = NULL, tarjeta_ultimos4 = NULL, estado = 'sin_tarjeta' WHERE client_id = ?"
  ).run(req.params.clientId);
  res.json(suscripcionDeCliente(req.params.clientId));
});

module.exports = router;
