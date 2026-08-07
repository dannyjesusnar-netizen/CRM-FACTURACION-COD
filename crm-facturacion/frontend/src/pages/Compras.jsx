import { useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const FORMA_PAGO_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', banco: 'Transferencia/Banco' };

function emptyItem() {
  return { product_id: '', cantidad: 1, costo_unitario: 0 };
}

function emptySupplier() {
  return { ruc: '', nombre: '', direccion: '', telefono: '', email: '' };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Compras() {
  const toast = useToast();
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  const [q, setQ] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());

  const [showForm, setShowForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [error, setError] = useState('');

  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [observaciones, setObservaciones] = useState('');
  const [formaPago, setFormaPago] = useState('efectivo');
  const [newSupplier, setNewSupplier] = useState(emptySupplier());
  const [igvRate, setIgvRate] = useState(0.18);

  function load() {
    const params = {};
    if (desde) params.from = desde;
    if (hasta) params.to = hasta;
    if (q) params.q = q;
    api.get('/purchases', { params }).then((res) => setPurchases(res.data));
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

  function openNew() {
    setSupplierId('');
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
    updateItem(idx, { product_id: prod ? prod.id : '' });
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const total = items.reduce((sum, it) => sum + Number(it.cantidad || 0) * Number(it.costo_unitario || 0), 0);
  const subtotal = total / (1 + igvRate);
  const igv = total - subtotal;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!supplierId) { setError('Selecciona un proveedor.'); return; }
    if (items.length === 0 || items.some((it) => !it.product_id || !it.cantidad)) {
      setError('Completa todos los items (producto y cantidad).');
      return;
    }
    try {
      await api.post('/purchases', {
        supplier_id: Number(supplierId),
        items: items.map((it) => ({
          product_id: Number(it.product_id),
          cantidad: Number(it.cantidad),
          costo_unitario: Number(it.costo_unitario),
        })),
        observaciones,
        forma_pago: formaPago,
      });
      setShowForm(false);
      toast.success('Compra registrada correctamente.');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar la compra.');
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
      <h1 className="page-title">Compras</h1>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={openNew}>+ Nueva compra</button>
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

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Nueva compra</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
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
                  <label>Forma de pago</label>
                  <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="banco">Transferencia / Banco</option>
                  </select>
                </div>
              </div>

              <label>Items</label>
              <table className="items-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cant.</th>
                    <th>Costo Unit.</th>
                    <th>Subtotal</th>
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
                        <input type="number" min="0.01" step="0.01" style={{ width: 70 }} value={it.cantidad}
                          onChange={(e) => updateItem(idx, { cantidad: e.target.value })} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" style={{ width: 90 }} value={it.costo_unitario}
                          onChange={(e) => updateItem(idx, { costo_unitario: e.target.value })} />
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
              <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={addItem}>+ Agregar item</button>

              <div className="totals-box">
                <div><span>Subtotal (sin IGV):</span><span>S/ {subtotal.toFixed(2)}</span></div>
                <div><span>IGV ({Math.round(igvRate * 100)}%):</span><span>S/ {igv.toFixed(2)}</span></div>
                <div className="totals-final"><span>Total:</span><span>S/ {total.toFixed(2)}</span></div>
              </div>

              <label>Observaciones</label>
              <textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />

              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Registrar compra</button>
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
