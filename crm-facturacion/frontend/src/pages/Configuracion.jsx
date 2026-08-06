import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Users as UsersIcon, Store, ShieldCheck } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const DEPARTAMENTOS_PERU = [
  'Amazonas', 'Áncash', 'Apurímac', 'Arequipa', 'Ayacucho', 'Cajamarca', 'Callao', 'Cusco',
  'Huancavelica', 'Huánuco', 'Ica', 'Junín', 'La Libertad', 'Lambayeque', 'Lima', 'Loreto',
  'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martín', 'Tacna', 'Tumbes', 'Ucayali',
];

const PASSWORD_PREDETERMINADA = 'Lima2026*';

function emptyUserForm() {
  return { username: '', password: PASSWORD_PREDETERMINADA, nombres: '', apellidos: '', email: '', telefono: '', dni: '', role: 'vendedor', sucursal_id: '', custom_role_id: '' };
}

function emptySucursalForm() {
  return { nombre: '', direccion: '' };
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

  // --- Empleados ---
  const [usuarios, setUsuarios] = useState([]);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyUserForm());
  const [errorForm, setErrorForm] = useState('');

  // --- Sucursales ---
  const [sucursales, setSucursales] = useState([]);
  const [limiteSucursales, setLimiteSucursales] = useState(null);
  const [showSucursalForm, setShowSucursalForm] = useState(false);
  const [editingSucursalId, setEditingSucursalId] = useState(null);
  const [sucursalForm, setSucursalForm] = useState(emptySucursalForm());
  const [errorSucursal, setErrorSucursal] = useState('');

  // --- Roles de usuario ---
  const [roles, setRoles] = useState([]);

  useEffect(() => {
    api.get('/empresa').then((res) => setEmpresa(res.data));
    loadUsuarios();
    loadSucursales();
    loadLimiteSucursales();
    loadRoles();
  }, []);

  function loadUsuarios() {
    const params = {};
    if (q) params.q = q;
    api.get('/users', { params }).then((res) => setUsuarios(res.data));
  }

  function loadSucursales() {
    api.get('/sucursales', { params: { todas: 1 } }).then((res) => setSucursales(res.data));
  }

  function loadLimiteSucursales() {
    api.get('/sucursales/limite').then((res) => setLimiteSucursales(res.data));
  }

  function loadRoles() {
    api.get('/roles').then((res) => setRoles(res.data));
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

  function handleLogoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.3 * 1024 * 1024) {
      toast.error('La imagen es muy pesada. Usa una de menos de 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEmpresa({ ...empresa, logo_data_url: reader.result });
    reader.readAsDataURL(file);
  }

  function openNewUser() {
    setEditingId(null);
    setForm(emptyUserForm());
    setErrorForm('');
    setShowForm(true);
  }

  function openEditUser(u) {
    setEditingId(u.id);
    setForm({
      username: u.username, password: '', nombres: u.nombres || '', apellidos: u.apellidos || '',
      email: u.email || '', telefono: u.telefono || '', dni: u.dni || '', role: u.role,
      sucursal_id: u.sucursal_id || '', custom_role_id: u.custom_role_id || '',
    });
    setErrorForm('');
    setShowForm(true);
  }

  async function handleSubmitUser(e) {
    e.preventDefault();
    setErrorForm('');
    const payloadComun = {
      nombres: form.nombres, apellidos: form.apellidos, email: form.email || null, telefono: form.telefono || null,
      dni: form.dni, role: form.role, sucursal_id: form.sucursal_id || null, custom_role_id: form.custom_role_id || null,
    };
    try {
      if (editingId) {
        const payload = { ...payloadComun };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${editingId}`, payload);
        toast.success('Empleado actualizado.');
      } else {
        await api.post('/users', { ...payloadComun, username: form.username, password: form.password });
        toast.success('Empleado creado. Ya puede iniciar sesión con esas credenciales.');
      }
      setShowForm(false);
      loadUsuarios();
    } catch (err) {
      setErrorForm(err.response?.data?.error || 'No se pudo guardar el empleado.');
    }
  }

  async function handleToggleEstado(u) {
    const accion = u.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} a ${u.full_name}?`)) return;
    try {
      await api.put(`/users/${u.id}/estado`, { activo: !u.activo });
      toast.success(`Empleado ${u.activo ? 'desactivado' : 'activado'}.`);
      loadUsuarios();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  async function handleRestablecerContrasena(u) {
    if (!window.confirm(`¿Restablecer la contraseña de ${u.full_name} a la predeterminada (${PASSWORD_PREDETERMINADA})?`)) return;
    try {
      await api.put(`/users/${u.id}`, { password: PASSWORD_PREDETERMINADA });
      toast.success(`Contraseña de ${u.full_name} restablecida a ${PASSWORD_PREDETERMINADA}.`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo restablecer la contraseña.');
    }
  }

  function exportarEmpleadosCsv() {
    const header = ['Nombres', 'Apellidos', 'Rol', 'DNI', 'Correo', 'Teléfono', 'Estado'];
    const rows = usuarios.map((u) => [
      u.nombres || '', u.apellidos || '',
      u.role === 'gerencia' ? 'Gerencia' : (u.rol_personalizado_nombre || 'Sin rol asignado'),
      u.dni || '', u.email || '', u.telefono || '', u.activo ? 'Habilitado' : 'Deshabilitado',
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'empleados.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openNewSucursal() {
    setEditingSucursalId(null);
    setSucursalForm(emptySucursalForm());
    setErrorSucursal('');
    setShowSucursalForm(true);
  }

  function openEditSucursal(s) {
    setEditingSucursalId(s.id);
    setSucursalForm({ nombre: s.nombre, direccion: s.direccion || '' });
    setErrorSucursal('');
    setShowSucursalForm(true);
  }

  async function handleSubmitSucursal(e) {
    e.preventDefault();
    setErrorSucursal('');
    try {
      if (editingSucursalId) {
        await api.put(`/sucursales/${editingSucursalId}`, sucursalForm);
        toast.success('Sede actualizada.');
      } else {
        await api.post('/sucursales', sucursalForm);
        toast.success('Sede creada.');
      }
      setShowSucursalForm(false);
      loadSucursales();
      loadLimiteSucursales();
    } catch (err) {
      setErrorSucursal(err.response?.data?.error || 'No se pudo guardar la sede.');
    }
  }

  async function handleToggleSucursalEstado(s) {
    const accion = s.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} la sede "${s.nombre}"?`)) return;
    try {
      await api.put(`/sucursales/${s.id}/estado`, { activo: !s.activo });
      toast.success(`Sede ${s.activo ? 'desactivada' : 'activada'}.`);
      loadSucursales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  async function handleToggleRoleEstado(r) {
    const accion = r.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} el rol "${r.nombre}"?`)) return;
    try {
      await api.put(`/roles/${r.id}/estado`, { activo: !r.activo });
      toast.success(`Rol ${r.activo ? 'desactivado' : 'activado'}.`);
      loadRoles();
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
            <Building2 size={16} /><span>Empresa</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'sucursales' ? ' active' : '')} onClick={() => setSeccion('sucursales')} role="button" tabIndex={0}>
            <Store size={16} /><span>Sucursales</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'empleados' ? ' active' : '')} onClick={() => setSeccion('empleados')} role="button" tabIndex={0}>
            <UsersIcon size={16} /><span>Empleados</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'roles' ? ' active' : '')} onClick={() => setSeccion('roles')} role="button" tabIndex={0}>
            <ShieldCheck size={16} /><span>Roles de usuario</span>
          </div>
        </div>

        <div className="reports-content">
          {seccion === 'empresa' && empresa && (
            <>
              <h3 style={{ marginTop: 0 }}>Información de tu empresa</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Estos datos aparecen como emisor en el encabezado de la app y en los comprobantes (PDF). Son los datos
                legales del negocio que usa este CRM — deben coincidir con los registrados ante SUNAT.
              </p>
              <form onSubmit={handleGuardarEmpresa} style={{ maxWidth: 560 }}>
                <label>Nombre de mi empresa *</label>
                <input required value={empresa.razon_social || ''} onChange={(e) => setEmpresa({ ...empresa, razon_social: e.target.value })} />
                <label>RUC * (11 dígitos)</label>
                <input required value={empresa.ruc || ''} onChange={(e) => setEmpresa({ ...empresa, ruc: e.target.value })} maxLength={11} />
                <label>Nombre Comercial</label>
                <input value={empresa.nombre_comercial || ''} onChange={(e) => setEmpresa({ ...empresa, nombre_comercial: e.target.value })} placeholder="Si es distinto al Nombre de mi empresa" />

                <div className="form-row">
                  <div>
                    <label>Actividad económica (CIIU)</label>
                    <input value={empresa.actividad_ciiu || ''} onChange={(e) => setEmpresa({ ...empresa, actividad_ciiu: e.target.value })} placeholder="Código/descripción según tu ficha RUC" />
                  </div>
                  <div>
                    <label>Actividad comercial (MCC)</label>
                    <input value={empresa.actividad_mcc || ''} onChange={(e) => setEmpresa({ ...empresa, actividad_mcc: e.target.value })} placeholder="Opcional" />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -10 }}>
                  Texto libre: escribe el código/descripción tal como aparece en tu ficha RUC (no validamos contra el catálogo oficial de SUNAT).
                </p>

                <div className="form-row">
                  <div>
                    <label>Departamento *</label>
                    <select required value={empresa.departamento || ''} onChange={(e) => setEmpresa({ ...empresa, departamento: e.target.value })}>
                      <option value="">Selecciona un departamento</option>
                      {DEPARTAMENTOS_PERU.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Provincia *</label>
                    <input required value={empresa.provincia || ''} onChange={(e) => setEmpresa({ ...empresa, provincia: e.target.value })} />
                  </div>
                  <div>
                    <label>Distrito *</label>
                    <input required value={empresa.distrito || ''} onChange={(e) => setEmpresa({ ...empresa, distrito: e.target.value })} />
                  </div>
                </div>
                <label>Dirección de facturación *</label>
                <input required value={empresa.direccion_fiscal || ''} onChange={(e) => setEmpresa({ ...empresa, direccion_fiscal: e.target.value })} />
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
                  {savingEmpresa ? 'Guardando…' : 'Guardar'}
                </button>
              </form>

              <div className="panel" style={{ maxWidth: 560, marginTop: 20 }}>
                <h3 style={{ marginTop: 0 }}>Logotipo de tu empresa</h3>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Medidas recomendadas: 320 px de ancho x 160 px de alto, en formato .PNG o .JPG.</p>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ width: 160, height: 90, border: '1px dashed var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface)' }}>
                    {empresa.logo_data_url ? (
                      <img src={empresa.logo_data_url} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Sin logo</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="btn-secondary" style={{ width: 'auto', textAlign: 'center', cursor: 'pointer' }}>
                      Subir logo
                      <input type="file" accept="image/png,image/jpeg" onChange={handleLogoChange} style={{ display: 'none' }} />
                    </label>
                    {empresa.logo_data_url && (
                      <button type="button" className="btn-secondary" onClick={async () => {
                        const res = await api.put('/empresa', { ...empresa, logo_data_url: null });
                        setEmpresa(res.data);
                        toast.success('Logo eliminado.');
                      }}>Quitar logo</button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {seccion === 'sucursales' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Sucursales</h3>
                <button
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  onClick={openNewSucursal}
                  disabled={limiteSucursales?.max != null && limiteSucursales.actual >= limiteSucursales.max}
                  title={limiteSucursales?.max != null && limiteSucursales.actual >= limiteSucursales.max
                    ? `Llegaste al máximo de sedes de tu plan (${limiteSucursales.max}).`
                    : undefined}
                >
                  + Nueva sede
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Cada sede tiene su propio stock, ventas, compras y caja — como negocios independientes bajo la misma
                empresa. Al iniciar sesión, quien tenga acceso a más de una elige con cuál trabajar.
                {limiteSucursales?.max != null && (
                  <> Tu plan permite hasta <strong>{limiteSucursales.max}</strong> sede(s) — llevas usadas{' '}
                    <strong>{limiteSucursales.actual}</strong> de {limiteSucursales.max}.</>
                )}
              </p>
              {limiteSucursales?.max != null && limiteSucursales.actual >= limiteSucursales.max && (
                <p style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: -6 }}>
                  Llegaste al máximo de sedes de tu plan. Contacta a tu proveedor para ampliarlo.
                </p>
              )}
              <table className="data-table">
                <thead>
                  <tr><th>Nombre</th><th>Dirección</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {sucursales.map((s) => (
                    <tr key={s.id}>
                      <td>{s.nombre}{s.es_principal ? ' (principal)' : ''}</td>
                      <td>{s.direccion || '—'}</td>
                      <td>
                        <span className={'badge ' + (s.activo ? 'badge-good' : 'badge-critical')}>
                          {s.activo ? 'Activa' : 'Desactivada'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => openEditSucursal(s)}>Editar</button>
                        {s.es_principal ? (
                          <span className="icon-link muted" title="No puedes desactivar la sede principal">—</span>
                        ) : (
                          <button className={'btn-link' + (s.activo ? ' danger' : '')} onClick={() => handleToggleSucursalEstado(s)}>
                            {s.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sucursales.length === 0 && (
                    <tr><td colSpan={4} className="empty-row">No hay sedes registradas.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'empleados' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Empleados</h3>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-export" onClick={exportarEmpleadosCsv}>Exportar</button>
                  <button className="btn-primary" style={{ width: 'auto' }} onClick={openNewUser}>Nuevo Empleado</button>
                </div>
              </div>

              <form className="filter-panel" onSubmit={(e) => { e.preventDefault(); loadUsuarios(); }}>
                <div className="filter-field grow">
                  <label>Buscar por nombre, apellido, DNI o correo</label>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar.." />
                </div>
                <div className="filter-actions">
                  <button type="submit" className="btn-secondary">Buscar</button>
                </div>
              </form>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombres</th><th>Apellidos</th><th>Rol</th><th>N° documento</th><th>Correo</th><th>Teléfono</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id}>
                      <td>{u.nombres || u.full_name}</td>
                      <td>{u.apellidos || ''}</td>
                      <td>{u.role === 'gerencia' ? 'Gerencia (administrador)' : (u.rol_personalizado_nombre || 'Sin rol asignado')}</td>
                      <td>{u.dni ? `DNI : ${u.dni}` : '—'}</td>
                      <td>{u.email || '—'}</td>
                      <td>{u.telefono || '—'}</td>
                      <td>
                        <span className={'badge ' + (u.activo ? 'badge-good' : 'badge-critical')}>
                          {u.activo ? 'Habilitado' : 'Deshabilitado'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => openEditUser(u)}>Editar</button>
                        <button className="btn-link" onClick={() => handleRestablecerContrasena(u)}>Restablecer contraseña</button>
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
                    <tr><td colSpan={8} className="empty-row">No hay empleados registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'roles' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Roles de usuario</h3>
                <button className="btn-primary" style={{ width: 'auto' }} onClick={() => navigate('/configuracion/roles/nuevo')}>Nuevo Rol de usuario</button>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id}>
                      <td>{r.nombre}</td>
                      <td>{r.descripcion || '—'}</td>
                      <td>
                        <span className={'badge ' + (r.activo ? 'badge-good' : 'badge-critical')}>
                          {r.activo ? 'Habilitado' : 'Deshabilitado'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => navigate(`/configuracion/roles/${r.id}`)}>Editar</button>
                        <button className={'btn-link' + (r.activo ? ' danger' : '')} onClick={() => handleToggleRoleEstado(r)}>
                          {r.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {roles.length === 0 && (
                    <tr><td colSpan={4} className="empty-row">No hay roles creados todavía.</td></tr>
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
            <h2>{editingId ? 'Editar empleado' : 'Nuevo empleado'}</h2>
            <form onSubmit={handleSubmitUser}>
              <div className="form-row">
                <div>
                  <label>Nombre *</label>
                  <input required value={form.nombres} onChange={(e) => setForm({ ...form, nombres: e.target.value })} />
                </div>
                <div>
                  <label>Apellidos *</label>
                  <input required value={form.apellidos} onChange={(e) => setForm({ ...form, apellidos: e.target.value })} />
                </div>
              </div>
              <label>Usuario (identificador interno) *</label>
              <input required disabled={!!editingId} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <label>DNI * (8 dígitos) — se usa para iniciar sesión junto con el RUC de la empresa</label>
              <input required value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value })} maxLength={8} />
              <div className="form-row">
                <div>
                  <label>Teléfono</label>
                  <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
                </div>
                <div>
                  <label>Correo electrónico</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -10 }}>
                El correo es solo para tenerlo como contacto — no enviamos ningún email automático (esta instancia no tiene un proveedor de correo configurado). El empleado inicia sesión con RUC + DNI + contraseña.
              </p>
              <label>Nivel *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="vendedor">Empleado (permisos por rol)</option>
                <option value="gerencia">Gerencia (administrador, acceso total)</option>
              </select>
              {form.role === 'vendedor' && (
                <>
                  <label>Rol</label>
                  <select value={form.custom_role_id} onChange={(e) => setForm({ ...form, custom_role_id: e.target.value })}>
                    <option value="">Sin rol asignado (sin restricciones, como antes)</option>
                    {roles.filter((r) => r.activo).map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </select>
                </>
              )}
              <label>Sede</label>
              <select value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}>
                <option value="">Todas las sedes (puede elegir al ingresar)</option>
                {sucursales.filter((s) => s.activo).map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <label>{editingId ? 'Nueva contraseña (dejar en blanco para no cambiarla)' : 'Contraseña * (mínimo 8 caracteres, mayúscula, minúscula, número y carácter especial)'}</label>
              <input required={!editingId} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {!editingId && (
                <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -10 }}>
                  Contraseña predeterminada — puedes dejarla así o cambiarla antes de guardar.
                </p>
              )}
              {errorForm && <div className="form-error">{errorForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingId ? 'Guardar cambios' : 'Guardar empleado'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSucursalForm && (
        <div className="modal-overlay" onClick={() => setShowSucursalForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingSucursalId ? 'Editar sede' : 'Nueva sede'}</h2>
            <form onSubmit={handleSubmitSucursal}>
              <label>Nombre</label>
              <input required value={sucursalForm.nombre} onChange={(e) => setSucursalForm({ ...sucursalForm, nombre: e.target.value })} />
              <label>Dirección</label>
              <input value={sucursalForm.direccion} onChange={(e) => setSucursalForm({ ...sucursalForm, direccion: e.target.value })} />
              {errorSucursal && <div className="form-error">{errorSucursal}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSucursalForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingSucursalId ? 'Guardar cambios' : 'Crear sede'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
