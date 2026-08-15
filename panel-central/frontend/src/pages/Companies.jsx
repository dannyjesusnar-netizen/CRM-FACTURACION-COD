import { useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const ESTADO_LABEL = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const ESTADO_BADGE = { pendiente: 'badge-warning', aprobado: 'badge-good', rechazado: 'badge-critical' };

const SOLICITUD_LABEL = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };
const SOLICITUD_BADGE = { pendiente: 'badge-warning', aprobada: 'badge-good', rechazada: 'badge-critical' };

function formatFecha(f) {
  if (!f) return '—';
  return String(f).slice(0, 10);
}

export default function Companies() {
  const toast = useToast();

  const [locales, setLocales] = useState({ disponible: false, empresas: [] });
  const [costoRuc, setCostoRuc] = useState(null);
  const [costoValor, setCostoValor] = useState('');
  const [fechaValor, setFechaValor] = useState('');
  const [pagosRuc, setPagosRuc] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [mensajesRuc, setMensajesRuc] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [usuariosRuc, setUsuariosRuc] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [sedesLibresRuc, setSedesLibresRuc] = useState(null);
  const [sedesLibresValor, setSedesLibresValor] = useState('');
  const [solicitudesRuc, setSolicitudesRuc] = useState(null);
  const [solicitudes, setSolicitudes] = useState([]);

  const CLAVE_DEFECTO = 'Lima2026*';

  const empresasActivas = locales.empresas.filter((t) => t.estado === 'aprobado' && t.activo).length;
  const ingresoTotal = locales.empresas.reduce((sum, t) => sum + (Number(t.ingreso_total) || 0), 0);
  const solicitudesPendientesTotal = locales.empresas.reduce((sum, t) => sum + (Number(t.solicitudes_sede_pendientes) || 0), 0);

  useEffect(() => { loadLocales(); }, []);

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

  function abrirSedesLibres(tenant) {
    setSedesLibresRuc(tenant.ruc);
    setSedesLibresValor(tenant.sedes_libres ?? 1);
  }

  async function guardarSedesLibres(e) {
    e.preventDefault();
    try {
      await api.put(`/companies/locales/${sedesLibresRuc}/sedes-libres`, { cantidad: Number(sedesLibresValor) });
      toast.success('Sedes libres actualizadas.');
      setSedesLibresRuc(null);
      loadLocales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo actualizar.');
    }
  }

  async function verSolicitudes(ruc) {
    setSolicitudesRuc(ruc);
    const res = await api.get(`/companies/locales/${ruc}/solicitudes-sede`);
    setSolicitudes(res.data);
  }

  async function resolverSolicitud(id, aprobar) {
    if (aprobar && !window.confirm('¿Aprobar esta solicitud? Se creará la sede tal cual fue pedida.')) return;
    if (!aprobar && !window.confirm('¿Rechazar esta solicitud?')) return;
    try {
      const accion = aprobar ? 'aprobar' : 'rechazar';
      const res = await api.put(`/companies/locales/${solicitudesRuc}/solicitudes-sede/${id}/${accion}`);
      setSolicitudes((prev) => prev.map((s) => (s.id === id ? res.data : s)));
      toast.success(aprobar ? 'Solicitud aprobada — la sede ya está creada.' : 'Solicitud rechazada.');
      loadLocales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo resolver la solicitud.');
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

  async function verUsuarios(ruc) {
    setUsuariosRuc(ruc);
    const res = await api.get(`/companies/locales/${ruc}/usuarios`);
    setUsuarios(res.data);
  }

  async function restablecerClaveDefecto(u) {
    if (!window.confirm(`¿Restablecer la contraseña de "${u.full_name}" a "${CLAVE_DEFECTO}"?`)) return;
    try {
      await api.put(`/companies/locales/${usuariosRuc}/usuarios/${u.id}/password`, { new_password: CLAVE_DEFECTO });
      toast.success(`Contraseña restablecida a "${CLAVE_DEFECTO}".`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo restablecer la contraseña.');
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
            Empresas que corren en esta misma instancia — se registraron solas desde "Registrar mi empresa",
            o son la instalación base que ya venía con el despliegue — aparecen automáticamente, sin que
            tengas que agregarlas a mano.
          </p>

          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(160px, 220px))' }}>
            <div className="stat-card">
              <div className="stat-label">EMPRESAS ACTIVAS</div>
              <div className="stat-value">{empresasActivas}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">INGRESO TOTAL</div>
              <div className="stat-value">S/ {ingresoTotal.toFixed(2)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">SOLICITUDES DE SEDE PENDIENTES</div>
              <div className="stat-value">{solicitudesPendientesTotal}</div>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Razón social</th><th>RUC</th><th>Estado</th><th>Costo mensual</th>
                <th>Fecha de pago</th><th>Próximo cobro</th><th>Ingresos</th><th>Sucursales</th><th>Sedes libres</th><th></th>
              </tr>
            </thead>
            <tbody>
              {locales.empresas.map((t) => (
                <tr key={t.ruc}>
                  <td>{t.razon_social}</td>
                  <td>{t.ruc}</td>
                  <td>
                    {t.estado === 'aprobado' && !t.activo ? (
                      <span className="badge badge-critical">Suspendida</span>
                    ) : t.estado === 'aprobado' ? (
                      <span className="badge badge-good">Activa</span>
                    ) : (
                      <span className={'badge ' + (ESTADO_BADGE[t.estado] || 'badge-neutral')}>{ESTADO_LABEL[t.estado] || t.estado}</span>
                    )}
                  </td>
                  <td>{t.costo_mensual != null ? `S/ ${Number(t.costo_mensual).toFixed(2)}` : '—'}</td>
                  <td>{formatFecha(t.fecha_inicio_suscripcion)}</td>
                  <td>{formatFecha(t.proximo_cobro_at)}</td>
                  <td>{t.ingreso_total != null ? `S/ ${Number(t.ingreso_total).toFixed(2)}` : '—'}</td>
                  <td>{t.sucursales_count ?? '—'}</td>
                  <td>
                    {t.sedes_libres ?? 1}
                    <button className="btn-link" style={{ marginLeft: 6 }} onClick={() => abrirSedesLibres(t)}>Editar</button>
                  </td>
                  <td className="row-actions">
                    {t.estado === 'pendiente' && (
                      <>
                        <button className="btn-link" onClick={() => aprobarLocal(t.ruc)}>Aprobar</button>
                        <button className="btn-link danger" onClick={() => rechazarLocal(t.ruc)}>Rechazar</button>
                      </>
                    )}
                    {t.estado === 'aprobado' && (
                      <button className={'btn-link' + (t.activo ? ' danger' : '')} onClick={() => toggleActivo(t)}>
                        {t.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                    <button className="btn-link" onClick={() => abrirCosto(t)}>Costo</button>
                    <button className="btn-link" onClick={() => verPagos(t.ruc)}>Pagos</button>
                    <button className="btn-link" onClick={() => verUsuarios(t.ruc)}>Usuarios</button>
                    <button className="btn-link" onClick={() => verMensajes(t.ruc)}>Mensajes</button>
                    <button className="btn-link" onClick={() => verSolicitudes(t.ruc)}>
                      Solicitudes{t.solicitudes_sede_pendientes > 0 ? ` (${t.solicitudes_sede_pendientes})` : ''}
                    </button>
                  </td>
                </tr>
              ))}
              {locales.empresas.length === 0 && (
                <tr><td colSpan={10} className="empty-row">Todavía no hay empresas registradas desde "Registrar mi empresa".</td></tr>
              )}
            </tbody>
          </table>
        </>
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

      {sedesLibresRuc && (
        <div className="modal-overlay" onClick={() => setSedesLibresRuc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Sedes libres — {sedesLibresRuc}</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Cuántas sedes puede crear esta empresa sin pedir permiso. Al llegar a este número, la siguiente
              queda como solicitud pendiente hasta que la apruebes.
            </p>
            <form onSubmit={guardarSedesLibres}>
              <label>Sedes libres</label>
              <input required type="number" min="0" step="1" value={sedesLibresValor} onChange={(e) => setSedesLibresValor(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setSedesLibresRuc(null)}>Cancelar</button>
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

      {solicitudesRuc && (
        <div className="modal-overlay" onClick={() => setSolicitudesRuc(null)}>
          <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
            <h2>Solicitudes de sede — {solicitudesRuc}</h2>
            <table className="data-table">
              <thead>
                <tr><th>Fecha</th><th>Solicitó</th><th>Sede pedida</th><th>Dirección</th><th>Motivo</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {solicitudes.map((s) => (
                  <tr key={s.id}>
                    <td>{formatFecha(s.created_at)}</td>
                    <td>{s.nombre_usuario || '—'}</td>
                    <td>{s.nombre}</td>
                    <td>{s.direccion || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{s.motivo || '—'}</td>
                    <td>
                      <span className={'badge ' + (SOLICITUD_BADGE[s.estado] || 'badge-neutral')}>
                        {SOLICITUD_LABEL[s.estado] || s.estado}
                      </span>
                    </td>
                    <td className="row-actions">
                      {s.estado === 'pendiente' && (
                        <>
                          <button className="btn-link" onClick={() => resolverSolicitud(s.id, true)}>Aprobar</button>
                          <button className="btn-link danger" onClick={() => resolverSolicitud(s.id, false)}>Rechazar</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {solicitudes.length === 0 && (
                  <tr><td colSpan={7} className="empty-row">Todavía no hay solicitudes de sede de esta empresa.</td></tr>
                )}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setSolicitudesRuc(null)}>Cerrar</button>
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

      {usuariosRuc && (
        <div className="modal-overlay" onClick={() => setUsuariosRuc(null)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2>Usuarios — {usuariosRuc}</h2>
            <table className="data-table">
              <thead>
                <tr><th>Nombre</th><th>DNI</th><th>Rol</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td>{u.dni}</td>
                    <td>
                      <span className={'badge ' + (u.role === 'gerencia' ? 'badge-good' : '')}>
                        {u.role === 'gerencia' ? 'Gerencia' : 'Vendedor'}
                      </span>
                    </td>
                    <td>
                      <span className={'badge ' + (u.activo ? 'badge-good' : 'badge-critical')}>
                        {u.activo ? 'Activo' : 'Desactivado'}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button className="btn-link" onClick={() => restablecerClaveDefecto(u)}>Restablecer a Lima2026*</button>
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && (
                  <tr><td colSpan={5} className="empty-row">Todavía no hay usuarios en esa empresa.</td></tr>
                )}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setUsuariosRuc(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
