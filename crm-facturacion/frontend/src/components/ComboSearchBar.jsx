import { useEffect, useRef, useState } from 'react';

// Buscador en vivo de combos activos, por nombre — reemplaza la fila de
// botones "Agregar combo: ..." (uno por promoción) que se volvía
// impracticable con muchas promociones creadas a la vez. Filtra en el
// cliente porque combos ya viene cargado completo desde
// GET /promociones/activas (ver RegistroVenta.jsx/RegistroNotaVenta.jsx),
// no hace falta ir al servidor por cada letra.
export default function ComboSearchBar({ combos, onSelect, placeholder }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const qNorm = q.trim().toLowerCase();
  const results = qNorm ? combos.filter((c) => c.nombre.toLowerCase().includes(qNorm)) : combos;

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function pick(c) {
    onSelect(c);
    setQ('');
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) pick(results[0]);
    }
  }

  return (
    <div className="product-search" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Buscar combo/promo por nombre...'}
      />
      {open && results.length > 0 && (
        <div className="product-search-dropdown">
          {results.map((c) => (
            <div key={c.id} className="product-search-item" onClick={() => pick(c)}>
              <span className="psi-nombre">🏷 {c.nombre}</span>
              <span className="psi-meta">
                S/ {Number(c.precio_combo).toFixed(2)}
                {c.combo_modo === 'grupo'
                  ? ` · ${c.cantidad_requerida} unidades, ${c.items.length} sabores/variantes`
                  : ` · ${c.items.length} producto${c.items.length === 1 ? '' : 's'}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {open && qNorm && results.length === 0 && (
        <div className="product-search-dropdown">
          <div className="product-search-empty">Sin combos que coincidan con "{q}"</div>
        </div>
      )}
    </div>
  );
}
