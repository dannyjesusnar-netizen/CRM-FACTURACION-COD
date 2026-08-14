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
import api from '../api';
import { useAuth } from '../context/AuthContext';

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

function pctBadge(pct) {
  if (pct === null || pct === undefined) return <span className="badge badge-neutral">—</span>;
  const clase = pct >= 100 ? 'badge-good' : pct >= 70 ? 'badge-warning' : 'badge-critical';
  return <span className={'badge ' + clase}>{Number(pct).toFixed(2)}%</span>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const puedeVerTablero = !!user?.puede_ver_tablero;
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

  if (loading) return (
    <div className="page-loading">
      <span className="spinner" />
      Cargando dashboard...
    </div>
  );

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

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>

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

      {puedeVerTablero && (
        <div className="dashboard-tablero">
          <div className="report-toolbar">
            <h2 className="page-title" style={{ margin: 0, fontSize: 18 }}>Tablero de Ventas</h2>
            <div className="filter-panel" style={{ margin: 0 }}>
              <div className="filter-field">
                <label>Sede</label>
                <select value={tableroSedeId} onChange={(e) => setTableroSedeId(e.target.value)}>
                  <option value="">Todas las sedes</option>
                  {sucursalesTablero.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>
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
            </div>
          </div>

          {tableroLoading ? (
            <div className="page-loading"><span className="spinner" /> Cargando tablero de ventas...</div>
          ) : (
            <>
              <div className="panel">
                <h3>Ranking Trainers</h3>
                <table className="data-table">
                  <thead>
                    <tr><th>Trainer</th><th>Sede</th><th>Turno</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Meta</th><th>%</th></tr>
                  </thead>
                  <tbody>
                    {rankingTrainers.map((r) => (
                      <tr key={r.user_id}>
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
                <h3>Ranking Vendedores</h3>
                <table className="data-table">
                  <thead>
                    <tr><th>Vendedor</th><th>Sede</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Meta</th><th>%</th></tr>
                  </thead>
                  <tbody>
                    {rankingVendedores.map((r) => (
                      <tr key={r.user_id}>
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
                  <h3>Total por Marca</h3>
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
                  <h3>Total por Producto</h3>
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
                  <h3>Resumen Sedes</h3>
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
                  <div className="stat-label">Ventas Totales</div>
                  <div className="stat-value">{money(resumenSedes.ventas_totales)}</div>
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
