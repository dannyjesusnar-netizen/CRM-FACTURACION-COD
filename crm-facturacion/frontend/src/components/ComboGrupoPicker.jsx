import { useState } from 'react';

// Modal para elegir, dentro de un combo "por grupo" (varios productos
// intercambiables — ej. los sabores de una proteína — a un precio fijo por
// cierta cantidad de unidades, sin importar la mezcla), cuáles productos y
// cuántas unidades de cada uno completan la cantidad_requerida. Cada
// producto del grupo ya trae su propio descuento_pct_aplicado (calculado
// en el servidor contra SU propio precio, ver utils/promociones.js) para
// que la suma de las unidades elegidas dé exacto el precio del combo, sea
// cual sea la mezcla — acá solo se arma el carrito, el backend vuelve a
// calcular el % real al emitir (ver resolverDescuentoItemPct).
export default function ComboGrupoPicker({ promo, onConfirm, onClose }) {
  const [cantidades, setCantidades] = useState({});

  const totalElegido = Object.values(cantidades).reduce((s, c) => s + (Number(c) || 0), 0);
  const faltan = promo.cantidad_requerida - totalElegido;

  function setCantidad(productId, cantidad) {
    setCantidades((prev) => ({ ...prev, [productId]: Math.max(0, Math.floor(cantidad) || 0) }));
  }

  function confirmar() {
    const lineas = promo.items
      .filter((it) => (cantidades[it.product_id] || 0) > 0)
      .map((it) => ({
        product_id: it.product_id,
        descripcion: it.nombre,
        stock: undefined,
        unidad: it.unidad,
        precio_unitario: it.precio_unitario,
        cantidad: cantidades[it.product_id],
        descuento_pct: it.descuento_pct_aplicado,
        costo: it.precio_compra || 0,
        afectacion_igv: it.afectacion_igv,
        promocion_id: promo.id,
        promocion_nombre: promo.nombre,
      }));
    onConfirm(lineas);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{promo.nombre}</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          Elige cuáles de estos productos completan las <strong>{promo.cantidad_requerida}</strong> unidades del
          combo — S/ {Number(promo.precio_combo).toFixed(2)} en total, cualquier mezcla vale.
        </p>
        <table className="data-table" style={{ marginTop: 8 }}>
          <thead>
            <tr><th>Producto</th><th style={{ textAlign: 'right' }}>Precio</th><th>Cantidad</th></tr>
          </thead>
          <tbody>
            {promo.items.map((it) => (
              <tr key={it.product_id}>
                <td>{it.nombre}</td>
                <td style={{ textAlign: 'right' }}>S/ {Number(it.precio_unitario).toFixed(2)}</td>
                <td>
                  <input
                    type="number" min="0" step="1" style={{ width: 80 }}
                    value={cantidades[it.product_id] || 0}
                    onChange={(e) => setCantidad(it.product_id, Number(e.target.value))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 13, marginTop: 10 }}>
          {faltan > 0 && (
            <span style={{ color: 'var(--critical)' }}>
              Faltan {faltan} unidad{faltan === 1 ? '' : 'es'} para completar el combo.
            </span>
          )}
          {faltan < 0 && (
            <span style={{ color: 'var(--critical)' }}>
              Elegiste {-faltan} unidad{faltan === -1 ? '' : 'es'} de más — quita alguna.
            </span>
          )}
          {faltan === 0 && (
            <span style={{ color: 'var(--good)' }}>Completo — {promo.cantidad_requerida} unidades listas.</span>
          )}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={faltan !== 0} onClick={confirmar}>
            Agregar al carrito
          </button>
        </div>
      </div>
    </div>
  );
}
