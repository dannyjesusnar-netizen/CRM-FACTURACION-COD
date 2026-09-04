const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal, requireGerencia } = require('../middleware/auth');
const { analizarComprobante } = require('../utils/ocrPago');
const { hoyPeru } = require('../utils/fechas');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);

const MEDIOS_VALIDOS = ['yape', 'plin'];

function esDataUrlImagen(s) {
  return typeof s === 'string' && s.startsWith('data:image/');
}

// POST /api/pagos-qr/detectar-monto { foto_data_url } -> intenta leer el
// monto y el medio (Yape/Plin) desde la foto del comprobante. Cualquiera de
// los dos puede salir null si el OCR no encontró nada — es solo una
// sugerencia, quien registra el pago siempre confirma o corrige.
router.post('/detectar-monto', async (req, res) => {
  const { foto_data_url } = req.body || {};
  if (!esDataUrlImagen(foto_data_url)) {
    return res.status(400).json({ error: 'foto_data_url debe ser una imagen válida.' });
  }
  try {
    const resultado = await analizarComprobante(foto_data_url);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo analizar la foto. Ingresa el monto manualmente.' });
  }
});

// GET /api/pagos-qr?fecha=YYYY-MM-DD (default hoy) -> pagos de la sede
// activa en esa fecha, más un resumen (total y por medio) para el control
// diario de lo vendido por QR.
router.get('/', (req, res) => {
  const fecha = req.query.fecha || hoyPeru();
  const pagos = db.prepare(
    `SELECT p.*, u.full_name AS usuario_nombre
     FROM pagos_qr p LEFT JOIN users u ON u.id = p.created_by
     WHERE p.sucursal_id = ? AND date(p.created_at) = date(?)
     ORDER BY p.created_at DESC`
  ).all(req.sucursalId, fecha);
  const total = pagos.reduce((s, p) => s + p.monto, 0);
  const porMedio = { yape: 0, plin: 0 };
  for (const p of pagos) {
    if (porMedio[p.medio] !== undefined) porMedio[p.medio] += p.monto;
  }
  res.json({ fecha, pagos, total: Math.round(total * 100) / 100, porMedio });
});

router.post('/', (req, res) => {
  const { medio, monto, monto_detectado, foto_data_url, hora_detectada, comentario } = req.body || {};
  if (!MEDIOS_VALIDOS.includes(medio)) {
    return res.status(400).json({ error: 'medio inválido. Use yape o plin.' });
  }
  if (!(Number(monto) > 0)) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
  }
  if (!esDataUrlImagen(foto_data_url)) {
    return res.status(400).json({ error: 'Debes adjuntar la foto del comprobante.' });
  }
  const info = db.prepare(
    `INSERT INTO pagos_qr (medio, monto, monto_detectado, foto_data_url, hora_detectada, comentario, sucursal_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    medio, Number(monto), monto_detectado != null ? Number(monto_detectado) : null, foto_data_url,
    hora_detectada || null, comentario || null, req.sucursalId, req.user.id
  );
  res.status(201).json(db.prepare('SELECT * FROM pagos_qr WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', requireGerencia, (req, res) => {
  const existente = db.prepare('SELECT * FROM pagos_qr WHERE id = ? AND sucursal_id = ?').get(req.params.id, req.sucursalId);
  if (!existente) return res.status(404).json({ error: 'Pago no encontrado.' });
  db.prepare('DELETE FROM pagos_qr WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
