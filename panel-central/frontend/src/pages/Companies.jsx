import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';

function emptyForm() {
  return { nombre: '', ruc: '', telefono: '', render_url: '', platform_token: '' };
}

const ESTADO_LABEL = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const ESTADO_BADGE = { pendiente: 'badge-warning', aprobado: 'badge-good', rechazado: 'badge-critical' };

function formatFecha(f) {
  if (!f) return '—';
  return String(f).slice(0, 10);
}

export default function Companies() {
  const navigate = useNavigate();
  const toast = useToast();
  const [companies, setCompanies] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  const [locales, setLocales] = useState({ disponible: false, empresas: [] });
  const [costoRuc, setCostoRuc] = useState(null);
  const [costoValor, setCostoValor] = useState('');
  const [fechaValor, setFechaValor] = useState('');
  const [pagosRuc, setPagosRuc] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [mensajesRuc, setMensajesRuc] = useState(null);
  const [mensajes, setMensajes] = useState([]);

  const empresasActivas = locales.empresas.filter((t) => !t.es_original && t.estado === 'aprobado' && t.activo).length;
  const ingresoTotal = locales.empresas.reduce((sum, t) => sum + (Number(t.ingreso_total) || 0), 0);

  useEffect(() => { load(); loadLocales(); }, []);

  function load() {
    api.get('/companies').then((res) => setCompanies(res.data));
  }

  function loadLocales() {
    api.get('/companies/locales').then((res) => setLocales(res.data));
  }

  async function aprobarLocal(ruc) {
    try {
      await api.put(`/companies/locales/${ruc}/aprobar`);
      toast.success('Empresa aprobada. Ya puede iniciar sesión.');
      loadLocales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo aprobar.');
    }
  }

  async function rechazarLocal(ruc) {
    if (!window.confirm('¿Rechazar este registro?')) return;
    try {
      await api.put(`/companies/locales/${ruc}/rechazar`);
      toast.success('Registro rechazado.');
      loadLocales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo rechazar.');
    }
  }

  function abrirCosto(tenant) {
    setCostoRuc(tenant.ruc);
    setCostoValor(tenant.costo_mensual ?? '');
    setFechaValor(tenant.fecha_inicio_suscripcion || '');
  }

  async function guardarCosto(e) {
    e.preventDefault();
    try {
      await api.put(`/companies/locales/${costoRuc}/costo`, {
        costo_mensual: Number(costoValor),
        fecha_inicio_suscripcion: fechaValor || null,
      });
      toast.success('Costo y fecha de pago actualizados.');
      setCostoRuc(null);
      loadLocales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo actualizar el costo.');
    }
  }

  async function toggleActivo(t) {
    const accion = t.activo ? 'suspender' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} a "${t.razon_social}"?`)) return;
    try {
      await api.put(`/companies/locales/${t.ruc}/activo`, { activo: !t.activo });
      toast.success(t.activo ? 'Empresa suspendida.' : 'Empresa reactivada.');
      loadLocales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  async function verPagos(ruc) {
    setPagosRuc(ruc);
    const res = await api.get(`/companies/locales/${ruc}/pagos`);
    setPagos(res.data);
  }

  async function verMensajes(ruc) {
    setMensajesRuc(ruc);
    const res = await api.get(`/companies/locales/${ruc}/mensajes`);
    setMensajes(res.data);
  }

  async function marcarMensajeLeido(id) {
    await api.put(`/companies/locales/${mensajesRuc}/mensajes/${id}/leido`);
    setMensajes((prev) => prev.map((m) => (m.id === id ? { ...m, leido: 1 } : m)));
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
      {locales.disponible && (
        <>
          <div className="report-toolbar">
            <h1 className="page-title" style={{ margin: 0 }}>CUENTAS REGISTRADAS</h1>
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
            Tu propia empresa y las que se registraron solas desde "Registrar mi empresa" en esta misma
            instancia — aparecen automáticamente, sin que tengas que agregarlas a mano.
          </p>

          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(160px, 220px))' }}>
            <div className="stat-card">
              <div className="stat-label">EMPRESAS ACTIVAS</div>
              <div className="stat-value">{empresasActivas}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">INGRESO TOTAL</div>
              <div className="stat-value">S/ {ingresoTotal.toFixed(2)}</div>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Razón social</th><th>RUC</th><th>Estado</th><th>Costo mensual</th>
                <th>Fecha de pago</th><th>Próximo cobro</th><th>Ingresos</th><th>Sucursales</th><th></th>
              </tr>
            </thead>
            <tbody>
              {locales.empresas.map((t) => (
                <tr key={t.ruc}>
                  <td>{t.razon_social}</td>
                  <td>{t.ruc}</td>
                  <td>
                    {t.es_original ? (
                      <span className="badge badge-good">Tu empresa</span>
                    ) : t.estado === 'aprobado' && !t.activo ? (
                      <span className="badge badge-critical">Suspendida</span>
                    ) : t.estado === 'aprobado' ? (
                      <span className="badge badge-good">Activa</span>
                    ) : (
                      <span className={'badge ' + (ESTADO_BADGE[t.estado] || 'badge-neutral')}>{ESTADO_LABEL[t.estado] || t.estado}</span>
                    )}
                  </td>
                  <td>{t.es_original ? '—' : (t.costo_mensual != null ? `S/ ${Number(t.costo_mensual).toFixed(2)}` : '—')}</td>
                  <td>{t.es_original ? '—' : formatFecha(t.fecha_inicio_suscripcion)}</td>
                  <td>{t.es_original ? '—' : formatFecha(t.proximo_cobro_at)}</td>
                  <td>{t.ingreso_total != null ? `S/ ${Number(t.ingreso_total).toFixed(2)}` : '—'}</td>
                  <td>{t.sucursales_count ?? '—'}</td>
                  <td className="row-actions">
                    {!t.es_original && t.estado === 'pendiente' && (
                      <>
                        <button className="btn-link" onClick={() => aprobarLocal(t.ruc)}>Aprobar</button>
                        <button className="btn-link danger" onClick={() => rechazarLocal(t.ruc)}>Rechazar</button>
                      </>
                    )}
                    {!t.es_original && t.estado === 'aprobado' && (
                      <button className={'btn-link' + (t.activo ? ' danger' : '')} onClick={() => toggleActivo(t)}>
                        {t.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                    {!t.es_original && (
                      <>
                        <button className="btn-link" onClick={() => abrirCosto(t)}>Costo</button>
                        <button className="btn-link" onClick={() => verPagos(t.ruc)}>Pagos</button>
                      </>
                    )}
                    <button className="btn-link" onClick={() => verMensajes(t.ruc)}>Mensajes</button>
                  </td>
                </tr>
              ))}
              {locales.empresas.length === 0 && (
                <tr><td colSpan={9} className="empty-row">Todavía no hay empresas registradas desde "Registrar mi empresa".</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <div className="report-toolbar" style={{ marginTop: locales.disponible ? 32 : 0 }}>
        <h1 className="page-title" style={{ margin: 0 }}>EMPRESAS EN OTRAS INSTANCIAS</h1>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={openNew}>+ Nueva empresa</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Para empresas que corren en su propia instancia de Render, separada de esta. Regístrala una vez
        con su URL y el token que configuraste ahí (variable <code>PLATFORM_TOKEN</code>) para poder ver
        y administrar sus cuentas admin desde aquí.
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
            <tr><td colSpan={4} className="empty-row">Todavía no registraste ninguna empresa en otra instancia.</td></tr>
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

      {costoRuc && (
        <div className="modal-overlay" onClick={() => setCostoRuc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Costo y fecha de pago</h2>
            <form onSubmit={guardarCosto}>
              <label>Costo mensual (S/)</label>
              <input required type="number" min="0" step="0.01" value={costoValor} onChange={(e) => setCostoValor(e.target.value)} />
              <label>Fecha de pago (desde cuándo corre el cobro)</label>
              <input type="date" value={fechaValor} onChange={(e) => setFechaValor(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setCostoRuc(null)}>Cancelar</button>
                <button type="submit" className="btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pagosRuc && (
        <div className="modal-overlay" onClick={() => setPagosRuc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Historial de pagos — {pagosRuc}</h2>
            <table className="data-table">
              <thead>
                <tr><th>Fecha</th><th>Monto</th><th>Estado</th><th>Mensaje</th></tr>
              </thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{formatFecha(p.created_at)}</td>
                    <td>S/ {Number(p.monto).toFixed(2)}</td>
                    <td>
                      <span className={'badge ' + (p.estado === 'exitoso' ? 'badge-good' : 'badge-critical')}>
                        {p.estado === 'exitoso' ? 'Exitoso' : 'Fallido'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{p.mensaje || '—'}</td>
                  </tr>
                ))}
                {pagos.length === 0 && (
                  <tr><td colSpan={4} className="empty-row">Todavía no hay cobros registrados.</td></tr>
                )}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setPagosRuc(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {mensajesRuc && (
        <div className="modal-overlay" onClick={() => setMensajesRuc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Mensajes a ODIN — {mensajesRuc}</h2>
            <table className="data-table">
              <thead>
                <tr><th>Fecha</th><th>De</th><th>Mensaje</th><th></th></tr>
              </thead>
              <tbody>
                {mensajes.map((m) => (
                  <tr key={m.id}>
                    <td>{formatFecha(m.created_at)}</td>
                    <td>{m.nombre_usuario || '—'}</td>
                    <td style={{ fontSize: 13 }}>{m.mensaje}</td>
                    <td>
                      {m.leido ? (
                        <span className="badge badge-good">Leído</span>
                      ) : (
                        <button className="btn-link" onClick={() => marcarMensajeLeido(m.id)}>Marcar leído</button>
                      )}
                    </td>
                  </tr>
                ))}
                {mensajes.length === 0 && (
                  <tr><td colSpan={4} className="empty-row">Todavía no le escribieron a ODIN desde esta cuenta.</td></tr>
                )}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setMensajesRuc(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
