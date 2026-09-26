const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAccionConfiguracion } = require('../utils/permisos');

const requireMetodosPago = requireAccionConfiguracion('metodos_pago');

const router = express.Router();
router.use(requireAuth);

const TIPOS_VALIDOS = ['efectivo', 'billetera', 'pos', 'transferencia', 'link', 'otro'];

// "abonado" no es un método de pago real, es el valor que ya usa todo el
// sistema para marcar una venta al crédito (invoices.forma_pago = 'abonado'
// — ver Cuentas por Cobrar, utils/cajaCalculos.js). Ese código no está en la
// tabla metodos_pago (buildResumen arma su tarjeta "Abonados" del Tablero de
// Caja aparte, en memoria) así que nada impedía crear un método de pago real
// cuyo nombre también slugifique a "abonado" — quedaban dos tarjetas
// distintas en Caja con el mismo significado, y encima cualquier venta
// cobrada con ese método quedaba registrada como crédito real sin querer.
const CODIGOS_RESERVADOS = ['abonado'];

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

// El QR es una foto/captura (base64) — se acepta hasta ~2MB de payload
// codificado, suficiente para una imagen de QR comprimida.
const QR_MAX_LEN = 2_000_000;

function validarQrYLink(qr_data_url, link_pago) {
  if (qr_data_url && (typeof qr_data_url !== 'string' || !qr_data_url.startsWith('data:image/') || qr_data_url.length > QR_MAX_LEN)) {
    return 'El QR debe ser una imagen válida de menos de 1.5MB.';
  }
  if (link_pago && !/^https?:\/\//i.test(link_pago)) {
    return 'El link de pago debe empezar con http:// o https://';
  }
  return null;
}

router.post('/', requireMetodosPago, (req, res) => {
  const { nombre, tipo, color, icono, qr_data_url, link_pago } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Use: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ error: 'color debe ser un hexadecimal (ej. #0f4c81).' });
  }
  const errorQr = validarQrYLink(qr_data_url, link_pago);
  if (errorQr) return res.status(400).json({ error: errorQr });
  const codigo = slugify(nombre);
  if (!codigo) return res.status(400).json({ error: 'nombre inválido.' });
  if (CODIGOS_RESERVADOS.includes(codigo)) {
    return res.status(400).json({ error: '"Abonado" ya es un concepto reservado del sistema (venta al crédito) — usa otro nombre para este método de pago.' });
  }
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM metodos_pago').get().m;
  try {
    const info = db.prepare(
      `INSERT INTO metodos_pago (codigo, nombre, tipo, color, icono, orden, activo, qr_data_url, link_pago)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(codigo, nombre, tipo || 'otro', color || '#0f4c81', icono || '💳', maxOrden + 1, qr_data_url || null, link_pago || null);
    res.status(201).json(db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(409).json({ error: 'Ya existe un método de pago con ese nombre.' });
  }
});

router.put('/:id', requireMetodosPago, (req, res) => {
  const existing = db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Método de pago no encontrado.' });
  const { nombre, tipo, color, icono, qr_data_url, link_pago } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Use: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ error: 'color debe ser un hexadecimal (ej. #0f4c81).' });
  }
  const errorQr = validarQrYLink(qr_data_url, link_pago);
  if (errorQr) return res.status(400).json({ error: errorQr });
  db.prepare('UPDATE metodos_pago SET nombre = ?, tipo = ?, color = ?, icono = ?, qr_data_url = ?, link_pago = ? WHERE id = ?').run(
    nombre,
    tipo || existing.tipo,
    color || existing.color,
    icono || existing.icono,
    qr_data_url === undefined ? existing.qr_data_url : (qr_data_url || null),
    link_pago === undefined ? existing.link_pago : (link_pago || null),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id));
});

// PUT /api/metodos-pago/:id/estado { activo: true|false }
router.put('/:id/estado', requireMetodosPago, (req, res) => {
  const existing = db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Método de pago no encontrado.' });
  db.prepare('UPDATE metodos_pago SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM metodos_pago WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireMetodosPago, (req, res) => {
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
