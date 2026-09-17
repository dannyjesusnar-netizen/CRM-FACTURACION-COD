// Tarea de fondo que mantiene sunat_estado al día solo, sin que nadie tenga
// que ir a mirar el panel de Nubefact ni hacer clic en nada: sunat_estado
// se graba una sola vez al emitir el comprobante, así que una boleta que
// queda "pendiente" porque SUNAT todavía no había respondido en ese
// instante (normal — SUNAT confirma boletas al día siguiente por el
// Resumen Diario) se queda así para siempre si nadie vuelve a preguntar.
// Programada en server.js; también existe un botón manual
// (routes/invoices.js:sincronizar-sunat) para forzarlo antes si hace falta.
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { consultarComprobante, estaConfigurado } = require('./facturacionElectronica');

// Corre dentro del contexto de UNA empresa ya seleccionado (ver
// db.runWithDb más abajo) — revisa sus boletas 'pendiente' (todas las
// sedes) y actualiza las que SUNAT ya haya respondido.
async function sincronizarPendientesDeEmpresa() {
  if (!estaConfigurado()) return;
  // Margen de 3 horas antes de volver a preguntar: recién emitida, lo
  // normal es que siga pendiente el resto del día — no tiene sentido
  // consultar de inmediato.
  const pendientes = db.prepare(
    `SELECT * FROM invoices WHERE estado = 'emitido' AND modo_emision = 'real' AND sunat_estado = 'pendiente'
     AND datetime(created_at) <= datetime('now', '-3 hours')`
  ).all();
  for (const invoice of pendientes) {
    const resultado = await consultarComprobante(invoice);
    if (!resultado || resultado.sunat_estado === 'pendiente') continue; // sigue sin respuesta, nada que cambiar
    db.prepare(
      `UPDATE invoices SET sunat_estado = ?, sunat_hash = ?, sunat_pdf_url = ?,
       sunat_xml_url = ?, sunat_cdr_url = ?, sunat_mensaje = ? WHERE id = ?`
    ).run(
      resultado.sunat_estado,
      resultado.sunat_hash || invoice.sunat_hash,
      resultado.sunat_pdf_url || invoice.sunat_pdf_url,
      resultado.sunat_xml_url || invoice.sunat_xml_url,
      resultado.sunat_cdr_url || invoice.sunat_cdr_url,
      resultado.sunat_mensaje || invoice.sunat_mensaje,
      invoice.id
    );
  }
}

// Recorre TODAS las empresas de esta instancia, cada una por separado con
// su propio try/catch (mismo patrón que respaldarTodasLasEmpresas en
// server.js) — un error en una empresa no debe frenar a las demás.
async function sincronizarPendientesDeTodasLasEmpresas() {
  const tenants = tenantRegistry.listTodos();
  for (const tenant of tenants) {
    try {
      const tenantDb = db.openTenantDb(tenant.db_file);
      await db.runWithDb(tenantDb, sincronizarPendientesDeEmpresa);
    } catch (err) {
      console.error(`Error sincronizando estado SUNAT de ${tenant.ruc}:`, err);
    }
  }
  // Antes de que la instalación base tenga su RUC configurado no aparece en
  // tenantRegistry.listTodos() — se sincroniza igual "a mano".
  const yaIncluida = tenants.some((t) => t.db_file === db.DEFAULT_DB_PATH);
  if (!yaIncluida) {
    try {
      await db.runWithDb(db.openTenantDb(db.DEFAULT_DB_PATH), sincronizarPendientesDeEmpresa);
    } catch (err) {
      console.error('Error sincronizando estado SUNAT de la instalación base:', err);
    }
  }
}

module.exports = { sincronizarPendientesDeEmpresa, sincronizarPendientesDeTodasLasEmpresas };
