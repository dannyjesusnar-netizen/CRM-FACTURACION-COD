import { useEffect, useState } from 'react';
import api from '../api';
import { hoyPeru } from '../utils/fechas';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ExportButton from '../components/ExportButton';
import { exportarTabla } from '../utils/excelImport';

function todayStr() {
  return hoyPeru();
}

function fmtHora(iso) {
  if (!iso) return '—';
  // Los timestamps de sqlite vienen en UTC sin sufijo "Z" — hay que
  // agregarlo para que el navegador los interprete como UTC y los
  // convierta a la hora local, en vez de asumir que ya son locales.
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-PE', { hour: '2-digit', minute: '2-digit' });
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
  const { user } = useAuth();
  const toast = useToast();
  const esGerencia = user?.role === 'gerencia';
  const [desde, setDesde] = useState(todayStr());
  const [hasta, setHasta] = useState(todayStr());
  const [sucursalId, setSucursalId] = useState('');
  const [sucursales, setSucursales] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  function load() {
    setLoading(true);
    setLoadError('');
    api.get('/planilla', { params: { desde, hasta, sucursal_id: esGerencia ? (sucursalId || undefined) : undefined } })
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.response?.data?.error || 'No se pudo cargar la planilla.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (esGerencia) api.get('/sucursales').then((res) => setSucursales(res.data)).catch(() => {});
  }, [esGerencia]);
  useEffect(() => { load(); }, [desde, hasta, sucursalId]);

  async function exportPlanilla(formato) {
    if (!data?.turnos?.length) return;
    const header = [
      ...(data.verTodos ? ['Empleado'] : []),
      'Sede', 'Fecha', 'Apertura', 'Cierre', 'Duración', 'Total', 'Estado',
    ];
    const rows = data.turnos.map((t) => [
      ...(data.verTodos ? [t.empleado_nombre] : []),
      t.sede_nombre, t.fecha, fmtHora(t.abierto_at), fmtHora(t.cerrado_at),
      duracion(t.abierto_at, t.cerrado_at), Number(t.total).toFixed(2),
      t.cerrado_at ? (t.cerrado_automaticamente ? 'Cerrado automático (11:30pm)' : 'Cerrado') : 'Abierto',
    ]);
    await exportarTabla(`planilla_${desde}_${hasta}`, header, rows, formato);
    toast.success(`Archivo ${formato === 'excel' ? 'Excel' : 'CSV'} exportado.`);
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Planilla</h1>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8, marginBottom: 16 }}>
        Reporte de horas: quién abrió y cerró su turno de caja, cuánto duró y cuánto se vendió/movió en caja durante
        ese turno puntual (no el total del día completo). Para abrir o cerrar tu turno, ve a Caja y Bancos.
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
        {esGerencia && (
          <div className="filter-field">
            <label>Sede</label>
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
              <option value="">Todas las sedes</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>
            {data?.verTodos ? 'Turnos de caja — todos los empleados' : 'Mis turnos de caja'}
            {data?.puedeElegirSede && !sucursalId && ' (todas las sedes)'}
          </h3>
          {data?.turnos?.length > 0 && <ExportButton onExport={exportPlanilla} />}
        </div>
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
                  <th style={{ textAlign: 'right' }}>Total</th>
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
                    <td style={{ textAlign: 'right' }}>S/ {Number(t.total).toFixed(2)}</td>
                    <td>
                      <span className={'badge ' + (t.cerrado_at ? 'badge-good' : 'badge-warning')}
                        title={t.cerrado_automaticamente ? 'Nadie cerró este turno a tiempo — el sistema lo cerró solo a las 11:30pm.' : undefined}>
                        {t.cerrado_at ? (t.cerrado_automaticamente ? 'Cerrado automático' : 'Cerrado') : 'Abierto'}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.turnos.length === 0 && (
                  <tr><td colSpan={data.verTodos ? 8 : 7} className="empty-row">No hay turnos de caja registrados en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
