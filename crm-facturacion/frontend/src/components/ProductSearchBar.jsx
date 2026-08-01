import { useEffect, useRef, useState } from 'react';
import api from '../api';

// Buscador en vivo de productos por nombre, código o código de barras.
// Al seleccionar uno (click o Enter sobre el primer resultado) llama a onSelect(producto).
export default function ProductSearchBar({ onSelect, placeholder }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const timer = setTimeout(() => {
      api.get('/products', { params: { q } }).then((res) => {
        setResults(res.data.filter((p) => p.activo));
        setOpen(true);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function pick(p) {
    onSelect(p);
    setQ('');
    setResults([]);
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
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Buscar producto por nombre o codigo de barras'}
      />
      {open && results.length > 0 && (
        <div className="product-search-dropdown">
          {results.map((p) => (
            <div key={p.id} className="product-search-item" onClick={() => pick(p)}>
              <span className="psi-nombre">{p.nombre}</span>
              <span className="psi-meta">
                {p.codigo}{p.stock !== null ? ` · Stock: ${p.stock}` : ' · Servicio'} · S/ {Number(p.precio_unitario).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
      {open && q.trim() && results.length === 0 && (
        <div className="product-search-dropdown">
          <div className="product-search-empty">Sin resultados para "{q}"</div>
        </div>
      )}
    </div>
  );
}
