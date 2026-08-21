import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

const TIPO_LABEL = { factura: 'Factura', boleta: 'Boleta', nota_credito: 'Nota de crédito' };

function tipoLabel(inv) {
  if (inv._source === 'nota_venta') return 'Nota de Venta Interna';
  return TIPO_LABEL[inv.tipo_comprobante] || inv.tipo_comprobante;
}

function envioBadgeLabel(inv) {
  if (inv.estado === 'anulado') return 'Anulado';
  if (inv.modo_emision !== 'real') return 'Simulado';
  if (inv.sunat_estado === 'aceptado') return 'Aceptado SUNAT';
  if (inv.sunat_estado === 'rechazado') return 'Rechazado SUNAT';
  if (inv.sunat_estado === 'error') return 'Error de envío';
  return 'Pendiente';
}

function envioBadgeClass(inv) {
  if (inv.estado === 'anulado') return 'badge-critical';
  if (inv.modo_emision !== 'real') return 'badge-good';
  if (inv.sunat_estado === 'aceptado') return 'badge-good';
  if (inv.sunat_estado === 'rechazado' || inv.sunat_estado === 'error') return 'badge-critical';
  return 'badge-neutral';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Invoices() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const puedeReatribuir = !!user?.puede_reatribuir_venta;
  const [invoices, setInvoices] = useState([]);
  const [metodosPago, setMetodosPago] = useState([]);
  const [entrenadores, setEntrenadores] = useState([]);

  // filtros de busqueda (panel tipo RapiFac)
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [documento, setDocumento] = useState('');
  const [formaPago, setFormaPago] = useState('');

  // Las Notas de Venta (sin IGV) viven en una tabla/endpoint aparte de las
  // facturas/boletas/notas de crédito — se traen en paralelo y se mezclan
  // en una sola lista para que "Documentos Emitidos" muestre todo junto.
  // Si el filtro Documento pide específicamente uno de los dos grupos, se
  // omite la llamada al otro endpoint (evita traer datos que se van a
  // descartar igual).
  function load() {
    const commonParams = {};
    if (desde) commonParams.from = desde;
    if (hasta) commonParams.to = hasta;
    if (q) commonParams.q = q;

    const wantInvoices = documento !== 'nota_venta';
    const wantNotasVenta = !documento || documento === 'nota_venta';

    const invoiceParams = { ...commonParams };
    if (documento) invoiceParams.tipo = documento;
    if (formaPago) invoiceParams.forma_pago = formaPago;

    const nvParams = { ...commonParams };
    if (formaPago) nvParams.forma_pago = formaPago;

    Promise.all([
      wantInvoices ? api.get('/invoices', { params: invoiceParams }) : Promise.resolve({ data: [] }),
      wantNotasVenta ? api.get('/notas-venta', { params: nvParams }) : Promise.resolve({ data: [] }),
    ]).then(([invRes, nvRes]) => {
      const invRows = invRes.data.map((r) => ({ ...r, _source: 'invoice' }));
      const nvRows = nvRes.data.map((r) => ({ ...r, _source: 'nota_venta', tipo_comprobante: 'nota_venta' }));
      const merged = [...invRows, ...nvRows].sort((a, b) => {
        if (a.fecha_emision !== b.fecha_emision) return a.fecha_emision < b.fecha_emision ? 1 : -1;
        return b.id - a.id;
      });
      setInvoices(merged);
    });
  }

  useEffect(() => {
    load();
    api.get('/metodos-pago', { params: { todos: 1 } }).then((res) => setMetodosPago(res.data));
    if (puedeReatribuir) {
      api.get('/invoices/entrenadores').then((res) => setEntrenadores(res.data)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formaPagoLabel(codigo) {
    if (!codigo) return 'Efectivo';
    if (codigo === 'abonado') return '🧾 Abonado (crédito)';
    const metodo = metodosPago.find((m) => m.codigo === codigo);
    return metodo ? `${metodo.icono} ${metodo.nombre}` : codigo;
  }

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  function handleExportar() {
    const header = ['Fecha', 'Serie', 'Nro', 'Comprobante', 'Nro Doc', 'Nombre o Razon Social', 'Importe', 'Total', 'Estado'];
    const rows = invoices.map((inv) => [
      inv.fecha_emision,
      inv.serie,
      String(inv.numero).padStart(6, '0'),
      tipoLabel(inv),
      inv.cliente_documento,
      inv.cliente_nombre,
      inv.subtotal,
      inv.total,
      inv.estado,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas_${desde}_a_${hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Archivo CSV exportado.');
  }

  async function handleReatribuir(id, atribuidoAId) {
    try {
      const res = await api.put(`/invoices/${id}/atribuido-a`, { atribuido_a_id: atribuidoAId || null });
      setInvoices((rows) => rows.map((r) => (r.id === id ? { ...r, atribuido_a: res.data.atribuido_a, atribuido_nombre: res.data.atribuido_nombre } : r)));
      toast.success('Venta reatribuida.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo reatribuir la venta.');
    }
  }

  async function handleAnular(inv) {
    if (!window.confirm('¿Anular este comprobante? Esta acción no se puede revertir.')) return;
    try {
      const base = inv._source === 'nota_venta' ? '/notas-venta' : '/invoices';
      await api.post(`${base}/${inv.id}/anular`);
      toast.success('Comprobante anulado.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo anular el comprobante.');
    }
  }

  const vigentes = invoices.filter((i) => i.estado === 'emitido');
  const sumaSoles = vigentes.filter((i) => i.moneda !== 'USD').reduce((s, i) => s + i.total, 0);
  const sumaDolares = vigentes.filter((i) => i.moneda === 'USD').reduce((s, i) => s + i.total, 0);

  return (
    <div>
      <h1 className="page-title">Ventas</h1>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={() => navigate('/ventas/nuevo/factura')}>Factura</button>
        <button className="ventas-action-btn" onClick={() => navigate('/ventas/nuevo/boleta')}>Boleta</button>
        <button className="ventas-action-btn" onClick={() => navigate('/ventas/nota-credito/nueva')}>Nota de Crédito</button>
        <button className="ventas-action-btn" onClick={() => navigate('/ventas/guia-remitente/nueva')}>Guía Remitente</button>
        <button className="ventas-action-btn" onClick={() => navigate('/ventas/nuevo/cotizacion')}>Cotización</button>
        <button className="ventas-action-btn" onClick={() => navigate('/ventas/nota-venta/nueva')}>Nota de Venta Interna</button>
      </div>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field grow">
          <label>Buscar por nombre o número doc.</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nro. doc/nombre.." />
        </div>
        <div className="filter-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Documento</label>
          <select value={documento} onChange={(e) => setDocumento(e.target.value)}>
            <option value="">Comprobantes</option>
            <option value="factura">Factura</option>
            <option value="boleta">Boleta</option>
            <option value="nota_venta">Nota de Venta Interna</option>
            <option value="nota_credito">Nota de crédito</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Forma de pago</label>
          <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
            <option value="">Todas</option>
            <option value="abonado">🧾 Abonado (crédito)</option>
            <option value="mixto">🔀 Pago mixto</option>
            {metodosPago.map((m) => <option key={m.codigo} value={m.codigo}>{m.icono} {m.nombre}</option>)}
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
          <button type="button" className="btn-export" onClick={handleExportar}>Exportar</button>
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Serie</th>
                <th>Nro</th>
                <th>Comprobante</th>
                <th>Nro Doc</th>
                <th>Nombre o Razón Social</th>
                <th>Atribuido a</th>
                <th style={{ textAlign: 'right' }}>Importe</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Forma de pago</th>
                <th>Enviado</th>
                <th>Print</th>
                <th>PDF</th>
                <th>XML</th>
                <th>CDR</th>
                <th>SUNAT</th>
                <th>Baja</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={`${inv._source}-${inv.id}`}>
                  <td>{inv.fecha_emision}</td>
                  <td>{inv.serie}</td>
                  <td>{String(inv.numero).padStart(6, '0')}</td>
                  <td>{tipoLabel(inv)}</td>
                  <td>{inv.cliente_documento}</td>
                  <td>{inv.cliente_nombre}</td>
                  <td>
                    {inv._source !== 'nota_venta' && puedeReatribuir && entrenadores.length > 0 && inv.estado !== 'anulado' ? (
                      <select
                        value={inv.atribuido_a || ''}
                        onChange={(e) => handleReatribuir(inv.id, e.target.value)}
                        title="Cambiar a nombre de quién cuenta esta venta"
                      >
                        <option value="">{inv.vendedor_nombre || 'Vendedor'}</option>
                        {entrenadores.map((e) => (
                          <option key={e.id} value={e.id}>{e.full_name} ({e.categoria_staff === 'trainer' ? 'Trainer' : 'Supervisor'})</option>
                        ))}
                      </select>
                    ) : (
                      inv.atribuido_nombre || inv.vendedor_nombre || '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(inv.subtotal).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(inv.total).toFixed(2)}</td>
                  <td>{formaPagoLabel(inv.forma_pago)}</td>
                  <td>
                    {inv._source === 'nota_venta' ? (
                      <span className="badge badge-neutral" title="Documento sin efectos tributarios, no se envía a SUNAT">Sin IGV</span>
                    ) : (
                      <span className={'badge ' + envioBadgeClass(inv)} title={inv.sunat_mensaje || ''}>
                        {envioBadgeLabel(inv)}
                      </span>
                    )}
                  </td>
                  <td>
                    <a className="icon-link" href={inv._source === 'nota_venta' ? `/api/notas-venta/${inv.id}/pdf` : (inv.sunat_pdf_url || `/api/invoices/${inv.id}/pdf`)} target="_blank" rel="noreferrer" title="Imprimir">🖨️</a>
                  </td>
                  <td>
                    <a className="icon-link" href={inv._source === 'nota_venta' ? `/api/notas-venta/${inv.id}/pdf` : (inv.sunat_pdf_url || `/api/invoices/${inv.id}/pdf`)} target="_blank" rel="noreferrer" title="Ver PDF">📄</a>
                  </td>
                  <td>
                    {inv._source === 'nota_venta' ? (
                      <span className="icon-link muted" title="No aplica — documento sin IGV, no fiscal">—</span>
                    ) : inv.sunat_xml_url ? (
                      <a className="icon-link" href={inv.sunat_xml_url} target="_blank" rel="noreferrer">XML</a>
                    ) : (
                      <span className="icon-link muted" title="No disponible en modo simulado">XML</span>
                    )}
                  </td>
                  <td>
                    {inv._source === 'nota_venta' ? (
                      <span className="icon-link muted" title="No aplica — documento sin IGV, no fiscal">—</span>
                    ) : inv.sunat_cdr_url ? (
                      <a className="icon-link" href={inv.sunat_cdr_url} target="_blank" rel="noreferrer">CDR</a>
                    ) : (
                      <span className="icon-link muted" title="No disponible en modo simulado">CDR</span>
                    )}
                  </td>
                  <td>
                    {inv._source === 'nota_venta' ? (
                      <span className="icon-link muted" title="No aplica — documento sin IGV, no fiscal">—</span>
                    ) : inv.modo_emision === 'real' ? (
                      <span className={'icon-link ' + (inv.sunat_estado === 'aceptado' ? '' : 'muted')} title={inv.sunat_mensaje || ''}>
                        {inv.sunat_estado || '—'}
                      </span>
                    ) : (
                      <span className="icon-link muted" title="Sin conexión real a SUNAT">—</span>
                    )}
                  </td>
                  <td>
                    {inv.estado === 'emitido' ? (
                      <button className="btn-link danger" onClick={() => handleAnular(inv)}>Anular</button>
                    ) : (
                      <span className="icon-link muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={16} className="empty-row">No hay comprobantes en el rango seleccionado.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totals-footer">
                <td colSpan={8}>Cantidad: {vigentes.length}</td>
                <td colSpan={2}>
                  Suma S/ <input readOnly value={sumaSoles.toFixed(2)} />
                </td>
                <td colSpan={3}>
                  Suma $ <input readOnly value={sumaDolares.toFixed(2)} />
                </td>
                <td colSpan={3}>
                  Gran Total <input readOnly value={(sumaSoles + sumaDolares).toFixed(2)} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
