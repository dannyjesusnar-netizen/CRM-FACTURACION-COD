// Cierre automático de turnos de caja que nadie cerró — al vendedor se le
// olvida apretar "Cerrar caja" (pantalla Caja y Bancos) al final del día y
// termina cerrándolo recién al día siguiente, con la hora de cierre ya
// mezclada con el turno nuevo. Esto cierra a las 11:30pm hora de Perú
// cualquier turno que siga abierto, sin que nadie tenga que acordarse.
// Mismo patrón de "recorrer todas las empresas" que sincronizarSunat.js.
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');

// Corre dentro del contexto de UNA empresa ya seleccionado (ver
// db.runWithDb en server.js) — cierra todos los turnos sin cerrar de esa
// empresa (todas las sedes), igual que el botón manual "Cerrar caja" (ver
// routes/planilla.js: POST /cerrar), solo que marcados como automáticos.
function cerrarTurnosAbiertosDeEmpresa() {
  db.prepare(
    `UPDATE caja_turnos SET cerrado_at = datetime('now'), cerrado_automaticamente = 1
     WHERE cerrado_at IS NULL`
  ).run();
}

// Recorre TODAS las empresas de esta instancia, cada una por separado con
// su propio try/catch (mismo patrón que respaldarTodasLasEmpresas y
// sincronizarPendientesDeTodasLasEmpresas en server.js) — un error en una
// empresa no debe frenar a las demás.
function cerrarTurnosAbiertosDeTodasLasEmpresas() {
  const tenants = tenantRegistry.listTodos();
  for (const tenant of tenants) {
    try {
      const tenantDb = db.openTenantDb(tenant.db_file);
      db.runWithDb(tenantDb, cerrarTurnosAbiertosDeEmpresa);
    } catch (err) {
      console.error(`Error en el cierre automático de caja de ${tenant.ruc}:`, err);
    }
  }
  // Antes de que la instalación base tenga su RUC configurado no aparece en
  // tenantRegistry.listTodos() — se cierra igual "a mano".
  const yaIncluida = tenants.some((t) => t.db_file === db.DEFAULT_DB_PATH);
  if (!yaIncluida) {
    try {
      db.runWithDb(db.openTenantDb(db.DEFAULT_DB_PATH), cerrarTurnosAbiertosDeEmpresa);
    } catch (err) {
      console.error('Error en el cierre automático de caja de la instalación base:', err);
    }
  }
}

// Milisegundos desde ahora hasta la próxima vez que sean las 11:30pm hora
// de Perú (UTC-5, sin horario de verano — ver utils/fechas.js). 11:30pm
// Lima = 04:30 UTC del día siguiente.
function msHastaProximoCierre() {
  const ahora = new Date();
  const proximo = new Date(Date.UTC(
    ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 4, 30, 0, 0
  ));
  if (proximo.getTime() <= ahora.getTime()) proximo.setUTCDate(proximo.getUTCDate() + 1);
  return proximo.getTime() - ahora.getTime();
}

// Programa el primer cierre a las 11:30pm Lima más próximas, y de ahí en
// adelante uno cada 24 horas — sin depender de un cron externo ni de una
// librería de cron, mismo criterio que los demás trabajos de fondo de
// server.js (respaldos, cobros recurrentes, sincronización SUNAT).
function programarCierreAutomaticoDiario() {
  const UN_DIA_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    cerrarTurnosAbiertosDeTodasLasEmpresas();
    setInterval(cerrarTurnosAbiertosDeTodasLasEmpresas, UN_DIA_MS);
  }, msHastaProximoCierre());
}

module.exports = {
  cerrarTurnosAbiertosDeEmpresa,
  cerrarTurnosAbiertosDeTodasLasEmpresas,
  msHastaProximoCierre,
  programarCierreAutomaticoDiario,
};
