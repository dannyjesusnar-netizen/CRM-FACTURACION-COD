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

  // Un lector de código de barras escribe el código y manda Enter casi al
  // instante — mucho más rápido que el debounce de 200ms de arriba, así que
  // "results" todavía no tiene la respuesta de la búsqueda cuando llega el
  // Enter. Por eso el Enter no depende de "results": dispara su propia
  // búsqueda inmediata y, si hay un único producto cuyo código o código de
  // barras calza exacto (el caso normal al escanear) o un único resultado
  // en general, lo agrega de una sin que el vendedor tenga que hacer nada
  // más — así el siguiente escaneo también entra directo, uno tras otro.
  async function handleKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const texto = q.trim();
    if (!texto) return;
    let encontrados;
    try {
      const res = await api.get('/products', { params: { q: texto } });
      encontrados = res.data.filter((p) => p.activo);
    } catch {
      return;
    }
    const exacto = encontrados.filter((p) => p.codigo === texto || p.codigo_barras === texto);
    if (exacto.length === 1) { pick(exacto[0]); return; }
    if (encontrados.length === 1) { pick(encontrados[0]); return; }
    // Varios resultados (búsqueda por nombre, no un código único): se
    // muestra el desplegable para que elija a mano, en vez de adivinar.
    setResults(encontrados);
    setOpen(true);
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
                {p.codigo}
                {p.tipo === 'servicio' ? ' · Servicio' : p.stock !== undefined ? ` · Stock: ${p.stock}` : ''}
                {' '}· S/ {Number(p.precio_unitario).toFixed(2)}
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
