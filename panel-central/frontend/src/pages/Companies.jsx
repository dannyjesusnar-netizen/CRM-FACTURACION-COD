import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';

function emptyForm() {
  return { nombre: '', ruc: '', telefono: '', render_url: '', platform_token: '' };
}

export default function Companies() {
  const navigate = useNavigate();
  const toast = useToast();
  const [companies, setCompanies] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  function load() {
    api.get('/companies').then((res) => setCompanies(res.data));
  }

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setError('');
    setShowForm(true);
  }

  function openEdit(c) {
    setEditingId(c.id);
    setForm({ nombre: c.nombre, ruc: c.ruc || '', telefono: c.telefono || '', render_url: c.render_url, platform_token: '' });
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        const body = { ...form };
        if (!body.platform_token) delete body.platform_token; // no tocar el token si se dejó en blanco al editar
        await api.put(`/companies/${editingId}`, body);
        toast.success('Empresa actualizada.');
      } else {
        await api.post('/companies', form);
        toast.success('Empresa registrada.');
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar la empresa.');
    }
  }

  async function handleDelete(c) {
    if (!window.confirm(`¿Quitar "${c.nombre}" del panel? Esto no afecta su instancia, solo deja de administrarla desde aquí.`)) return;
    try {
      await api.delete(`/companies/${c.id}`);
      toast.success('Empresa quitada del panel.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo quitar la empresa.');
    }
  }

  return (
    <div>
      <div className="report-toolbar">
        <h1 className="page-title" style={{ margin: 0 }}>EMPRESAS</h1>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={openNew}>+ Nueva empresa</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Cada empresa es una instancia de Render independiente. Regístrala una vez con su URL y el
        token que configuraste ahí (variable <code>PLATFORM_TOKEN</code>) para poder ver y administrar
        sus cuentas admin desde aquí.
      </p>

      <table className="data-table">
        <thead>
          <tr><th>Nombre</th><th>RUC</th><th>Teléfono</th><th></th></tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/empresas/${c.id}`)}>
              <td>{c.nombre}</td>
              <td>{c.ruc || '—'}</td>
              <td>{c.telefono || '—'}</td>
              <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn-link" onClick={() => openEdit(c)}>Editar</button>
                <button className="btn-link danger" onClick={() => handleDelete(c)}>Quitar</button>
              </td>
            </tr>
          ))}
          {companies.length === 0 && (
            <tr><td colSpan={4} className="empty-row">Todavía no registraste ninguna empresa.</td></tr>
          )}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Editar empresa' : 'Nueva empresa'}</h2>
            <form onSubmit={handleSubmit}>
              <label>Nombre</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              <label>RUC</label>
              <input value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value })} maxLength={11} />
              <label>Teléfono</label>
              <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
              <label>URL de Render de su instancia</label>
              <input required value={form.render_url} onChange={(e) => setForm({ ...form, render_url: e.target.value })} placeholder="https://cliente-x.onrender.com" />
              <label>{editingId ? 'Token de plataforma (dejar en blanco para no cambiarlo)' : 'Token de plataforma (PLATFORM_TOKEN configurado en su Render)'}</label>
              <input required={!editingId} value={form.platform_token} onChange={(e) => setForm({ ...form, platform_token: e.target.value })} />
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingId ? 'Guardar cambios' : 'Registrar empresa'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
