const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAccionConfiguracion } = require('../utils/permisos');
const { TABLA_POR_TIPO, listSeries, siguienteNumero } = require('../utils/series');

const router = express.Router();
router.use(requireAuth);
router.use(requireAccionConfiguracion('series'));

function sucursalExiste(sucursalId) {
  return !!db.prepare('SELECT 1 FROM sucursales WHERE id = ?').get(sucursalId);
}

// GET /api/series?sucursal_id=X -> serie + siguiente número real (dato ya
// combinado con lo usado en la práctica) de cada tipo de documento de esa
// sede, para la pantalla Configuración -> Series y Sucursal. Gerencia puede
// administrar la serie de cualquier sede, no solo la que tenga activa en su
// sesión — por eso la sede se recibe explícita y no sale de req.sucursalId.
router.get('/', (req, res) => {
  const sucursalId = Number(req.query.sucursal_id);
  if (!sucursalId) return res.status(400).json({ error: 'sucursal_id es requerido.' });
  if (!sucursalExiste(sucursalId)) return res.status(404).json({ error: 'Sede no encontrada.' });
  const rows = listSeries(sucursalId).map((s) => ({
    ...s,
    siguiente_numero_real: siguienteNumero(s.tipo_documento, sucursalId)?.numero ?? s.siguiente_numero,
  }));
  res.json(rows);
});

// PUT /api/series { sucursal_id, series: [{ tipo_documento, serie, siguiente_numero }] } ->
// guarda las filas de esa sede (como el botón "Modificar Series").
router.put('/', (req, res) => {
  const { sucursal_id, series } = req.body || {};
  const sucursalId = Number(sucursal_id);
  if (!sucursalId) return res.status(400).json({ error: 'sucursal_id es requerido.' });
  if (!sucursalExiste(sucursalId)) return res.status(404).json({ error: 'Sede no encontrada.' });
  if (!Array.isArray(series) || series.length === 0) {
    return res.status(400).json({ error: 'Debe enviar al menos una serie.' });
  }
  const seriesNormalizadas = [];
  for (const s of series) {
    if (!TABLA_POR_TIPO[s.tipo_documento]) {
      return res.status(400).json({ error: `Tipo de documento inválido: ${s.tipo_documento}.` });
    }
    if (!s.serie || !/^[A-Za-z0-9]{1,10}$/.test(String(s.serie).trim())) {
      return res.status(400).json({ error: `La serie de ${s.tipo_documento} debe tener entre 1 y 10 caracteres alfanuméricos.` });
    }
    if (!(Number(s.siguiente_numero) >= 1)) {
      return res.status(400).json({ error: `El correlativo de ${s.tipo_documento} debe ser un número mayor o igual a 1.` });
    }
    seriesNormalizadas.push({
      tipo_documento: s.tipo_documento,
      serie: String(s.serie).trim().toUpperCase(),
      siguiente_numero: Number(s.siguiente_numero),
    });
  }
  // SUNAT exige que cada sede tenga su propia serie por tipo de documento —
  // no se puede guardar una serie que ya use otra sede.
  for (const s of seriesNormalizadas) {
    const otra = db.prepare(
      'SELECT sucursal_id FROM series_config WHERE tipo_documento = ? AND serie = ? AND sucursal_id != ?'
    ).get(s.tipo_documento, s.serie, sucursalId);
    if (otra) {
      return res.status(400).json({ error: `La serie "${s.serie}" ya la usa otra sede — cada sede necesita una serie distinta.` });
    }
  }
  // Tampoco puede haber dos TIPOS de documento de esta misma sede compartiendo
  // serie (ej. Nota de Crédito con la misma serie que Boleta) — cada tipo
  // lleva su propio correlativo por dentro (ver utils/series.js), así que
  // compartir la serie produce un mismo "serie-número" para dos comprobantes
  // distintos. Se arma el estado final de todas las series de esta sede (las
  // que no vienen en este PUT quedan como están en la base) y se revisa que
  // ninguna serie se repita entre tipos distintos.
  const estadoFinal = new Map(listSeries(sucursalId).map((s) => [s.tipo_documento, s.serie]));
  for (const s of seriesNormalizadas) {
    estadoFinal.set(s.tipo_documento, s.serie);
  }
  const tiposPorSerie = new Map();
  for (const [tipo, serie] of estadoFinal) {
    if (!tiposPorSerie.has(serie)) tiposPorSerie.set(serie, []);
    tiposPorSerie.get(serie).push(tipo);
  }
  for (const [serie, tipos] of tiposPorSerie) {
    if (tipos.length > 1) {
      return res.status(400).json({
        error: `La serie "${serie}" no puede repetirse entre tipos de documento distintos (${tipos.join(', ')}) — cada uno necesita la suya.`,
      });
    }
  }
  const update = db.prepare('UPDATE series_config SET serie = ?, siguiente_numero = ? WHERE tipo_documento = ? AND sucursal_id = ?');
  const updateAll = db.transaction(() => {
    for (const s of seriesNormalizadas) {
      update.run(s.serie, s.siguiente_numero, s.tipo_documento, sucursalId);
    }
  });
  updateAll();
  const rows = listSeries(sucursalId).map((s) => ({
    ...s,
    siguiente_numero_real: siguienteNumero(s.tipo_documento, sucursalId)?.numero ?? s.siguiente_numero,
  }));
  res.json(rows);
});

module.exports = router;
