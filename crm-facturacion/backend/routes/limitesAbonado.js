const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { CATEGORIAS } = require('../utils/limitesAbonado');

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

module.exports = router;
