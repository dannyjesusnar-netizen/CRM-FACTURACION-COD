import { useEffect, useRef, useState } from 'react';

// Selector de producto por texto (nombre, código o código de barras), en
// vez de un <select> con todo el catálogo para desplazarse a mano. A
// diferencia de ProductSearchBar (que se limpia tras cada selección para ir
// agregando filas nuevas, como en Registrar Venta), este queda mostrando el
// producto elegido — pensado para una fila fija que hay que poder ver y
// volver a cambiar, como en Registrar Traslado.
//
// Filtra en el propio navegador sobre la lista de productos que ya recibió
// por props (la pantalla que lo usa ya la tiene cargada completa), así que
// no hace una petición por cada letra tecleada.
function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function etiqueta(p) {
  return `${p.codigo} — ${p.nombre}`;
}

export default function ProductTypeahead({ productos, value, onChange, placeholder }) {
  const [q, setQ] = useState('');
  const [editando, setEditando] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const seleccionado = productos.find((p) => String(p.id) === String(value));

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setEditando(false);
        setQ('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const texto = normalizar(q);
  const resultados = (texto
    ? productos.filter((p) => normalizar(`${p.codigo} ${p.nombre} ${p.codigo_barras || ''}`).includes(texto))
    : productos
  ).slice(0, 50);

  function elegir(p) {
    onChange(p.id);
    setQ('');
    setEditando(false);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (resultados.length === 1) elegir(resultados[0]);
    } else if (e.key === 'Escape') {
      setEditando(false);
      setQ('');
      setOpen(false);
    }
  }

  const mostrarSeleccionado = seleccionado && !editando;

  return (
    <div className="product-search" ref={boxRef}>
      <input
        value={mostrarSeleccionado ? etiqueta(seleccionado) : q}
        onChange={(e) => { setQ(e.target.value); setEditando(true); setOpen(true); }}
        onFocus={() => { setEditando(true); setOpen(true); setQ(''); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Buscar producto por nombre o código...'}
      />
      {open && (
        <div className="product-search-dropdown">
          {resultados.length === 0 && <div className="product-search-empty">Sin resultados</div>}
          {resultados.map((p) => (
            <div key={p.id} className="product-search-item" onClick={() => elegir(p)}>
              <span className="psi-nombre">{p.nombre}</span>
              <span className="psi-meta">{p.codigo}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
