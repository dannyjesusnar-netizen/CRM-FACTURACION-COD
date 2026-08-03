import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Users as UsersIcon } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const ROLE_LABEL = { gerencia: 'Gerencia (administrador)', vendedor: 'Vendedor' };

function emptyUserForm() {
  return { username: '', password: '', full_name: '', dni: '', role: 'vendedor' };
}

export default function Configuracion() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [seccion, setSeccion] = useState('empresa');

  // --- Datos de la empresa ---
  const [empresa, setEmpresa] = useState(null);
  const [errorEmpresa, setErrorEmpresa] = useState('');
  const [savingEmpresa, setSavingEmpresa] = useState(false);

  // --- Usuarios ---
  const [usuarios, setUsuarios] = useState([]);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyUserForm());
  const [errorForm, setErrorForm] = useState('');

  useEffect(() => {
    api.get('/empresa').then((res) => setEmpresa(res.data));
    loadUsuarios();
  }, []);

  function loadUsuarios() {
    const params = {};
    if (q) params.q = q;
    api.get('/users', { params }).then((res) => setUsuarios(res.data));
  }

  if (!user || user.role !== 'gerencia') {
    return (
      <div className="panel">
        <h3>Acceso restringido</h3>
        <p className="empty-row">Solo un usuario de Gerencia puede acceder a Configuración.</p>
        <button className="btn-secondary" onClick={() => navigate('/menu')}>Volver al menú</button>
      </div>
    );
  }

  async function handleGuardarEmpresa(e) {
    e.preventDefault();
    setErrorEmpresa('');
    setSavingEmpresa(true);
    try {
      const res = await api.put('/empresa', empresa);
      setEmpresa(res.data);
      toast.success('Datos de la empresa actualizados. Ya aparecen en el encabezado y en los comprobantes.');
    } catch (err) {
      setErrorEmpresa(err.response?.data?.error || 'No se pudo guardar.');
    } finally {
      setSavingEmpresa(false);
    }
  }

  function openNewUser() {
    setEditingId(null);
    setForm(emptyUserForm());
    setErrorForm('');
    setShowForm(true);
  }

  function openEditUser(u) {
    setEditingId(u.id);
    setForm({ username: u.username, password: '', full_name: u.full_name, dni: u.dni || '', role: u.role });
    setErrorForm('');
    setShowForm(true);
  }

  async function handleSubmitUser(e) {
    e.preventDefault();
    setErrorForm('');
    try {
      if (editingId) {
        const payload = { full_name: form.full_name, dni: form.dni, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${editingId}`, payload);
        toast.success('Usuario actualizado.');
      } else {
        await api.post('/users', form);
        toast.success('Usuario creado. Ya puede iniciar sesión con esas credenciales.');
      }
      setShowForm(false);
      loadUsuarios();
    } catch (err) {
      setErrorForm(err.response?.data?.error || 'No se pudo guardar el usuario.');
    }
  }

  async function handleToggleEstado(u) {
    const accion = u.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} a ${u.full_name}?`)) return;
    try {
      await api.put(`/users/${u.id}/estado`, { activo: !u.activo });
      toast.success(`Usuario ${u.activo ? 'desactivado' : 'activado'}.`);
      loadUsuarios();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver al menú" onClick={() => navigate('/menu')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CONFIGURACIÓN
      </h1>

      <div className="reports-shell">
        <div className="reports-sidebar">
          <div className={'reports-sidebar-item' + (seccion === 'empresa' ? ' active' : '')} onClick={() => setSeccion('empresa')} role="button" tabIndex={0}>
            <Building2 size={16} /><span>Datos de la empresa</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'usuarios' ? ' active' : '')} onClick={() => setSeccion('usuarios')} role="button" tabIndex={0}>
            <UsersIcon size={16} /><span>Usuarios</span>
          </div>
        </div>

        <div className="reports-content">
          {seccion === 'empresa' && empresa && (
            <>
              <h3 style={{ marginTop: 0 }}>Datos de la empresa</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Estos datos aparecen como emisor en el encabezado de la app y en los comprobantes (PDF). Son los datos
                legales del negocio que usa este CRM — deben coincidir con los registrados ante SUNAT.
              </p>
              <form onSubmit={handleGuardarEmpresa} style={{ maxWidth: 520 }}>
                <label>Razón Social *</label>
                <input required value={empresa.razon_social || ''} onChange={(e) => setEmpresa({ ...empresa, razon_social: e.target.value })} />
                <label>RUC * (11 dígitos)</label>
                <input required value={empresa.ruc || ''} onChange={(e) => setEmpresa({ ...empresa, ruc: e.target.value })} maxLength={11} />
                <label>Nombre Comercial</label>
                <input value={empresa.nombre_comercial || ''} onChange={(e) => setEmpresa({ ...empresa, nombre_comercial: e.target.value })} placeholder="Si es distinto a la Razón Social" />
                <label>Dirección Fiscal</label>
                <input value={empresa.direccion_fiscal || ''} onChange={(e) => setEmpresa({ ...empresa, direccion_fiscal: e.target.value })} />
                <div className="form-row">
                  <div>
                    <label>Teléfono</label>
                    <input value={empresa.telefono || ''} onChange={(e) => setEmpresa({ ...empresa, telefono: e.target.value })} />
                  </div>
                  <div>
                    <label>Email</label>
                    <input value={empresa.email || ''} onChange={(e) => setEmpresa({ ...empresa, email: e.target.value })} />
                  </div>
                </div>
                {errorEmpresa && <div className="form-error">{errorEmpresa}</div>}
                <button type="submit" className="btn-primary" style={{ width: 'auto', marginTop: 16 }} disabled={savingEmpresa}>
                  {savingEmpresa ? 'Guardando…' : 'Guardar datos de la empresa'}
                </button>
              </form>
            </>
          )}

          {seccion === 'usuarios' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Usuarios</h3>
                <button className="btn-primary" style={{ width: 'auto' }} onClick={openNewUser}>+ Nuevo usuario</button>
              </div>

              <form className="filter-panel" onSubmit={(e) => { e.preventDefault(); loadUsuarios(); }}>
                <div className="filter-field grow">
                  <label>Buscar por nombre, usuario o DNI</label>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar.." />
                </div>
                <div className="filter-actions">
                  <button type="submit" className="btn-secondary">Buscar</button>
                </div>
              </form>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Usuario</th><th>Nombre completo</th><th>DNI</th><th>Rol</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.full_name}</td>
                      <td>{u.dni || '—'}</td>
                      <td>{ROLE_LABEL[u.role] || u.role}</td>
                      <td>
                        <span className={'badge ' + (u.activo ? 'badge-good' : 'badge-critical')}>
                          {u.activo ? 'Activo' : 'Desactivado'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => openEditUser(u)}>Editar</button>
                        {u.id === user.id ? (
                          <span className="icon-link muted" title="No puedes desactivar tu propia cuenta">—</span>
                        ) : (
                          <button className={'btn-link' + (u.activo ? ' danger' : '')} onClick={() => handleToggleEstado(u)}>
                            {u.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {usuarios.length === 0 && (
                    <tr><td colSpan={6} className="empty-row">No hay usuarios registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Editar usuario' : 'Nuevo usuario'}</h2>
            <form onSubmit={handleSubmitUser}>
              <label>Usuario (identificador interno)</label>
              <input required disabled={!!editingId} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <label>Nombre completo</label>
              <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              <label>DNI (8 dígitos) — se usa para iniciar sesión junto con el RUC de la empresa</label>
              <input required value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value })} maxLength={8} />
              <label>Rol</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="vendedor">Vendedor</option>
                <option value="gerencia">Gerencia (administrador)</option>
              </select>
              <label>{editingId ? 'Nueva contraseña (dejar en blanco para no cambiarla)' : 'Contraseña (mínimo 6 caracteres)'}</label>
              <input required={!editingId} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {errorForm && <div className="form-error">{errorForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingId ? 'Guardar cambios' : 'Crear usuario'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
