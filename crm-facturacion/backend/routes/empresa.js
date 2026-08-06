const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { buildInvoicePdf } = require('../utils/pdf');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const config = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  res.json(config);
});

const LOGO_MAX_BYTES = 1.5 * 1024 * 1024; // ~1.5MB en base64
const TAMANOS_PDF = ['A4', 'ticket_80mm'];

router.put('/', requireGerencia, (req, res) => {
  const {
    razon_social, ruc, nombre_comercial, direccion_fiscal, telefono, email,
    actividad_ciiu, actividad_mcc, departamento, provincia, distrito, logo_data_url,
    color_acento, mostrar_logo_pdf, mostrar_datos_contacto_pdf, tamano_pdf, terminos_condiciones_pdf,
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
  if (color_acento && !/^#[0-9a-fA-F]{6}$/.test(color_acento)) {
    return res.status(400).json({ error: 'color_acento debe ser un color hexadecimal (ej. #0f4c81).' });
  }
  if (tamano_pdf && !TAMANOS_PDF.includes(tamano_pdf)) {
    return res.status(400).json({ error: 'tamano_pdf inválido. Use A4 o ticket_80mm.' });
  }
  const existing = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  db.prepare(
    `UPDATE empresa_config SET razon_social = ?, ruc = ?, nombre_comercial = ?, direccion_fiscal = ?,
     telefono = ?, email = ?, actividad_ciiu = ?, actividad_mcc = ?, departamento = ?, provincia = ?, distrito = ?,
     logo_data_url = ?, color_acento = ?, mostrar_logo_pdf = ?, mostrar_datos_contacto_pdf = ?, tamano_pdf = ?,
     terminos_condiciones_pdf = ?, updated_at = datetime('now'), updated_by = ? WHERE id = 1`
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
    color_acento || existing?.color_acento || '#0f4c81',
    mostrar_logo_pdf !== undefined ? (mostrar_logo_pdf ? 1 : 0) : existing?.mostrar_logo_pdf ?? 1,
    mostrar_datos_contacto_pdf !== undefined ? (mostrar_datos_contacto_pdf ? 1 : 0) : existing?.mostrar_datos_contacto_pdf ?? 1,
    tamano_pdf || existing?.tamano_pdf || 'A4',
    terminos_condiciones_pdf !== undefined ? (terminos_condiciones_pdf || null) : existing?.terminos_condiciones_pdf || null,
    req.user?.id || null
  );
  res.json(db.prepare('SELECT * FROM empresa_config WHERE id = 1').get());
});

// GET /api/empresa/comprobante-preview -> PDF de ejemplo con los datos/ajustes actuales,
// para previsualizar cómo se ve un comprobante real sin necesidad de emitir uno.
router.get('/comprobante-preview', requireGerencia, (req, res) => {
  const sampleInvoice = {
    tipo_comprobante: 'factura',
    serie: 'F001',
    numero: 1,
    fecha_emision: new Date().toISOString().slice(0, 10),
    moneda: 'PEN',
    estado: 'emitido',
    modo_emision: 'simulado',
    sunat_estado: null,
    sunat_hash: null,
    sunat_mensaje: null,
    cliente_nombre: 'CLIENTE DE EJEMPLO S.A.C.',
    cliente_tipo_documento: 'RUC',
    cliente_documento: '20123456789',
    cliente_direccion: 'Av. Ejemplo 123, Miraflores, Lima',
    subtotal: 152.37,
    igv: 27.43,
    total: 179.80,
    observaciones: 'Comprobante de ejemplo — solo para previsualizar el diseño.',
  };
  const sampleItems = [
    { descripcion: 'Producto de ejemplo A', cantidad: 2, precio_unitario: 45.9, subtotal: 91.8 },
    { descripcion: 'Producto de ejemplo B', cantidad: 1, precio_unitario: 87.99, subtotal: 87.99 },
  ];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="vista-previa-comprobante.pdf"');
  const doc = buildInvoicePdf(sampleInvoice, sampleItems);
  doc.pipe(res);
  doc.end();
});

module.exports = router;
