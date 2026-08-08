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

module.exports = { sumarUnMes };
