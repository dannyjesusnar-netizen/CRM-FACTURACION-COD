import { useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const EMPTY_FORM = { tipo_documento: 'DNI', numero_documento: '', nombre: '', direccion: '', telefono: '', email: '', notas: '' };

export default function Clients() {
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  function load(query = '') {
    api.get('/clients', { params: query ? { q: query } : {} }).then((res) => setClients(res.data));
  }

  useEffect(() => { load(); }, []);

  function handleSearch(e) {
    e.preventDefault();
    load(q);
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
    setShowForm(true);
  }

  function openEdit(client) {
    setForm({
      tipo_documento: client.tipo_documento,
      numero_documento: client.numero_documento,
      nombre: client.nombre,
      direccion: client.direccion || '',
      telefono: client.telefono || '',
      email: client.email || '',
      notas: client.notas || '',
    });
    setEditingId(client.id);
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.put(`/clients/${editingId}`, form);
        toast.success('Cliente actualizado correctamente.');
      } else {
        await api.post('/clients', form);
        toast.success('Cliente creado correctamente.');
      }
      setShowForm(false);
      load(q);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar el cliente.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar este cliente?')) return;
    try {
      await api.delete(`/clients/${id}`);
      toast.success('Cliente eliminado.');
      load(q);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo eliminar.');
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Clientes</h1>
        <button className="btn-primary" onClick={openNew}>+ Nuevo cliente</button>
      </div>

      <form className="search-bar" onSubmit={handleSearch}>
        <input placeholder="Buscar por nombre o documento..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn-secondary">Buscar</button>
      </form>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Nombre / Razón social</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>{c.tipo_documento} {c.numero_documento}</td>
                <td>{c.nombre}</td>
                <td>{c.telefono || '—'}</td>
                <td>{c.email || '—'}</td>
                <td className="row-actions">
                  <button className="btn-link" onClick={() => openEdit(c)}>Editar</button>
                  <button className="btn-link danger" onClick={() => handleDelete(c.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr><td colSpan={5} className="empty-row">No hay clientes registrados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Editar cliente' : 'Nuevo cliente'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div>
                  <label>Tipo de documento</label>
                  <select value={form.tipo_documento} onChange={(e) => setForm({ ...form, tipo_documento: e.target.value })}>
                    <option value="DNI">DNI</option>
                    <option value="RUC">RUC</option>
                  </select>
                </div>
                <div>
                  <label>Número de documento</label>
                  <input required value={form.numero_documento} onChange={(e) => setForm({ ...form, numero_documento: e.target.value })} />
                </div>
              </div>
              <label>Nombre / Razón social</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              <label>Dirección</label>
              <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
              <div className="form-row">
                <div>
                  <label>Teléfono</label>
                  <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
                </div>
                <div>
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <label>Notas</label>
              <textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
