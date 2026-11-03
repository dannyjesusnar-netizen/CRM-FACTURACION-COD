const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { CATEGORIAS, deudaPendienteDe, limiteDe } = require('../utils/limitesAbonado');

const router = express.Router();
router.use(requireAuth);

// Deuda pendiente HOY, sumada entre todas las personas de una categoría —
// solo de contexto en Configuración, para que Gerencia vea cuánto le
// afectaría bajar el tope antes de guardarlo (no se usa para validar
// ninguna venta, eso lo hace utils/limitesAbonado.js por persona).
function deudaPendienteDeCategoria(categoria) {
  const porPersona = (tabla) => `
    SELECT COALESCE(atribuido_a, created_by) AS persona, SUM(total - monto_pagado) AS saldo
    FROM ${tabla} WHERE forma_pago = 'abonado' AND estado = 'emitido'${tabla === 'invoices' ? " AND tipo_comprobante != 'nota_credito'" : ''}
    GROUP BY persona
  `;
  const { t } = db.prepare(`
    SELECT COALESCE(SUM(d.saldo), 0) AS t FROM (
      SELECT * FROM (${porPersona('invoices')})
      UNION ALL
      SELECT * FROM (${porPersona('notas_venta')})
    ) d
    JOIN users u ON u.id = d.persona
    WHERE u.categoria_staff = ?
  `).get(categoria);
  return t;
}

// GET /api/limites-abonado -> una fila por categoría de personal (trainer,
// supervisor, vendedor), con el tope vigente (null = sin tope todavía) y la
// deuda pendiente actual sumada de esa categoría, de contexto.
router.get('/', (req, res) => {
  const filas = db.prepare('SELECT categoria_staff, monto_maximo FROM limites_abonado').all();
  const mapa = new Map(filas.map((f) => [f.categoria_staff, f.monto_maximo]));
  res.json(CATEGORIAS.map((categoria_staff) => ({
    categoria_staff,
    monto_maximo: mapa.has(categoria_staff) ? mapa.get(categoria_staff) : null,
    deuda_pendiente: deudaPendienteDeCategoria(categoria_staff),
  })));
});

// PUT /api/limites-abonado { categoria_staff, monto_maximo } -> crea o
// reemplaza el tope de una categoría. monto_maximo null/vacío = quita el
// tope (deja a esa categoría sin límite). Exclusivo de Gerencia ("el
// administrador"), igual que el resto de ajustes de negocio en
// Configuración.
router.put('/', requireGerencia, (req, res) => {
  const { categoria_staff, monto_maximo } = req.body || {};
  if (!CATEGORIAS.includes(categoria_staff)) {
    return res.status(400).json({ error: 'categoria_staff inválida. Use trainer, supervisor o vendedor.' });
  }
  if (monto_maximo === null || monto_maximo === undefined || monto_maximo === '') {
    db.prepare('DELETE FROM limites_abonado WHERE categoria_staff = ?').run(categoria_staff);
    return res.json({ categoria_staff, monto_maximo: null });
  }
  const monto = Number(monto_maximo);
  if (!Number.isFinite(monto) || monto <= 0) {
    return res.status(400).json({ error: 'El monto máximo debe ser un número mayor a 0.' });
  }
  db.prepare(
    `INSERT INTO limites_abonado (categoria_staff, monto_maximo, updated_by) VALUES (?, ?, ?)
     ON CONFLICT(categoria_staff) DO UPDATE SET monto_maximo = excluded.monto_maximo, updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(categoria_staff, monto, req.user?.id || null);
  res.json({ categoria_staff, monto_maximo: monto });
});

// GET /api/limites-abonado/personas?q= -> Trainers/Supervisores/Vendedores
// activos (con o sin usuario de login, ver /api/users/operativos) con su
// categoría, sede, deuda pendiente hoy, el tope heredado de su categoría y
// su excepción individual si Gerencia le puso una (ver
// limites_abonado_usuario) — para la lista de "Límite por persona" de
// Configuración. Exclusivo de Gerencia: muestra deuda de cada empleado por
// nombre.
router.get('/personas', requireGerencia, (req, res) => {
  const { q } = req.query;
  let sql = `
    SELECT u.id, u.full_name, u.categoria_staff, s.nombre AS sucursal_nombre
    FROM users u LEFT JOIN sucursales s ON s.id = u.sucursal_id
    WHERE u.activo = 1 AND u.role != 'gerencia' AND u.categoria_staff IN ('trainer', 'supervisor', 'vendedor')
  `;
  const params = [];
  if (q) {
    sql += ' AND u.full_name LIKE ?';
    params.push(`%${q}%`);
  }
  sql += ' ORDER BY u.full_name ASC';
  const personas = db.prepare(sql).all(...params);
  const overrides = new Map(
    db.prepare('SELECT user_id, monto_maximo FROM limites_abonado_usuario').all().map((f) => [f.user_id, f.monto_maximo])
  );
  res.json(personas.map((p) => ({
    ...p,
    deuda_pendiente: deudaPendienteDe(p.id),
    limite_categoria: limiteDe(p.categoria_staff),
    limite_personal: overrides.has(p.id) ? overrides.get(p.id) : null,
  })));
});

// PUT /api/limites-abonado/personas/:id { monto_maximo } -> excepción
// individual de esa persona. null/vacío = quitarla (vuelve a seguir el
// tope de su categoría). Exclusivo de Gerencia.
router.put('/personas/:id', requireGerencia, (req, res) => {
  const userId = Number(req.params.id);
  const persona = db.prepare(
    `SELECT id FROM users WHERE id = ? AND activo = 1 AND role != 'gerencia' AND categoria_staff IN ('trainer', 'supervisor', 'vendedor')`
  ).get(userId);
  if (!persona) return res.status(404).json({ error: 'Persona no encontrada.' });
  const { monto_maximo } = req.body || {};
  if (monto_maximo === null || monto_maximo === undefined || monto_maximo === '') {
    db.prepare('DELETE FROM limites_abonado_usuario WHERE user_id = ?').run(userId);
    return res.json({ user_id: userId, monto_maximo: null });
  }
  const monto = Number(monto_maximo);
  if (!Number.isFinite(monto) || monto <= 0) {
    return res.status(400).json({ error: 'El monto máximo debe ser un número mayor a 0.' });
  }
  db.prepare(
    `INSERT INTO limites_abonado_usuario (user_id, monto_maximo, updated_by) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET monto_maximo = excluded.monto_maximo, updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(userId, monto, req.user?.id || null);
  res.json({ user_id: userId, monto_maximo: monto });
});

module.exports = router;
