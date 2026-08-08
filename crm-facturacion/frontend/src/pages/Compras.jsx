import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import PeriodoContable from '../components/PeriodoContable';

const FORMA_PAGO_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', banco: 'Transferencia/Banco' };

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
const TIPOS_COMPRA = [
  { value: 'mercaderia', label: 'Mercadería' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'activo_fijo', label: 'Activo Fijo' },
  { value: 'envase_embalaje', label: 'Envase/Embalaje' },
  { value: 'otros', label: 'Otros' },
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
  const hoy = new Date();
  const [periodoMes, setPeriodoMes] = useState(hoy.getMonth() + 1);
  const [periodoAnio, setPeriodoAnio] = useState(hoy.getFullYear());

  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState('compra'); // 'compra' | 'orden'
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [error, setError] = useState('');

  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [observaciones, setObservaciones] = useState('');
  const [formaPago, setFormaPago] = useState('efectivo');
  const [newSupplier, setNewSupplier] = useState(emptySupplier());
  const [igvRate, setIgvRate] = useState(0.18);

  const [tipoComprobante, setTipoComprobante] = useState('factura');
  const [docSerie, setDocSerie] = useState('');
  const [docNumero, setDocNumero] = useState('');
  const [fechaEmision, setFechaEmision] = useState(todayStr());
  const [moneda, setMoneda] = useState('PEN');
  const [tipoCambio, setTipoCambio] = useState(1);
  const [tipoCompra, setTipoCompra] = useState('mercaderia');
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
  }, []);

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  function openNew(mode = 'compra') {
    setFormMode(mode);
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
    setTipoCompra('mercaderia');
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
        await api.post('/purchase-orders', payload);
        toast.success('Orden de compra guardada correctamente.');
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Compras</h1>
        <PeriodoContable mes={periodoMes} anio={periodoAnio} onChange={aplicarPeriodo} />
      </div>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={() => openNew('compra')}>Registrar Compras</button>
        <button className="ventas-action-btn" onClick={() => openNew('orden')}>Orden de Compra</button>
        <button className="ventas-action-btn" onClick={() => navigate('/compras/recepcion')}>Recepción de Compras</button>
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
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Nro</th>
                <th>Proveedor</th>
                <th>RUC</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Forma de pago</th>
                <th>Estado</th>
                <th>Baja</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td>{p.fecha}</td>
                  <td>{String(p.numero).padStart(5, '0')}</td>
                  <td>{p.proveedor_nombre}</td>
                  <td>{p.proveedor_ruc}</td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(p.subtotal).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(p.total).toFixed(2)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{FORMA_PAGO_LABEL[p.forma_pago] || p.forma_pago}</td>
                  <td>
                    <span className={'badge ' + (p.estado === 'anulada' ? 'badge-critical' : 'badge-good')}>
                      {p.estado === 'anulada' ? 'Anulada' : 'Registrada'}
                    </span>
                  </td>
                  <td>
                    {p.estado === 'registrada' ? (
                      <button className="btn-link danger" onClick={() => handleAnular(p.id)}>Anular</button>
                    ) : (
                      <span className="icon-link muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {purchases.length === 0 && (
                <tr><td colSpan={9} className="empty-row">No hay compras en el rango seleccionado.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totals-footer">
                <td colSpan={5}>Cantidad: {vigentes.length}</td>
                <td colSpan={4}>
                  Gran Total S/ <input readOnly value={sumaTotal.toFixed(2)} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <h2 className="page-title" style={{ fontSize: 16, marginTop: 28 }}>Órdenes de Compra</h2>
      <div className="panel">
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Nro</th>
                <th>Proveedor</th>
                <th>RUC</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
                <th>Baja</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.fecha}</td>
                  <td>{String(o.numero).padStart(5, '0')}</td>
                  <td>{o.proveedor_nombre}</td>
                  <td>{o.proveedor_ruc}</td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(o.total).toFixed(2)}</td>
                  <td>
                    <span className={'badge ' + (o.estado === 'anulada' ? 'badge-critical' : o.estado === 'recibida' ? 'badge-good' : 'badge-warning')}>
                      {o.estado === 'anulada' ? 'Anulada' : o.estado === 'recibida' ? 'Recibida' : 'Pendiente'}
                    </span>
                  </td>
                  <td>
                    {o.estado === 'pendiente' ? (
                      <button className="btn-link danger" onClick={() => handleAnularOrder(o.id)}>Anular</button>
                    ) : (
                      <span className="icon-link muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={7} className="empty-row">No hay órdenes de compra en el rango seleccionado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
            <h2>{formMode === 'orden' ? 'Orden de Compra' : 'Registrar Compra'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="compra-header-grid">
                <div>
                  <label>Documento</label>
                  {formMode === 'orden' ? (
                    <input readOnly value="Orden de Compra" />
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
                    {TIPOS_COMPRA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
