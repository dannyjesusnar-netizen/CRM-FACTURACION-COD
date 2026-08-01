import { useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const TIPO_LABEL = { factura: 'Factura', boleta: 'Boleta', nota_credito: 'Nota de crédito' };
const FORMA_PAGO_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', banco: 'Transferencia/Banco' };

function emptyItem() {
  return { product_id: '', descripcion: '', cantidad: 1, precio_unitario: 0 };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Invoices() {
  const toast = useToast();
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);

  // filtros de busqueda (panel tipo RapiFac)
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [documento, setDocumento] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const [tipoComprobante, setTipoComprobante] = useState('boleta');
  const [clientId, setClientId] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [observaciones, setObservaciones] = useState('');
  const [formaPago, setFormaPago] = useState('efectivo');

  function load() {
    const params = {};
    if (documento) params.tipo = documento;
    if (desde) params.from = desde;
    if (hasta) params.to = hasta;
    if (q) params.q = q;
    api.get('/invoices', { params }).then((res) => setInvoices(res.data));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get('/clients').then((res) => setClients(res.data));
    api.get('/products').then((res) => setProducts(res.data));
  }, []);

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

  function openNew(tipo) {
    setTipoComprobante(tipo);
    setClientId('');
    setItems([emptyItem()]);
    setObservaciones('');
    setFormaPago('efectivo');
    setError('');
    setShowForm(true);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function handleProductSelect(idx, productId) {
    const prod = products.find((p) => String(p.id) === String(productId));
    if (prod) {
      updateItem(idx, {
        product_id: prod.id,
        descripcion: prod.nombre,
        precio_unitario: prod.precio_unitario,
      });
    } else {
      updateItem(idx, { product_id: '', descripcion: '', precio_unitario: 0 });
    }
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const total = items.reduce((sum, it) => sum + Number(it.cantidad || 0) * Number(it.precio_unitario || 0), 0);
  const subtotal = total / 1.18;
  const igv = total - subtotal;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!clientId) { setError('Selecciona un cliente.'); return; }
    if (items.length === 0 || items.some((it) => !it.descripcion || !it.cantidad)) {
      setError('Completa todos los items.');
      return;
    }
    try {
      await api.post('/invoices', {
        tipo_comprobante: tipoComprobante,
        client_id: Number(clientId),
        items: items.map((it) => ({
          product_id: it.product_id || null,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario),
        })),
        observaciones,
        forma_pago: formaPago,
      });
      setShowForm(false);
      toast.success(`${TIPO_LABEL[tipoComprobante]} emitida correctamente.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al emitir el comprobante.');
    }
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
        <button className="ventas-action-btn" onClick={() => openNew('factura')}>Factura</button>
        <button className="ventas-action-btn" onClick={() => openNew('boleta')}>Boleta</button>
        <button className="ventas-action-btn" onClick={() => openNew('nota_credito')}>Nota de Crédito</button>
        <button className="ventas-action-btn disabled" title="Próximamente" onClick={() => toast.info('Guía Remitente estará disponible próximamente.')}>Guía Remitente</button>
        <button className="ventas-action-btn disabled" title="Próximamente" onClick={() => toast.info('Cotización estará disponible próximamente.')}>Cotización</button>
        <button className="ventas-action-btn disabled" title="Próximamente" onClick={() => toast.info('Órdenes estará disponible próximamente.')}>Órdenes</button>
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
        <div className="filter-field">
          <label>Sucursal</label>
          <select defaultValue="principal">
            <option value="principal">Sede Principal</option>
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
                    <span className={'badge ' + (inv.estado === 'anulado' ? 'badge-critical' : 'badge-good')}>
                      {inv.estado === 'anulado' ? 'Anulado' : 'Simulado'}
                    </span>
                  </td>
                  <td>
                    <a className="icon-link" href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" title="Imprimir">🖨️</a>
                  </td>
                  <td>
                    <a className="icon-link" href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" title="Ver PDF">📄</a>
                  </td>
                  <td><span className="icon-link muted" title="No disponible en modo simulado">XML</span></td>
                  <td><span className="icon-link muted" title="No disponible en modo simulado">CDR</span></td>
                  <td><span className="icon-link muted" title="Sin conexión real a SUNAT">—</span></td>
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

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Nueva venta &mdash; {TIPO_LABEL[tipoComprobante]}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div>
                  <label>Tipo de comprobante</label>
                  <select value={tipoComprobante} onChange={(e) => setTipoComprobante(e.target.value)}>
                    <option value="boleta">Boleta</option>
                    <option value="factura">Factura (requiere RUC)</option>
                    <option value="nota_credito">Nota de crédito</option>
                  </select>
                </div>
                <div>
                  <label>Cliente</label>
                  <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">Selecciona un cliente...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre} ({c.tipo_documento} {c.numero_documento})</option>
                    ))}
                  </select>
                </div>
              </div>

              <label>Forma de pago</label>
              <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="banco">Transferencia / Banco</option>
              </select>

              <label>Items</label>
              <table className="items-table">
                <thead>
                  <tr>
                    <th>Producto/Servicio</th>
                    <th>Descripción</th>
                    <th>Cant.</th>
                    <th>P. Unit.</th>
                    <th>Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <select value={it.product_id} onChange={(e) => handleProductSelect(idx, e.target.value)}>
                          <option value="">Manual...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input value={it.descripcion} onChange={(e) => updateItem(idx, { descripcion: e.target.value })} />
                      </td>
                      <td>
                        <input type="number" min="0.01" step="0.01" style={{ width: 70 }} value={it.cantidad}
                          onChange={(e) => updateItem(idx, { cantidad: e.target.value })} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" style={{ width: 90 }} value={it.precio_unitario}
                          onChange={(e) => updateItem(idx, { precio_unitario: e.target.value })} />
                      </td>
                      <td>S/ {(Number(it.cantidad || 0) * Number(it.precio_unitario || 0)).toFixed(2)}</td>
                      <td>
                        {items.length > 1 && (
                          <button type="button" className="btn-link danger" onClick={() => removeItem(idx)}>x</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={addItem}>+ Agregar item</button>

              <div className="totals-box">
                <div><span>Subtotal (sin IGV):</span><span>S/ {subtotal.toFixed(2)}</span></div>
                <div><span>IGV (18%):</span><span>S/ {igv.toFixed(2)}</span></div>
                <div className="totals-final"><span>Total:</span><span>S/ {total.toFixed(2)}</span></div>
              </div>

              <label>Observaciones</label>
              <textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />

              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Emitir comprobante</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
