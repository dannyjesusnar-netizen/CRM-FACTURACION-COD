import { useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtHora(iso) {
  if (!iso) return '—';
  // Los timestamps de sqlite vienen en UTC sin sufijo "Z" — hay que
  // agregarlo para que el navegador los interprete como UTC y los
  // convierta a la hora local, en vez de asumir que ya son locales.
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function duracion(abiertoAt, cerradoAt) {
  if (!cerradoAt) return '—';
  const ini = new Date(abiertoAt.replace(' ', 'T') + 'Z');
  const fin = new Date(cerradoAt.replace(' ', 'T') + 'Z');
  const minutos = Math.max(0, Math.round((fin - ini) / 60000));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function Planilla() {
  const toast = useToast();
  const [desde, setDesde] = useState(todayStr());
  const [hasta, setHasta] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [miTurnoAbierto, setMiTurnoAbierto] = useState(null);
  const [procesando, setProcesando] = useState(false);

  function load() {
    setLoading(true);
    setLoadError('');
    api.get('/planilla', { params: { desde, hasta } })
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.response?.data?.error || 'No se pudo cargar la planilla.'))
      .finally(() => setLoading(false));
  }

  function loadMiTurno() {
    api.get('/planilla/mi-turno-abierto').then((res) => setMiTurnoAbierto(res.data)).catch(() => {});
  }

  useEffect(() => { load(); }, [desde, hasta]);
  useEffect(() => { loadMiTurno(); }, []);

  async function handleAbrir() {
    setProcesando(true);
    try {
      await api.post('/planilla/abrir');
      toast.success('Turno de caja abierto.');
      loadMiTurno();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo abrir el turno.');
    } finally {
      setProcesando(false);
    }
  }

  async function handleCerrar() {
    setProcesando(true);
    try {
      await api.post('/planilla/cerrar');
      toast.success('Turno de caja cerrado.');
      loadMiTurno();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cerrar el turno.');
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Planilla</h1>
        {miTurnoAbierto ? (
          <button className="btn-primary" style={{ background: 'var(--critical)', borderColor: 'var(--critical)' }} disabled={procesando} onClick={handleCerrar}>
            {procesando ? 'Cerrando...' : 'Cerrar caja'}
          </button>
        ) : (
          <button className="btn-primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }} disabled={procesando} onClick={handleAbrir}>
            {procesando ? 'Abriendo...' : 'Abrir caja'}
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8, marginBottom: 16 }}>
        {miTurnoAbierto
          ? `Tienes un turno de caja abierto desde las ${fmtHora(miTurnoAbierto.abierto_at)}.`
          : 'No tienes un turno de caja abierto — presiona "Abrir caja" al empezar tu turno.'}
      </p>

      <div className="filter-panel" style={{ marginBottom: 16 }}>
        <div className="filter-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Hasta</label>
          <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      <div className="panel">
        <h3>{data?.verTodos ? 'Turnos de caja — todos los empleados' : 'Mis turnos de caja'}</h3>
        {loadError ? (
          <>
            <p className="form-error">{loadError}</p>
            <button className="btn-secondary" onClick={load}>Reintentar</button>
          </>
        ) : loading || !data ? (
          <span className="spinner" />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {data.verTodos && <th>Empleado</th>}
                  <th>Sede</th>
                  <th>Fecha</th>
                  <th>Apertura</th>
                  <th>Cierre</th>
                  <th>Duración</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.turnos.map((t) => (
                  <tr key={t.id}>
                    {data.verTodos && <td>{t.empleado_nombre}</td>}
                    <td>{t.sede_nombre}</td>
                    <td>{t.fecha}</td>
                    <td>{fmtHora(t.abierto_at)}</td>
                    <td>{fmtHora(t.cerrado_at)}</td>
                    <td>{duracion(t.abierto_at, t.cerrado_at)}</td>
                    <td>
                      <span className={'badge ' + (t.cerrado_at ? 'badge-good' : 'badge-warning')}>
                        {t.cerrado_at ? 'Cerrado' : 'Abierto'}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.turnos.length === 0 && (
                  <tr><td colSpan={data.verTodos ? 7 : 6} className="empty-row">No hay turnos de caja registrados en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
