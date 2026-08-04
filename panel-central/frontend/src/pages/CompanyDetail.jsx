import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [empresa, setEmpresa] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pwdModalUser, setPwdModalUser] = useState(null);
  const [nuevaClave, setNuevaClave] = useState('');
  const [pwdError, setPwdError] = useState('');

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [empresaRes, usersRes] = await Promise.all([
        api.get(`/companies/${id}/live/empresa`),
        api.get(`/companies/${id}/live/users`),
      ]);
      setEmpresa(empresaRes.data);
      setUsers(usersRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo contactar la instancia.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleEstado(u) {
    const accion = u.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} la cuenta de "${u.full_name}"?`)) return;
    try {
      await api.put(`/companies/${id}/live/users/${u.id}/estado`, { activo: !u.activo });
      toast.success(`Cuenta ${u.activo ? 'desactivada' : 'activada'}.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  async function handleRestaurarGerencia(u) {
    if (!window.confirm(`¿Restaurar a "${u.full_name}" como Gerencia? Esto le da de vuelta acceso total en su CRM.`)) return;
    try {
      await api.put(`/companies/${id}/live/users/${u.id}/rol`);
      toast.success('Cuenta restaurada como Gerencia.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo restaurar el rol.');
    }
  }

  function openPasswordModal(u) {
    setPwdModalUser(u);
    setNuevaClave('');
    setPwdError('');
  }

  async function handleRestaurarClave(e) {
    e.preventDefault();
    setPwdError('');
    try {
      await api.put(`/companies/${id}/live/users/${pwdModalUser.id}/password`, { new_password: nuevaClave });
      toast.success('Contraseña restaurada.');
      setPwdModalUser(null);
    } catch (err) {
      setPwdError(err.response?.data?.error || 'No se pudo restaurar la contraseña.');
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver" onClick={() => navigate('/empresas')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        {empresa?.nombre_comercial || empresa?.razon_social || 'EMPRESA'}
      </h1>

      {loading && (
        <div className="panel">
          <p>Cargando datos en vivo de la instancia… puede tardar hasta 30 segundos si estaba dormida.</p>
        </div>
      )}

      {!loading && error && (
        <div className="panel">
          <p className="form-error">{error}</p>
          <button className="btn-secondary" onClick={load}>Reintentar</button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="panel" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>Datos de la empresa</h3>
            <p><strong>Razón social:</strong> {empresa?.razon_social || '—'}</p>
            <p><strong>Nombre comercial:</strong> {empresa?.nombre_comercial || '—'}</p>
            <p><strong>RUC:</strong> {empresa?.ruc || '—'}</p>
            <p><strong>Teléfono:</strong> {empresa?.telefono || '—'}</p>
          </div>

          <h3>Cuentas</h3>
          <table className="data-table">
            <thead>
              <tr><th>Nombre</th><th>DNI</th><th>Correo</th><th>Rol</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {(users || []).map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.dni}</td>
                  <td>{u.email || '—'}</td>
                  <td>
                    <span className={'badge ' + (u.role === 'gerencia' ? 'badge-good' : '')}>
                      {u.role === 'gerencia' ? 'Gerencia' : 'Vendedor'}
                    </span>
                  </td>
                  <td>
                    <span className={'badge ' + (u.activo ? 'badge-good' : 'badge-critical')}>
                      {u.activo ? 'Activa' : 'Desactivada'}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button className={'btn-link' + (u.activo ? ' danger' : '')} onClick={() => handleToggleEstado(u)}>
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button className="btn-link" onClick={() => openPasswordModal(u)}>Restaurar clave</button>
                    {u.role !== 'gerencia' && (
                      <button className="btn-link" onClick={() => handleRestaurarGerencia(u)}>Restaurar como Gerencia</button>
                    )}
                  </td>
                </tr>
              ))}
              {(users || []).length === 0 && (
                <tr><td colSpan={6} className="empty-row">No hay cuentas registradas en esa instancia.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {pwdModalUser && (
        <div className="modal-overlay" onClick={() => setPwdModalUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Restaurar clave de {pwdModalUser.full_name}</h2>
            <form onSubmit={handleRestaurarClave}>
              <label>Nueva contraseña (mínimo 8 caracteres, mayúscula, minúscula, número y carácter especial)</label>
              <input required type="text" value={nuevaClave} onChange={(e) => setNuevaClave(e.target.value)} autoFocus />
              {pwdError && <div className="form-error">{pwdError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setPwdModalUser(null)}>Cancelar</button>
                <button type="submit" className="btn-primary">Restaurar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
