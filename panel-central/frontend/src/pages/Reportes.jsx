import { useEffect, useState } from 'react';
import api from '../api';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const ACCION_LABEL = {
  aprobar_empresa: 'Aprobó la empresa',
  rechazar_empresa: 'Rechazó la empresa',
  activar_empresa: 'Activó la empresa',
  desactivar_empresa: 'Desactivó la empresa',
  cambiar_costo: 'Cambió el costo mensual',
  cambiar_tipo_negocio: 'Cambió el tipo de negocio',
  cambiar_sedes_libres: 'Cambió las sedes libres',
  aprobar_solicitud_sede: 'Aprobó una solicitud de sede',
  rechazar_solicitud_sede: 'Rechazó una solicitud de sede',
  crear_empresa_demo: 'Creó una empresa demo',
  reset_password: 'Reseteó una contraseña',
};

function formatFechaHora(f) {
  if (!f) return '—';
  // Los timestamps de sqlite vienen en UTC sin sufijo "Z".
  const d = new Date(String(f).replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const TABS = [
  { key: 'documentos', label: 'Documentos por sede' },
  { key: 'auditoria', label: 'Auditoría del sistema' },
  { key: 'commits', label: 'Cambios en el código' },
];

export default function Reportes() {
  const [tab, setTab] = useState('documentos');
  const [empresas, setEmpresas] = useState([]);

  useEffect(() => {
    api.get('/companies/locales').then((res) => setEmpresas(res.data.empresas || [])).catch(() => {});
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0 }}>Reportes</h1>
      </div>

      <div className="reportes-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'reportes-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'documentos' && <DocumentosPorSede />}
      {tab === 'auditoria' && <AuditoriaSistema empresas={empresas} />}
      {tab === 'commits' && <CambiosCodigo />}
    </div>
  );
}

function DocumentosPorSede() {
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [data, setData] = useState({ disponible: true, sedes: [], total: { boletas: 0, facturas: 0, notas_credito: 0, notas_venta: 0, total: 0 } });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/companies/reportes/documentos-por-sede', { params: { anio, mes } })
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, [anio, mes]);

  const maxTotal = Math.max(1, ...data.sedes.map((s) => s.total));

  return (
    <div className="panel">
      <div className="modal-header-row">
        <h3 style={{ margin: 0 }}>Documentos emitidos por sede — todas las empresas</h3>
        <div className="docs-periodo">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((nombre, idx) => <option key={idx} value={idx + 1}>{nombre}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[anio - 1, anio, anio + 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -2 }}>
        Cuántos documentos emitió cada sede de cada empresa en el mes elegido — para comparar actividad entre empresas y sedes.
      </p>

      {!data.disponible ? (
        <p className="empty-row">No disponible en esta instancia.</p>
      ) : loading ? (
        <span className="spinner" />
      ) : (
        <>
          <div className="docs-hero">
            <div>
              <div className="docs-hero-total">{data.total.total}</div>
              <div className="docs-hero-label">Total {MESES[mes - 1]} {anio}</div>
            </div>
            <div className="docs-hero-chips">
              <div className="docs-chip"><div className="docs-chip-value">{data.total.boletas}</div><div className="docs-chip-label">Boletas</div></div>
              <div className="docs-chip"><div className="docs-chip-value">{data.total.facturas}</div><div className="docs-chip-label">Facturas</div></div>
              <div className="docs-chip"><div className="docs-chip-value">{data.total.notas_credito}</div><div className="docs-chip-label">N. Crédito</div></div>
              <div className="docs-chip"><div className="docs-chip-value">{data.total.notas_venta}</div><div className="docs-chip-label">N. Venta</div></div>
            </div>
          </div>

          <div className="docs-sedes" style={{ marginTop: 18 }}>
            {data.sedes.map((s) => (
              <div className="docs-sede-row" key={`${s.ruc}-${s.sucursal_id}`}>
                <div className="docs-sede-head">
                  <span className="docs-sede-nombre">{s.razon_social} — {s.sede}</span>
                  <span className="docs-sede-total">{s.total}</span>
                </div>
                <div className="docs-sede-bar-track">
                  <div className="docs-sede-bar-fill" style={{ width: `${Math.round((s.total / maxTotal) * 100)}%` }} />
                </div>
                <div className="docs-sede-detalle">
                  {s.boletas} boletas · {s.facturas} facturas · {s.notas_credito} N. crédito · {s.notas_venta} N. venta
                </div>
              </div>
            ))}
            {data.sedes.length === 0 && <p className="empty-row">Sin sedes activas con documentos en este período.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function AuditoriaSistema({ empresas }) {
  const [ruc, setRuc] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [acciones, setAcciones] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const params = {};
    if (ruc) params.ruc = ruc;
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    api.get('/companies/reportes/acciones', { params }).then((res) => setAcciones(res.data)).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  return (
    <div className="panel">
      <h3>Auditoría de acciones del sistema</h3>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6, marginBottom: 14 }}>
        Qué hiciste desde Panel Central sobre cada empresa: aprobar, rechazar, activar/desactivar, cambios de costo,
        tipo de negocio, sedes libres, solicitudes de sede y reseteos de contraseña.
      </p>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field grow">
          <label>Empresa</label>
          <select value={ruc} onChange={(e) => setRuc(e.target.value)}>
            <option value="">Todas</option>
            {empresas.map((e) => <option key={e.ruc} value={e.ruc}>{e.razon_social} ({e.ruc})</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
        </div>
      </form>

      {loading ? <span className="spinner" /> : (
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Admin</th>
                <th>Acción</th>
                <th>Empresa (RUC)</th>
                <th>Detalle</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {acciones.map((a) => (
                <tr key={a.id}>
                  <td>{formatFechaHora(a.created_at)}</td>
                  <td>{a.admin_nombre || a.admin_email || '—'}</td>
                  <td>{ACCION_LABEL[a.accion] || a.accion}</td>
                  <td>{a.ruc}</td>
                  <td>{a.detalle || '—'}</td>
                  <td>{a.motivo || '—'}</td>
                </tr>
              ))}
              {acciones.length === 0 && (
                <tr><td colSpan={6} className="empty-row">No hay acciones registradas en este rango.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CambiosCodigo() {
  const [data, setData] = useState({ disponible: false, commits: [], mensaje: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/companies/reportes/commits', { params: { limit: 50 } })
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="panel">
      <h3>Cambios en el código</h3>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6, marginBottom: 14 }}>
        Últimos commits del repositorio — qué se modificó en la plataforma desde el código, no desde este panel.
      </p>

      {loading ? (
        <span className="spinner" />
      ) : !data.disponible ? (
        <p className="empty-row">{data.mensaje || 'No disponible.'}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Autor</th>
                <th>Mensaje</th>
                <th>Commit</th>
              </tr>
            </thead>
            <tbody>
              {data.commits.map((c) => (
                <tr key={c.sha}>
                  <td>{formatFechaHora(c.fecha)}</td>
                  <td>{c.autor}</td>
                  <td>{c.mensaje}</td>
                  <td>
                    <a href={c.url} target="_blank" rel="noreferrer">{c.sha}</a>
                  </td>
                </tr>
              ))}
              {data.commits.length === 0 && (
                <tr><td colSpan={4} className="empty-row">Sin commits.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
