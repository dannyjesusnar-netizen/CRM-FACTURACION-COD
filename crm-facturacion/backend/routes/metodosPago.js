const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const TIPOS_VALIDOS = ['efectivo', 'billetera', 'pos', 'transferencia', 'link', 'otro'];

function slugify(nombre) {
  return String(nombre)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// GET /api/metodos-pago?todos=1 (incluye desactivados, para el panel de Gerencia)
router.get('/', (req, res) => {
  const sql = req.query.todos
    ? 'SELECT * FROM metodos_pago ORDER BY orden ASC, id ASC'
    : 'SELECT * FROM metodos_pago WHERE activo = 1 ORDER BY orden ASC, id ASC';
  res.json(db.prepare(sql).all());
});

router.post('/', requireGerencia, (req, res) => {
  const { nombre, tipo, color, icono } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Use: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ error: 'color debe ser un hexadecimal (ej. #0f4c81).' });
  }
  const codigo = slugify(nombre);
  if (!codigo) return res.status(400).json({ error: 'nombre inválido.' });
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM metodos_pago').get().m;
  try {
    const info = db.prepare(
      'INSERT INTO metodos_pago (codigo, nombre, tipo, color, icono, orden, activo) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(codigo, nombre, tipo || 'otro', color || '#0f4c81', icono || '💳', maxOrden + 1);
    res.status(201).json(db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(409).json({ error: 'Ya existe un método de pago con ese nombre.' });
  }
});

router.put('/:id', requireGerencia, (req, res) => {
  const existing = db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Método de pago no encontrado.' });
  const { nombre, tipo, color, icono } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Use: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ error: 'color debe ser un hexadecimal (ej. #0f4c81).' });
  }
  db.prepare('UPDATE metodos_pago SET nombre = ?, tipo = ?, color = ?, icono = ? WHERE id = ?').run(
    nombre,
    tipo || existing.tipo,
    color || existing.color,
    icono || existing.icono,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id));
});

// PUT /api/metodos-pago/:id/estado { activo: true|false }
router.put('/:id/estado', requireGerencia, (req, res) => {
  const existing = db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Método de pago no encontrado.' });
  db.prepare('UPDATE metodos_pago SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireGerencia, (req, res) => {
  const existing = db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Método de pago no encontrado.' });
  const usado = [
    db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE forma_pago = ?').get(existing.codigo).n,
    db.prepare('SELECT COUNT(*) AS n FROM cobros WHERE medio = ?').get(existing.codigo).n,
    db.prepare('SELECT COUNT(*) AS n FROM caja_movimientos WHERE medio = ?').get(existing.codigo).n,
  ].reduce((a, b) => a + b, 0);
  if (usado > 0) {
    return res.status(409).json({ error: 'No se puede eliminar: ya tiene comprobantes o movimientos asociados. Puedes desactivarlo en su lugar.' });
  }
  db.prepare('DELETE FROM metodos_pago WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
