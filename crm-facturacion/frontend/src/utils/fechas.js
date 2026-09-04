// La fecha de "hoy" que se usa como valor por defecto en formularios (fecha
// de emisión de comprobantes, cierre de caja, vigencia de descuentos, etc.)
// debe ser la fecha civil de Perú, no la fecha en UTC — `Date.toISOString()`
// SIEMPRE devuelve UTC sin importar la zona horaria del navegador. Perú es
// UTC-5 sin horario de verano, así que entre las 7:00pm y la medianoche
// (hora de Perú) ese cálculo ya "ve" el día siguiente. Ver el mismo fix en
// el backend (backend/utils/fechas.js) — este es su equivalente en frontend.
export function hoyPeru() {
  const limaMs = Date.now() - 5 * 60 * 60 * 1000;
  return new Date(limaMs).toISOString().slice(0, 10);
}
