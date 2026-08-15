import { useEffect, useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Circle, Triangle, Diamond } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const COLORS = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  ink: '#0b0b0b',
  secondaryInk: '#52514e',
  mutedInk: '#898781',
  grid: '#e1e0d9',
  surface: '#fcfcfb',
};

function money(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Símbolo + color según el % de cumplimiento de meta, igual al criterio de
// Power BI: rombo rojo (<80%), triángulo ámbar (80%–99.99%), círculo verde
// (100% en adelante).
function pctBadge(pct) {
  if (pct === null || pct === undefined) return <span className="badge badge-neutral">—</span>;
  const valor = Number(pct);
  if (valor >= 100) {
    return <span className="pct-symbol pct-good"><Circle size={12} fill="currentColor" strokeWidth={0} />{valor.toFixed(2)}%</span>;
  }
  if (valor >= 80) {
    return <span className="pct-symbol pct-warning"><Triangle size={12} fill="currentColor" strokeWidth={0} />{valor.toFixed(2)}%</span>;
  }
  return <span className="pct-symbol pct-critical"><Diamond size={12} fill="currentColor" strokeWidth={0} />{valor.toFixed(2)}%</span>;
}

// Franja de color centrada en la parte superior de cada panel del Tablero
// de Ventas — el color lo elige Gerencia (empresa.color_tablero_ventas).
function PanelHeader({ children, color }) {
  return (
    <div className="panel-banda" style={{ background: color }}>
      <h3>{children}</h3>
    </div>
  );
}

export default function Dashboard() {
  const { user, empresa, setEmpresa } = useAuth();
  const toast = useToast();
  const puedeVerTablero = !!user?.puede_ver_tablero;
  const colorTablero = empresa?.color_tablero_ventas || '#16a34a';

  async function guardarColorTablero(nuevoColor) {
    if (!empresa) return;
    try {
      const res = await api.put('/empresa', { ...empresa, color_tablero_ventas: nuevoColor });
      setEmpresa(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo guardar el color.');
    }
  }
  // Hoja 1 = Tablero de Ventas (solo Gerencia/Supervisor), Hoja 2 = el
  // resumen general que ya existía. Quien no puede ver el Tablero solo
  // tiene la Hoja 2, sin selector.
  const [hoja, setHoja] = useState(puedeVerTablero ? '1' : '2');
  const [summary, setSummary] = useState(null);
  const [ventasPorDia, setVentasPorDia] = useState([]);
  const [ventasPorTipo, setVentasPorTipo] = useState([]);
  const [loading, setLoading] = useState(true);

  const hoy = new Date();
  const [tableroAnio, setTableroAnio] = useState(hoy.getFullYear());
  const [tableroMes, setTableroMes] = useState(hoy.getMonth() + 1);
  const [tableroSedeId, setTableroSedeId] = useState('');
  const [sucursalesTablero, setSucursalesTablero] = useState([]);
  const [rankingTrainers, setRankingTrainers] = useState([]);
  const [rankingVendedores, setRankingVendedores] = useState([]);
  const [totalMarca, setTotalMarca] = useState([]);
  const [totalProducto, setTotalProducto] = useState([]);
  const [resumenSedes, setResumenSedes] = useState({ sedes: [], total: null, ventas_totales: 0 });
  const [tableroLoading, setTableroLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/reports/summary'),
      api.get('/reports/ventas-por-dia'),
      api.get('/reports/ventas-por-tipo'),
    ]).then(([s, d, t]) => {
      setSummary(s.data);
      setVentasPorDia(d.data);
      setVentasPorTipo(t.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!puedeVerTablero) return;
    api.get('/sucursales').then((res) => setSucursalesTablero(res.data));
  }, [puedeVerTablero]);

  useEffect(() => {
    if (!puedeVerTablero) return;
    setTableroLoading(true);
    const params = { anio: tableroAnio, mes: tableroMes, sucursal_id: tableroSedeId || undefined };
    Promise.all([
      api.get('/tablero/ranking-personal', { params: { ...params, categoria: 'trainer' } }),
      api.get('/tablero/ranking-personal', { params: { ...params, categoria: 'vendedor' } }),
      api.get('/tablero/total-por-marca', { params }),
      api.get('/tablero/total-por-producto', { params }),
      api.get('/tablero/resumen-sedes', { params }),
    ]).then(([trainers, vendedores, marca, producto, sedes]) => {
      setRankingTrainers(trainers.data);
      setRankingVendedores(vendedores.data);
      setTotalMarca(marca.data);
      setTotalProducto(producto.data);
      setResumenSedes(sedes.data);
    }).finally(() => setTableroLoading(false));
  }, [puedeVerTablero, tableroAnio, tableroMes, tableroSedeId]);

  const lineData = {
    labels: ventasPorDia.map((r) => r.dia.slice(5)),
    datasets: [
      {
        label: 'Ventas (S/)',
        data: ventasPorDia.map((r) => r.total),
        borderColor: COLORS.blue,
        backgroundColor: 'rgba(42,120,214,0.12)',
        pointRadius: 3,
        pointBackgroundColor: COLORS.blue,
        borderWidth: 2,
        fill: true,
        tension: 0.25,
      },
    ],
  };

  const tipoLabelMap = { factura: 'Facturas', boleta: 'Boletas', nota_credito: 'Notas de crédito' };
  const tipoColorMap = { factura: COLORS.blue, boleta: COLORS.orange, nota_credito: COLORS.aqua };
  const barData = {
    labels: ventasPorTipo.map((r) => tipoLabelMap[r.tipo_comprobante] || r.tipo_comprobante),
    datasets: [
      {
        label: 'Total vendido',
        data: ventasPorTipo.map((r) => r.total),
        backgroundColor: ventasPorTipo.map((r) => tipoColorMap[r.tipo_comprobante] || COLORS.blue),
        borderRadius: 4,
        maxBarThickness: 60,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fff',
        titleColor: COLORS.ink,
        bodyColor: COLORS.secondaryInk,
        borderColor: COLORS.grid,
        borderWidth: 1,
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: COLORS.mutedInk } },
      y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.mutedInk } },
    },
  };

  const hojaGeneral = (
    loading ? (
      <div className="page-loading">
        <span className="spinner" />
        Cargando dashboard...
      </div>
    ) : (
      <>
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Ventas de hoy</div>
            <div className="stat-value">{money(summary.ventasHoy.total)}</div>
            <div className="stat-sub">{summary.ventasHoy.cantidad} comprobante(s)</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ventas del mes</div>
            <div className="stat-value">{money(summary.ventasMes.total)}</div>
            <div className="stat-sub">{summary.ventasMes.cantidad} comprobante(s)</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Clientes registrados</div>
            <div className="stat-value">{summary.totalClientes}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Productos activos</div>
            <div className="stat-value">{summary.totalProductos}</div>
          </div>
        </div>

        <div className="chart-grid">
          <div className="panel">
            <h3>Ventas últimos 30 días</h3>
            <Line data={lineData} options={chartOptions} height={220} />
          </div>
          <div className="panel">
            <h3>Ventas por tipo de comprobante</h3>
            <Bar data={barData} options={chartOptions} height={220} />
          </div>
        </div>

        <div className="panel">
          <h3>Últimas ventas</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.ultimasVentas.map((v) => (
                <tr key={v.id}>
                  <td>{v.serie}-{String(v.numero).padStart(6, '0')}</td>
                  <td>{v.cliente_nombre}</td>
                  <td>{v.fecha_emision}</td>
                  <td>
                    <span className={'badge ' + (v.estado === 'anulado' ? 'badge-critical' : 'badge-good')}>
                      {v.estado}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  );

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>

      {puedeVerTablero && (
        <div className="dashboard-hojas">
          <button type="button" className={'dashboard-hoja-btn' + (hoja === '1' ? ' active' : '')} onClick={() => setHoja('1')}>
            Hoja 1 · Tablero de Ventas
          </button>
          <button type="button" className={'dashboard-hoja-btn' + (hoja === '2' ? ' active' : '')} onClick={() => setHoja('2')}>
            Hoja 2 · Resumen general
          </button>
        </div>
      )}

      {(!puedeVerTablero || hoja === '2') && hojaGeneral}

      {puedeVerTablero && hoja === '1' && (
        <div className="dashboard-tablero">
          <div className="report-toolbar">
            <h2 className="page-title" style={{ margin: 0, fontSize: 18 }}>Tablero de Ventas</h2>
            <div className="filter-panel" style={{ margin: 0 }}>
              {user?.role === 'gerencia' && (
                <div className="filter-field">
                  <label>Sede</label>
                  <select value={tableroSedeId} onChange={(e) => setTableroSedeId(e.target.value)}>
                    <option value="">Todas las sedes</option>
                    {sucursalesTablero.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="filter-field">
                <label>Año</label>
                <input type="number" value={tableroAnio} onChange={(e) => setTableroAnio(Number(e.target.value))} style={{ width: 100 }} />
              </div>
              <div className="filter-field">
                <label>Mes</label>
                <select value={tableroMes} onChange={(e) => setTableroMes(Number(e.target.value))}>
                  {MESES.map((nombre, idx) => (
                    <option key={idx} value={idx + 1}>{nombre}</option>
                  ))}
                </select>
              </div>
              {user?.role === 'gerencia' && (
                <div className="filter-field">
                  <label>Color del tablero</label>
                  <input
                    type="color"
                    value={colorTablero}
                    onChange={(e) => guardarColorTablero(e.target.value)}
                    className="color-picker-btn"
                    title="Cambiar el color de la franja superior de cada panel"
                  />
                </div>
              )}
            </div>
          </div>

          {tableroLoading ? (
            <div className="page-loading"><span className="spinner" /> Cargando tablero de ventas...</div>
          ) : (
            <>
              <div className="panel">
                <PanelHeader color={colorTablero}>Ranking Trainers</PanelHeader>
                <table className="data-table">
                  <thead>
                    <tr><th>Trainer</th><th>Sede</th><th>Turno</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Meta</th><th>%</th></tr>
                  </thead>
                  <tbody>
                    {rankingTrainers.map((r) => (
                      <tr key={r.user_id} style={r.faltante ? { color: 'var(--ink-muted)', fontStyle: 'italic' } : undefined}>
                        <td>{r.nombre}</td>
                        <td>{r.sede || '—'}</td>
                        <td>{r.turno === 'manana' ? 'Mañana' : r.turno === 'tarde' ? 'Tarde' : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.venta)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.meta)}</td>
                        <td>{pctBadge(r.porcentaje)}</td>
                      </tr>
                    ))}
                    {rankingTrainers.length === 0 && (
                      <tr><td colSpan={6} className="empty-row">No hay trainers con ventas en el período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="panel">
                <PanelHeader color={colorTablero}>Ranking Vendedores</PanelHeader>
                <table className="data-table">
                  <thead>
                    <tr><th>Vendedor</th><th>Sede</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Meta</th><th>%</th></tr>
                  </thead>
                  <tbody>
                    {rankingVendedores.map((r) => (
                      <tr key={r.user_id} style={r.faltante ? { color: 'var(--ink-muted)', fontStyle: 'italic' } : undefined}>
                        <td>{r.nombre}</td>
                        <td>{r.sede || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.venta)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.meta)}</td>
                        <td>{pctBadge(r.porcentaje)}</td>
                      </tr>
                    ))}
                    {rankingVendedores.length === 0 && (
                      <tr><td colSpan={5} className="empty-row">No hay vendedores con ventas en el período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="chart-grid">
                <div className="panel">
                  <PanelHeader color={colorTablero}>Total por Marca</PanelHeader>
                  <table className="data-table">
                    <thead>
                      <tr><th>Marca</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>% Venta</th></tr>
                    </thead>
                    <tbody>
                      {totalMarca.map((m) => (
                        <tr key={m.marca}>
                          <td>{m.marca}</td>
                          <td style={{ textAlign: 'right' }}>{m.cantidad}</td>
                          <td style={{ textAlign: 'right' }}>{money(m.venta)}</td>
                          <td style={{ textAlign: 'right' }}>{m.porcentaje.toFixed(2)}%</td>
                        </tr>
                      ))}
                      {totalMarca.length === 0 && (
                        <tr><td colSpan={4} className="empty-row">Sin ventas en el período.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="panel">
                  <PanelHeader color={colorTablero}>Total por Producto</PanelHeader>
                  <table className="data-table">
                    <thead>
                      <tr><th>Categoría</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>% Venta</th></tr>
                    </thead>
                    <tbody>
                      {totalProducto.map((p) => (
                        <tr key={p.categoria}>
                          <td>{p.categoria}</td>
                          <td style={{ textAlign: 'right' }}>{p.cantidad}</td>
                          <td style={{ textAlign: 'right' }}>{money(p.venta)}</td>
                          <td style={{ textAlign: 'right' }}>{p.porcentaje.toFixed(2)}%</td>
                        </tr>
                      ))}
                      {totalProducto.length === 0 && (
                        <tr><td colSpan={4} className="empty-row">Sin ventas en el período.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="chart-grid">
                <div className="panel">
                  <PanelHeader color={colorTablero}>Resumen Sedes</PanelHeader>
                  <table className="data-table">
                    <thead>
                      <tr><th>Sede</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Meta</th><th>% Meta</th></tr>
                    </thead>
                    <tbody>
                      {resumenSedes.sedes.map((s) => (
                        <tr key={s.sucursal_id}>
                          <td>{s.sede}</td>
                          <td style={{ textAlign: 'right' }}>{money(s.venta)}</td>
                          <td style={{ textAlign: 'right' }}>{money(s.meta)}</td>
                          <td>{pctBadge(s.porcentaje)}</td>
                        </tr>
                      ))}
                      {resumenSedes.sedes.length === 0 && (
                        <tr><td colSpan={4} className="empty-row">Sin sedes activas.</td></tr>
                      )}
                    </tbody>
                    {resumenSedes.total && (
                      <tfoot>
                        <tr className="totals-footer">
                          <td>Total</td>
                          <td style={{ textAlign: 'right' }}>{money(resumenSedes.total.venta)}</td>
                          <td style={{ textAlign: 'right' }}>{money(resumenSedes.total.meta)}</td>
                          <td>{pctBadge(resumenSedes.total.porcentaje)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <div className="stat-card" style={{ alignSelf: 'start' }}>
                  <div className="stat-card-banda" style={{ background: colorTablero }}>Ventas Totales</div>
                  <div className="stat-value" style={{ textAlign: 'center' }}>{money(resumenSedes.ventas_totales)}</div>
                  <div className="stat-sub">
                    {MESES[tableroMes - 1]} {tableroAnio} — {tableroSedeId
                      ? (sucursalesTablero.find((s) => String(s.id) === String(tableroSedeId))?.nombre || 'sede seleccionada')
                      : 'todas las sedes'}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
