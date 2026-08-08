import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const DESTINO_LABEL = { centro_costo: 'Centro Costo', ingreso_inventario: 'Ingreso Inventario' };

function emptyForm() {
  return { categoria: '', nombre: '', glosa_observacion: '', clasificacion_libros: '', destino_compra: 'centro_costo', activo: true };
}

export default function TiposCompra() {
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
    api.get('/tipos-compra', { params: { q, estado } }).then((res) => setTipos(res.data));
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
    setForm({
      categoria: t.categoria, nombre: t.nombre, glosa_observacion: t.glosa_observacion || '',
      clasificacion_libros: t.clasificacion_libros || '', destino_compra: t.destino_compra, activo: !!t.activo,
    });
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.categoria || !form.nombre) { setError('Completa categoría y tipo de compra.'); return; }
    try {
      if (editId) {
        await api.put(`/tipos-compra/${editId}`, form);
        toast.success('Tipo de compra actualizado.');
      } else {
        await api.post('/tipos-compra', form);
        toast.success('Tipo de compra creado.');
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
        <button className="icon-link" title="Volver a Compras" onClick={() => navigate('/compras')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        Tipos de Compra
      </h1>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field grow">
          <label>Buscar por nombre</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del tipo de compra.." />
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
          <button type="button" className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={openNew}>Crear Tipo Compra</button>
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Código</th>
                <th>Categoría</th>
                <th>Tipo Compra</th>
                <th>Glosa Observación</th>
                <th>Clasificación Libros</th>
                <th>Destino Compra</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.categoria}</td>
                  <td>{t.nombre}</td>
                  <td>{t.glosa_observacion || '—'}</td>
                  <td>{t.clasificacion_libros || '—'}</td>
                  <td>{DESTINO_LABEL[t.destino_compra] || t.destino_compra}</td>
                  <td>
                    <button className="icon-link" title="Editar" onClick={() => openEdit(t)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {tipos.length === 0 && (
                <tr><td colSpan={7} className="empty-row">No hay tipos de compra registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editId ? 'Editar Tipo de Compra' : 'Crear Tipo de Compra'}</h2>
            <form onSubmit={handleSubmit}>
              <label>Categoría</label>
              <input required value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                placeholder="Ej: Inversión en mercadería y activo fijo" />
              <label>Tipo Compra</label>
              <input required value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Mercadería" />
              <label>Glosa Observación</label>
              <input value={form.glosa_observacion} onChange={(e) => setForm((f) => ({ ...f, glosa_observacion: e.target.value }))} />
              <label>Clasificación Libros</label>
              <input value={form.clasificacion_libros} onChange={(e) => setForm((f) => ({ ...f, clasificacion_libros: e.target.value }))} />
              <label>Destino Compra</label>
              <select value={form.destino_compra} onChange={(e) => setForm((f) => ({ ...f, destino_compra: e.target.value }))}>
                <option value="centro_costo">Centro Costo</option>
                <option value="ingreso_inventario">Ingreso Inventario</option>
              </select>
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
                <button type="submit" className="btn-primary">{editId ? 'Guardar cambios' : 'Crear Tipo Compra'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
