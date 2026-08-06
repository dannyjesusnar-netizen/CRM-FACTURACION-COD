// Convierte un monto (parte entera) a letras en español, para la línea
// "SON: ... SOLES" de los comprobantes. Soporta hasta 999,999,999.

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const DIECIS = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

// n: 0-999
function letrasHastaNoveciento99(n, apocope) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (centena > 0) partes.push(CENTENAS[centena]);
  if (resto > 0) {
    if (resto < 10) {
      partes.push(apocope && resto === 1 ? 'UN' : UNIDADES[resto]);
    } else if (resto < 20) {
      partes.push(DIECIS[resto - 10]);
    } else if (resto < 30) {
      const unidad = resto % 10;
      partes.push(resto === 20 ? 'VEINTE' : `VEINTI${unidad === 1 ? (apocope ? 'UN' : 'UNO') : UNIDADES[unidad]}`);
    } else {
      const decena = Math.floor(resto / 10);
      const unidad = resto % 10;
      partes.push(unidad === 0 ? DECENAS[decena] : `${DECENAS[decena]} Y ${apocope && unidad === 1 ? 'UN' : UNIDADES[unidad]}`);
    }
  }
  return partes.join(' ');
}

function numeroALetras(numero) {
  const n = Math.floor(Math.abs(Number(numero) || 0));
  if (n === 0) return 'CERO';

  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;

  const partes = [];
  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLON' : `${letrasHastaNoveciento99(millones, true)} MILLONES`);
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'MIL' : `${letrasHastaNoveciento99(miles, true)} MIL`);
  }
  if (resto > 0) {
    // apocope=false: el último tramo no precede a un sustantivo ("MIL"/"MILLONES"),
    // así que va "UNO"/"VEINTIUNO", no "UN"/"VEINTIUN".
    partes.push(letrasHastaNoveciento99(resto, false));
  }
  return partes.join(' ').trim();
}

// "SON: DOSCIENTOS TREINTA Y UNO CON 50/100 SOLES"
function montoEnLetras(monto, moneda) {
  const nombreMoneda = moneda === 'USD' ? 'DOLARES' : 'SOLES';
  const entero = Math.floor(Math.abs(Number(monto) || 0));
  const centavos = Math.round((Math.abs(Number(monto) || 0) - entero) * 100);
  const centavosStr = String(centavos).padStart(2, '0');
  return `SON: ${numeroALetras(entero)} CON ${centavosStr}/100 ${nombreMoneda}`;
}

module.exports = { numeroALetras, montoEnLetras };
