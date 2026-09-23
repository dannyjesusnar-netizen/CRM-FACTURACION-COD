// Administración de tokens de BI (ver middleware/biAuth.js, routes/bi.js) —
// esto sí requiere sesión normal (con el permiso de Configuración → Power
// BI), a diferencia de /api/bi/* que se autentica con el token generado acá.
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAccionConfiguracion } = require('../utils/permisos');
const { hashToken } = require('../middleware/biAuth');

const router = express.Router();
router.use(requireAuth);
router.use(requireAccionConfiguracion('power_bi'));

router.get('/', (req, res) => {
  res.json(db.prepare(
    'SELECT id, nombre, created_at, ultimo_uso_at FROM bi_tokens ORDER BY created_at DESC'
  ).all());
});

// El valor real del token SOLO se devuelve acá, una vez — de ahí en
// adelante ni siquiera Gerencia puede volver a verlo (solo se guarda su
// hash), igual que cualquier API key de un servicio serio.
router.post('/', (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Ponle un nombre al token (ej. "Power BI Organic").' });
  const token = crypto.randomBytes(32).toString('hex');
  const info = db.prepare(
    'INSERT INTO bi_tokens (nombre, token_hash, created_by) VALUES (?, ?, ?)'
  ).run(nombre, hashToken(token), req.user?.id || null);
  res.status(201).json({ id: info.lastInsertRowid, nombre, token });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM bi_tokens WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Token no encontrado.' });
  res.json({ ok: true });
});

module.exports = router;
