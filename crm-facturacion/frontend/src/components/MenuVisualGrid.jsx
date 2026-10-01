import { useEffect, useMemo, useState } from 'react';
import api from '../api';

// Menú visual tipo "carta" para Registrar Venta, en vez del buscador de
// texto — solo para empresas tipo "restaurante" (ver RegistroVenta.jsx).
// Carga el catálogo completo de la sede activa una sola vez (el buscador de
// texto normal pide a la API en cada tecla; acá se necesita todo el
// catálogo de una vez para armar la grilla con fotos y filtrar por
// categoría/texto en el cliente).
export default function MenuVisualGrid({ onSelect, ofertaPorProducto }) {
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoria, setCategoria] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get('/products').then((res) => setProductos(res.data.filter((p) => p.activo))).finally(() => setLoading(false));
  }, []);

  const categorias = useMemo(() => {
    const set = new Set(productos.map((p) => p.categoria || 'General'));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [productos]);

  const visibles = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return productos.filter((p) => {
      if (categoria && (p.categoria || 'General') !== categoria) return false;
      if (texto && !p.nombre.toLowerCase().includes(texto)) return false;
      return true;
    });
  }, [productos, categoria, q]);

  return (
    <div className="menu-visual">
      <div className="menu-visual-filtros">
        <input
          className="menu-visual-busqueda"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar plato por nombre..."
        />
      </div>
      {categorias.length > 1 && (
        <div className="menu-visual-categorias">
          <button
            type="button"
            className={'menu-visual-categoria-btn' + (categoria === '' ? ' active' : '')}
            onClick={() => setCategoria('')}
          >Todo</button>
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              className={'menu-visual-categoria-btn' + (categoria === c ? ' active' : '')}
              onClick={() => setCategoria(c)}
            >{c}</button>
          ))}
        </div>
      )}
      {loading ? (
        <p className="menu-visual-vacio">Cargando el menú...</p>
      ) : visibles.length === 0 ? (
        <p className="menu-visual-vacio">Sin platos que coincidan con la búsqueda.</p>
      ) : (
        <div className="menu-visual-grid">
          {visibles.map((p) => (
            <button type="button" key={p.id} className="menu-visual-card" onClick={() => onSelect(p)}>
              <div className="menu-visual-card-foto">
                {p.foto_data_url ? (
                  <img src={p.foto_data_url} alt={p.nombre} />
                ) : (
                  <span className="menu-visual-card-foto-vacia">🍽️</span>
                )}
                {ofertaPorProducto?.get(p.id) && <span className="menu-visual-card-oferta">Promo</span>}
              </div>
              <div className="menu-visual-card-body">
                <span className="menu-visual-card-nombre">{p.nombre}</span>
                <span className="menu-visual-card-precio">S/ {Number(p.precio_unitario).toFixed(2)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
