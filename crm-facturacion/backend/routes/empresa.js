const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const config = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  res.json(config);
});

router.put('/', requireGerencia, (req, res) => {
  const { razon_social, ruc, nombre_comercial, direccion_fiscal, telefono, email } = req.body || {};
  if (!razon_social || !ruc) {
    return res.status(400).json({ error: 'Razón social y RUC son requeridos.' });
  }
  if (!/^\d{11}$/.test(ruc)) {
    return res.status(400).json({ error: 'El RUC debe tener 11 dígitos.' });
  }
  db.prepare(
    `UPDATE empresa_config SET razon_social = ?, ruc = ?, nombre_comercial = ?, direccion_fiscal = ?,
     telefono = ?, email = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1`
  ).run(
    razon_social,
    ruc,
    nombre_comercial || razon_social,
    direccion_fiscal || null,
    telefono || null,
    email || null,
    req.user?.id || null
  );
  res.json(db.prepare('SELECT * FROM empresa_config WHERE id = 1').get());
});

module.exports = router;
