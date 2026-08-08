// "Mis pagos" — pantalla de Gerencia para ver el costo de la suscripción a
// la plataforma, su fecha de inicio, el historial de cobros, y guardar la
// tarjeta para el cobro recurrente (vía Izipay, ver utils/izipay.js). Nada
// de esto es facturación a los clientes de la empresa — es lo que la
// empresa le paga al dueño de la plataforma por usar el sistema.
const express = require('express');
const tenantRegistry = require('../tenantRegistry');
const izipay = require('../utils/izipay');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireGerencia);

function sinDatosSensibles(tenant) {
  if (!tenant) return null;
  const { db_file, izipay_token, terminos_aceptados_at, ...rest } = tenant;
  return { ...rest, tiene_tarjeta: Boolean(izipay_token) };
}

function emailDeGerencia(req) {
  return req.user.username?.includes('@') ? req.user.username : `${req.user.username}@example.com`;
}

// GET /api/suscripcion — req.user.ruc solo existe para empresas que pasaron
// por "Registrar mi empresa" (ver login en routes/auth.js); la instancia
// original de este despliegue no tiene suscripción configurada.
router.get('/', (req, res) => {
  if (!req.user.ruc) {
    return res.status(404).json({ error: 'Esta instancia no tiene una suscripción a la plataforma configurada.' });
  }
  const tenant = tenantRegistry.findTenant(req.user.ruc);
  if (!tenant) {
    return res.status(404).json({ error: 'No se encontró tu empresa en el registro de la plataforma.' });
  }
  res.json({
    suscripcion: sinDatosSensibles(tenant),
    historial: tenantRegistry.listarPagos(req.user.ruc),
  });
});

// POST /api/suscripcion/form-token — pide el formToken para pintar el
// formulario embebido de Izipay (KR.js) en el navegador.
router.post('/form-token', async (req, res) => {
  if (!req.user.ruc) {
    return res.status(404).json({ error: 'Esta instancia no tiene una suscripción a la plataforma configurada.' });
  }
  const tenant = tenantRegistry.findTenant(req.user.ruc);
  if (!tenant) {
    return res.status(404).json({ error: 'No se encontró tu empresa en el registro de la plataforma.' });
  }
  if (!tenant.costo_mensual) {
    return res.status(400).json({ error: 'Todavía no tienes un costo de suscripción asignado. Contacta al soporte de la plataforma.' });
  }
  try {
    const resultado = await izipay.crearFormularioRegistro({
      monto: tenant.costo_mensual,
      orderId: `sub-plataforma-${tenant.ruc}-${Date.now()}`,
      email: emailDeGerencia(req),
    });
    if (resultado.simulado) return res.status(503).json({ error: resultado.mensaje });
    res.json({ formToken: resultado.formToken, izipay_public_key: resultado.publicKey });
  } catch (err) {
    res.status(502).json({ error: err.message || 'No se pudo iniciar el registro de la tarjeta con Izipay.' });
  }
});

// POST /api/suscripcion/tarjeta { kr_answer, kr_hash } — respuesta del
// formulario embebido tras guardar la tarjeta (nunca pasa el número real
// por este backend, ver utils/izipay.js).
router.post('/tarjeta', (req, res) => {
  if (!req.user.ruc) {
    return res.status(404).json({ error: 'Esta instancia no tiene una suscripción a la plataforma configurada.' });
  }
  const { kr_answer, kr_hash } = req.body || {};
  if (!kr_answer) {
    return res.status(400).json({ error: 'Falta la respuesta del formulario de Izipay.' });
  }
  const tenant = tenantRegistry.findTenant(req.user.ruc);
  if (!tenant) {
    return res.status(404).json({ error: 'No se encontró tu empresa en el registro de la plataforma.' });
  }
  const confirmacion = izipay.confirmarRegistro({ krAnswer: kr_answer, krHash: kr_hash });
  if (!confirmacion.exitoso) return res.status(400).json({ error: confirmacion.mensaje });
  const actualizado = tenantRegistry.guardarTarjeta(tenant.ruc, {
    izipay_token: confirmacion.paymentMethodToken,
    tarjeta_marca: confirmacion.marca,
    tarjeta_ultimos4: confirmacion.ultimos4,
  });
  res.json({ suscripcion: sinDatosSensibles(actualizado) });
});

// DELETE /api/suscripcion/tarjeta — quita la tarjeta guardada (el cobro
// recurrente se pausa hasta que se agregue una nueva).
router.delete('/tarjeta', (req, res) => {
  if (!req.user.ruc) {
    return res.status(404).json({ error: 'Esta instancia no tiene una suscripción a la plataforma configurada.' });
  }
  const actualizado = tenantRegistry.quitarTarjeta(req.user.ruc);
  res.json({ suscripcion: sinDatosSensibles(actualizado) });
});

module.exports = router;
