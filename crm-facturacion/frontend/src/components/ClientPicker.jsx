import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function emptyClient() {
  return { tipo_documento: 'DNI', numero_documento: '', nombre: '', direccion: '', telefono: '', email: '' };
}

// Buscador de cliente con alta rápida ("Cliente Nuevo"). value = cliente seleccionado (objeto) o null.
export default function ClientPicker({ value, onChange, required }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newClient, setNewClient] = useState(emptyClient());
  const boxRef = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const timer = setTimeout(() => {
      api.get('/clients', { params: { q } }).then((res) => { setResults(res.data); setOpen(true); });
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

  async function handleCreate(e) {
    e.preventDefault();
    if (!newClient.numero_documento || !newClient.nombre) {
      toast.error('Número de documento y nombre son requeridos.');
      return;
    }
    try {
      const res = await api.post('/clients', newClient);
      onChange(res.data);
      setShowNew(false);
      setNewClient(emptyClient());
      toast.success('Cliente creado.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo crear el cliente.');
    }
  }

  return (
    <div className="client-picker">
      <div className="filter-field grow" ref={boxRef} style={{ position: 'relative' }}>
        <label>Cliente{required ? ' *' : ''}</label>
        {value ? (
          <div className="client-picker-selected">
            <span>{value.numero_documento} - {value.nombre}</span>
            <button type="button" className="client-picker-clear" onClick={() => onChange(null)}>×</button>
          </div>
        ) : (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="Buscar cliente por nombre o número de documento"
            />
            {open && results.length > 0 && (
              <div className="product-search-dropdown">
                {results.map((c) => (
                  <div key={c.id} className="product-search-item" onClick={() => { onChange(c); setQ(''); setOpen(false); }}>
                    <span className="psi-nombre">{c.nombre}</span>
                    <span className="psi-meta">{c.tipo_documento} {c.numero_documento}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <button type="button" className="btn-secondary client-picker-new-btn" onClick={() => setShowNew(true)}>Cliente Nuevo</button>

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Cliente nuevo</h2>
            <form onSubmit={handleCreate}>
              <div className="form-row">
                <div>
                  <label>Tipo documento</label>
                  <select value={newClient.tipo_documento} onChange={(e) => setNewClient((c) => ({ ...c, tipo_documento: e.target.value }))}>
                    <option value="DNI">DNI</option>
                    <option value="RUC">RUC</option>
                  </select>
                </div>
                <div>
                  <label>Número documento</label>
                  <input required value={newClient.numero_documento} onChange={(e) => setNewClient((c) => ({ ...c, numero_documento: e.target.value }))} />
                </div>
              </div>
              <label>Nombre / Razón social</label>
              <input required value={newClient.nombre} onChange={(e) => setNewClient((c) => ({ ...c, nombre: e.target.value }))} />
              <label>Dirección</label>
              <input value={newClient.direccion} onChange={(e) => setNewClient((c) => ({ ...c, direccion: e.target.value }))} />
              <div className="form-row">
                <div>
                  <label>Teléfono</label>
                  <input value={newClient.telefono} onChange={(e) => setNewClient((c) => ({ ...c, telefono: e.target.value }))} />
                </div>
                <div>
                  <label>Email</label>
                  <input value={newClient.email} onChange={(e) => setNewClient((c) => ({ ...c, email: e.target.value }))} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Crear cliente</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
