// Adaptador de Culqi (pasarela de pago peruana) para el cobro recurrente de
// la suscripción a la plataforma (no tiene nada que ver con la facturación
// a los clientes de cada empresa — eso es utils/facturacionElectronica.js).
//
// Igual que el adaptador de SUNAT: sin CULQI_SECRET_KEY configurada, este
// módulo no hace ninguna llamada de red y todo queda en modo simulado — así
// "Mis pagos" y el cobro automático nunca quedan a medias por falta de
// credenciales, simplemente no operan hasta que se configuren.
//
// IMPORTANTE: esta integración sigue la documentación pública de Culqi
// (https://culqi.com/docs) pero no pudo probarse contra una cuenta real (no
// había credenciales disponibles al escribirla). Antes de usarla en
// producción, probá primero con las llaves de prueba (sk_test_...) de tu
// cuenta y una tarjeta de prueba, y confirmá que las respuestas coinciden
// con lo que este adaptador espera — ajustalo si algún campo cambió.
//
// Nunca se guarda un número de tarjeta real en esta base de datos: el
// frontend tokeniza la tarjeta directamente con Culqi.js (nunca toca
// nuestro backend) y solo nos llega un "token" de un solo uso, que acá se
// cambia por una Tarjeta (crd_...) asociada a un Cliente (cus_...) en
// Culqi — eso es lo único que guardamos (ver tenantRegistry.js).

const CULQI_SECRET_KEY = process.env.CULQI_SECRET_KEY || null;
const CULQI_BASE_URL = 'https://api.culqi.com/v2';

function estaConfigurado() {
  return Boolean(CULQI_SECRET_KEY);
}

async function culqiRequest(path, body) {
  const res = await fetch(`${CULQI_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CULQI_SECRET_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.object === 'error') {
    const mensaje = (data && (data.user_message || data.merchant_message))
      || `Culqi respondió con estado HTTP ${res.status}.`;
    const err = new Error(mensaje);
    err.culqi = data;
    throw err;
  }
  return data;
}

// Crea (o reutiliza, si ya existe customerId) el Cliente en Culqi asociado
// a esta empresa, y le agrega la tarjeta a partir del token de un solo uso
// que generó Culqi.js en el navegador.
async function guardarTarjeta({ tokenId, customerId, email, nombres, ruc }) {
  let cliente;
  if (customerId) {
    cliente = { id: customerId };
  } else {
    cliente = await culqiRequest('/customers', {
      first_name: nombres || 'Gerencia',
      last_name: ruc || '',
      email,
      address: '-',
      address_city: '-',
      country_code: 'PE',
      phone_number: '000000000',
    });
  }
  const tarjeta = await culqiRequest('/cards', {
    customer_id: cliente.id,
    token_id: tokenId,
  });
  return {
    customerId: cliente.id,
    cardId: tarjeta.id,
    marca: tarjeta.source?.iin?.card_brand || tarjeta.source?.card_brand || null,
    ultimos4: tarjeta.source?.last_four || null,
  };
}

// Cobra el monto mensual contra la tarjeta guardada. Nunca lanza excepción:
// el resultado (éxito o fallo) queda siempre como un objeto para que quien
// llama decida qué guardar en el historial de pagos.
async function cobrar({ monto, cardId, email, descripcion }) {
  if (!estaConfigurado()) {
    return { exitoso: false, simulado: true, mensaje: 'Culqi no está configurado en este servidor (modo simulado).' };
  }
  try {
    const cargo = await culqiRequest('/charges', {
      amount: Math.round(monto * 100), // Culqi espera céntimos
      currency_code: 'PEN',
      email,
      source_id: cardId,
      description: descripcion,
    });
    return { exitoso: true, cargoId: cargo.id, mensaje: 'Cobro exitoso.' };
  } catch (err) {
    return { exitoso: false, mensaje: err.message };
  }
}

module.exports = { estaConfigurado, guardarTarjeta, cobrar };
