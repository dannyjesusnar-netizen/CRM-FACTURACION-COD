const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MEDIOS_VALIDOS = ['yape', 'plin'];
const QR_MAX_LEN = 2_000_000;

function validar({ qr_data_url, titular_nombre, titular_telefono }) {
  if (qr_data_url && (typeof qr_data_url !== 'string' || !qr_data_url.startsWith('data:image/') || qr_data_url.length > QR_MAX_LEN)) {
    return 'El QR debe ser una imagen válida de menos de 1.5MB.';
  }
  if (titular_nombre && typeof titular_nombre !== 'string') return 'Nombre del titular inválido.';
  if (titular_telefono && !/^\d{6,15}$/.test(titular_telefono)) return 'El teléfono debe tener solo números.';
  return null;
}

// GET /api/qr-unico/medios — los dos medios (yape/plin) de esta empresa,
// existan o no todavía (con id null si aún no se guardó nada).
router.get('/medios', (req, res) => {
  const filas = db.prepare('SELECT * FROM qr_unico_medios').all();
  const porMedio = Object.fromEntries(filas.map((f) => [f.medio, f]));
  res.json(MEDIOS_VALIDOS.map((medio) => porMedio[medio] || { medio }));
});

// PUT /api/qr-unico/medios/:medio — crea o actualiza (upsert) los datos de
// Yape o Plin. Todo opcional: se puede guardar solo el nombre primero y la
// foto después, por ejemplo.
router.put('/medios/:medio', requireGerencia, (req, res) => {
  const { medio } = req.params;
  if (!MEDIOS_VALIDOS.includes(medio)) {
    return res.status(400).json({ error: 'medio inválido. Use yape o plin.' });
  }
  const errorValidacion = validar(req.body || {});
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  const existente = db.prepare('SELECT * FROM qr_unico_medios WHERE medio = ?').get(medio);
  const { qr_data_url, titular_nombre, titular_telefono } = req.body || {};
  if (existente) {
    db.prepare(
      `UPDATE qr_unico_medios SET qr_data_url = ?, titular_nombre = ?, titular_telefono = ?, updated_at = datetime('now')
       WHERE medio = ?`
    ).run(
      qr_data_url === undefined ? existente.qr_data_url : (qr_data_url || null),
      titular_nombre === undefined ? existente.titular_nombre : (titular_nombre || null),
      titular_telefono === undefined ? existente.titular_telefono : (titular_telefono || null),
      medio
    );
  } else {
    db.prepare(
      `INSERT INTO qr_unico_medios (medio, qr_data_url, titular_nombre, titular_telefono) VALUES (?, ?, ?, ?)`
    ).run(medio, qr_data_url || null, titular_nombre || null, titular_telefono || null);
  }
  res.json(db.prepare('SELECT * FROM qr_unico_medios WHERE medio = ?').get(medio));
});

// GET /api/qr-unico/generar — genera la imagen de QR (PNG en base64) que
// apunta a la página pública /pago/:ruc de este comercio. No es un QR de
// pago real (eso lo emite cada banco/app) — es un QR que lleva a nuestra
// propia página con el menú Yape/Plin, ver routes/pagoPublico.js.
router.get('/generar', async (req, res) => {
  const empresa = db.prepare('SELECT ruc FROM empresa_config WHERE id = 1').get();
  if (!empresa?.ruc) {
    return res.status(400).json({ error: 'Configura primero el RUC de tu empresa en Configuración → Datos de la empresa.' });
  }
  const url = `${req.protocol}://${req.get('host')}/pago/${empresa.ruc}`;
  try {
    const qr_data_url = await QRCode.toDataURL(url, { width: 400, margin: 1 });
    res.json({ url, qr_data_url });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo generar el QR.' });
  }
});

module.exports = router;
