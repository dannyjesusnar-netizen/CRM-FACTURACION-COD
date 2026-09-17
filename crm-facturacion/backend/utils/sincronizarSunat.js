// Tarea de fondo que mantiene sunat_estado al día solo, sin que nadie tenga
// que ir a mirar el panel de Nubefact ni hacer clic en nada. Cubre dos casos
// distintos, que NO se resuelven igual:
//   - 'pendiente': el envío a Nubefact sí se logró, pero SUNAT todavía no
//     había respondido en ese instante (normal — confirma boletas al día
//     siguiente por el Resumen Diario). Acá solo hay que volver a
//     PREGUNTAR (consultarComprobante), nunca reenviar.
//   - 'error': el envío ni siquiera llegó a Nubefact (Nubefact/SUNAT caídos,
//     sin internet, timeout, etc.) — acá hay que REENVIAR el comprobante
//     (emitirComprobante) para que de verdad llegue. Esto es seguro: la
//     fila ya existe con su serie/número desde que se emitió la venta la
//     primera vez, reenviar solo repite la llamada al OSE con esos mismos
//     datos — nunca genera ni consume un número nuevo, así que no hay
//     riesgo de duplicar ni de saltar correlativos.
// Programada en server.js; también existe un botón manual
// (routes/invoices.js:sincronizar-sunat) para forzarlo antes si hace falta.
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { consultarComprobante, emitirComprobante, estaConfigurado } = require('./facturacionElectronica');

function guardarResultado(invoice, resultado) {
  db.prepare(
    `UPDATE invoices SET sunat_estado = ?, sunat_hash = ?, sunat_pdf_url = ?,
     sunat_xml_url = ?, sunat_cdr_url = ?, sunat_mensaje = ? WHERE id = ?`
  ).run(
    resultado.sunat_estado || invoice.sunat_estado,
    resultado.sunat_hash || invoice.sunat_hash,
    resultado.sunat_pdf_url || invoice.sunat_pdf_url,
    resultado.sunat_xml_url || invoice.sunat_xml_url,
    resultado.sunat_cdr_url || invoice.sunat_cdr_url,
    resultado.sunat_mensaje || invoice.sunat_mensaje,
    invoice.id
  );
}

// Reconstruye los items (con su código de producto) y el cliente de un
// comprobante ya guardado, y lo reenvía al OSE — mismo dato que se manda al
// emitir una venta nueva (ver routes/invoices.js), reusado acá para
// reintentar uno que quedó en 'error'. Devuelve el resultado del envío (o
// null si el comprobante no existe), y ya deja guardado el resultado.
async function reenviarComprobante(invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId).map((it) => ({
    ...it,
    codigo_producto: it.product_id ? db.prepare('SELECT codigo FROM products WHERE id = ?').get(it.product_id)?.codigo : null,
  }));
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id);
  const resultado = await emitirComprobante(invoice, items, client);
  guardarResultado(invoice, resultado);
  return resultado;
}

// Corre dentro del contexto de UNA empresa ya seleccionado (ver
// db.runWithDb más abajo) — revisa sus boletas 'pendiente' y 'error' (todas
// las sedes) y actualiza las que correspondan.
async function sincronizarPendientesDeEmpresa() {
  if (!estaConfigurado()) return;
  // Margen de 3 horas antes de volver a preguntar por una 'pendiente':
  // recién emitida, lo normal es que siga pendiente el resto del día — no
  // tiene sentido consultar de inmediato.
  const pendientes = db.prepare(
    `SELECT * FROM invoices WHERE estado = 'emitido' AND modo_emision = 'real' AND sunat_estado = 'pendiente'
     AND datetime(created_at) <= datetime('now', '-3 hours')`
  ).all();
  for (const invoice of pendientes) {
    const resultado = await consultarComprobante(invoice);
    if (!resultado || resultado.sunat_estado === 'pendiente') continue; // sigue sin respuesta, nada que cambiar
    guardarResultado(invoice, resultado);
  }

  // Margen más corto para 'error': acá no estamos esperando a que SUNAT
  // procese nada (nunca le llegó), solo dando un respiro para no reintentar
  // en ráfaga si Nubefact/SUNAT siguen caídos en ese mismo momento.
  const enError = db.prepare(
    `SELECT id FROM invoices WHERE estado = 'emitido' AND modo_emision = 'real' AND sunat_estado = 'error'
     AND datetime(created_at) <= datetime('now', '-5 minutes')`
  ).all();
  for (const { id } of enError) {
    await reenviarComprobante(id);
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

module.exports = { sincronizarPendientesDeEmpresa, sincronizarPendientesDeTodasLasEmpresas, reenviarComprobante };
