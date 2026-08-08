// Adaptador de Izipay (pasarela de pago peruana) para el cobro recurrente
// que cada empresa le hace a SUS PROPIOS clientes (no confundir con
// utils/culqi.js, que es el cobro de la suscripción a la plataforma, ni
// con utils/facturacionElectronica.js, que es la facturación electrónica).
//
// Izipay Perú usa por debajo la plataforma "Lyra Collect" (marca blanca,
// también conocida como "MiCuentaWeb"): se pudo confirmar públicamente el
// host de la API (https://api.micuentaweb.pe), el endpoint de pagos
// (/api-payment/V4/Charge/CreatePayment) y que la autenticación es HTTP
// Basic con usuario:contraseña de tu cuenta de comercio.
//
// IMPORTANTE — a diferencia del adaptador de Culqi, este NO pudo
// verificarse ni contra la documentación oficial de Izipay Perú
// (developers.izipay.pe) ni contra una cuenta de prueba real: ambos
// quedaron fuera de alcance de red en el entorno donde se escribió este
// código. Antes de usarlo en producción:
//   1. Crea una cuenta de comercio en Izipay y consigue tus credenciales
//      de prueba (usuario/shopId + contraseña, y la llave HMAC-SHA-256 si
//      quieres validar la firma de las respuestas del formulario).
//   2. Prueba el flujo completo con una tarjeta de prueba y compará las
//      respuestas reales contra lo que este adaptador espera — ajústalo
//      si algún nombre de campo cambió (es el mismo trabajo que ya se hizo
//      para culqi.js).
//
// Nunca se guarda un número de tarjeta real en esta base de datos: el
// número de tarjeta se captura DENTRO del formulario embebido de Izipay
// (widget "KR.js" en el navegador), nuestro código nunca lo ve. Lo único
// que se guarda es el "paymentMethodToken" que Izipay devuelve tras el
// primer registro — ese token es lo que se usa para cobrar los meses
// siguientes sin volver a pedirle la tarjeta al cliente.

const crypto = require('crypto');

const IZIPAY_USERNAME = process.env.IZIPAY_USERNAME || null; // shopId de tu cuenta de comercio
const IZIPAY_PASSWORD = process.env.IZIPAY_PASSWORD || null; // contraseña de la API (test o producción)
const IZIPAY_PUBLIC_KEY = process.env.IZIPAY_PUBLIC_KEY || null; // llave pública — esta sí se le manda al navegador
const IZIPAY_HMAC_KEY = process.env.IZIPAY_HMAC_KEY || null; // opcional: para validar la firma del formulario
const IZIPAY_BASE_URL = 'https://api.micuentaweb.pe/api-payment/V4';

function estaConfigurado() {
  return Boolean(IZIPAY_USERNAME && IZIPAY_PASSWORD && IZIPAY_PUBLIC_KEY);
}

async function izipayRequest(path, body) {
  const auth = Buffer.from(`${IZIPAY_USERNAME}:${IZIPAY_PASSWORD}`).toString('base64');
  const res = await fetch(`${IZIPAY_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status === 'ERROR') {
    const mensaje = (data && data.answer && (data.answer.detailedErrorMessage || data.answer.errorMessage))
      || `Izipay respondió con estado HTTP ${res.status}.`;
    const err = new Error(mensaje);
    err.izipay = data;
    throw err;
  }
  return data;
}

// Pide un formToken para pintar el formulario embebido de Izipay (KR.js) en
// el navegador. orderId identifica la operación (usar algo único, ej.
// "sub-cliente-<id>-<timestamp>"). El monto es el del primer cobro: si el
// comercio configuró "registrar y cobrar" en un solo paso, este primer
// pago ya cuenta como el del mes en curso.
async function crearFormularioRegistro({ monto, moneda = 'PEN', orderId, email }) {
  if (!estaConfigurado()) {
    return { simulado: true, mensaje: 'Izipay no está configurado en este servidor (modo simulado).' };
  }
  const data = await izipayRequest('/Charge/CreatePayment', {
    amount: Math.round(monto * 100), // en céntimos
    currency: moneda,
    orderId,
    customer: { email },
    formAction: 'ASK_REGISTER_PAY', // cobra ahora y deja la tarjeta guardada para los próximos meses
  });
  return { simulado: false, formToken: data.answer?.formToken || null, publicKey: IZIPAY_PUBLIC_KEY };
}

// Verifica (si se configuró IZIPAY_HMAC_KEY) la firma de la respuesta que
// el formulario embebido le entrega al navegador tras el pago, y extrae el
// token de tarjeta reutilizable para los cobros siguientes.
function confirmarRegistro({ krAnswer, krHash }) {
  if (IZIPAY_HMAC_KEY && krHash) {
    const firmaCalculada = crypto.createHmac('sha256', IZIPAY_HMAC_KEY).update(krAnswer).digest('hex');
    if (firmaCalculada !== krHash) {
      return { exitoso: false, mensaje: 'La firma de la respuesta de Izipay no coincide (posible manipulación).' };
    }
  }
  let respuesta;
  try {
    respuesta = JSON.parse(krAnswer);
  } catch {
    return { exitoso: false, mensaje: 'No se pudo leer la respuesta de Izipay.' };
  }
  const transaccion = respuesta.transactions?.[0];
  if (!transaccion || transaccion.status !== 'PAID') {
    return { exitoso: false, mensaje: transaccion?.errorMessage || 'El pago no se completó.' };
  }
  return {
    exitoso: true,
    paymentMethodToken: transaccion.paymentMethodToken || null,
    marca: transaccion.paymentMethodType || null,
    ultimos4: transaccion.transactionDetails?.cardDetails?.pan?.slice(-4) || null,
    cargoId: transaccion.uuid || transaccion.transactionId || null,
  };
}

// Cobra el monto mensual contra el token guardado (transacción MIT, sin
// intervención del cliente). Nunca lanza excepción: el resultado (éxito o
// fallo) queda siempre como un objeto para que quien llama decida qué
// guardar en el historial de pagos.
async function cobrar({ monto, moneda = 'PEN', paymentMethodToken, orderId, email, descripcion }) {
  if (!estaConfigurado()) {
    return { exitoso: false, simulado: true, mensaje: 'Izipay no está configurado en este servidor (modo simulado).' };
  }
  try {
    const data = await izipayRequest('/Charge/CreatePayment', {
      amount: Math.round(monto * 100),
      currency: moneda,
      orderId,
      customer: { email },
      paymentMethodToken,
      formAction: 'SILENT', // cobro recurrente sin intervención del cliente (MIT)
      description: descripcion,
    });
    const transaccion = data.answer?.transactions?.[0];
    if (!transaccion || transaccion.status !== 'PAID') {
      return { exitoso: false, mensaje: transaccion?.errorMessage || 'El cobro no se completó.' };
    }
    return { exitoso: true, cargoId: transaccion.uuid || transaccion.transactionId || null, mensaje: 'Cobro exitoso.' };
  } catch (err) {
    return { exitoso: false, mensaje: err.message };
  }
}

module.exports = { estaConfigurado, crearFormularioRegistro, confirmarRegistro, cobrar };
