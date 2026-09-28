const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { ejecutarTodoONada } = require('../utils/cargaMasiva');
const { consultarRuc, consultarDni } = require('../utils/rucLookup');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermiso('clientes'));

function sucursalIdOrError(sucursalId) {
  if (sucursalId === undefined || sucursalId === null || sucursalId === '') return { value: null };
  const suc = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(Number(sucursalId));
  if (!suc) return { error: 'La sede seleccionada no existe o está desactivada.' };
  return { value: suc.id };
}

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const base = `SELECT c.*, s.nombre AS sucursal_nombre FROM clients c LEFT JOIN sucursales s ON s.id = c.sucursal_id`;
  let rows;
  if (q) {
    rows = db.prepare(
      `${base} WHERE c.nombre LIKE ? OR c.numero_documento LIKE ? ORDER BY c.nombre ASC`
    ).all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare(`${base} ORDER BY c.nombre ASC`).all();
  }
  res.json(rows);
});

// GET /api/clients/consultar-documento?tipo_documento=DNI|RUC&numero_documento=...
// -> autocompletar nombre/razón social al registrar un cliente nuevo desde
// una venta. Va antes de /:id para no chocar con esa ruta. Nunca falla la
// petición por un problema del proveedor externo -- responde 200 con
// encontrado:false en cualquier caso donde no se pudo autocompletar, para
// que el frontend simplemente no rellene nada (nunca bloquea el alta manual).
router.get('/consultar-documento', async (req, res) => {
  const tipoDocumento = (req.query.tipo_documento || '').toUpperCase();
  const numeroDocumento = (req.query.numero_documento || '').trim();
  if (tipoDocumento === 'DNI' && /^\d{8}$/.test(numeroDocumento)) {
    const info = await consultarDni(numeroDocumento);
    if (info.verificado && info.existe) {
      return res.json({ encontrado: true, nombre: info.nombreCompleto });
    }
    return res.json({ encontrado: false });
  }
  if (tipoDocumento === 'RUC' && /^\d{11}$/.test(numeroDocumento)) {
    const info = await consultarRuc(numeroDocumento);
    if (info.verificado && info.existe) {
      return res.json({ encontrado: true, nombre: info.razonSocial, direccion: info.direccion || undefined });
    }
    return res.json({ encontrado: false });
  }
  // CE (Carnet de Extranjería) u otro documento: no hay proveedor gratuito
  // de consulta -- se completa siempre a mano.
  return res.json({ encontrado: false });
});

// GET /api/clients/duplicados-ce
// Detecta clientes duplicados por Carnet de Extranjería: mismo
// numero_documento, una fila con tipo_documento = 'CE' (el código correcto,
// catálogo SUNAT) y otra con un valor viejo no estandarizado (ej. "CARNET
// EXT"), de antes de que "CE" existiera como opción en el formulario. No
// modifica nada -- solo lista los pares para que Gerencia los revise antes
// de fusionar. Va antes de /:id para no chocar con esa ruta.
router.get('/duplicados-ce', requireAccion('clientes', 'eliminar'), (req, res) => {
  const pares = db.prepare(`
    SELECT
      ce.id AS ce_id, ce.tipo_documento AS ce_tipo_documento, ce.nombre AS ce_nombre,
      ce.numero_documento, ce.telefono AS ce_telefono, ce.email AS ce_email,
      legacy.id AS legacy_id, legacy.tipo_documento AS legacy_tipo_documento, legacy.nombre AS legacy_nombre,
      legacy.telefono AS legacy_telefono, legacy.email AS legacy_email,
      (SELECT COUNT(*) FROM invoices WHERE client_id = legacy.id) AS legacy_comprobantes,
      (SELECT COUNT(*) FROM cotizaciones WHERE client_id = legacy.id) AS legacy_cotizaciones,
      (SELECT COUNT(*) FROM guias_remitentes WHERE client_id = legacy.id) AS legacy_guias,
      (SELECT COUNT(*) FROM notas_venta WHERE client_id = legacy.id) AS legacy_notas_venta
    FROM clients ce
    JOIN clients legacy
      ON legacy.numero_documento = ce.numero_documento
     AND legacy.id != ce.id
    WHERE ce.tipo_documento = 'CE'
      AND legacy.tipo_documento NOT IN ('DNI', 'RUC', 'CE')
    ORDER BY ce.nombre ASC
  `).all();
  res.json(pares);
});

router.get('/:id', (req, res) => {
  const row = db.prepare(
    `SELECT c.*, s.nombre AS sucursal_nombre FROM clients c LEFT JOIN sucursales s ON s.id = c.sucursal_id WHERE c.id = ?`
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const invoices = db.prepare(
    'SELECT * FROM invoices WHERE client_id = ? ORDER BY fecha_emision DESC'
  ).all(req.params.id);
  res.json({ ...row, invoices });
});

router.post('/', requireAccion('clientes', 'crear_editar'), (req, res) => {
  const { tipo_documento, numero_documento, nombre, direccion, telefono, email, notas, sucursal_id, turno, referencia, contacto } = req.body || {};
  if (!numero_documento || !nombre) {
    return res.status(400).json({ error: 'numero_documento y nombre son requeridos.' });
  }
  const sucursal = sucursalIdOrError(sucursal_id);
  if (sucursal.error) return res.status(400).json({ error: sucursal.error });
  try {
    const info = db.prepare(
      `INSERT INTO clients (tipo_documento, numero_documento, nombre, direccion, telefono, email, notas, sucursal_id, turno, referencia, contacto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tipo_documento || 'DNI', numero_documento, nombre, direccion || null, telefono || null, email || null,
      notas || null, sucursal.value, turno || null, referencia || null, contacto || null
    );
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un cliente con ese tipo y numero de documento.' });
    }
    res.status(500).json({ error: 'Error al crear cliente.' });
  }
});

router.put('/:id', requireAccion('clientes', 'crear_editar'), (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const { tipo_documento, numero_documento, nombre, direccion, telefono, email, notas, sucursal_id, turno, referencia, contacto } = req.body || {};
  let sucursalId = existing.sucursal_id;
  if (sucursal_id !== undefined) {
    const sucursal = sucursalIdOrError(sucursal_id);
    if (sucursal.error) return res.status(400).json({ error: sucursal.error });
    sucursalId = sucursal.value;
  }
  try {
    db.prepare(
      `UPDATE clients SET tipo_documento = ?, numero_documento = ?, nombre = ?, direccion = ?, telefono = ?, email = ?, notas = ?, sucursal_id = ?, turno = ?, referencia = ?, contacto = ?
       WHERE id = ?`
    ).run(
      tipo_documento ?? existing.tipo_documento,
      numero_documento ?? existing.numero_documento,
      nombre ?? existing.nombre,
      direccion ?? existing.direccion,
      telefono ?? existing.telefono,
      email ?? existing.email,
      notas ?? existing.notas,
      sucursalId,
      turno !== undefined ? (turno || null) : existing.turno,
      referencia !== undefined ? (referencia || null) : existing.referencia,
      contacto !== undefined ? (contacto || null) : existing.contacto,
      req.params.id
    );
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar cliente.' });
  }
});

function sedeNombreASucursalId(nombre) {
  const limpio = (nombre || '').toString().trim();
  if (!limpio) return { value: null };
  const suc = db.prepare('SELECT id FROM sucursales WHERE LOWER(nombre) = LOWER(?)').get(limpio);
  if (!suc) return { error: `No existe la sede "${limpio}".` };
  return { value: suc.id };
}

// POST /api/clients/carga-masiva { rows: [{ tipo_documento, numero_documento,
// nombre, direccion, telefono, email, sede, turno, referencia, contacto }] }
// Crea clientes nuevos o actualiza los que ya existen, por (tipo_documento,
// numero_documento) — mismo criterio "crear o actualizar" que products.js y
// users.js. "sede" es el nombre de la sede (no el id).
// Todo o nada (ver utils/cargaMasiva.js): si CUALQUIER fila tiene un
// error, no se guarda NADA.
router.post('/carga-masiva', requireAccion('clientes', 'crear_editar'), (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows es requerido y debe tener al menos una fila.' });
  }

  const resultado = ejecutarTodoONada(() => {
    const creados = [];
    const actualizados = [];
    const errores = [];

    for (const r of rows) {
      const numeroDocumento = (r.numero_documento || '').toString().trim();
      const nombre = (r.nombre || '').toString().trim();
      if (!numeroDocumento || !nombre) {
        errores.push({ numero_documento: numeroDocumento || '(vacío)', error: 'numero_documento y nombre son requeridos.' });
        continue;
      }
      const tipoDocumento = (r.tipo_documento || 'DNI').toString().trim() || 'DNI';
      const sede = sedeNombreASucursalId(r.sede);
      if (sede.error) { errores.push({ numero_documento: numeroDocumento, error: sede.error }); continue; }
      const direccion = (r.direccion || '').toString().trim() || null;
      const telefono = (r.telefono || '').toString().trim() || null;
      const email = (r.email || '').toString().trim() || null;
      const turno = (r.turno || '').toString().trim() || null;
      const referencia = (r.referencia || '').toString().trim() || null;
      const contacto = (r.contacto || '').toString().trim() || null;

      const existing = db.prepare('SELECT * FROM clients WHERE tipo_documento = ? AND numero_documento = ?').get(tipoDocumento, numeroDocumento);
      try {
        if (existing) {
          db.prepare(
            `UPDATE clients SET nombre = ?, direccion = ?, telefono = ?, email = ?, sucursal_id = ?, turno = ?, referencia = ?, contacto = ? WHERE id = ?`
          ).run(nombre, direccion, telefono, email, sede.value, turno, referencia, contacto, existing.id);
          actualizados.push({ numero_documento: numeroDocumento, nombre });
        } else {
          db.prepare(
            `INSERT INTO clients (tipo_documento, numero_documento, nombre, direccion, telefono, email, sucursal_id, turno, referencia, contacto)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(tipoDocumento, numeroDocumento, nombre, direccion, telefono, email, sede.value, turno, referencia, contacto);
          creados.push({ numero_documento: numeroDocumento, nombre });
        }
      } catch (err) {
        errores.push({ numero_documento: numeroDocumento, error: 'No se pudo guardar esta fila.' });
      }
    }

    return { creados, actualizados, errores };
  });

  res.json(resultado);
});

// POST /api/clients/duplicados-ce/fusionar { pares: [{ ce_id, legacy_id }] }
// Fusiona cada par: conserva la fila "CE" (rellenando con los datos de la
// fila vieja los campos que tenga vacíos), reasigna hacia ella cualquier
// comprobante/cotización/guía/nota de venta que apunte a la fila vieja, y
// recién entonces la borra. Todo o nada por par -- si un par ya no existe
// tal cual (por ejemplo porque se fusionó en otra pestaña), se informa en
// omitidos sin afectar al resto.
router.post('/duplicados-ce/fusionar', requireAccion('clientes', 'eliminar'), (req, res) => {
  const { pares } = req.body || {};
  if (!Array.isArray(pares) || pares.length === 0) {
    return res.status(400).json({ error: 'pares es requerido y debe tener al menos un elemento.' });
  }

  const getCliente = db.prepare('SELECT * FROM clients WHERE id = ?');
  const actualizarCliente = db.prepare(
    'UPDATE clients SET direccion = ?, telefono = ?, email = ?, notas = ? WHERE id = ?'
  );
  const tablasRelacionadas = ['invoices', 'cotizaciones', 'guias_remitentes', 'notas_venta'];
  const reasignarTablas = tablasRelacionadas.map((tabla) => db.prepare(`UPDATE ${tabla} SET client_id = ? WHERE client_id = ?`));
  const borrarCliente = db.prepare('DELETE FROM clients WHERE id = ?');

  const fusionarPar = db.transaction((ceId, legacyId) => {
    const ce = getCliente.get(ceId);
    const legacy = getCliente.get(legacyId);
    if (!ce || !legacy) throw new Error('NOT_FOUND');
    if (ce.tipo_documento !== 'CE' || ce.numero_documento !== legacy.numero_documento) {
      throw new Error('NOT_MATCHING');
    }
    actualizarCliente.run(
      ce.direccion || legacy.direccion || null,
      ce.telefono || legacy.telefono || null,
      ce.email || legacy.email || null,
      ce.notas || legacy.notas || null,
      ceId
    );
    for (const reasignar of reasignarTablas) reasignar.run(ceId, legacyId);
    borrarCliente.run(legacyId);
  });

  const fusionados = [];
  const omitidos = [];
  for (const par of pares) {
    const ceId = Number(par && par.ce_id);
    const legacyId = Number(par && par.legacy_id);
    if (!ceId || !legacyId) { omitidos.push({ ...par, motivo: 'Par inválido.' }); continue; }
    try {
      fusionarPar(ceId, legacyId);
      fusionados.push({ ce_id: ceId, legacy_id: legacyId });
    } catch (err) {
      omitidos.push({ ce_id: ceId, legacy_id: legacyId, motivo: 'Ya no existe o no coincide -- probablemente ya fue fusionado.' });
    }
  }

  res.json({ fusionados, omitidos });
});

router.delete('/:id', requireAccion('clientes', 'eliminar'), (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado.' });
  const used = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?').get(req.params.id).n;
  if (used > 0) {
    return res.status(409).json({ error: 'No se puede eliminar: el cliente tiene comprobantes asociados.' });
  }
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
