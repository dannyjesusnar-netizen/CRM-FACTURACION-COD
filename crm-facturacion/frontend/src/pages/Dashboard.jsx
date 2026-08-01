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

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [ventasPorDia, setVentasPorDia] = useState([]);
  const [ventasPorTipo, setVentasPorTipo] = useState([]);
  const [loading, setLoading] = useState(true);

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
    </div>
  );
}
