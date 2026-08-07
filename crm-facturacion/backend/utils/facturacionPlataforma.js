// Motor de cobro recurrente de la suscripción a la plataforma. Corre
// periódicamente (ver server.js) buscando empresas cuyo "próximo cobro" ya
// venció y con tarjeta guardada, y les cobra el costo mensual que les
// asignó el dueño de la plataforma vía panel central.
const tenantRegistry = require('../tenantRegistry');
const culqi = require('./culqi');
const db = require('../db');

// Súmale un mes a una fecha YYYY-MM-DD sin depender de librerías externas.
// Si el mes siguiente no tiene ese día (ej. 31 de enero -> febrero), cae en
// el último día de ese mes — evita fechas inválidas como "31 de febrero".
function sumarUnMes(fechaISO) {
  const [y, m, d] = fechaISO.slice(0, 10).split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  const mesDestino = fecha.getUTCMonth() + 1;
  fecha.setUTCMonth(mesDestino);
  if (fecha.getUTCMonth() !== ((mesDestino % 12 + 12) % 12)) {
    fecha.setUTCDate(0); // retrocede al último día del mes destino
  }
  return fecha.toISOString().slice(0, 10);
}

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
