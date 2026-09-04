const express = require('express');
const db = require('../db');
const { requireAuth, resolveSucursal } = require('../middleware/auth');
const { requirePermiso, requireAccion } = require('../utils/permisos');
const { hoyPeru } = require('../utils/fechas');

const router = express.Router();
router.use(requireAuth);
router.use(resolveSucursal);

const TIPOS = ['oferta', 'combo'];
const TIPOS_DESCUENTO = ['precio_fijo', 'porcentaje'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function validarFechas(fecha_inicio, fecha_fin) {
  if (!fecha_inicio || !fecha_fin) return 'fecha_inicio y fecha_fin son requeridas.';
  if (fecha_fin < fecha_inicio) return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
  return null;
}

// El % de descuento efectivo se calcula siempre contra el precio ACTUAL del
// producto (no uno guardado al crear la promoción), para que una oferta de
// tipo "precio_fijo" siga dando el mismo precio final aunque el precio base
// del producto cambie después — evita descuadres si se reajustan precios
// mientras la promoción sigue vigente. Se calcula una sola vez aquí y se
// expone como descuento_pct_aplicado, para que el frontend no tenga que
// repetir esta aritmética (ni pueda desincronizarse de ella).
function conDetalle(promo) {
  if (promo.tipo === 'oferta') {
    const producto = db.prepare(
      'SELECT id, nombre, codigo, precio_unitario, unidad, afectacion_igv, precio_compra FROM products WHERE id = ?'
    ).get(promo.product_id);
    let descuentoAplicado = promo.descuento_pct || 0;
    if (promo.tipo_descuento === 'precio_fijo' && producto?.precio_unitario > 0) {
      descuentoAplicado = round2(Math.max(0, Math.min(100, (1 - promo.precio_promocional / producto.precio_unitario) * 100)));
    }
    return { ...promo, producto, descuento_pct_aplicado: descuentoAplicado };
  }
  const items = db.prepare(
    `SELECT pi.product_id, pi.cantidad, p.nombre, p.codigo, p.precio_unitario, p.unidad, p.afectacion_igv, p.precio_compra
     FROM promocion_items pi JOIN products p ON p.id = pi.product_id
     WHERE pi.promocion_id = ? ORDER BY pi.id ASC`
  ).all(promo.id);
  const totalTeorico = round2(items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0));
  const descuentoAplicado = totalTeorico > 0
    ? round2(Math.max(0, Math.min(100, (1 - promo.precio_combo / totalTeorico) * 100)))
    : 0;
  return { ...promo, items, total_teorico: totalTeorico, descuento_pct_aplicado: descuentoAplicado };
}

// GET /api/promociones — lista completa para la pantalla de gestión (Inventario).
router.get('/', requirePermiso('inventario'), (req, res) => {
  const promos = db.prepare(
    `SELECT pr.*, s.nombre AS sede_nombre FROM promociones pr
     LEFT JOIN sucursales s ON s.id = pr.sucursal_id
     ORDER BY pr.activo DESC, pr.fecha_inicio DESC, pr.id DESC`
  ).all();
  res.json(promos.map(conDetalle));
});

// GET /api/promociones/activas — promociones vigentes hoy para la sede
// activa (o sin sede asignada = todas), usado por RegistroVenta.jsx para
// aplicar precios/descuentos automáticamente al agregar productos. Sin
// permiso de inventario a propósito: cualquiera que registra una venta debe
// poder consultarlas, no solo quien administra el inventario.
router.get('/activas', (req, res) => {
  const hoy = hoyPeru();
  const promos = db.prepare(
    `SELECT * FROM promociones
     WHERE activo = 1 AND fecha_inicio <= ? AND fecha_fin >= ?
       AND (sucursal_id IS NULL OR sucursal_id = ?)`
  ).all(hoy, hoy, req.sucursalId);
  res.json(promos.map(conDetalle));
});

function validarOferta(body) {
  const { product_id, tipo_descuento, precio_promocional, descuento_pct } = body;
  if (!product_id) return 'Selecciona el producto de la oferta.';
  const producto = db.prepare('SELECT id, activo FROM products WHERE id = ?').get(product_id);
  if (!producto || !producto.activo) return 'El producto seleccionado no existe o está desactivado.';
  if (!TIPOS_DESCUENTO.includes(tipo_descuento)) return 'tipo_descuento inválido. Use precio_fijo o porcentaje.';
  if (tipo_descuento === 'precio_fijo' && !(Number(precio_promocional) > 0)) {
    return 'Ingresa un precio promocional mayor a 0.';
  }
  if (tipo_descuento === 'porcentaje' && !(Number(descuento_pct) > 0 && Number(descuento_pct) <= 100)) {
    return 'Ingresa un porcentaje de descuento entre 0 y 100.';
  }
  return null;
}

function validarCombo(body) {
  const { items, precio_combo } = body;
  if (!Array.isArray(items) || items.length < 1) return 'Agrega al menos un producto al combo.';
  for (const it of items) {
    if (!it.product_id || !(Number(it.cantidad) > 0)) return 'Cada producto del combo necesita cantidad mayor a 0.';
    const producto = db.prepare('SELECT id, activo FROM products WHERE id = ?').get(it.product_id);
    if (!producto || !producto.activo) return `Uno de los productos del combo no existe o está desactivado.`;
  }
  const ids = items.map((it) => it.product_id);
  if (new Set(ids).size !== ids.length) return 'No repitas el mismo producto dentro del combo.';
  // El combo puede ser de un solo producto (ej. "lleva 2 Creatinas") o de
  // varios distintos — lo único que importa es que sume 2+ unidades entre
  // sus productos, no que haya 2 líneas separadas.
  const totalUnidades = items.reduce((s, it) => s + Number(it.cantidad), 0);
  if (totalUnidades < 2) return 'Un combo necesita al menos 2 unidades en total (por ejemplo, 2 del mismo producto, o 1 y 1 de productos distintos).';
  if (!(Number(precio_combo) > 0)) return 'Ingresa el precio del combo (mayor a 0).';
  return null;
}

// POST /api/promociones { nombre, tipo, sucursal_id?, fecha_inicio, fecha_fin,
//   product_id, tipo_descuento, precio_promocional?, descuento_pct? }  (oferta)
//   o { ..., items: [{product_id, cantidad}], precio_combo }          (combo)
router.post('/', requireAccion('inventario', 'productos'), (req, res) => {
  const { nombre, tipo, sucursal_id, fecha_inicio, fecha_fin } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'tipo inválido. Use oferta o combo.' });
  const errorFechas = validarFechas(fecha_inicio, fecha_fin);
  if (errorFechas) return res.status(400).json({ error: errorFechas });
  if (sucursal_id) {
    const sede = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(sucursal_id);
    if (!sede) return res.status(400).json({ error: 'La sede seleccionada no existe o está desactivada.' });
  }

  if (tipo === 'oferta') {
    const errorOferta = validarOferta(req.body);
    if (errorOferta) return res.status(400).json({ error: errorOferta });
    const { product_id, tipo_descuento, precio_promocional, descuento_pct } = req.body;
    const info = db.prepare(
      `INSERT INTO promociones (nombre, tipo, sucursal_id, fecha_inicio, fecha_fin, product_id, tipo_descuento, precio_promocional, descuento_pct)
       VALUES (?, 'oferta', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nombre, sucursal_id || null, fecha_inicio, fecha_fin, product_id, tipo_descuento,
      tipo_descuento === 'precio_fijo' ? round2(Number(precio_promocional)) : null,
      tipo_descuento === 'porcentaje' ? round2(Number(descuento_pct)) : null
    );
    return res.status(201).json(conDetalle(db.prepare('SELECT * FROM promociones WHERE id = ?').get(info.lastInsertRowid)));
  }

  const errorCombo = validarCombo(req.body);
  if (errorCombo) return res.status(400).json({ error: errorCombo });
  const { items, precio_combo } = req.body;
  const crear = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO promociones (nombre, tipo, sucursal_id, fecha_inicio, fecha_fin, precio_combo)
       VALUES (?, 'combo', ?, ?, ?, ?)`
    ).run(nombre, sucursal_id || null, fecha_inicio, fecha_fin, round2(Number(precio_combo)));
    const insertItem = db.prepare('INSERT INTO promocion_items (promocion_id, product_id, cantidad) VALUES (?, ?, ?)');
    for (const it of items) insertItem.run(info.lastInsertRowid, it.product_id, Number(it.cantidad));
    return info.lastInsertRowid;
  });
  const id = crear();
  res.status(201).json(conDetalle(db.prepare('SELECT * FROM promociones WHERE id = ?').get(id)));
});

// PUT /api/promociones/:id — mismos campos que POST según el tipo original
// (el tipo no se puede cambiar entre oferta/combo, se crea una nueva).
router.put('/:id', requireAccion('inventario', 'productos'), (req, res) => {
  const existente = db.prepare('SELECT * FROM promociones WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Promoción no encontrada.' });
  const { nombre, sucursal_id, fecha_inicio, fecha_fin } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  const errorFechas = validarFechas(fecha_inicio, fecha_fin);
  if (errorFechas) return res.status(400).json({ error: errorFechas });
  if (sucursal_id) {
    const sede = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(sucursal_id);
    if (!sede) return res.status(400).json({ error: 'La sede seleccionada no existe o está desactivada.' });
  }

  if (existente.tipo === 'oferta') {
    const errorOferta = validarOferta(req.body);
    if (errorOferta) return res.status(400).json({ error: errorOferta });
    const { product_id, tipo_descuento, precio_promocional, descuento_pct } = req.body;
    db.prepare(
      `UPDATE promociones SET nombre = ?, sucursal_id = ?, fecha_inicio = ?, fecha_fin = ?,
         product_id = ?, tipo_descuento = ?, precio_promocional = ?, descuento_pct = ? WHERE id = ?`
    ).run(
      nombre, sucursal_id || null, fecha_inicio, fecha_fin, product_id, tipo_descuento,
      tipo_descuento === 'precio_fijo' ? round2(Number(precio_promocional)) : null,
      tipo_descuento === 'porcentaje' ? round2(Number(descuento_pct)) : null,
      req.params.id
    );
    return res.json(conDetalle(db.prepare('SELECT * FROM promociones WHERE id = ?').get(req.params.id)));
  }

  const errorCombo = validarCombo(req.body);
  if (errorCombo) return res.status(400).json({ error: errorCombo });
  const { items, precio_combo } = req.body;
  const actualizar = db.transaction(() => {
    db.prepare('UPDATE promociones SET nombre = ?, sucursal_id = ?, fecha_inicio = ?, fecha_fin = ?, precio_combo = ? WHERE id = ?')
      .run(nombre, sucursal_id || null, fecha_inicio, fecha_fin, round2(Number(precio_combo)), req.params.id);
    db.prepare('DELETE FROM promocion_items WHERE promocion_id = ?').run(req.params.id);
    const insertItem = db.prepare('INSERT INTO promocion_items (promocion_id, product_id, cantidad) VALUES (?, ?, ?)');
    for (const it of items) insertItem.run(req.params.id, it.product_id, Number(it.cantidad));
  });
  actualizar();
  res.json(conDetalle(db.prepare('SELECT * FROM promociones WHERE id = ?').get(req.params.id)));
});

// PUT /api/promociones/:id/estado { activo: true|false }
router.put('/:id/estado', requireAccion('inventario', 'productos'), (req, res) => {
  const existente = db.prepare('SELECT id FROM promociones WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Promoción no encontrada.' });
  db.prepare('UPDATE promociones SET activo = ? WHERE id = ?').run(req.body?.activo ? 1 : 0, req.params.id);
  res.json(conDetalle(db.prepare('SELECT * FROM promociones WHERE id = ?').get(req.params.id)));
});

// DELETE /api/promociones/:id — solo se puede eliminar una promoción ya
// desactivada (flujo: primero Desactivar, luego aparece Eliminar), para
// evitar borrar por error una que sigue vigente. promocion_items se borra
// solo por el ON DELETE CASCADE de la tabla.
router.delete('/:id', requireAccion('inventario', 'productos'), (req, res) => {
  const existente = db.prepare('SELECT id, activo FROM promociones WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Promoción no encontrada.' });
  if (existente.activo) return res.status(400).json({ error: 'Desactiva la promoción antes de eliminarla.' });
  db.prepare('DELETE FROM promociones WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
