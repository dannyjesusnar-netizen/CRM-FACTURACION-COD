// Adaptador de facturación electrónica real (SUNAT vía OSE).
//
// Por defecto este sistema opera en modo SIMULADO (sin conexión real a
// SUNAT). Para emitir comprobantes con validez legal real, la empresa que
// use este CRM debe:
//   1. Tener RUC activo y estar registrada como emisor electrónico en SUNAT.
//   2. Contratar un OSE (Operador de Servicios Electrónicos) — esta
//      implementación de referencia usa la API de Nubefact
//      (https://nubefact.com), un OSE peruano con planes desde ~S/40/mes.
//   3. Configurar su RUTA y TOKEN de Nubefact desde Configuración → Empresa
//      en el propio CRM. Sin eso, el sistema sigue en modo simulado
//      exactamente como antes: NUNCA se marca un comprobante como aceptado
//      por SUNAT sin una confirmación real del OSE.
//
// Las credenciales son POR EMPRESA (empresa_config.nubefact_ruta/token),
// no globales: cada empresa factura ante SUNAT con su propio RUC, así que
// no puede compartir la cuenta de Nubefact de otra empresa que corra en la
// misma instancia (co-desplegada) — ver credenciales() más abajo. Si una
// empresa no configuró las suyas, se cae a las variables de entorno
// NUBEFACT_RUTA/NUBEFACT_TOKEN (comportamiento de siempre, para no romper
// una instalación de un solo cliente que ya las tenía así).
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

const db = require('../db');

function credenciales() {
  const config = db.prepare('SELECT nubefact_ruta, nubefact_token FROM empresa_config WHERE id = 1').get();
  return {
    ruta: config?.nubefact_ruta || process.env.NUBEFACT_RUTA,
    token: config?.nubefact_token || process.env.NUBEFACT_TOKEN,
  };
}

function estaConfigurado() {
  const { ruta, token } = credenciales();
  return Boolean(ruta && token);
}

const TIPO_COMPROBANTE_NUBEFACT = { factura: 1, boleta: 2, nota_credito: 3 };
// Catálogo 06 de SUNAT (Tipo de Documento de Identidad): 6=RUC, 1=DNI,
// 4=Carnet de Extranjería.
const TIPO_DOCUMENTO_NUBEFACT = { RUC: 6, DNI: 1, CE: 4 };

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
      // valor_unitario/precio_unitario SIEMPRE se derivan de it.subtotal (el
      // importe real de la línea, ya neto de descuento — ver
      // RegistroVenta.jsx:computed.rows) en vez de it.precio_unitario (el
      // precio de lista, SIN descuento). Antes se mandaba precio_unitario
      // sin descontar mientras subtotal/total sí iban descontados: para una
      // línea con descuento, SUNAT rechazaba el comprobante con "Error de
      // cálculo de 'precio_unitario'" porque no cuadraba con el total real
      // de la línea. descuento_global (arriba) sigue el mismo criterio —
      // vacío/0 porque el descuento ya está aplicado dentro de los totales,
      // no se reporta aparte.
      valor_unitario: round2((it.subtotal - it.igv_item) / it.cantidad),
      precio_unitario: round2(it.subtotal / it.cantidad),
      descuento: '',
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

// ¿Este "motivo" en realidad es la página de error cruda de un servidor
// caído (502/500/timeout de la pasarela de SUNAT), no un mensaje real de
// rechazo de SUNAT? Un rechazo real es una frase corta tipo "El RUC del
// cliente es inválido" — esto detecta el patrón contrario: HTML completo o
// el texto típico de un error de infraestructura.
function pareceErrorDeInfraestructura(texto) {
  return /<!DOCTYPE|<html[\s>]|<\/html>|http error|bad gateway|internal server error|\b50[0-9]\b.{0,10}(error|gateway)/i.test(texto || '');
}

// Traduce la respuesta cruda del OSE (misma forma tanto al emitir como al
// volver a consultar un comprobante ya enviado) al estado que guardamos
// nosotros. Separado de emitirComprobante para poder reusarlo en
// consultarComprobante sin duplicar esta lógica.
function interpretarRespuestaOse(data) {
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
  if (motivoRechazo && !pareceErrorDeInfraestructura(motivoRechazo)) {
    return { modo_emision: 'real', sunat_estado: 'rechazado', sunat_mensaje: motivoRechazo };
  }
  // Una caída momentánea de la pasarela de SUNAT (502/500/timeout) a veces
  // le llega a Nubefact como una página de error HTML cruda en vez de un
  // mensaje real, y Nubefact la reenvía tal cual en esos mismos campos.
  // Sin este filtro, ese texto se confundía con un motivo de rechazo
  // real — un estado que ni el job automático (sincronizarSunat.js) ni el
  // botón manual reintentan — y la venta quedaba "rechazada" para siempre
  // por una caída de SUNAT, no por un problema real del comprobante.
  if (motivoRechazo) {
    return {
      modo_emision: 'real',
      sunat_estado: 'pendiente',
      sunat_mensaje: 'SUNAT tuvo una falla momentánea al recibir este comprobante (caída de su propio servidor) — se reintentará automáticamente.',
    };
  }

  return {
    modo_emision: 'real',
    sunat_estado: 'pendiente',
    sunat_hash: data.codigo_hash || null,
    sunat_pdf_url: data.enlace_del_pdf || null,
    sunat_xml_url: data.enlace_del_xml || null,
    // No es un problema ni algo exclusivo del modo demo: SUNAT confirma las
    // boletas a través del Resumen Diario de Boletas (RDB), no una por una
    // -- por norma, la confirmación final puede llegar recién al día
    // siguiente aunque el comprobante ya sea válido desde que se emitió.
    sunat_mensaje: 'Comprobante enviado a SUNAT. La confirmación final puede tardar hasta el día siguiente (SUNAT valida las boletas por resumen diario, no una por una) — el comprobante ya es válido.',
  };
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
    const { ruta, token } = credenciales();
    const res = await fetch(ruta, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

    const resultado = interpretarRespuestaOse(data);
    // Un reenvío (ver utils/sincronizarSunat.js) puede toparse con un
    // comprobante que en realidad SÍ había llegado la primera vez —
    // solo que la respuesta nunca nos llegó (caída justo al responder,
    // timeout, etc.) — Nubefact lo rechaza como "ya informado" en vez de
    // aceptarlo de nuevo. Eso no es un rechazo real: consultamos el
    // estado verdadero en vez de quedarnos con "rechazado".
    if (resultado.sunat_estado === 'rechazado' && /ya\s+(fue\s+)?informado/i.test(resultado.sunat_mensaje || '')) {
      const real = await consultarComprobante(invoice);
      if (real) return real;
    }
    return resultado;
  } catch (err) {
    return { modo_emision: 'real', sunat_estado: 'error', sunat_mensaje: err.message };
  }
}

// Vuelve a preguntarle al OSE por un comprobante YA enviado, para boletas
// que quedaron 'pendiente' porque en el momento de emitir SUNAT todavía no
// había respondido (normal: SUNAT confirma boletas al día siguiente, por
// el Resumen Diario). Usa la operación "consultar_comprobante" documentada
// en la API de Nubefact — misma RUTA/token que emitirComprobante, sin
// verificación en vivo desde este entorno (sin acceso a internet acá); si
// Nubefact cambia el nombre/forma de esta operación, revisar primero este
// payload contra su documentación actual.
// Devuelve null (sin tocar nada) si no hay nada que consultar o la
// consulta falla — nunca lanza excepción.
async function consultarComprobante(invoice) {
  if (!estaConfigurado()) return null;
  const tipoComprobanteId = TIPO_COMPROBANTE_NUBEFACT[invoice.tipo_comprobante];
  if (!tipoComprobanteId) return null;

  try {
    const { ruta, token } = credenciales();
    const res = await fetch(ruta, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        operacion: 'consultar_comprobante',
        tipo_de_comprobante: tipoComprobanteId,
        serie: invoice.serie,
        numero: invoice.numero,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      console.error(`[facturacionElectronica] consultar_comprobante ${invoice.serie}-${invoice.numero}: HTTP ${res.status}`);
      return null;
    }
    return interpretarRespuestaOse(data);
  } catch (err) {
    console.error(`[facturacionElectronica] consultar_comprobante ${invoice.serie}-${invoice.numero}: no se pudo conectar:`, err.message);
    return null;
  }
}

module.exports = { emitirComprobante, consultarComprobante, estaConfigurado };
