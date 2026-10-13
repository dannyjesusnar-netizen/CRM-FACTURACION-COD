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
//      (se guardan por empresa en empresa_config — ver routes/empresa.js,
//      necesario en una instancia que factura para más de una empresa). Como
//      alternativa para una instancia de una sola empresa, también sirven
//      las variables de entorno NUBEFACT_RUTA/NUBEFACT_TOKEN del servidor
//      (Render u otro), que se usan si la empresa no configuró las suyas.
//      Sin ninguna de las dos, el sistema sigue en modo simulado exactamente
//      como antes: NUNCA se marca un comprobante como aceptado por SUNAT sin
//      una confirmación real del OSE.
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

// En una instancia que atiende a una sola empresa, NUBEFACT_RUTA/TOKEN como
// variable de entorno alcanza. Pero en una instancia multi-empresa (varias
// empresas comparten el mismo servidor, ver tenantRegistry.js) cada una
// factura bajo su propio RUC y necesita su propia cuenta de Nubefact — así
// que la credencial real sale primero de empresa_config (por empresa, ver
// routes/empresa.js) y solo si esa empresa no configuró la suya cae en la
// variable de entorno (compatibilidad con instancias de una sola empresa ya
// configuradas así, como la original).
function credencialesNubefact() {
  const config = db.prepare('SELECT nubefact_ruta, nubefact_token FROM empresa_config WHERE id = 1').get();
  return {
    ruta: config?.nubefact_ruta || process.env.NUBEFACT_RUTA,
    token: config?.nubefact_token || process.env.NUBEFACT_TOKEN,
  };
}

function estaConfigurado() {
  const { ruta, token } = credencialesNubefact();
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

// Catálogo 07 SUNAT (Afectación del IGV) — códigos que de verdad usa este
// sistema. afectacion_igv es un atributo del PRODUCTO (Inventario →
// Productos), no de la venta — ver routes/invoices.js, donde se adjunta a
// cada item antes de llamar a emitirComprobante/reenviarComprobante.
const TIPO_IGV_POR_AFECTACION = { gravado: 1, gratuito: 1, exonerado: 8, inafecto: 10 };

function construirPayload(invoice, items, client) {
  const tipoComprobanteId = TIPO_COMPROBANTE_NUBEFACT[invoice.tipo_comprobante];
  const itemsPayload = items.map((it) => {
    // afectacion_igv puede faltar (comprobantes emitidos antes de que se
    // empezara a adjuntar, o un item sin product_id) — en ese caso se cae
    // al criterio viejo (si se le calculó IGV a la línea, se asume
    // gravado; si no, exonerado) para no romper nada ya emitido.
    const tipoDeIgv = TIPO_IGV_POR_AFECTACION[it.afectacion_igv] || (it.igv_item > 0 ? 1 : 8);
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
      tipo_de_igv: tipoDeIgv,
      igv: it.igv_item,
      total: it.subtotal,
      anticipo_regularizacion: false,
    };
  });

  // Totales del comprobante por afectación: tienen que cuadrar con la suma
  // de los items de cada categoría de arriba o SUNAT rechaza el envío (ej.
  // "Total EXONERADA debe ser mayor a cero" cuando hay una línea exonerada
  // pero este total se mandaba siempre en 0, con TODO el subtotal metido en
  // total_gravada sin importar la afectación real de cada línea).
  const totalGravada = round2(itemsPayload.filter((it) => it.tipo_de_igv === 1).reduce((s, it) => s + it.subtotal, 0));
  const totalExonerada = round2(itemsPayload.filter((it) => it.tipo_de_igv === 8).reduce((s, it) => s + it.subtotal, 0));
  const totalInafecta = round2(itemsPayload.filter((it) => it.tipo_de_igv === 10).reduce((s, it) => s + it.subtotal, 0));

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
    total_gravada: totalGravada,
    total_inafecta: totalInafecta,
    total_exonerada: totalExonerada,
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

// ¿Este "motivo" en realidad es un error de infraestructura (servidor
// caído, timeout de conexión, etc.), no un mensaje real de rechazo de
// SUNAT? Un rechazo real es una frase corta en español tipo "El RUC del
// cliente es inválido" — esto detecta el patrón contrario: HTML completo,
// el texto típico de un servidor caído, o el nombre de una excepción de
// bajo nivel (Nubefact antepone "[Error <Excepción>]" cuando la falla es
// de conexión, no de validación — visto en producción tanto con
// "HTTP error (502): <!DOCTYPE html>..." como con "Net::ReadTimeout").
function pareceErrorDeInfraestructura(texto) {
  return /^\s*\[Error\b|<!DOCTYPE|<html[\s>]|<\/html>|http error|bad gateway|internal server error|\btimeout\b|\bread\s*timeout\b|net::\w+|\bECONNRESET\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\b50[0-9]\b.{0,10}(error|gateway)/i.test(texto || '');
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
    const { ruta, token } = credencialesNubefact();
    const payload = construirPayload(invoice, items, client);
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
    const { ruta, token } = credencialesNubefact();
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
