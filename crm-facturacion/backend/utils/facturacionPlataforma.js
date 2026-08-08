// Motor de cobro recurrente de la suscripción a la plataforma. Corre
// periódicamente (ver server.js) buscando empresas cuyo "próximo cobro" ya
// venció y con tarjeta guardada, y les cobra el costo mensual que les
// asignó el dueño de la plataforma vía panel central.
const tenantRegistry = require('../tenantRegistry');
const culqi = require('./culqi');
const db = require('../db');
const { sumarUnMes } = require('./fechas');

// Nombre + email de contacto para el cargo en Culqi: usa la cuenta
// Gerencia de esa empresa (primer usuario, sembrado al registrarse).
function contactoDeEmpresa(tenant) {
  const tenantDb = db.openTenantDb(tenant.db_file);
  const gerente = tenantDb.prepare("SELECT email, full_name FROM users WHERE role = 'gerencia' ORDER BY id ASC LIMIT 1").get();
  return { email: gerente?.email || 'sin-correo@example.com', nombre: gerente?.full_name || tenant.razon_social };
}

async function cobrarEmpresa(tenant) {
  const { email } = contactoDeEmpresa(tenant);
  const resultado = await culqi.cobrar({
    monto: tenant.costo_mensual,
    cardId: tenant.culqi_card_id,
    email,
    descripcion: `Suscripción plataforma — ${tenant.razon_social} (RUC ${tenant.ruc})`,
  });
  const proximoCobro = sumarUnMes(tenant.proximo_cobro_at);
  tenantRegistry.registrarPago(tenant.ruc, {
    monto: tenant.costo_mensual,
    estado: resultado.exitoso ? 'exitoso' : 'fallido',
    culqi_cargo_id: resultado.cargoId || null,
    mensaje: resultado.mensaje,
    proximo_cobro_at: proximoCobro,
  });
  return resultado;
}

// Procesa todas las empresas con cobro vencido. Nunca lanza: cada cobro
// fallido queda registrado, no interrumpe a los demás.
async function procesarCobrosVencidos() {
  const pendientes = tenantRegistry.tenantsConCobroVencido();
  const resultados = [];
  for (const tenant of pendientes) {
    try {
      const resultado = await cobrarEmpresa(tenant);
      resultados.push({ ruc: tenant.ruc, ...resultado });
    } catch (err) {
      resultados.push({ ruc: tenant.ruc, exitoso: false, mensaje: err.message });
    }
  }
  return resultados;
}

module.exports = { procesarCobrosVencidos, cobrarEmpresa, sumarUnMes };
