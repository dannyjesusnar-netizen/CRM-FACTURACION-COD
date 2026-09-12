import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [buscandoDoc, setBuscandoDoc] = useState(false);
  const boxRef = useRef(null);

  // Autocompletar nombre/razón social apenas se completa un DNI (8 dígitos)
  // o RUC (11 dígitos) válido — sin API key configurada o si el proveedor
  // falla, /consultar-documento responde encontrado:false y este efecto no
  // hace nada (nunca bloquea ni pisa lo que la persona ya haya escrito a mano).
  useEffect(() => {
    if (!showNew) return;
    const tipo = newClient.tipo_documento;
    const numero = newClient.numero_documento.trim();
    const largoValido = (tipo === 'DNI' && numero.length === 8) || (tipo === 'RUC' && numero.length === 11);
    if (!largoValido) return;
    let cancelado = false;
    setBuscandoDoc(true);
    api.get('/clients/consultar-documento', { params: { tipo_documento: tipo, numero_documento: numero } })
      .then((res) => {
        if (cancelado || !res.data.encontrado) return;
        setNewClient((c) => (
          c.numero_documento.trim() === numero && c.tipo_documento === tipo
            ? { ...c, nombre: c.nombre.trim() ? c.nombre : res.data.nombre, direccion: c.direccion.trim() ? c.direccion : (res.data.direccion || c.direccion) }
            : c
        ));
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setBuscandoDoc(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newClient.tipo_documento, newClient.numero_documento, showNew]);

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
    // Este formulario vive dentro del <form> de la pantalla que lo usa
    // (Registro de Venta, Nota de Venta, Guía). Sin stopPropagation, React
    // también dispara el onSubmit del formulario contenedor (submit
    // burbujea por el árbol de React, no por el DOM, así que ni siquiera
    // el portal de más abajo evita esto) — eso hacía que "Crear cliente"
    // nunca llegara a crear nada.
    e.stopPropagation();
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

      {showNew && createPortal(
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
                    <option value="CE">Carnet de Extranjería</option>
                  </select>
                </div>
                <div>
                  <label>Número documento</label>
                  <input required value={newClient.numero_documento} onChange={(e) => setNewClient((c) => ({ ...c, numero_documento: e.target.value }))} />
                </div>
              </div>
              <label>Nombre / Razón social{buscandoDoc ? ' — buscando...' : ''}</label>
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
        </div>,
        document.body
      )}
    </div>
  );
}
