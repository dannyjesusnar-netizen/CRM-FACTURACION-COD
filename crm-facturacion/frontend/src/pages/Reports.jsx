import { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Download, ShoppingCart, Landmark } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const COLORS = { blue: '#2a78d6', grid: '#e1e0d9', mutedInk: '#898781' };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

function money(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const toast = useToast();
  const [topClientes, setTopClientes] = useState([]);
  const [ventasPorTipo, setVentasPorTipo] = useState([]);

  const [mensualAnio, setMensualAnio] = useState(CURRENT_YEAR);
  const [ventasMensuales, setVentasMensuales] = useState([]);

  const [vendedorMes, setVendedorMes] = useState('');
  const [vendedorAnio, setVendedorAnio] = useState(CURRENT_YEAR);
  const [ventasPorVendedor, setVentasPorVendedor] = useState([]);

  const [prodMes, setProdMes] = useState('');
  const [prodAnio, setProdAnio] = useState(CURRENT_YEAR);
  const [productos, setProductos] = useState([]);
  const [mostrarTodo, setMostrarTodo] = useState(false);

  const [tributarioAnio, setTributarioAnio] = useState(CURRENT_YEAR);
  const [tributario, setTributario] = useState([]);

  useEffect(() => {
    api.get('/reports/top-clientes').then((res) => setTopClientes(res.data));
    api.get('/reports/ventas-por-tipo').then((res) => setVentasPorTipo(res.data));
  }, []);

  useEffect(() => {
    api.get('/reports/ventas-mensuales', { params: { year: mensualAnio } }).then((res) => setVentasMensuales(res.data));
  }, [mensualAnio]);

  useEffect(() => {
    const params = { year: vendedorAnio };
    if (vendedorMes) params.month = vendedorMes;
    api.get('/reports/ventas-por-vendedor', { params }).then((res) => setVentasPorVendedor(res.data));
  }, [vendedorMes, vendedorAnio]);

  useEffect(() => {
    const params = { year: prodAnio };
    if (prodMes) params.month = prodMes;
    api.get('/reports/productos-mas-vendidos', { params }).then((res) => setProductos(res.data));
  }, [prodMes, prodAnio]);

  useEffect(() => {
    api.get('/reports/informe-tributario', { params: { year: tributarioAnio } }).then((res) => setTributario(res.data));
  }, [tributarioAnio]);

  const barDataClientes = {
    labels: topClientes.map((c) => c.nombre),
    datasets: [{ label: 'Total comprado (S/)', data: topClientes.map((c) => c.total_comprado), backgroundColor: COLORS.blue, borderRadius: 4, maxBarThickness: 40 }],
  };
  const barOptionsH = {
    indexAxis: 'y', responsive: true, plugins: { legend: { display: false } },
    scales: { x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.mutedInk } }, y: { grid: { display: false }, ticks: { color: COLORS.mutedInk } } },
  };

  const barDataMensual = {
    labels: ventasMensuales.map((r) => r.mes.slice(0, 3)),
    datasets: [{ label: 'Ventas (S/)', data: ventasMensuales.map((r) => r.total), backgroundColor: COLORS.blue, borderRadius: 4, maxBarThickness: 34 }],
  };
  const barOptionsV = {
    responsive: true, plugins: { legend: { display: false } },
    scales: { x: { grid: { display: false }, ticks: { color: COLORS.mutedInk } }, y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.mutedInk } } },
  };

  const totalGeneral = ventasPorTipo.reduce((s, r) => s + r.total, 0);
  const productosVisibles = mostrarTodo ? productos : productos.slice(0, 5);
  const totalProductosMonto = productos.reduce((s, p) => s + p.total_vendido, 0);

  function exportTributario() {
    downloadCsv(
      `informe_tributario_${tributarioAnio}.csv`,
      ['Periodo', 'Ventas Netas', 'IGV Ventas'],
      tributario.map((r) => [r.periodo, r.ventas_netas.toFixed(2), r.igv_ventas.toFixed(2)])
    );
    toast.success('Informe tributario exportado.');
  }

  return (
    <div>
      <h1 className="page-title">Reportes</h1>

      <div className="panel">
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>Ventas mensuales</h3>
          <div className="filter-field">
            <label>Año</label>
            <select value={mensualAnio} onChange={(e) => setMensualAnio(e.target.value)}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <Bar data={barDataMensual} options={barOptionsV} height={90} />
      </div>

      <div className="panel">
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>Ventas por vendedor</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="filter-field">
              <label>Mes</label>
              <select value={vendedorMes} onChange={(e) => setVendedorMes(e.target.value)}>
                <option value="">Todos</option>
                {MESES.map((m, idx) => <option key={m} value={String(idx + 1).padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Año</label>
              <select value={vendedorAnio} onChange={(e) => setVendedorAnio(e.target.value)}>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Comprobantes</th><th style={{ textAlign: 'right' }}>Total vendido</th></tr>
          </thead>
          <tbody>
            {ventasPorVendedor.map((v) => (
              <tr key={v.id || 'sin-asignar'}>
                <td>{v.vendedor}</td>
                <td style={{ textAlign: 'right' }}>{v.cantidad}</td>
                <td style={{ textAlign: 'right' }}>{money(v.total)}</td>
              </tr>
            ))}
            {ventasPorVendedor.length === 0 && <tr><td colSpan={3} className="empty-row">Sin ventas en el periodo seleccionado.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>Productos más vendidos</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="filter-field">
              <label>Mes</label>
              <select value={prodMes} onChange={(e) => setProdMes(e.target.value)}>
                <option value="">Todos</option>
                {MESES.map((m, idx) => <option key={m} value={String(idx + 1).padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label>Año</label>
              <select value={prodAnio} onChange={(e) => setProdAnio(e.target.value)}>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>N°</th><th>Producto</th><th>Unidad de medida</th>
              <th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Monto S/</th>
            </tr>
          </thead>
          <tbody>
            {productosVisibles.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{p.nombre || 'Item manual'}</td>
                <td>{p.unidad}</td>
                <td style={{ textAlign: 'right' }}>{p.cantidad_vendida}</td>
                <td style={{ textAlign: 'right' }}>{money(p.total_vendido)}</td>
              </tr>
            ))}
            {productos.length === 0 && <tr><td colSpan={5} className="empty-row">Sin datos para el periodo seleccionado.</td></tr>}
          </tbody>
          {productos.length > 0 && (
            <tfoot>
              <tr className="totals-footer"><td colSpan={4}>TOTALES</td><td style={{ textAlign: 'right' }}>{money(totalProductosMonto)}</td></tr>
            </tfoot>
          )}
        </table>
        {productos.length > 5 && (
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setMostrarTodo((v) => !v)}>
            {mostrarTodo ? 'Ocultar lista' : 'Mostrar todo'}
          </button>
        )}
      </div>

      <div className="panel">
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>Informe tributario</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div className="filter-field">
              <label>Año</label>
              <select value={tributarioAnio} onChange={(e) => setTributarioAnio(e.target.value)}>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button className="btn-export" onClick={exportTributario}>
              <Download size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />Exportar
            </button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>Periodo</th><th style={{ textAlign: 'right' }}>Ventas netas</th><th style={{ textAlign: 'right' }}>IGV ventas</th></tr>
          </thead>
          <tbody>
            {tributario.map((r) => (
              <tr key={r.periodo}>
                <td>{r.periodo}</td>
                <td style={{ textAlign: 'right' }}>{money(r.ventas_netas)}</td>
                <td style={{ textAlign: 'right' }}>{money(r.igv_ventas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Top clientes por monto comprado</h3>
        {topClientes.length > 0 ? (
          <Bar data={barDataClientes} options={barOptionsH} height={Math.max(120, topClientes.length * 40)} />
        ) : (
          <p className="empty-row">Aún no hay ventas registradas.</p>
        )}
      </div>

      <div className="panel">
        <h3>Resumen por tipo de comprobante</h3>
        <table className="data-table">
          <thead>
            <tr><th>Tipo</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>% del total</th></tr>
          </thead>
          <tbody>
            {ventasPorTipo.map((r) => (
              <tr key={r.tipo_comprobante}>
                <td>{r.tipo_comprobante}</td>
                <td style={{ textAlign: 'right' }}>{r.cantidad}</td>
                <td style={{ textAlign: 'right' }}>{money(r.total)}</td>
                <td style={{ textAlign: 'right' }}>{totalGeneral ? ((r.total / totalGeneral) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel disabled-panel">
        <h3>Compras y Cuentas (Caja y bancos)</h3>
        <p className="empty-row" style={{ padding: '4px 0 8px' }}>
          <ShoppingCart size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          Los reportes de Compras y
          <Landmark size={15} style={{ verticalAlign: 'text-bottom', margin: '0 6px 0 8px' }} />
          Cuentas (Caja y bancos) estarán disponibles cuando se implementen esos módulos.
        </p>
      </div>
    </div>
  );
}
