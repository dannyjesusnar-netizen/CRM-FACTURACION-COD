import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import PeriodoContable from '../components/PeriodoContable';

const DOCUMENTO_LABEL = {
  factura: 'FACTURA', boleta: 'BOLETA', ticket: 'TICKET',
  recibo_honorarios: 'RECIBO POR HONORARIOS', otros: 'OTROS',
  orden_compra: 'ORDEN DE COMPRA', orden_servicio: 'ORDEN DE SERVICIO',
};

const TIPOS_COMPROBANTE = [
  { value: 'factura', label: '01 - FACTURA' },
  { value: 'boleta', label: '03 - BOLETA' },
  { value: 'ticket', label: 'TICKET' },
  { value: 'recibo_honorarios', label: 'RECIBO POR HONORARIOS' },
  { value: 'otros', label: 'OTROS' },
];
const MONEDAS = [
  { value: 'PEN', label: 'SOLES' },
  { value: 'USD', label: 'DÓLARES' },
];
const TIPOS_OPERACION = [
  { value: 'gravada_exportacion', label: 'Con IGV Destinadas a Operaciones Gravadas y/o De Exportación' },
  { value: 'no_gravada', label: 'Con IGV Destinadas a Operaciones No Gravadas' },
  { value: 'sin_derecho_credito', label: 'Sin derecho a crédito fiscal' },
  { value: 'no_gravado', label: 'No Gravado' },
];
const AFECTACIONES_IGV = [
  { value: 'gravado', label: 'Gravado' },
  { value: 'exonerado', label: 'Exonerado' },
  { value: 'inafecto', label: 'Inafecto' },
];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function emptyItem() {
  return { product_id: '', cantidad: 1, costo_unitario: 0, unidad: 'UND', afectacion_igv: 'gravado', observacion: '' };
}

function emptySupplier() {
  return { ruc: '', nombre: '', direccion: '', telefono: '', email: '' };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Compras() {
  const toast = useToast();
  const navigate = useNavigate();
  const { sucursal } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  const [q, setQ] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [documentoFiltro, setDocumentoFiltro] = useState('');
  const hoy = new Date();
  const [periodoMes, setPeriodoMes] = useState(hoy.getMonth() + 1);
  const [periodoAnio, setPeriodoAnio] = useState(hoy.getFullYear());

  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState('compra'); // 'compra' | 'orden'
  const [ordenDocumento, setOrdenDocumento] = useState('Orden de Compra'); // 'Orden de Compra' | 'Orden de Servicio'
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [error, setError] = useState('');

  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [observaciones, setObservaciones] = useState('');
  const [formaPago, setFormaPago] = useState('efectivo');
  const [newSupplier, setNewSupplier] = useState(emptySupplier());
  const [igvRate, setIgvRate] = useState(0.18);
  const [tiposCompra, setTiposCompra] = useState([]);

  const [tipoComprobante, setTipoComprobante] = useState('factura');
  const [docSerie, setDocSerie] = useState('');
  const [docNumero, setDocNumero] = useState('');
  const [fechaEmision, setFechaEmision] = useState(todayStr());
  const [moneda, setMoneda] = useState('PEN');
  const [tipoCambio, setTipoCambio] = useState(1);
  const [tipoCompra, setTipoCompra] = useState('');
  const [tipoOperacion, setTipoOperacion] = useState('gravada_exportacion');
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [percepcion, setPercepcion] = useState(0);

  function load(overrides = {}) {
    const params = {};
    const d = overrides.desde ?? desde;
    const h = overrides.hasta ?? hasta;
    if (d) params.from = d;
    if (h) params.to = h;
    if (q) params.q = q;
    api.get('/purchases', { params }).then((res) => setPurchases(res.data));
    api.get('/purchase-orders', { params }).then((res) => setOrders(res.data));
  }

  function aplicarPeriodo({ mes, anio, desde: d, hasta: h }) {
    setPeriodoMes(mes);
    setPeriodoAnio(anio);
    setDesde(d);
    setHasta(h);
    load({ desde: d, hasta: h });
  }

  function loadSuppliers() {
    return api.get('/suppliers').then((res) => setSuppliers(res.data));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    loadSuppliers();
    api.get('/products').then((res) => setProducts(res.data.filter((p) => p.tipo === 'producto')));
    api.get('/empresa').then((res) => {
      if (res.data?.igv_rate) setIgvRate(Number(res.data.igv_rate));
    });
    api.get('/tipos-compra', { params: { estado: 'activo' } }).then((res) => setTiposCompra(res.data));
  }, []);

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  function openNew(mode = 'compra', ordenDoc = 'Orden de Compra') {
    setFormMode(mode);
    setOrdenDocumento(ordenDoc);
    setSupplierId('');
    setItems([emptyItem()]);
    setObservaciones('');
    setFormaPago('efectivo');
    setTipoComprobante('factura');
    setDocSerie('');
    setDocNumero('');
    setFechaEmision(todayStr());
    setMoneda('PEN');
    setTipoCambio(1);
    setTipoCompra(tiposCompra[0]?.nombre || '');
    setTipoOperacion('gravada_exportacion');
    setDescuentoPct(0);
    setPercepcion(0);
    setError('');
    setShowForm(true);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function handleProductSelect(idx, productId) {
    const prod = products.find((p) => String(p.id) === String(productId));
    updateItem(idx, { product_id: prod ? prod.id : '' });
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const computedTotals = items.reduce((acc, it) => {
    const bruta = Number(it.cantidad || 0) * Number(it.costo_unitario || 0);
    const neta = bruta * (1 - Number(descuentoPct || 0) / 100);
    if ((it.afectacion_igv || 'gravado') === 'gravado') {
      const igvLinea = neta - neta / (1 + igvRate);
      acc.subtotal += neta - igvLinea;
      acc.igv += igvLinea;
    } else {
      acc.noGravado += neta;
    }
    return acc;
  }, { subtotal: 0, igv: 0, noGravado: 0 });
  const subtotal = round2(computedTotals.subtotal);
  const igv = round2(computedTotals.igv);
  const noGravado = round2(computedTotals.noGravado);
  const total = round2(subtotal + igv + noGravado + Number(percepcion || 0));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!supplierId) { setError('Selecciona un proveedor.'); return; }
    if (!docSerie || !docNumero) { setError('Ingresa la serie y el número del documento.'); return; }
    if (!fechaEmision) { setError('Ingresa la fecha de emisión.'); return; }
    if (moneda === 'USD' && Number(tipoCambio) <= 0) { setError('Ingresa un tipo de cambio válido.'); return; }
    if (items.length === 0 || items.some((it) => !it.product_id || !it.cantidad)) {
      setError('Completa todos los items (producto y cantidad).');
      return;
    }
    const payload = {
      supplier_id: Number(supplierId),
      items: items.map((it) => ({
        product_id: Number(it.product_id),
        cantidad: Number(it.cantidad),
        costo_unitario: Number(it.costo_unitario),
        unidad: it.unidad,
        afectacion_igv: it.afectacion_igv,
        observacion: it.observacion,
      })),
      observaciones,
      serie: docSerie,
      numero_doc: docNumero,
      fecha: fechaEmision,
      moneda,
      tipo_cambio: Number(tipoCambio),
      tipo_compra: tipoCompra,
      tipo_operacion: tipoOperacion,
      descuento_pct: Number(descuentoPct || 0),
      percepcion: Number(percepcion || 0),
    };
    try {
      if (formMode === 'orden') {
        await api.post('/purchase-orders', {
          ...payload,
          tipo_documento: ordenDocumento === 'Orden de Servicio' ? 'orden_servicio' : 'orden_compra',
        });
        toast.success(`${ordenDocumento} guardada correctamente.`);
      } else {
        await api.post('/purchases', { ...payload, forma_pago: formaPago, tipo_comprobante: tipoComprobante });
        toast.success('Compra registrada correctamente.');
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar.');
    }
  }

  async function handleAnular(id) {
    if (!window.confirm('¿Anular esta compra? El stock ingresado se revertirá.')) return;
    try {
      await api.post(`/purchases/${id}/anular`);
      toast.success('Compra anulada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo anular la compra.');
    }
  }

  async function handleAnularOrder(id) {
    if (!window.confirm('¿Anular esta orden de compra?')) return;
    try {
      await api.post(`/purchase-orders/${id}/anular`);
      toast.success('Orden de compra anulada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo anular la orden.');
    }
  }

  async function handleNewSupplier(e) {
    e.preventDefault();
    if (!newSupplier.nombre) { toast.error('El nombre del proveedor es requerido.'); return; }
    try {
      const res = await api.post('/suppliers', newSupplier);
      await loadSuppliers();
      setSupplierId(res.data.id);
      setNewSupplier(emptySupplier());
      setShowSupplierForm(false);
      toast.success('Proveedor creado.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo crear el proveedor.');
    }
  }

  const vigentes = purchases.filter((p) => p.estado === 'registrada');
  const sumaTotal = vigentes.reduce((s, p) => s + p.total, 0);

  const registrosCompras = purchases.map((p) => ({
    key: `compra-${p.id}`, kind: 'compra', id: p.id, fecha: p.fecha,
    documento: DOCUMENTO_LABEL[p.tipo_comprobante] || (p.tipo_comprobante || '').toUpperCase(),
    serie: p.serie || '—', numeroDoc: p.numero_doc || String(p.numero).padStart(5, '0'),
    ruc: p.proveedor_ruc, nombre: p.proveedor_nombre, moneda: p.moneda || 'PEN',
    importe: round2(Number(p.subtotal || 0) + Number(p.igv || 0) + Number(p.no_gravado || 0)),
    tipoCambio: p.tipo_cambio || 1, total: p.total, sucursal: p.sucursal_nombre,
    estadoLabel: p.estado === 'anulada' ? 'Anulada' : 'Registrada',
    badgeClass: p.estado === 'anulada' ? 'badge-critical' : 'badge-good',
    puedeAnular: p.estado === 'registrada',
  }));
  const registrosOrdenes = orders.map((o) => ({
    key: `orden-${o.id}`, kind: 'orden', id: o.id, fecha: o.fecha,
    documento: DOCUMENTO_LABEL[o.tipo_documento] || 'ORDEN DE COMPRA',
    serie: o.serie || '—', numeroDoc: o.numero_doc || String(o.numero).padStart(5, '0'),
    ruc: o.proveedor_ruc, nombre: o.proveedor_nombre, moneda: o.moneda || 'PEN',
    importe: round2(Number(o.subtotal || 0) + Number(o.igv || 0) + Number(o.no_gravado || 0)),
    tipoCambio: o.tipo_cambio || 1, total: o.total, sucursal: o.sucursal_nombre,
    estadoLabel: o.estado === 'anulada' ? 'Anulada' : o.estado === 'recibida' ? 'Recibida' : 'Pendiente',
    badgeClass: o.estado === 'anulada' ? 'badge-critical' : o.estado === 'recibida' ? 'badge-good' : 'badge-warning',
    puedeAnular: o.estado === 'pendiente',
  }));
  const registros = [...registrosCompras, ...registrosOrdenes]
    .filter((r) => !documentoFiltro || r.documento === documentoFiltro)
    .sort((a, b) => (a.fecha === b.fecha ? b.id - a.id : (a.fecha < b.fecha ? 1 : -1)));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Compras</h1>
        <PeriodoContable mes={periodoMes} anio={periodoAnio} onChange={aplicarPeriodo} />
      </div>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={() => openNew('compra')}>Registrar Compras</button>
        <button className="ventas-action-btn" onClick={() => openNew('orden', 'Orden de Compra')}>Orden de Compra</button>
        <button className="ventas-action-btn" onClick={() => openNew('orden', 'Orden de Servicio')}>Orden de Servicio</button>
        <button className="ventas-action-btn" onClick={() => navigate('/compras/recepcion')}>Recepción de Compras</button>
        <button className="ventas-action-btn" onClick={() => navigate('/compras/tipos')}>Tipos de Compra</button>
      </div>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field grow">
          <label>Buscar por proveedor o RUC</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Proveedor / RUC.." />
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
          <select value={documentoFiltro} onChange={(e) => setDocumentoFiltro(e.target.value)}>
            <option value="">Todos</option>
            {Object.values(DOCUMENTO_LABEL).map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Sucursal</label>
          <input readOnly value={sucursal?.nombre || '—'} style={{ width: 120 }} />
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Registro</th>
                <th>Documento</th>
                <th>Serie</th>
                <th>Número</th>
                <th>Nro Doc</th>
                <th>Nombre o Razón Social</th>
                <th>(M)</th>
                <th style={{ textAlign: 'right' }}>Importe</th>
                <th style={{ textAlign: 'right' }}>T.C.</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <tr key={r.key}>
                  <td>{r.fecha}</td>
                  <td>{r.documento}</td>
                  <td>{r.serie}</td>
                  <td>{r.numeroDoc}</td>
                  <td>{r.ruc}</td>
                  <td>{r.nombre}</td>
                  <td>{r.moneda === 'USD' ? '$' : 'S/'}</td>
                  <td style={{ textAlign: 'right' }}>{r.importe.toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(r.tipoCambio).toFixed(3)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(r.total).toFixed(2)}</td>
                  <td>{r.sucursal || '—'}</td>
                  <td><span className={'badge ' + r.badgeClass}>{r.estadoLabel}</span></td>
                  <td>
                    {r.puedeAnular ? (
                      <button className="btn-link danger" onClick={() => (r.kind === 'compra' ? handleAnular(r.id) : handleAnularOrder(r.id))}>
                        Anular
                      </button>
                    ) : (
                      <span className="icon-link muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {registros.length === 0 && (
                <tr><td colSpan={13} className="empty-row">No hay registros en el rango seleccionado.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totals-footer">
                <td colSpan={6}>Cantidad: {registros.length}</td>
                <td colSpan={7}>
                  Gran Total S/ <input readOnly value={sumaTotal.toFixed(2)} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
            <h2>{formMode === 'orden' ? ordenDocumento : 'Registrar Compra'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="compra-header-grid">
                <div>
                  <label>Documento</label>
                  {formMode === 'orden' ? (
                    <input readOnly value={ordenDocumento} />
                  ) : (
                    <select required value={tipoComprobante} onChange={(e) => setTipoComprobante(e.target.value)}>
                      {TIPOS_COMPROBANTE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label>Proveedor</label>
                  <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">Selecciona un proveedor...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}{s.ruc ? ` (${s.ruc})` : ''}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-link" style={{ marginTop: 4 }} onClick={() => setShowSupplierForm(true)}>
                    + Nuevo proveedor
                  </button>
                </div>

                <div>
                  <label>Serie - Nro</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input required placeholder="Serie" value={docSerie} onChange={(e) => setDocSerie(e.target.value)} style={{ width: 90 }} />
                    <span>-</span>
                    <input required placeholder="Número" value={docNumero} onChange={(e) => setDocNumero(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label>Compra (destino de la operación)</label>
                  <select required value={tipoOperacion} onChange={(e) => setTipoOperacion(e.target.value)}>
                    {TIPOS_OPERACION.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                <div className="form-row" style={{ margin: 0 }}>
                  <div>
                    <label>Fecha Emisión</label>
                    <input required type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
                  </div>
                  <div>
                    <label>T.C.</label>
                    <input type="number" min="0" step="0.001" value={tipoCambio} disabled={moneda === 'PEN'}
                      onChange={(e) => setTipoCambio(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label>Observación</label>
                  <textarea rows={1} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
                </div>

                <div>
                  <label>Tipo de Compra</label>
                  <select required value={tipoCompra} onChange={(e) => setTipoCompra(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {tiposCompra.map((t) => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label>Sucursal</label>
                  <input readOnly value={sucursal?.nombre || '—'} />
                </div>

                <div>
                  <label>Moneda</label>
                  <select required value={moneda} onChange={(e) => { setMoneda(e.target.value); if (e.target.value === 'PEN') setTipoCambio(1); }}>
                    {MONEDAS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                {formMode !== 'orden' && (
                  <div>
                    <label>Forma de pago</label>
                    <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                      <option value="efectivo">Efectivo</option>
                      <option value="tarjeta">Tarjeta</option>
                      <option value="banco">Transferencia / Banco</option>
                    </select>
                  </div>
                )}
              </div>

              <label>Items</label>
              <div className="table-scroll">
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Observación</th>
                      <th>Cant.</th>
                      <th>Und.</th>
                      <th>Costo Unit.</th>
                      <th>IGV</th>
                      <th>Importe</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          <select required value={it.product_id} onChange={(e) => handleProductSelect(idx, e.target.value)}>
                            <option value="">Selecciona...</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>{p.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input value={it.observacion} style={{ width: 100 }}
                            onChange={(e) => updateItem(idx, { observacion: e.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0.01" step="0.01" style={{ width: 65 }} value={it.cantidad}
                            onChange={(e) => updateItem(idx, { cantidad: e.target.value })} />
                        </td>
                        <td>
                          <input value={it.unidad} style={{ width: 55 }}
                            onChange={(e) => updateItem(idx, { unidad: e.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" style={{ width: 85 }} value={it.costo_unitario}
                            onChange={(e) => updateItem(idx, { costo_unitario: e.target.value })} />
                        </td>
                        <td>
                          <select value={it.afectacion_igv} onChange={(e) => updateItem(idx, { afectacion_igv: e.target.value })}>
                            {AFECTACIONES_IGV.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                        </td>
                        <td>S/ {(Number(it.cantidad || 0) * Number(it.costo_unitario || 0)).toFixed(2)}</td>
                        <td>
                          {items.length > 1 && (
                            <button type="button" className="btn-link danger" onClick={() => removeItem(idx)}>x</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={addItem}>+ Agregar item</button>

              <div className="form-row" style={{ marginTop: 14 }}>
                <div>
                  <label>Descuento %</label>
                  <input type="number" min="0" max="100" step="1" value={descuentoPct}
                    onChange={(e) => setDescuentoPct(e.target.value)} />
                </div>
                <div>
                  <label>Percepción S/</label>
                  <input type="number" min="0" step="0.01" value={percepcion}
                    onChange={(e) => setPercepcion(e.target.value)} />
                </div>
              </div>

              <div className="totals-box">
                <div><span>Subtotal:</span><span>S/ {subtotal.toFixed(2)}</span></div>
                <div><span>No Gravado:</span><span>S/ {noGravado.toFixed(2)}</span></div>
                <div><span>IGV ({Math.round(igvRate * 100)}%):</span><span>S/ {igv.toFixed(2)}</span></div>
                <div className="totals-final"><span>Total:</span><span>S/ {total.toFixed(2)}</span></div>
              </div>

              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{formMode === 'orden' ? 'Guardar' : 'Registrar Compra'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSupplierForm && (
        <div className="modal-overlay" onClick={() => setShowSupplierForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nuevo proveedor</h2>
            <form onSubmit={handleNewSupplier}>
              <label>Nombre / Razón social</label>
              <input required value={newSupplier.nombre} onChange={(e) => setNewSupplier((s) => ({ ...s, nombre: e.target.value }))} />
              <label>RUC</label>
              <input value={newSupplier.ruc} onChange={(e) => setNewSupplier((s) => ({ ...s, ruc: e.target.value }))} />
              <label>Dirección</label>
              <input value={newSupplier.direccion} onChange={(e) => setNewSupplier((s) => ({ ...s, direccion: e.target.value }))} />
              <label>Teléfono</label>
              <input value={newSupplier.telefono} onChange={(e) => setNewSupplier((s) => ({ ...s, telefono: e.target.value }))} />
              <label>Email</label>
              <input value={newSupplier.email} onChange={(e) => setNewSupplier((s) => ({ ...s, email: e.target.value }))} />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSupplierForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Crear proveedor</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
