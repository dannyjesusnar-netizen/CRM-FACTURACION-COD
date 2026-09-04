// Adaptador de facturación electrónica real (SUNAT vía OSE).
//
// Por defecto este sistema opera en modo SIMULADO (sin conexión real a
// SUNAT). Para emitir comprobantes con validez legal real, la empresa que
// use este CRM debe:
//   1. Tener RUC activo y estar registrada como emisor electrónico en SUNAT.
//   2. Contratar un OSE (Operador de Servicios Electrónicos) — esta
//      implementación de referencia usa la API de Nubefact
//      (https://nubefact.com), un OSE peruano con planes desde ~S/40/mes.
//   3. Configurar las variables de entorno NUBEFACT_RUTA y NUBEFACT_TOKEN en
//      el servidor (Render u otro). Sin esas variables, el sistema sigue en
//      modo simulado exactamente como antes: NUNCA se marca un comprobante
//      como aceptado por SUNAT sin una confirmación real del OSE.
//
// A diferencia de otros OSE, Nubefact NO usa una URL base fija + tu RUC: te
// asigna una RUTA única por empresa/local (algo como
// https://api.nubefact.com/api/v1/<id-de-tu-cuenta>), visible en su panel en
// "API - Integración". Esa misma RUTA y TOKEN sirven tanto en modo demo
// (los comprobantes NO se envían a SUNAT) como en modo producción — el
// cambio de uno a otro se activa desde el propio panel de Nubefact ("Activar
// con la SUNAT"), no cambiando de URL. Por eso no hay aquí ninguna variable
// de tipo NUBEFACT_ENV.
//
// IMPORTANTE: al pasar de modo demo a producción en el panel de Nubefact,
// hay que reiniciar la numeración de comprobantes desde el correlativo 1 —
// lo emitido en demo no vale y no debe mezclarse con series ya usadas en
// real.

const NUBEFACT_RUTA = process.env.NUBEFACT_RUTA;
const NUBEFACT_TOKEN = process.env.NUBEFACT_TOKEN;

function estaConfigurado() {
  return Boolean(NUBEFACT_RUTA && NUBEFACT_TOKEN);
}

const TIPO_COMPROBANTE_NUBEFACT = { factura: 1, boleta: 2, nota_credito: 3 };
const TIPO_DOCUMENTO_NUBEFACT = { RUC: 6, DNI: 1 };

// Catálogo 09 de SUNAT (Tipo de nota de crédito) — códigos oficiales,
// independientes del OSE usado.
const TIPO_NOTA_CATALOGO_09 = {
  anulacion_operacion: '01',
  anulacion_error_ruc: '02',
  correccion_descripcion: '03',
  descuento_global: '04',
  descuento_item: '05',
  devolucion_total: '06',
  devolucion_item: '07',
  bonificacion: '08',
  otros: '10',
};

function fechaDDMMYYYY(fechaISO) {
  const [y, m, d] = String(fechaISO).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

function construirPayload(invoice, items, client) {
  const tipoComprobanteId = TIPO_COMPROBANTE_NUBEFACT[invoice.tipo_comprobante];
  const itemsPayload = items.map((it) => {
    const gravado = it.igv_item > 0;
    return {
      unidad_de_medida: 'NIU',
      codigo: it.codigo_producto || String(it.product_id || 'ITEM'),
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      // Se deriva del subtotal/igv reales de la línea (no de una tasa fija)
      // porque la tasa de IGV es configurable y puede variar entre comprobantes.
      valor_unitario: gravado ? round2((it.subtotal - it.igv_item) / it.cantidad) : it.precio_unitario,
      precio_unitario: it.precio_unitario,
      descuento: it.descuento_pct ? String(round2((it.cantidad * it.precio_unitario) * (it.descuento_pct / 100))) : '',
      subtotal: it.subtotal - it.igv_item,
      tipo_de_igv: gravado ? 1 : 8, // 1 = Gravado - Op. Onerosa, 8 = Exonerado (catálogo 07 SUNAT)
      igv: it.igv_item,
      total: it.subtotal,
      anticipo_regularizacion: false,
    };
  });

  const payload = {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: tipoComprobanteId,
    serie: invoice.serie,
    numero: invoice.numero,
    sunat_transaction: 1, // Venta interna
    cliente_tipo_de_documento: TIPO_DOCUMENTO_NUBEFACT[client.tipo_documento] || 1,
    cliente_numero_de_documento: client.numero_documento,
    cliente_denominacion: client.nombre,
    cliente_direccion: client.direccion || '-',
    cliente_email: client.email || '',
    fecha_de_emision: fechaDDMMYYYY(invoice.fecha_emision),
    moneda: invoice.moneda === 'USD' ? 2 : 1,
    porcentaje_de_igv: 18.00,
    descuento_global: '',
    total_descuento: 0,
    // Este sistema no desglosa el subtotal por afectación a nivel de
    // comprobante (solo por línea vía igv_item); se reporta todo como
    // gravado. Si hay líneas exoneradas/inafectas, ajustar aquí sumando
    // items[].subtotal según tipo_de_igv antes de enviar a producción.
    total_gravada: round2(invoice.subtotal),
    total_inafecta: 0,
    total_exonerada: 0,
    total_igv: round2(invoice.igv),
    total_gratuita: 0,
    total_otros_cargos: 0,
    total: round2(invoice.total),
    observaciones: invoice.observaciones || '',
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    items: itemsPayload,
  };

  if (invoice.tipo_comprobante === 'nota_credito') {
    payload.documento_que_se_modifica_tipo = invoice.modifica_tipo === 'factura' ? 1 : 2;
    payload.documento_que_se_modifica_serie = invoice.modifica_serie;
    payload.documento_que_se_modifica_numero = invoice.modifica_numero;
    payload.tipo_de_nota_de_credito = TIPO_NOTA_CATALOGO_09[invoice.tipo_nota] || '10';
  }

  return payload;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Emite un comprobante contra el OSE configurado. Si no hay credenciales
// configuradas, no hace ninguna llamada de red y devuelve modo simulado
// (comportamiento idéntico al actual). Nunca lanza excepción: los errores
// de red o de SUNAT quedan registrados en el comprobante como
// sunat_estado='error', sin bloquear la venta ya confirmada localmente.
async function emitirComprobante(invoice, items, client) {
  if (!estaConfigurado()) {
    return { modo_emision: 'simulado', sunat_estado: null, sunat_mensaje: null };
  }
  if (!TIPO_COMPROBANTE_NUBEFACT[invoice.tipo_comprobante]) {
    return { modo_emision: 'real', sunat_estado: 'error', sunat_mensaje: `Tipo de comprobante "${invoice.tipo_comprobante}" no soportado por el OSE.` };
  }

  try {
    const payload = construirPayload(invoice, items, client);
    const res = await fetch(NUBEFACT_RUTA, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NUBEFACT_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data) {
      return {
        modo_emision: 'real',
        sunat_estado: 'error',
        sunat_mensaje: (data && (data.errors || data.mensaje)) || `El OSE respondió con estado HTTP ${res.status}.`,
      };
    }

    if (data.aceptada_por_sunat) {
      return {
        modo_emision: 'real',
        sunat_estado: 'aceptado',
        sunat_hash: data.codigo_hash || null,
        sunat_pdf_url: data.enlace_del_pdf || null,
        sunat_xml_url: data.enlace_del_xml || null,
        sunat_cdr_url: data.enlace_del_cdr || null,
        sunat_mensaje: data.sunat_description || 'Aceptado por SUNAT.',
      };
    }

    // aceptada_por_sunat=false no siempre es un rechazo: Nubefact devuelve
    // ese mismo valor tanto cuando SUNAT rechazó el comprobante (con un
    // motivo real en sunat_description/sunat_note/sunat_responsecode) como
    // cuando todavía no hay respuesta de SUNAT — sobre todo en modo demo,
    // donde Nubefact firma y genera el documento pero nunca llega a
    // consultar a SUNAT, y esos tres campos quedan null para siempre.
    // Solo lo marcamos "rechazado" cuando de verdad viene un motivo.
    const motivoRechazo = data.sunat_description || data.sunat_note || data.sunat_soap_error || null;
    if (motivoRechazo) {
      return {
        modo_emision: 'real',
        sunat_estado: 'rechazado',
        sunat_mensaje: motivoRechazo,
      };
    }

    return {
      modo_emision: 'real',
      sunat_estado: 'pendiente',
      sunat_hash: data.codigo_hash || null,
      sunat_pdf_url: data.enlace_del_pdf || null,
      sunat_xml_url: data.enlace_del_xml || null,
      sunat_mensaje: 'Nubefact generó el comprobante; SUNAT todavía no confirmó su validación (normal mientras la cuenta esté en modo demo).',
    };
  } catch (err) {
    return { modo_emision: 'real', sunat_estado: 'error', sunat_mensaje: err.message };
  }
}

module.exports = { emitirComprobante, estaConfigurado };
