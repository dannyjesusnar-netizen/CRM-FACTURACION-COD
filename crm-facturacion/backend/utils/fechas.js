// Súmale un mes a una fecha YYYY-MM-DD sin depender de librerías externas.
// Si el mes siguiente no tiene ese día (ej. 31 de enero -> febrero), cae en
// el último día de ese mes — evita fechas inválidas como "31 de febrero".
// Usado por los dos motores de cobro recurrente (plataforma y clientes).
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

// La fecha de "hoy" para todo lo que tenga peso legal o de negocio (fecha de
// emisión de comprobantes, cierre de caja, vencimiento de lotes/descuentos,
// etc.) debe calcularse en hora de Perú (UTC-5, sin horario de verano) — no
// en la hora del servidor, que en Render corre en UTC. Sin este ajuste, entre
// las 7:00pm y la medianoche (hora de Perú) `new Date()` ya "ve" el día
// siguiente en UTC, y por ejemplo Nubefact rechaza el comprobante por tener
// una fecha de emisión mayor a la fecha real de hoy en Perú.
function hoyPeru() {
  const limaMs = Date.now() - 5 * 60 * 60 * 1000;
  return new Date(limaMs).toISOString().slice(0, 10);
}

module.exports = { sumarUnMes, hoyPeru };
