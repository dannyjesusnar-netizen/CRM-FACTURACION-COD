// Canal de mensajes del widget ODIN (esquina inferior derecha del CRM).
// Cualquier cuenta logueada puede escribir — no es un módulo de negocio,
// así que no exige permiso especial. Los mensajes los lee el dueño de la
// plataforma desde panel-central (ver routes/platform.js).
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST / { mensaje }
router.post('/', (req, res) => {
  const mensaje = String(req.body?.mensaje || '').trim();
  if (!mensaje) {
    return res.status(400).json({ error: 'Escribe un mensaje antes de enviarlo.' });
  }
  const info = db.prepare(
    'INSERT INTO mensajes_soporte (user_id, nombre_usuario, mensaje) VALUES (?, ?, ?)'
  ).run(req.user.id, req.user.full_name || null, mensaje);
  res.status(201).json(db.prepare('SELECT * FROM mensajes_soporte WHERE id = ?').get(info.lastInsertRowid));
});

module.exports = router;
