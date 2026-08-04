const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const config = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  res.json(config);
});

const LOGO_MAX_BYTES = 1.5 * 1024 * 1024; // ~1.5MB en base64

router.put('/', requireGerencia, (req, res) => {
  const {
    razon_social, ruc, nombre_comercial, direccion_fiscal, telefono, email,
    actividad_ciiu, actividad_mcc, departamento, provincia, distrito, logo_data_url,
  } = req.body || {};
  if (!razon_social || !ruc) {
    return res.status(400).json({ error: 'Razón social y RUC son requeridos.' });
  }
  if (!/^\d{11}$/.test(ruc)) {
    return res.status(400).json({ error: 'El RUC debe tener 11 dígitos.' });
  }
  if (logo_data_url && logo_data_url.length > LOGO_MAX_BYTES) {
    return res.status(400).json({ error: 'El logo es demasiado grande. Usa una imagen más liviana (máximo ~1MB).' });
  }
  const existing = db.prepare('SELECT logo_data_url FROM empresa_config WHERE id = 1').get();
  db.prepare(
    `UPDATE empresa_config SET razon_social = ?, ruc = ?, nombre_comercial = ?, direccion_fiscal = ?,
     telefono = ?, email = ?, actividad_ciiu = ?, actividad_mcc = ?, departamento = ?, provincia = ?, distrito = ?,
     logo_data_url = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1`
  ).run(
    razon_social,
    ruc,
    nombre_comercial || razon_social,
    direccion_fiscal || null,
    telefono || null,
    email || null,
    actividad_ciiu || null,
    actividad_mcc || null,
    departamento || null,
    provincia || null,
    distrito || null,
    logo_data_url !== undefined ? (logo_data_url || null) : existing?.logo_data_url || null,
    req.user?.id || null
  );
  res.json(db.prepare('SELECT * FROM empresa_config WHERE id = 1').get());
});

module.exports = router;
