// Página pública a la que lleva el "QR Único" (ver routes/qrUnico.js) — la
// escanea el cliente del comercio, no necesita sesión ni permisos. Solo
// expone lo mínimo para que pueda pagar: nombre del comercio y los datos de
// Yape/Plin que el dueño cargó.
const express = require('express');
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { resolveTenantDb } = require('../utils/tenant');

const router = express.Router();

router.get('/:ruc', (req, res) => {
  const { ruc } = req.params;
  const tenant = tenantRegistry.findTenant(ruc);
  if (!tenant) {
    // Igual que en el login: la instalación base de este despliegue nunca
    // pasó por el registro de tenants hasta que Gerencia guarda su RUC en
    // Configuración — así que si no hay tenant, se verifica contra la base
    // por defecto antes de decir que no existe.
    const empresaBase = db.runWithDb(db.openTenantDb(db.DEFAULT_DB_PATH), () =>
      db.prepare('SELECT ruc FROM empresa_config WHERE id = 1').get()
    );
    if (!empresaBase?.ruc || empresaBase.ruc !== ruc) {
      return res.status(404).json({ error: 'No se encontró ningún comercio con ese código.' });
    }
  } else if (tenant.estado !== 'aprobado') {
    return res.status(404).json({ error: 'No se encontró ningún comercio con ese código.' });
  }

  const tenantDb = resolveTenantDb(ruc);
  db.runWithDb(tenantDb, () => {
    const empresa = db.prepare('SELECT razon_social, nombre_comercial, logo_data_url FROM empresa_config WHERE id = 1').get();
    const medios = db.prepare(
      `SELECT medio, qr_data_url, titular_nombre, titular_telefono FROM qr_unico_medios
       WHERE titular_nombre IS NOT NULL OR titular_telefono IS NOT NULL OR qr_data_url IS NOT NULL`
    ).all();
    res.json({
      nombre_comercio: empresa?.nombre_comercial || empresa?.razon_social || 'Comercio',
      logo_data_url: empresa?.logo_data_url || null,
      medios,
    });
  });
});

module.exports = router;
