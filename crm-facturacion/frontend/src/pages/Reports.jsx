import { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import {
  ShoppingCart, Calculator, User, TrendingUp, Package, BarChart3, Users, Wallet, FileText,
} from 'lucide-react';
import api from '../api';
import { hoyPeru } from '../utils/fechas';
import { useToast } from '../context/ToastContext';
import ExportButton from '../components/ExportButton';
import { exportarTabla } from '../utils/excelImport';
import ProductSearchBar from '../components/ProductSearchBar';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const COLORS = { blue: '#2a78d6', good: '#0ca30c', critical: '#d03b3b', grid: '#e1e0d9', mutedInk: '#898781' };
const KARDEX_TIPO_LABEL = {
  venta: 'Venta', anulacion: 'Anulación', ajuste: 'Ajuste manual',
  ingreso_lote: 'Ingreso de lote', salida_lote: 'Salida de lote',
  compra: 'Compra', anulacion_compra: 'Anulación de compra',
  nota_credito_devolucion: 'Devolución (Nota de crédito)',
  produccion_consumo: 'Consumo (Producción)', produccion_ingreso: 'Ingreso (Producción)',
};
const KARDEX_TIPO_BADGE = {
  venta: 'badge-critical', anulacion: 'badge-good', ajuste: 'badge-neutral',
  ingreso_lote: 'badge-good', salida_lote: 'badge-critical',
  compra: 'badge-good', anulacion_compra: 'badge-critical',
  nota_credito_devolucion: 'badge-good',
  produccion_consumo: 'badge-critical', produccion_ingreso: 'badge-good',
};
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const SECCIONES = [
  { key: 'ventas_mes', label: 'Ventas por mes', Icon: ShoppingCart },
  { key: 'tributario', label: 'Informe Tributario', Icon: Calculator },
  { key: 'vendedor', label: 'Ventas por vendedor', Icon: User },
  { key: 'producto', label: 'Ventas por producto', Icon: ShoppingCart },
  { key: 'detalle_producto', label: 'Detalle de ventas por producto', Icon: FileText },
  { key: 'inventarios', label: 'Evolución inventarios', Icon: TrendingUp },
  { key: 'kardex', label: 'Kardex', Icon: FileText },
  { key: 'compras_mes', label: 'Compras por mes', Icon: Package },
  { key: 'ingreso_gastos', label: 'Ingreso vs gastos', Icon: BarChart3 },
  { key: 'top_clientes', label: 'Top clientes', Icon: Users },
  { key: 'resumen_comprobante', label: 'Resumen por comprobante', Icon: BarChart3 },
  { key: 'cierre_caja', label: 'Cierre de Caja', Icon: Wallet },
];

function todayStr() {
  return hoyPeru();
}

function money(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

function SucursalYAnio({ anio, setAnio, extra }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
      <div className="filter-field">
        <label>Año</label>
        <select value={anio} onChange={(e) => setAnio(e.target.value)}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {extra}
    </div>
  );
}

export default function Reports() {
  const toast = useToast();
  const [seccion, setSeccion] = useState('ventas_mes');

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

  const [comprasMesAnio, setComprasMesAnio] = useState(CURRENT_YEAR);
  const [comprasPorMes, setComprasPorMes] = useState([]);

  const [ingresoGastosAnio, setIngresoGastosAnio] = useState(CURRENT_YEAR);
  const [ingresoVsGastos, setIngresoVsGastos] = useState([]);

  const [inventariosAnio, setInventariosAnio] = useState(CURRENT_YEAR);
  const [evolucionInventarios, setEvolucionInventarios] = useState([]);

  const [kardexProducto, setKardexProducto] = useState(null);
  const [kardexDesde, setKardexDesde] = useState('');
  const [kardexHasta, setKardexHasta] = useState(todayStr());
  const [kardexData, setKardexData] = useState(null);
  const [kardexLoading, setKardexLoading] = useState(false);

  const [detalleProdProducto, setDetalleProdProducto] = useState(null);
  const [detalleProdDesde, setDetalleProdDesde] = useState('');
  const [detalleProdHasta, setDetalleProdHasta] = useState(todayStr());
  const [detalleProdData, setDetalleProdData] = useState([]);
  const [detalleProdLoading, setDetalleProdLoading] = useState(false);

  const [cierreFecha, setCierreFecha] = useState(todayStr());
  const [cierreEmpleadoId, setCierreEmpleadoId] = useState('');
  const [cierreEmpleados, setCierreEmpleados] = useState([]);
  const [cierreCaja, setCierreCaja] = useState(null);

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

  useEffect(() => {
    api.get('/reports/compras-por-mes', { params: { year: comprasMesAnio } }).then((res) => setComprasPorMes(res.data));
  }, [comprasMesAnio]);

  useEffect(() => {
    api.get('/reports/ingreso-vs-gastos', { params: { year: ingresoGastosAnio } }).then((res) => setIngresoVsGastos(res.data));
  }, [ingresoGastosAnio]);

  useEffect(() => {
    api.get('/reports/evolucion-inventarios', { params: { year: inventariosAnio } }).then((res) => setEvolucionInventarios(res.data));
  }, [inventariosAnio]);

  useEffect(() => {
    // Sin permiso de Caja no se puede pedir la lista de empleados — el
    // selector queda solo con "Todos los empleados", el reporte igual funciona.
    api.get('/caja/empleados').then((res) => setCierreEmpleados(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const params = { fecha: cierreFecha };
    if (cierreEmpleadoId) params.empleado_id = cierreEmpleadoId;
    api.get('/reports/cierre-caja', { params }).then((res) => setCierreCaja(res.data)).catch(() => setCierreCaja(null));
  }, [cierreFecha, cierreEmpleadoId]);

  useEffect(() => {
    if (!kardexProducto) { setKardexData(null); return; }
    setKardexLoading(true);
    const params = { product_id: kardexProducto.id };
    if (kardexDesde) params.from = kardexDesde;
    if (kardexHasta) params.to = kardexHasta;
    api.get('/reports/kardex', { params })
      .then((res) => setKardexData(res.data))
      .catch(() => { setKardexData(null); toast.error('No se pudo cargar el kardex.'); })
      .finally(() => setKardexLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kardexProducto, kardexDesde, kardexHasta]);

  useEffect(() => {
    if (!detalleProdProducto) { setDetalleProdData([]); return; }
    setDetalleProdLoading(true);
    const params = { product_id: detalleProdProducto.id };
    if (detalleProdDesde) params.desde = detalleProdDesde;
    if (detalleProdHasta) params.hasta = detalleProdHasta;
    api.get('/reports/ventas-detalle', { params })
      .then((res) => setDetalleProdData(res.data))
      .catch(() => { setDetalleProdData([]); toast.error('No se pudo cargar el detalle de ventas.'); })
      .finally(() => setDetalleProdLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalleProdProducto, detalleProdDesde, detalleProdHasta]);

  const barOptionsV = {
    responsive: true, plugins: { legend: { display: false } },
    scales: { x: { grid: { display: false }, ticks: { color: COLORS.mutedInk } }, y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.mutedInk } } },
  };
  const barOptionsLegend = {
    responsive: true, plugins: { legend: { display: true, position: 'top' } },
    scales: { x: { grid: { display: false }, ticks: { color: COLORS.mutedInk } }, y: { grid: { color: COLORS.grid }, ticks: { color: COLORS.mutedInk } } },
  };
  const barOptionsH = {
    indexAxis: 'y', responsive: true, plugins: { legend: { display: false } },
    scales: { x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.mutedInk } }, y: { grid: { display: false }, ticks: { color: COLORS.mutedInk } } },
  };

  const barDataMensual = {
    labels: ventasMensuales.map((r) => r.mes.slice(0, 3)),
    datasets: [{ label: 'Ventas (S/)', data: ventasMensuales.map((r) => r.total), backgroundColor: COLORS.blue, borderRadius: 4, maxBarThickness: 34 }],
  };
  const barDataCompras = {
    labels: comprasPorMes.map((r) => r.mes.slice(0, 3)),
    datasets: [{ label: 'Compras (S/)', data: comprasPorMes.map((r) => r.total), backgroundColor: COLORS.critical, borderRadius: 4, maxBarThickness: 34 }],
  };
  const barDataIngresoGastos = {
    labels: ingresoVsGastos.map((r) => r.mes.slice(0, 3)),
    datasets: [
      { label: 'Ingresos', data: ingresoVsGastos.map((r) => r.ingresos), backgroundColor: COLORS.good, borderRadius: 4, maxBarThickness: 22 },
      { label: 'Gastos', data: ingresoVsGastos.map((r) => r.gastos), backgroundColor: COLORS.critical, borderRadius: 4, maxBarThickness: 22 },
    ],
  };
  const barDataInventarios = {
    labels: evolucionInventarios.map((r) => r.mes.slice(0, 3)),
    datasets: [
      { label: 'Ingresos', data: evolucionInventarios.map((r) => r.ingresos), backgroundColor: COLORS.good, borderRadius: 4, maxBarThickness: 22 },
      { label: 'Salidas', data: evolucionInventarios.map((r) => r.salidas), backgroundColor: COLORS.critical, borderRadius: 4, maxBarThickness: 22 },
    ],
  };
  const barDataClientes = {
    labels: topClientes.map((c) => c.nombre),
    datasets: [{ label: 'Total comprado (S/)', data: topClientes.map((c) => c.total_comprado), backgroundColor: COLORS.blue, borderRadius: 4, maxBarThickness: 40 }],
  };

  const totalGeneral = ventasPorTipo.reduce((s, r) => s + r.total, 0);
  const productosVisibles = mostrarTodo ? productos : productos.slice(0, 5);
  const totalProductosSoles = productos.reduce((s, p) => s + p.monto_soles, 0);
  const totalProductosDolares = productos.reduce((s, p) => s + p.monto_dolares, 0);
  const detalleProdVigentes = detalleProdData.filter((r) => r.estado !== 'anulado');
  const totalDetalleProdCantidad = detalleProdVigentes.reduce((s, r) => s + r.cantidad, 0);
  const totalDetalleProdSubtotal = detalleProdVigentes.reduce((s, r) => s + r.subtotal_item, 0);

  async function exportKardex(formato) {
    if (!kardexData) return;
    const header = ['Fecha', 'Tipo', 'Documento', 'Entrada', 'Salida', 'Saldo', 'Motivo', 'Usuario'];
    const rows = kardexData.movimientos.map((m) => [
      m.created_at, KARDEX_TIPO_LABEL[m.tipo] || m.tipo, m.referencia || '',
      m.cantidad > 0 ? m.cantidad : '', m.cantidad < 0 ? Math.abs(m.cantidad) : '',
      m.stock_resultante, m.motivo || '', m.usuario_nombre || '',
    ]);
    await exportarTabla(`kardex_${kardexData.producto.codigo}`, header, rows, formato);
    toast.success(`Archivo ${formato === 'excel' ? 'Excel' : 'CSV'} exportado.`);
  }

  async function exportDetalleProducto(formato) {
    if (!detalleProdProducto) return;
    const header = ['Fecha', 'Sede', 'Tipo', 'Serie', 'Número', 'Cliente', 'Cantidad', 'Precio Unit.', '% Descuento', 'Subtotal', 'Vendedor', 'Atribuido a', 'Estado'];
    const rows = detalleProdData.map((r) => [
      r.fecha_emision, r.sede, r.tipo, r.serie, r.numero, r.cliente_nombre,
      r.cantidad, r.precio_unitario, r.descuento_pct, r.subtotal_item,
      r.vendedor_nombre || '', r.atribuido_nombre || '', r.estado === 'anulado' ? 'Anulado' : 'Emitido',
    ]);
    await exportarTabla(`ventas_${detalleProdProducto.codigo}`, header, rows, formato);
    toast.success(`Archivo ${formato === 'excel' ? 'Excel' : 'CSV'} exportado.`);
  }

  async function exportTributario(formato) {
    await exportarTabla(
      `informe_tributario_${tributarioAnio}`,
      ['Periodo', 'Ventas Netas', 'ISC Ventas', 'Recargos', 'ICBPER Ventas', 'Compras Netas', 'IGV Ventas', 'IGV Compras', 'IGV Mes', 'Saldo IGV', 'Renta', 'Percepción Compras', 'Utilidad Contable'],
      tributario.map((r) => [
        r.periodo, r.ventas_netas.toFixed(2), r.isc_ventas.toFixed(2), r.recargos.toFixed(2), r.icbper_ventas.toFixed(2),
        r.compras_netas.toFixed(2), r.igv_ventas.toFixed(2), r.igv_compras.toFixed(2), r.igv_mes.toFixed(2),
        r.saldo_igv.toFixed(2), r.renta.toFixed(2), r.percepcion_compras.toFixed(2), r.utilidad_contable.toFixed(2),
      ]),
      formato
    );
    toast.success('Informe tributario exportado.');
  }

  const tribTotales = tributario.reduce((acc, r) => {
    acc.ventas_netas += r.ventas_netas; acc.compras_netas += r.compras_netas;
    acc.igv_ventas += r.igv_ventas; acc.igv_compras += r.igv_compras;
    acc.renta += r.renta; acc.utilidad_contable += r.utilidad_contable;
    return acc;
  }, { ventas_netas: 0, compras_netas: 0, igv_ventas: 0, igv_compras: 0, renta: 0, utilidad_contable: 0 });

  return (
    <div>
      <h1 className="page-title">Reportes</h1>

      <div className="reports-shell">
        <div className="reports-sidebar">
          {SECCIONES.map((s) => (
            <div
              key={s.key}
              className={'reports-sidebar-item' + (seccion === s.key ? ' active' : '')}
              onClick={() => setSeccion(s.key)}
              role="button"
              tabIndex={0}
            >
              <s.Icon size={16} />
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="reports-content">
          {seccion === 'ventas_mes' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Ventas mensuales</h3>
                <SucursalYAnio anio={mensualAnio} setAnio={setMensualAnio} />
              </div>
              <Bar data={barDataMensual} options={barOptionsV} height={90} />
            </>
          )}

          {seccion === 'tributario' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Informe tributario</h3>
                <SucursalYAnio
                  anio={tributarioAnio}
                  setAnio={setTributarioAnio}
                  extra={<ExportButton onExport={exportTributario} />}
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                ISC / Recargos / ICBPER / Percepción no se registran en este sistema (se muestran en 0). Renta es una
                estimación simplificada (1.5% de ventas netas) — el sistema opera en modo simulado, sin validez tributaria real.
              </p>
              <div className="table-scroll">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Periodo</th><th style={{ textAlign: 'right' }}>Ventas netas</th>
                      <th style={{ textAlign: 'right' }}>ISC</th><th style={{ textAlign: 'right' }}>Recargos</th>
                      <th style={{ textAlign: 'right' }}>ICBPER</th><th style={{ textAlign: 'right' }}>Compras netas</th>
                      <th style={{ textAlign: 'right' }}>IGV ventas</th><th style={{ textAlign: 'right' }}>IGV compras</th>
                      <th style={{ textAlign: 'right' }}>IGV mes</th><th style={{ textAlign: 'right' }}>Saldo IGV</th>
                      <th style={{ textAlign: 'right' }}>Renta</th><th style={{ textAlign: 'right' }}>Percep. compras</th>
                      <th style={{ textAlign: 'right' }}>Utilidad contable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tributario.map((r) => (
                      <tr key={r.periodo}>
                        <td>{r.periodo}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.ventas_netas)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.isc_ventas)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.recargos)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.icbper_ventas)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.compras_netas)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.igv_ventas)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.igv_compras)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.igv_mes)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.saldo_igv)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.renta)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.percepcion_compras)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.utilidad_contable)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="totals-footer">
                      <td>Totales</td>
                      <td style={{ textAlign: 'right' }}>{money(tribTotales.ventas_netas)}</td>
                      <td colSpan={3}></td>
                      <td style={{ textAlign: 'right' }}>{money(tribTotales.compras_netas)}</td>
                      <td style={{ textAlign: 'right' }}>{money(tribTotales.igv_ventas)}</td>
                      <td style={{ textAlign: 'right' }}>{money(tribTotales.igv_compras)}</td>
                      <td colSpan={2}></td>
                      <td style={{ textAlign: 'right' }}>{money(tribTotales.renta)}</td>
                      <td></td>
                      <td style={{ textAlign: 'right' }}>{money(tribTotales.utilidad_contable)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {seccion === 'vendedor' && (
            <>
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
                  <tr>
                    <th>Vendedor</th><th style={{ textAlign: 'right' }}>Cantidad</th>
                    <th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Ventas sin IGV</th>
                    <th style={{ textAlign: 'right' }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {ventasPorVendedor.map((v) => (
                    <tr key={v.id || 'sin-asignar'}>
                      <td>{v.vendedor}</td>
                      <td style={{ textAlign: 'right' }}>{v.cantidad}</td>
                      <td style={{ textAlign: 'right' }}>{money(v.total)}</td>
                      <td style={{ textAlign: 'right' }}>{money(v.ventas_sin_igv)}</td>
                      <td style={{ textAlign: 'right' }}>{v.porcentaje.toFixed(2)}%</td>
                    </tr>
                  ))}
                  {ventasPorVendedor.length === 0 && <tr><td colSpan={5} className="empty-row">Sin ventas en el periodo seleccionado.</td></tr>}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'producto' && (
            <>
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
                    <th style={{ textAlign: 'right' }}>Cantidad</th>
                    <th style={{ textAlign: 'right' }}>Monto Soles</th>
                    <th style={{ textAlign: 'right' }}>Monto Dólares</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {productosVisibles.map((p, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{p.nombre || 'Item manual'}</td>
                      <td>{p.unidad}</td>
                      <td style={{ textAlign: 'right' }}>{p.cantidad_vendida}</td>
                      <td style={{ textAlign: 'right' }}>{money(p.monto_soles)}</td>
                      <td style={{ textAlign: 'right' }}>$ {Number(p.monto_dolares).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>{money(p.total_vendido)}</td>
                    </tr>
                  ))}
                  {productos.length === 0 && <tr><td colSpan={7} className="empty-row">Sin datos para el periodo seleccionado.</td></tr>}
                </tbody>
                {productos.length > 0 && (
                  <tfoot>
                    <tr className="totals-footer">
                      <td colSpan={4}>TOTALES</td>
                      <td style={{ textAlign: 'right' }}>{money(totalProductosSoles)}</td>
                      <td style={{ textAlign: 'right' }}>$ {totalProductosDolares.toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>{money(totalProductosSoles)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {productos.length > 5 && (
                <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setMostrarTodo((v) => !v)}>
                  {mostrarTodo ? 'Ocultar lista' : 'Mostrar todo'}
                </button>
              )}
            </>
          )}

          {seccion === 'detalle_producto' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>
                  {detalleProdProducto ? `Detalle de ventas — ${detalleProdProducto.codigo} · ${detalleProdProducto.nombre}` : 'Detalle de ventas por producto'}
                </h3>
                {detalleProdProducto && <ExportButton onExport={exportDetalleProducto} />}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                Busca un producto y ve cada línea de venta que lo incluyó (Boletas, Facturas, Notas de Crédito y
                Notas de Venta Interna), con cantidad, descuento aplicado y a quién se atribuyó — para encontrar
                de un vistazo todos los movimientos de ese producto puntual.
              </p>

              <div className="filter-panel" style={{ marginBottom: 16 }}>
                <div className="filter-field grow">
                  <label>Producto</label>
                  {detalleProdProducto ? (
                    <p className="caja-row-auto" style={{ margin: 0 }}>
                      <strong>{detalleProdProducto.codigo} — {detalleProdProducto.nombre}</strong>{' '}
                      <button type="button" className="btn-link" onClick={() => setDetalleProdProducto(null)}>Cambiar</button>
                    </p>
                  ) : (
                    <ProductSearchBar
                      placeholder="Buscar producto por nombre, código o código de barras..."
                      onSelect={setDetalleProdProducto}
                    />
                  )}
                </div>
                <div className="filter-field">
                  <label>Desde</label>
                  <input type="date" value={detalleProdDesde} onChange={(e) => setDetalleProdDesde(e.target.value)} />
                </div>
                <div className="filter-field">
                  <label>Hasta</label>
                  <input type="date" value={detalleProdHasta} onChange={(e) => setDetalleProdHasta(e.target.value)} />
                </div>
              </div>

              {!detalleProdProducto && <p className="empty-row">Busca un producto para ver el detalle de sus ventas.</p>}

              {detalleProdProducto && detalleProdLoading && <p className="empty-row">Cargando...</p>}

              {detalleProdProducto && !detalleProdLoading && (
                <div className="table-scroll">
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Fecha</th><th>Sede</th><th>Tipo</th><th>Documento</th><th>Cliente</th>
                        <th style={{ textAlign: 'right' }}>Cantidad</th>
                        <th style={{ textAlign: 'right' }}>P. Unit.</th>
                        <th style={{ textAlign: 'right' }}>% Desc.</th>
                        <th style={{ textAlign: 'right' }}>Subtotal</th>
                        <th>Vendedor</th><th>Atribuido a</th><th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalleProdData.map((r, i) => (
                        <tr key={i} style={r.estado === 'anulado' ? { color: 'var(--ink-muted)', fontStyle: 'italic' } : undefined}>
                          <td>{r.fecha_emision}</td>
                          <td>{r.sede}</td>
                          <td>{r.tipo}</td>
                          <td>{r.serie}-{r.numero}</td>
                          <td>{r.cliente_nombre}</td>
                          <td style={{ textAlign: 'right' }}>{r.cantidad}</td>
                          <td style={{ textAlign: 'right' }}>{money(r.precio_unitario)}</td>
                          <td style={{ textAlign: 'right' }}>{r.descuento_pct ? `${r.descuento_pct}%` : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{money(r.subtotal_item)}</td>
                          <td>{r.vendedor_nombre || '—'}</td>
                          <td>{r.atribuido_nombre || '—'}</td>
                          <td>
                            <span className={'badge ' + (r.estado === 'anulado' ? 'badge-critical' : 'badge-good')}>
                              {r.estado === 'anulado' ? 'Anulado' : 'Emitido'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {detalleProdData.length === 0 && (
                        <tr><td colSpan={12} className="empty-row">Sin movimientos de este producto en el periodo seleccionado.</td></tr>
                      )}
                    </tbody>
                    {detalleProdData.length > 0 && (
                      <tfoot>
                        <tr className="totals-footer">
                          <td colSpan={5}>Total (sin contar anulados)</td>
                          <td style={{ textAlign: 'right' }}>{totalDetalleProdCantidad}</td>
                          <td></td>
                          <td></td>
                          <td style={{ textAlign: 'right' }}>{money(totalDetalleProdSubtotal)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </>
          )}

          {seccion === 'inventarios' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Evolución de inventarios</h3>
                <SucursalYAnio anio={inventariosAnio} setAnio={setInventariosAnio} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                Muestra el movimiento neto de stock (ingresos vs salidas) registrado en el kardex cada mes.
              </p>
              {evolucionInventarios.some((r) => r.ingresos || r.salidas) ? (
                <Bar data={barDataInventarios} options={barOptionsLegend} height={90} />
              ) : (
                <p className="empty-row">Sin movimientos de inventario en {inventariosAnio}.</p>
              )}
            </>
          )}

          {seccion === 'kardex' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>
                  {kardexData ? `Kardex — ${kardexData.producto.codigo} · ${kardexData.producto.nombre}` : 'Kardex'}
                </h3>
                {kardexData && <ExportButton onExport={exportKardex} />}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                Historial detallado de entradas y salidas de un producto, con el saldo de stock justo después de cada
                movimiento — igual criterio que Lotes y Series, pero movimiento por movimiento.
              </p>

              <div className="filter-panel" style={{ marginBottom: 16 }}>
                <div className="filter-field grow">
                  <label>Producto</label>
                  {kardexProducto ? (
                    <p className="caja-row-auto" style={{ margin: 0 }}>
                      <strong>{kardexProducto.codigo} — {kardexProducto.nombre}</strong>{' '}
                      <button type="button" className="btn-link" onClick={() => setKardexProducto(null)}>Cambiar</button>
                    </p>
                  ) : (
                    <ProductSearchBar
                      placeholder="Buscar producto por nombre, código o código de barras..."
                      onSelect={(p) => {
                        if (p.tipo !== 'producto') { toast.error('Los servicios no tienen kardex de stock.'); return; }
                        setKardexProducto(p);
                      }}
                    />
                  )}
                </div>
                <div className="filter-field">
                  <label>Desde</label>
                  <input type="date" value={kardexDesde} onChange={(e) => setKardexDesde(e.target.value)} />
                </div>
                <div className="filter-field">
                  <label>Hasta</label>
                  <input type="date" value={kardexHasta} onChange={(e) => setKardexHasta(e.target.value)} />
                </div>
              </div>

              {!kardexProducto && <p className="empty-row">Busca un producto para ver su kardex.</p>}

              {kardexProducto && kardexLoading && <p className="empty-row">Cargando...</p>}

              {kardexProducto && !kardexLoading && kardexData && (
                <div className="table-scroll">
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Fecha</th><th>Tipo</th><th>Documento</th>
                        <th style={{ textAlign: 'right' }}>Entrada</th>
                        <th style={{ textAlign: 'right' }}>Salida</th>
                        <th style={{ textAlign: 'right' }}>Saldo</th>
                        <th>Motivo</th><th>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="totals-footer">
                        <td colSpan={5}>Saldo inicial</td>
                        <td style={{ textAlign: 'right' }}>{kardexData.saldo_inicial} {kardexData.producto.unidad}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {kardexData.movimientos.map((m) => (
                        <tr key={m.id}>
                          <td>{m.created_at}</td>
                          <td><span className={'badge ' + (KARDEX_TIPO_BADGE[m.tipo] || 'badge-neutral')}>{KARDEX_TIPO_LABEL[m.tipo] || m.tipo}</span></td>
                          <td>{m.referencia || '—'}</td>
                          <td style={{ textAlign: 'right', color: m.cantidad > 0 ? COLORS.good : undefined }}>
                            {m.cantidad > 0 ? m.cantidad : ''}
                          </td>
                          <td style={{ textAlign: 'right', color: m.cantidad < 0 ? COLORS.critical : undefined }}>
                            {m.cantidad < 0 ? Math.abs(m.cantidad) : ''}
                          </td>
                          <td style={{ textAlign: 'right' }}><strong>{m.stock_resultante}</strong></td>
                          <td>{m.motivo || '—'}</td>
                          <td>{m.usuario_nombre || '—'}</td>
                        </tr>
                      ))}
                      {kardexData.movimientos.length === 0 && (
                        <tr><td colSpan={8} className="empty-row">Sin movimientos en el periodo seleccionado.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {seccion === 'compras_mes' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Compras por mes</h3>
                <SucursalYAnio anio={comprasMesAnio} setAnio={setComprasMesAnio} />
              </div>
              {comprasPorMes.some((r) => r.total) ? (
                <Bar data={barDataCompras} options={barOptionsV} height={90} />
              ) : (
                <p className="empty-row">Sin compras registradas en {comprasMesAnio}.</p>
              )}
            </>
          )}

          {seccion === 'ingreso_gastos' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Ingreso vs gastos</h3>
                <SucursalYAnio anio={ingresoGastosAnio} setAnio={setIngresoGastosAnio} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                Ingresos = ventas netas de notas de crédito. Gastos = compras a proveedores + egresos manuales de Caja (sin duplicar la categoría "Compras").
              </p>
              {ingresoVsGastos.some((r) => r.ingresos || r.gastos) ? (
                <Bar data={barDataIngresoGastos} options={barOptionsLegend} height={90} />
              ) : (
                <p className="empty-row">Sin datos en {ingresoGastosAnio}.</p>
              )}
            </>
          )}

          {seccion === 'top_clientes' && (
            <>
              <h3 style={{ marginTop: 0 }}>Top clientes por monto comprado</h3>
              {topClientes.length > 0 ? (
                <Bar data={barDataClientes} options={barOptionsH} height={Math.max(120, topClientes.length * 40)} />
              ) : (
                <p className="empty-row">Aún no hay ventas registradas.</p>
              )}
            </>
          )}

          {seccion === 'resumen_comprobante' && (
            <>
              <h3 style={{ marginTop: 0 }}>Resumen por tipo de comprobante</h3>
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
                  <tr className="totals-footer">
                    <td>Total general</td>
                    <td style={{ textAlign: 'right' }}>{ventasPorTipo.reduce((s, r) => s + r.cantidad, 0)}</td>
                    <td style={{ textAlign: 'right' }}>{money(totalGeneral)}</td>
                    <td style={{ textAlign: 'right' }}>100.0%</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {seccion === 'cierre_caja' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Cierre de Caja</h3>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div className="filter-field">
                    <label>Fecha</label>
                    <input type="date" value={cierreFecha} onChange={(e) => setCierreFecha(e.target.value)} />
                  </div>
                  <div className="filter-field">
                    <label>Empleado</label>
                    <select value={cierreEmpleadoId} onChange={(e) => setCierreEmpleadoId(e.target.value)}>
                      <option value="">Todos los empleados</option>
                      {cierreEmpleados.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {cierreCaja && (
                <>
                  <h4 style={{ marginBottom: 8 }}>Efectivo</h4>
                  {cierreCaja.efectivo ? (
                    <table className="data-table compact">
                      <tbody>
                        <tr><td>Saldo inicial</td><td style={{ textAlign: 'right' }}>{money(cierreCaja.efectivo.saldo_inicial)}</td></tr>
                        <tr><td>Ingresos</td><td style={{ textAlign: 'right' }}>{money(cierreCaja.efectivo.ingresos.total)}</td></tr>
                        <tr><td>Egresos</td><td style={{ textAlign: 'right' }}>{money(cierreCaja.efectivo.egresos.total)}</td></tr>
                        <tr className="totals-footer"><td>Saldo final</td><td style={{ textAlign: 'right' }}>{money(cierreCaja.efectivo.saldo_final)}</td></tr>
                      </tbody>
                    </table>
                  ) : <p className="empty-row">El método Efectivo no está activo.</p>}

                  <h4 style={{ marginTop: 24, marginBottom: 8 }}>🧾 Abonados</h4>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                    Total vendido a crédito hoy (Boleta/Factura/Nota de Venta Interna "Abonado"), sin importar
                    cuánto se cobró — no es dinero en caja, lo ya cobrado del abono cuenta en su método real
                    (Efectivo, Yape, etc.) dentro de "Ventas por Forma de Pago".
                  </p>
                  {cierreCaja.abonados ? (
                    <table className="data-table compact">
                      <tbody>
                        <tr><td>Cantidad de ventas abonado</td><td style={{ textAlign: 'right' }}>{cierreCaja.abonados.cantidad}</td></tr>
                        <tr className="totals-footer"><td>Total vendido a crédito</td><td style={{ textAlign: 'right' }}>{money(cierreCaja.abonados.ingresos.total)}</td></tr>
                      </tbody>
                    </table>
                  ) : <p className="empty-row">Sin ventas abonado en la fecha seleccionada.</p>}

                  <h4 style={{ marginTop: 24, marginBottom: 8 }}>Ventas por Documento</h4>
                  <table className="data-table">
                    <thead>
                      <tr><th>Documento</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Total</th></tr>
                    </thead>
                    <tbody>
                      {cierreCaja.ventas_por_documento.map((d) => (
                        <tr key={d.doc}>
                          <td>{d.label}</td>
                          <td style={{ textAlign: 'right' }}>{d.cantidad}</td>
                          <td style={{ textAlign: 'right' }}>{money(d.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="totals-footer">
                        <td>Total</td>
                        <td style={{ textAlign: 'right' }}>{cierreCaja.ventas_por_documento.reduce((s, d) => s + d.cantidad, 0)}</td>
                        <td style={{ textAlign: 'right' }}>{money(cierreCaja.ventas_por_documento.reduce((s, d) => s + d.total, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>

                  <h4 style={{ marginTop: 24, marginBottom: 8 }}>Ventas por Forma de Pago</h4>
                  <table className="data-table">
                    <thead>
                      <tr><th>Forma de pago</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Total</th></tr>
                    </thead>
                    <tbody>
                      {cierreCaja.ventas_por_forma_pago.map((f) => (
                        <tr key={f.forma_pago}>
                          <td>{f.label}</td>
                          <td style={{ textAlign: 'right' }}>{f.cantidad}</td>
                          <td style={{ textAlign: 'right' }}>{money(f.total)}</td>
                        </tr>
                      ))}
                      {cierreCaja.ventas_por_forma_pago.length === 0 && (
                        <tr><td colSpan={3} className="empty-row">Sin ventas en la fecha seleccionada.</td></tr>
                      )}
                    </tbody>
                  </table>

                  <h4 style={{ marginTop: 24, marginBottom: 8 }}>Resultado de Turno</h4>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                    El sistema no maneja turnos/sesiones de caja independientes — el resultado corresponde al día
                    completo (y al empleado, si se filtró uno).
                  </p>
                  <table className="data-table compact">
                    <tbody>
                      <tr><td>Total de ventas bruto</td><td style={{ textAlign: 'right' }}>{money(cierreCaja.turno.bruto)}</td></tr>
                      <tr><td>Descuento</td><td style={{ textAlign: 'right' }}>-{money(cierreCaja.turno.descuento)}</td></tr>
                      <tr><td>Devoluciones</td><td style={{ textAlign: 'right' }}>-{money(cierreCaja.turno.devoluciones)}</td></tr>
                      <tr><td>Anulaciones</td><td style={{ textAlign: 'right' }}>-{money(cierreCaja.turno.anulaciones)}</td></tr>
                      <tr className="totals-footer"><td>Total de ventas neto</td><td style={{ textAlign: 'right' }}>{money(cierreCaja.turno.neto)}</td></tr>
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
