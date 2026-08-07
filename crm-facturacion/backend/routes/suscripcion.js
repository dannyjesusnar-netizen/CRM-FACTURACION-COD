// "Mis pagos" — pantalla de Gerencia para ver el costo de la suscripción a
// la plataforma, su fecha de inicio, el historial de cobros, y guardar la
// tarjeta para el cobro recurrente (vía Culqi, ver utils/culqi.js). Nada de
// esto es facturación a los clientes de la empresa — es lo que la empresa
// le paga al dueño de la plataforma por usar el sistema.
const express = require('express');
const tenantRegistry = require('../tenantRegistry');
const culqi = require('../utils/culqi');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireGerencia);

function sinDatosSensibles(tenant) {
  if (!tenant) return null;
  const {
    db_file, culqi_customer_id, culqi_card_id, terminos_aceptados_at, ...rest
  } = tenant;
  return { ...rest, tiene_tarjeta: Boolean(culqi_card_id) };
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
    culqi_public_key: process.env.CULQI_PUBLIC_KEY || null,
  });
});

// POST /api/suscripcion/tarjeta { token_id } — token de un solo uso que
// generó Culqi.js en el navegador (nunca pasa el número de tarjeta real
// por este backend).
router.post('/tarjeta', async (req, res) => {
  if (!req.user.ruc) {
    return res.status(404).json({ error: 'Esta instancia no tiene una suscripción a la plataforma configurada.' });
  }
  const { token_id } = req.body || {};
  if (!token_id) {
    return res.status(400).json({ error: 'Falta el token de la tarjeta.' });
  }
  const tenant = tenantRegistry.findTenant(req.user.ruc);
  if (!tenant) {
    return res.status(404).json({ error: 'No se encontró tu empresa en el registro de la plataforma.' });
  }
  if (!culqi.estaConfigurado()) {
    return res.status(503).json({ error: 'El cobro de suscripciones todavía no está configurado en este servidor (falta CULQI_SECRET_KEY).' });
  }
  try {
    const resultado = await culqi.guardarTarjeta({
      tokenId: token_id,
      customerId: tenant.culqi_customer_id,
      email: req.user.username?.includes('@') ? req.user.username : `${req.user.username}@example.com`,
      nombres: req.user.full_name,
      ruc: tenant.ruc,
    });
    const actualizado = tenantRegistry.guardarTarjeta(tenant.ruc, {
      culqi_customer_id: resultado.customerId,
      culqi_card_id: resultado.cardId,
      tarjeta_marca: resultado.marca,
      tarjeta_ultimos4: resultado.ultimos4,
    });
    res.json({ suscripcion: sinDatosSensibles(actualizado) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo guardar la tarjeta.' });
  }
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
