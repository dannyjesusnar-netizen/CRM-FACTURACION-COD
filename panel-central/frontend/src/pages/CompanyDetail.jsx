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
  const [registros, setRegistros] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pwdModalUser, setPwdModalUser] = useState(null);
  const [nuevaClave, setNuevaClave] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [costoEdit, setCostoEdit] = useState({});
  const [guardandoCosto, setGuardandoCosto] = useState(null);

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [empresaRes, usersRes, registrosRes] = await Promise.all([
        api.get(`/companies/${id}/live/empresa`),
        api.get(`/companies/${id}/live/users`),
        api.get(`/companies/${id}/live/registros`).catch(() => ({ data: [] })),
      ]);
      setEmpresa(empresaRes.data);
      setUsers(usersRes.data);
      setRegistros(registrosRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo contactar la instancia.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAprobarRegistro(r) {
    if (!window.confirm(`¿Aprobar el registro de "${r.razon_social}" (RUC ${r.ruc})? Podrá iniciar sesión de inmediato.`)) return;
    try {
      await api.put(`/companies/${id}/live/registros/${r.ruc}/aprobar`);
      toast.success('Registro aprobado.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo aprobar el registro.');
    }
  }

  async function handleRechazarRegistro(r) {
    if (!window.confirm(`¿Rechazar el registro de "${r.razon_social}" (RUC ${r.ruc})? No podrá iniciar sesión.`)) return;
    try {
      await api.put(`/companies/${id}/live/registros/${r.ruc}/rechazar`);
      toast.success('Registro rechazado.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo rechazar el registro.');
    }
  }

  function formatFecha(f) {
    if (!f) return '—';
    return f.replace('T', ' ').slice(0, 16);
  }

  const ESTADO_BADGE = { pendiente: '', aprobado: 'badge-good', rechazado: 'badge-critical' };
  const ESTADO_LABEL = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
  const SUSCRIPCION_BADGE = { activa: 'badge-good', pago_fallido: 'badge-critical', sin_tarjeta: '' };
  const SUSCRIPCION_LABEL = { activa: 'Al día', pago_fallido: 'Pago fallido', sin_tarjeta: 'Sin tarjeta' };

  async function handleGuardarCosto(r) {
    const valor = costoEdit[r.ruc];
    const costo = Number(valor);
    if (valor === undefined || !Number.isFinite(costo) || costo < 0) {
      toast.error('Ingresa un costo mensual válido.');
      return;
    }
    setGuardandoCosto(r.ruc);
    try {
      await api.put(`/companies/${id}/live/registros/${r.ruc}/costo`, { costo_mensual: costo });
      toast.success('Costo mensual actualizado.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo actualizar el costo.');
    } finally {
      setGuardandoCosto(null);
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

          <h3 style={{ marginTop: 28 }}>Empresas registradas desde "Registrar mi empresa"</h3>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
            Historial completo de empresas que se dieron de alta solas en esta instancia (botón "Registro"
            en su pantalla de login), con la fecha desde que están y su estado actual.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Razón social</th><th>RUC</th><th>Registrada desde</th><th>Estado</th>
                <th>Costo mensual (S/)</th><th>Suscripción</th><th>Próximo cobro</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(registros || []).map((r) => (
                <tr key={r.ruc}>
                  <td>{r.razon_social}</td>
                  <td>{r.ruc}</td>
                  <td>{formatFecha(r.created_at)}</td>
                  <td>
                    <span className={'badge ' + (ESTADO_BADGE[r.estado] || '')}>{ESTADO_LABEL[r.estado] || r.estado}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number" min="0" step="0.01" style={{ width: 90 }}
                        value={costoEdit[r.ruc] ?? (r.costo_mensual ?? '')}
                        onChange={(e) => setCostoEdit({ ...costoEdit, [r.ruc]: e.target.value })}
                      />
                      <button
                        className="btn-link" disabled={guardandoCosto === r.ruc}
                        onClick={() => handleGuardarCosto(r)}
                      >
                        Guardar
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className={'badge ' + (SUSCRIPCION_BADGE[r.suscripcion_estado] || '')}>
                      {SUSCRIPCION_LABEL[r.suscripcion_estado] || r.suscripcion_estado}
                    </span>
                  </td>
                  <td>{formatFecha(r.proximo_cobro_at)}</td>
                  <td className="row-actions">
                    {r.estado === 'pendiente' && (
                      <>
                        <button className="btn-link" onClick={() => handleAprobarRegistro(r)}>Aprobar</button>
                        <button className="btn-link danger" onClick={() => handleRechazarRegistro(r)}>Rechazar</button>
                      </>
                    )}
                    {r.estado === 'aprobado' && (
                      <button className="btn-link danger" onClick={() => handleRechazarRegistro(r)}>Rechazar</button>
                    )}
                  </td>
                </tr>
              ))}
              {(registros || []).length === 0 && (
                <tr><td colSpan={8} className="empty-row">Todavía nadie se registró solo en esta instancia.</td></tr>
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
