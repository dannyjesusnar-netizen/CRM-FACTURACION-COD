const db = require('../db');

// Ejecuta una carga masiva "todo o nada": fn() procesa cada fila y devuelve
// { ..., errores: [...] } — si al terminar quedó algún error, se revierte
// TODA la transacción (nada de lo que se creó/actualizó en filas válidas
// queda guardado). Así el usuario nunca se encuentra con una carga a medias
// (algunos productos sí, otros no) — o corrige el archivo completo, o no se
// aplica nada, y el resultado siempre trae `aplicado` para que el frontend
// sepa cuál de los dos pasó.
const ABORTAR = Symbol('abortar-carga-masiva');

function ejecutarTodoONada(fn) {
  let resultado;
  try {
    db.transaction(() => {
      resultado = fn();
      if (resultado.errores && resultado.errores.length > 0) {
        const err = new Error('Carga masiva con errores — no se aplica nada.');
        err[ABORTAR] = true;
        throw err;
      }
    })();
  } catch (err) {
    if (!err[ABORTAR]) throw err;
  }
  return { ...resultado, aplicado: !(resultado.errores && resultado.errores.length > 0) };
}

module.exports = { ejecutarTodoONada };
