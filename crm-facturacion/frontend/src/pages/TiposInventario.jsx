import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function emptyForm() {
  return { nombre: '', activo: true };
}

export default function TiposInventario() {
  const navigate = useNavigate();
  const toast = useToast();

  const [tipos, setTipos] = useState([]);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('activo');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  function load() {
    api.get('/tipos-inventario', { params: { q, estado } }).then((res) => setTipos(res.data));
  }

  useEffect(() => { load(); }, [estado]);

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  function openNew() {
    setEditId(null);
    setForm(emptyForm());
    setError('');
    setShowForm(true);
  }

  function openEdit(t) {
    setEditId(t.id);
    setForm({ nombre: t.nombre, activo: !!t.activo });
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.nombre.trim()) { setError('El nombre es requerido.'); return; }
    try {
      if (editId) {
        await api.put(`/tipos-inventario/${editId}`, form);
        toast.success('Tipo de inventario actualizado.');
      } else {
        await api.post('/tipos-inventario', form);
        toast.success('Tipo de inventario creado.');
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar.');
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Inventario" onClick={() => navigate('/productos')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        Tipos de Inventario
      </h1>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field grow">
          <label>Buscar por nombre</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del tipo de inventario.." />
        </div>
        <div className="filter-field">
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
          <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={openNew}>Crear Tipo de Inventario</button>
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.nombre}</td>
                  <td>{t.activo ? 'Activo' : 'Inactivo'}</td>
                  <td>
                    <button className="icon-link" title="Editar" onClick={() => openEdit(t)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {tipos.length === 0 && (
                <tr><td colSpan={4} className="empty-row">No hay tipos de inventario registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editId ? 'Editar Tipo de Inventario' : 'Crear Tipo de Inventario'}</h2>
            <form onSubmit={handleSubmit}>
              <label>Nombre</label>
              <input required value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Mercaderías" />
              {editId && (
                <>
                  <label>Estado</label>
                  <select value={form.activo ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, activo: e.target.value === '1' }))}>
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </>
              )}
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editId ? 'Guardar cambios' : 'Crear Tipo de Inventario'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
