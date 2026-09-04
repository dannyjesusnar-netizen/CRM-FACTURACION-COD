// Recuerda la relación "texto tal como lo escribe un proveedor en su guía" →
// "producto real del catálogo del cliente". La primera vez que alguien
// vincula manualmente un ítem de guía sin match automático a un producto ya
// existente, se guarda acá — así, cualquier guía o foto futura que traiga
// ese mismo texto (de cualquier proveedor) empareja sola. Usado por
// routes/purchases.js (guía en XML/PDF) y routes/movements.js (guía por foto
// con OCR).

const db = require('../db');

function normalizarAlias(texto) {
  return (texto || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buscarProductoPorAlias(texto) {
  const normalizado = normalizarAlias(texto);
  if (!normalizado) return null;
  const fila = db.prepare('SELECT product_id FROM product_aliases WHERE alias_normalizado = ?').get(normalizado);
  return fila ? fila.product_id : null;
}

// Idempotente: si el mismo texto ya apuntaba a este producto, no hace nada
// nuevo; si apuntaba a otro (corrección posterior), lo actualiza.
function guardarAlias(productId, textoOriginal) {
  const normalizado = normalizarAlias(textoOriginal);
  if (!normalizado || !productId) return;
  db.prepare(
    `INSERT INTO product_aliases (product_id, alias_normalizado, alias_original)
     VALUES (?, ?, ?)
     ON CONFLICT(alias_normalizado) DO UPDATE SET product_id = excluded.product_id, alias_original = excluded.alias_original`
  ).run(productId, normalizado, String(textoOriginal).trim());
}

module.exports = { normalizarAlias, buscarProductoPorAlias, guardarAlias };
