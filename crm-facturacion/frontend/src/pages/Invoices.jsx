import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';

const TIPO_LABEL = { factura: 'Factura', boleta: 'Boleta', nota_credito: 'Nota de crédito' };
const FORMA_PAGO_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', banco: 'Transferencia/Banco' };

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
  const [invoices, setInvoices] = useState([]);

  // filtros de busqueda (panel tipo RapiFac)
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [documento, setDocumento] = useState('');

  function load() {
    const params = {};
    if (documento) params.tipo = documento;
    if (desde) params.from = desde;
    if (hasta) params.to = hasta;
    if (q) params.q = q;
    api.get('/invoices', { params }).then((res) => setInvoices(res.data));
  }

  useEffect(() => { load(); }, []);

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
      TIPO_LABEL[inv.tipo_comprobante] || inv.tipo_comprobante,
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

  async function handleAnular(id) {
    if (!window.confirm('¿Anular este comprobante? Esta acción no se puede revertir.')) return;
    try {
      await api.post(`/invoices/${id}/anular`);
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
        <button className="ventas-action-btn disabled" title="Próximamente" onClick={() => toast.info('Órdenes estará disponible próximamente.')}>Órdenes</button>
        <button className="ventas-action-btn" onClick={() => navigate('/ventas/cuentas-por-cobrar')}>Cuentas por Cobrar</button>
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
            <option value="nota_credito">Nota de crédito</option>
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
                <tr key={inv.id}>
                  <td>{inv.fecha_emision}</td>
                  <td>{inv.serie}</td>
                  <td>{String(inv.numero).padStart(6, '0')}</td>
                  <td>{TIPO_LABEL[inv.tipo_comprobante] || inv.tipo_comprobante}</td>
                  <td>{inv.cliente_documento}</td>
                  <td>{inv.cliente_nombre}</td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(inv.subtotal).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(inv.total).toFixed(2)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{FORMA_PAGO_LABEL[inv.forma_pago] || inv.forma_pago || 'Efectivo'}</td>
                  <td>
                    <span className={'badge ' + envioBadgeClass(inv)} title={inv.sunat_mensaje || ''}>
                      {envioBadgeLabel(inv)}
                    </span>
                  </td>
                  <td>
                    <a className="icon-link" href={inv.sunat_pdf_url || `/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" title="Imprimir">🖨️</a>
                  </td>
                  <td>
                    <a className="icon-link" href={inv.sunat_pdf_url || `/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" title="Ver PDF">📄</a>
                  </td>
                  <td>
                    {inv.sunat_xml_url ? (
                      <a className="icon-link" href={inv.sunat_xml_url} target="_blank" rel="noreferrer">XML</a>
                    ) : (
                      <span className="icon-link muted" title="No disponible en modo simulado">XML</span>
                    )}
                  </td>
                  <td>
                    {inv.sunat_cdr_url ? (
                      <a className="icon-link" href={inv.sunat_cdr_url} target="_blank" rel="noreferrer">CDR</a>
                    ) : (
                      <span className="icon-link muted" title="No disponible en modo simulado">CDR</span>
                    )}
                  </td>
                  <td>
                    {inv.modo_emision === 'real' ? (
                      <span className={'icon-link ' + (inv.sunat_estado === 'aceptado' ? '' : 'muted')} title={inv.sunat_mensaje || ''}>
                        {inv.sunat_estado || '—'}
                      </span>
                    ) : (
                      <span className="icon-link muted" title="Sin conexión real a SUNAT">—</span>
                    )}
                  </td>
                  <td>
                    {inv.estado === 'emitido' ? (
                      <button className="btn-link danger" onClick={() => handleAnular(inv.id)}>Anular</button>
                    ) : (
                      <span className="icon-link muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={15} className="empty-row">No hay comprobantes en el rango seleccionado.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totals-footer">
                <td colSpan={7}>Cantidad: {vigentes.length}</td>
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
