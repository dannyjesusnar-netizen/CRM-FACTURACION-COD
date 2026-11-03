const db = require('../db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const CATEGORIA_LABEL = { trainer: 'Entrenador', vendedor: 'Vendedor', supervisor: 'Supervisor' };

// Ranking Trainers/Vendedores/Supervisores: venta y % de cumplimiento de
// meta por empleado de esa categoría, cruzando todas las sedes (o solo una,
// si se pasa sucursalId). La venta se atribuye a invoices.atribuido_a si el
// vendedor eligió esa opción al emitir el comprobante (ver
// routes/invoices.js), o a created_by (quien lo registró) si no. La meta no
// se asigna persona por persona: para Vendedores y Trainers, Gerencia
// asigna un pool por sede+categoría (metas_venta_sede) que se reparte entre
// la dotación asignada a mano para ese equipo (metas_venta_sede.dotacion);
// si no se asignó ninguna dotación (0), se reparte entre los empleados
// activos de esa categoría en esa sede, como antes de que existiera ese
// campo. Supervisor es la excepción: no tiene pool propio — cada supervisor
// recibe un 50% fijo del pool de Trainers de su sede (asumiendo los dos
// turnos, mañana y tarde), sin importar cuántos trainers tenga su turno.
//
// Un mes ya cerrado NO debe cambiar si después Gerencia reasigna a alguien
// de sede (Personas → editar empleado): la VENTA de cada comprobante se
// cuenta siempre para la sede donde se emitió (invoices.sucursal_id /
// notas_venta.sucursal_id, que no cambian nunca), nunca para la sede ACTUAL
// del empleado — así que si alguien ya vendió este mes en Miraflores y
// después lo trasladan a San Borja, esa venta de Miraflores se queda en el
// ranking de Miraflores de ese mes para siempre. "sede"/sucursal_id en el
// resultado sigue siendo su sede actual (para mostrar dónde trabaja HOY y
// para calcular su meta, que sí es de la sede actual, igual que siempre) —
// solo la plata (venta) quedó anclada a como pasó en su momento. Por el
// mismo motivo, si viene filtrado por sede, también se incluye a quien ya
// no está en esa sede pero sí vendió ahí ese mes (si no, esa venta
// desaparecería del todo del ranking filtrado de esa sede).
//
// Esto NO cubre la cuota automática (pool / cantidad de gente activa HOY,
// cuando Gerencia no asignó una dotación a mano) — si además de mover a
// alguien de sede cambia cuánta gente activa queda contada en la sede
// vieja, el % de cumplimiento de un mes cerrado sí puede moverse un poco
// por ese lado. Para que quede 100% fijo incluso en ese caso, asignale una
// dotación a mano a esa sede/mes (Configuración → Metas de venta) — con
// dotación puesta, el divisor queda fijo sin importar cuánta gente activa
// haya después.
//
// Extraído de routes/tablero.js (GET /ranking-personal) para poder
// reutilizarlo tal cual desde el link público del Tablero de Ventas (ver
// routes/dashboardPublico.js) — misma lógica, sin duplicarla.
function calcularRankingPersonal(categoria, anio, mes, sucursalId) {
  const mesPad = String(mes).padStart(2, '0');
  const rows = db.prepare(`
    SELECT u.id AS user_id, u.full_name AS nombre, u.turno, u.sucursal_id, s.nombre AS sede,
           COALESCE(SUM(CASE WHEN ? IS NULL OR v.sucursal_id = ? THEN v.monto ELSE 0 END), 0) AS venta,
           MAX(CASE WHEN v.sucursal_id = ? THEN 1 ELSE 0 END) AS vendio_en_sede_filtro
    FROM users u
    LEFT JOIN sucursales s ON s.id = u.sucursal_id
    LEFT JOIN (
      SELECT COALESCE(atribuido_a, created_by) AS user_id, sucursal_id,
             CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END AS monto
      FROM invoices
      WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
      UNION ALL
      SELECT COALESCE(atribuido_a, created_by) AS user_id, sucursal_id, total AS monto
      FROM notas_venta
      WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
    ) v ON v.user_id = u.id
    WHERE u.categoria_staff = ? AND u.activo = 1
    GROUP BY u.id
    HAVING ? IS NULL OR u.sucursal_id = ? OR vendio_en_sede_filtro = 1
  `).all(
    sucursalId, sucursalId, sucursalId,
    String(anio), mesPad, String(anio), mesPad,
    categoria,
    sucursalId, sucursalId
  );

  // A pedido: la venta de los Entrenadores suma automáticamente a la del
  // Supervisor de su misma sede y turno (no afecta la meta, solo la venta
  // que se compara contra ella en este ranking). También anclado a la sede
  // donde pasó cada venta (ver comentario de arriba), no a la sede actual
  // del Trainer que la hizo.
  if (categoria === 'supervisor') {
    const ventasTrainer = db.prepare(`
      SELECT v.sucursal_id, u.turno, COALESCE(SUM(v.monto), 0) AS venta
      FROM (
        SELECT COALESCE(atribuido_a, created_by) AS user_id, sucursal_id,
               CASE WHEN tipo_comprobante = 'nota_credito' THEN -total ELSE total END AS monto
        FROM invoices
        WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
        UNION ALL
        SELECT COALESCE(atribuido_a, created_by) AS user_id, sucursal_id, total AS monto
        FROM notas_venta
        WHERE estado = 'emitido' AND strftime('%Y', fecha_emision) = ? AND strftime('%m', fecha_emision) = ?
      ) v
      JOIN users u ON u.id = v.user_id
      WHERE u.categoria_staff = 'trainer' AND u.activo = 1 AND u.turno IS NOT NULL
      GROUP BY v.sucursal_id, u.turno
    `).all(String(anio), mesPad, String(anio), mesPad);
    const trainerMap = new Map(ventasTrainer.map((t) => [`${t.sucursal_id}:${t.turno}`, t.venta]));
    rows.forEach((r) => {
      if (r.turno) {
        r.venta += trainerMap.get(`${r.sucursal_id}:${r.turno}`) || 0;
      }
    });
  }

  // La cuota de Supervisor no se asigna aparte: Gerencia solo asigna pool a
  // Vendedores y Trainers (ver metasVenta.js) — cada supervisor recibe un
  // 50% fijo del pool de Trainers de su misma sede (asumiendo los dos
  // turnos, mañana y tarde), sin importar cuántos trainers tenga su turno;
  // si no tiene turno asignado no se le puede calcular una cuota (queda en 0).
  let poolTrainerMap = new Map();
  if (categoria === 'supervisor') {
    const poolsTrainer = db.prepare(
      'SELECT sucursal_id, monto_meta FROM metas_venta_sede WHERE categoria_staff = ? AND anio = ? AND mes = ?'
    ).all('trainer', anio, mes);
    poolTrainerMap = new Map(poolsTrainer.map((p) => [p.sucursal_id, p.monto_meta]));
  }

  const pools = categoria === 'supervisor' ? [] : db.prepare(
    'SELECT sucursal_id, monto_meta, dotacion, monto_individual FROM metas_venta_sede WHERE categoria_staff = ? AND anio = ? AND mes = ?'
  ).all(categoria, anio, mes);
  const poolMap = new Map(pools.map((p) => [p.sucursal_id, p.monto_meta]));
  const dotacionMap = new Map(pools.map((p) => [p.sucursal_id, p.dotacion]));
  // monto_individual: cuota asignada a mano por vendedor de esa sede (ver
  // metasVenta.js) — solo aplica a categoria='vendedor'; si está asignada,
  // reemplaza el cálculo pool/dotación por completo.
  const individualMap = categoria === 'vendedor'
    ? new Map(pools.filter((p) => p.monto_individual !== null && p.monto_individual !== undefined).map((p) => [p.sucursal_id, p.monto_individual]))
    : new Map();
  // metas_venta_usuario: cuota asignada a mano a UN vendedor puntual (ver
  // metasVenta.js) — tiene prioridad sobre la cuota de sede y sobre el
  // cálculo pool/dotación.
  const usuarioMetas = categoria === 'vendedor'
    ? db.prepare('SELECT user_id, monto_meta FROM metas_venta_usuario WHERE anio = ? AND mes = ?').all(anio, mes)
    : [];
  const usuarioMetaMap = new Map(usuarioMetas.map((m) => [m.user_id, m.monto_meta]));
  const conteos = db.prepare(
    `SELECT sucursal_id, COUNT(*) AS cantidad FROM users
     WHERE categoria_staff = ? AND activo = 1 AND sucursal_id IS NOT NULL GROUP BY sucursal_id`
  ).all(categoria);
  const conteoMap = new Map(conteos.map((c) => [c.sucursal_id, c.cantidad]));

  const withPct = rows.map((r) => {
    let meta;
    if (categoria === 'supervisor') {
      meta = r.turno ? (poolTrainerMap.get(r.sucursal_id) || 0) / 2 : 0;
    } else if (usuarioMetaMap.has(r.user_id)) {
      meta = usuarioMetaMap.get(r.user_id);
    } else if (individualMap.has(r.sucursal_id)) {
      meta = individualMap.get(r.sucursal_id);
    } else {
      const cantidad = dotacionMap.get(r.sucursal_id) || conteoMap.get(r.sucursal_id) || 0;
      const pool = poolMap.get(r.sucursal_id) || 0;
      meta = cantidad > 0 ? pool / cantidad : 0;
    }
    return {
      user_id: r.user_id, nombre: r.nombre, turno: r.turno, sede: r.sede,
      venta: round2(r.venta), meta: round2(meta),
      porcentaje: meta > 0 ? round2((r.venta / meta) * 100) : null,
    };
  });

  // Si la dotación asignada a una sede es mayor a la cantidad de
  // empleados activos de esa categoría que tiene registrados (p.ej.
  // dotación 14 con solo 13 trainers asignados), se agregan filas
  // placeholder "Trainer faltante 1", "Trainer faltante 2"... para que el
  // ranking muestre el cupo completo y el vacío quede visible — no se
  // inventan ventas ni metas individuales distintas a las del resto del
  // equipo, solo venta 0.
  if (dotacionMap.size > 0) {
    const sedesIds = [...dotacionMap.keys()].filter((id) => sucursalId === null || id === sucursalId);
    const sedeNombreMap = new Map(
      db.prepare('SELECT id, nombre FROM sucursales').all().map((s) => [s.id, s.nombre])
    );
    for (const sId of sedesIds) {
      const dotacion = dotacionMap.get(sId) || 0;
      const real = conteoMap.get(sId) || 0;
      const faltantes = dotacion - real;
      if (faltantes <= 0) continue;
      const pool = poolMap.get(sId) || 0;
      const meta = individualMap.has(sId) ? individualMap.get(sId) : (dotacion > 0 ? pool / dotacion : 0);
      for (let i = 1; i <= faltantes; i += 1) {
        withPct.push({
          user_id: `faltante-${sId}-${i}`,
          nombre: `${CATEGORIA_LABEL[categoria] || categoria} faltante ${i}`,
          turno: null,
          sede: sedeNombreMap.get(sId) || null,
          venta: 0,
          meta: round2(meta),
          porcentaje: meta > 0 ? 0 : null,
          faltante: true,
        });
      }
    }
  }

  withPct.sort((a, b) => {
    if (a.porcentaje === null && b.porcentaje === null) return b.venta - a.venta;
    if (a.porcentaje === null) return 1;
    if (b.porcentaje === null) return -1;
    return b.porcentaje - a.porcentaje;
  });
  return withPct;
}

module.exports = { calcularRankingPersonal, CATEGORIA_LABEL };
