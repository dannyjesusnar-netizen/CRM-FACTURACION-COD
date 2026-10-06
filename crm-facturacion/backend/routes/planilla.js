const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso, tieneAccionSupervisor } = require('../utils/permisos');
const { hoyPeru } = require('../utils/fechas');
const { round2 } = require('../utils/cajaCalculos');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('caja'));
router.use(resolveSucursal);

function todayStr() {
  return hoyPeru();
}

// Total vendido/movido en caja durante la ventana exacta de un turno (su
// abierto_at hasta su cerrado_at, o hasta ahora si sigue abierto) -- no el
// total del día completo del empleado, que puede incluir otro turno aparte.
// No cuenta lo "abonado" (crédito, no es dinero que entró a caja en ese
// momento) -- mismo criterio que el resto de Caja y Bancos.
function totalTurno(turno) {
  const fin = turno.cerrado_at || db.prepare("SELECT datetime('now') AS n").get().n;
  const params = [turno.sucursal_id, turno.created_by, turno.abierto_at, fin];
  const ventas = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS t FROM invoices
     WHERE estado = 'emitido' AND tipo_comprobante != 'nota_credito' AND forma_pago != 'abonado'
       AND sucursal_id = ? AND created_by = ? AND created_at BETWEEN ? AND ?`
  ).get(...params).t;
  const notasVenta = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS t FROM notas_venta
     WHERE estado = 'emitido' AND (forma_pago IS NULL OR forma_pago != 'abonado')
       AND sucursal_id = ? AND created_by = ? AND created_at BETWEEN ? AND ?`
  ).get(...params).t;
  const ingresos = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS t FROM caja_movimientos
     WHERE tipo = 'ingreso' AND sucursal_id = ? AND created_by = ? AND created_at BETWEEN ? AND ?`
  ).get(...params).t;
  const egresos = db.prepare(
    `SELECT COALESCE(SUM(monto), 0) AS t FROM caja_movimientos
     WHERE tipo = 'egreso' AND sucursal_id = ? AND created_by = ? AND created_at BETWEEN ? AND ?`
  ).get(...params).t;
  return round2(ventas + notasVenta + ingresos - egresos);
}

// GET /api/planilla?desde=&hasta=&empleado_id=&sucursal_id=
// Un cajero/vendedor solo ve sus propios turnos, sin importar qué mande en
// empleado_id — el filtro por empleado (y ver los de todos) es exclusivo de
// Gerencia/Supervisor. Gerencia además puede ver TODAS las sedes a la vez
// (sin depender de la sede activa del selector rápido de la barra
// superior) o filtrar por una sede puntual con sucursal_id — mismo criterio
// que el Tablero de Ventas (ver routes/tablero.js: sedeFiltro). Un rol con
// el permiso de Supervisor "Ver todos" sigue viendo solo su propia sede: el
// cruce entre sedes es exclusivo del role 'gerencia'.
router.get('/', (req, res) => {
  const esSupervisorOGerencia = tieneAccionSupervisor(req.user, 'ver_todos_planilla_caja');
  const hoy = todayStr();
  const desde = req.query.desde || hoy;
  const hasta = req.query.hasta && req.query.hasta >= desde ? req.query.hasta : desde;

  const sucursalFiltro = req.user.role === 'gerencia'
    ? (req.query.sucursal_id ? Number(req.query.sucursal_id) : null)
    : req.sucursalId;

  let sql = `
    SELECT ct.id, ct.fecha, ct.abierto_at, ct.cerrado_at, ct.cerrado_automaticamente, ct.created_by, ct.sucursal_id,
           u.full_name AS empleado_nombre, s.nombre AS sede_nombre
    FROM caja_turnos ct
    JOIN users u ON u.id = ct.created_by
    JOIN sucursales s ON s.id = ct.sucursal_id
    WHERE ct.fecha BETWEEN ? AND ?
      AND (? IS NULL OR ct.sucursal_id = ?)
  `;
  const params = [desde, hasta, sucursalFiltro, sucursalFiltro];
  if (esSupervisorOGerencia) {
    if (req.query.empleado_id) { sql += ' AND ct.created_by = ?'; params.push(Number(req.query.empleado_id)); }
  } else {
    sql += ' AND ct.created_by = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY ct.abierto_at DESC';
  const turnos = db.prepare(sql).all(...params).map((t) => ({ ...t, total: totalTurno(t) }));
  res.json({
    desde, hasta, verTodos: esSupervisorOGerencia,
    puedeElegirSede: req.user.role === 'gerencia', sucursal_id: sucursalFiltro,
    turnos,
  });
});

// GET /api/planilla/mi-turno-abierto — para saber si el botón debe mostrar
// "Abrir caja" o "Cerrar caja" al cargar la pantalla.
router.get('/mi-turno-abierto', (req, res) => {
  const abierto = db.prepare(
    `SELECT * FROM caja_turnos WHERE created_by = ? AND sucursal_id = ? AND cerrado_at IS NULL
     ORDER BY abierto_at DESC LIMIT 1`
  ).get(req.user.id, req.sucursalId);
  res.json(abierto || null);
});

// POST /api/planilla/abrir — abre un turno para el usuario actual. Rechaza
// si ya tiene uno abierto (en esta sede) sin cerrar.
router.post('/abrir', (req, res) => {
  const yaAbierto = db.prepare(
    `SELECT id FROM caja_turnos WHERE created_by = ? AND sucursal_id = ? AND cerrado_at IS NULL`
  ).get(req.user.id, req.sucursalId);
  if (yaAbierto) {
    return res.status(400).json({ error: 'Ya tienes un turno de caja abierto — ciérralo antes de abrir otro.' });
  }
  const info = db.prepare(
    `INSERT INTO caja_turnos (sucursal_id, created_by, fecha) VALUES (?, ?, ?)`
  ).run(req.sucursalId, req.user.id, todayStr());
  res.status(201).json(db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(info.lastInsertRowid));
});

// POST /api/planilla/cerrar — cierra el turno abierto del usuario actual.
router.post('/cerrar', (req, res) => {
  const abierto = db.prepare(
    `SELECT * FROM caja_turnos WHERE created_by = ? AND sucursal_id = ? AND cerrado_at IS NULL
     ORDER BY abierto_at DESC LIMIT 1`
  ).get(req.user.id, req.sucursalId);
  if (!abierto) {
    return res.status(400).json({ error: 'No tienes un turno de caja abierto.' });
  }
  db.prepare(`UPDATE caja_turnos SET cerrado_at = datetime('now') WHERE id = ?`).run(abierto.id);
  res.json(db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(abierto.id));
});

module.exports = router;
