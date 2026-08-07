const express = require('express');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { TABLA_POR_TIPO, listSeries, siguienteNumero } = require('../utils/series');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

// GET /api/series -> serie + siguiente número real (dato ya combinado con lo
// usado en la práctica) de cada tipo de documento, para la pantalla
// Configuración -> Series y Sucursal.
router.get('/', (req, res) => {
  const rows = listSeries().map((s) => ({
    ...s,
    siguiente_numero_real: siguienteNumero(s.tipo_documento)?.numero ?? s.siguiente_numero,
  }));
  res.json(rows);
});

// PUT /api/series { series: [{ tipo_documento, serie, siguiente_numero }] } ->
// guarda todas las filas de una vez (como el botón "Modificar Series").
router.put('/', (req, res) => {
  const { series } = req.body || {};
  if (!Array.isArray(series) || series.length === 0) {
    return res.status(400).json({ error: 'Debe enviar al menos una serie.' });
  }
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
  }
  const update = db.prepare('UPDATE series_config SET serie = ?, siguiente_numero = ? WHERE tipo_documento = ?');
  const updateAll = db.transaction(() => {
    for (const s of series) {
      update.run(String(s.serie).trim().toUpperCase(), Number(s.siguiente_numero), s.tipo_documento);
    }
  });
  updateAll();
  const rows = listSeries().map((s) => ({
    ...s,
    siguiente_numero_real: siguienteNumero(s.tipo_documento)?.numero ?? s.siguiente_numero,
  }));
  res.json(rows);
});

module.exports = router;
