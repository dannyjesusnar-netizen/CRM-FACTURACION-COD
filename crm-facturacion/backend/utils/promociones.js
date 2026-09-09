const db = require('../db');
const { hoyPeru } = require('./fechas');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// El % de descuento efectivo se calcula siempre contra el precio ACTUAL del
// producto (no uno guardado al crear la promoción), para que una oferta de
// tipo "precio_fijo" siga dando el mismo precio final aunque el precio base
// del producto cambie después — evita descuadres si se reajustan precios
// mientras la promoción sigue vigente. Se calcula una sola vez aquí y se
// expone como descuento_pct_aplicado, tanto para el listado (routes/
// promociones.js) como para volver a calcularlo en el servidor al facturar
// (ver resolverDescuentoItemPct) sin confiar en lo que mande el cliente.
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

// Busca una promoción por id, vigente HOY para esa sucursal (o sin sede
// asignada = todas) — devuelve null si no existe/venció/se desactivó/no
// aplica a esta sede, en vez de lanzar, para que cada caller decida el
// mensaje de error según el contexto.
function obtenerPromoActivaPorId(promocionId, sucursalId) {
  if (!promocionId) return null;
  const hoy = hoyPeru();
  const promo = db.prepare(
    `SELECT * FROM promociones WHERE id = ? AND activo = 1 AND fecha_inicio <= ? AND fecha_fin >= ?
       AND (sucursal_id IS NULL OR sucursal_id = ?)`
  ).get(promocionId, hoy, hoy, sucursalId);
  return promo ? conDetalle(promo) : null;
}

// Único punto de verdad para el % de descuento de una línea de venta: nadie
// (ni vendedor ni Gerencia) puede escribir el % a mano — solo puede
// aparecer si la línea viene de una Oferta o Combo vigente en Promociones,
// y este helper recalcula el % real en el servidor a partir del
// promocion_id, ignorando lo que haya mandado el cliente. Sin
// promocion_id, el descuento de la línea es 0.
function resolverDescuentoItemPct(promocionId, sucursalId, productId) {
  if (!promocionId) return 0;
  const promo = obtenerPromoActivaPorId(promocionId, sucursalId);
  if (!promo) {
    const err = new Error('La oferta/combo seleccionado ya no está disponible (venció, se desactivó, o no aplica a esta sede).');
    err.status = 400;
    throw err;
  }
  if (promo.tipo === 'oferta' && Number(promo.product_id) !== Number(productId)) {
    const err = new Error('La oferta seleccionada no corresponde a este producto.');
    err.status = 400;
    throw err;
  }
  return promo.descuento_pct_aplicado;
}

module.exports = { conDetalle, obtenerPromoActivaPorId, resolverDescuentoItemPct, round2 };
