import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { hoyPeru } from '../utils/fechas';
import { useToast } from '../context/ToastContext';
import ExportButton from '../components/ExportButton';
import { exportarTabla } from '../utils/excelImport';

function emptyItem() {
  return { product_id: '', cantidad: 1, lote_id: '' };
}

function todayStr() {
  return hoyPeru();
}

export default function Traslados() {
  const toast = useToast();
  const navigate = useNavigate();
  const [traslados, setTraslados] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [productos, setProductos] = useState([]);

  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [estado, setEstado] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [stockPorSucursal, setStockPorSucursal] = useState({}); // productId -> [{sucursal_id, stock}]
  const [lotesPorProducto, setLotesPorProducto] = useState({}); // productId -> [{id, codigo_lote, fecha_vencimiento, cantidad_actual}]
  const [error, setError] = useState('');

  function load() {
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    if (estado) params.estado = estado;
    api.get('/traslados', { params }).then((res) => setTraslados(res.data));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get('/sucursales').then((res) => setSucursales(res.data));
    api.get('/products').then((res) => setProductos(res.data.filter((p) => p.tipo === 'producto')));
  }, []);

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  function openNew() {
    setOrigenId(sucursales.find((s) => s.es_principal)?.id || '');
    setDestinoId('');
    setObservaciones('');
    setItems([emptyItem()]);
    setStockPorSucursal({});
    setLotesPorProducto({});
    setError('');
    setShowForm(true);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleProductSelect(idx, productId) {
    updateItem(idx, { product_id: productId, lote_id: '' });
    if (productId && !stockPorSucursal[productId]) {
      const res = await api.get(`/traslados/stock/${productId}`);
      setStockPorSucursal((prev) => ({ ...prev, [productId]: res.data }));
    }
    if (productId && !lotesPorProducto[productId]) {
      const res = await api.get(`/traslados/lotes/${productId}`);
      setLotesPorProducto((prev) => ({ ...prev, [productId]: res.data }));
    }
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function stockEnOrigen(productId) {
    const rows = stockPorSucursal[productId];
    if (!rows || !origenId) return null;
    const row = rows.find((r) => String(r.sucursal_id) === String(origenId));
    return row ? row.stock : 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!origenId || !destinoId) { setError('Selecciona sucursal de origen y destino.'); return; }
    if (origenId === destinoId) { setError('La sucursal de origen y destino no pueden ser la misma.'); return; }
    if (items.some((it) => !it.product_id || !it.cantidad)) { setError('Completa todos los items.'); return; }
    try {
      await api.post('/traslados', {
        sucursal_origen_id: Number(origenId),
        sucursal_destino_id: Number(destinoId),
        observaciones,
        items: items.map((it) => ({ product_id: Number(it.product_id), cantidad: Number(it.cantidad), lote_id: it.lote_id ? Number(it.lote_id) : null })),
      });
      toast.success('Traslado registrado correctamente.');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el traslado.');
    }
  }

  async function handleAnular(id) {
    if (!window.confirm('¿Anular este traslado? El stock volverá a la sucursal de origen.')) return;
    try {
      await api.post(`/traslados/${id}/anular`);
      toast.success('Traslado anulado.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo anular el traslado.');
    }
  }

  async function handleExportar(formato) {
    const header = ['Fecha', 'Código', 'Operación', 'Sucursal Origen', 'Emisor', 'Sucursal Destino', 'Estado', 'Observaciones'];
    const rows = traslados.map((t) => [
      t.created_at, t.codigo, 'Traslado', t.sucursal_origen_nombre, t.emisor_nombre || '',
      t.sucursal_destino_nombre, t.estado, t.observaciones || '',
    ]);
    await exportarTabla(`traslados_${desde}_a_${hasta}`, header, rows, formato);
    toast.success(`Archivo ${formato === 'excel' ? 'Excel' : 'CSV'} exportado.`);
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-link" title="Volver a Inventario" onClick={() => navigate('/productos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <ArrowLeft size={20} />
          </button>
          TRASLADOS
        </h1>
      </div>

      <div className="ventas-actions" style={{ gridTemplateColumns: '1fr' }}>
        <button className="ventas-action-btn" onClick={openNew}>+ Registrar Traslado</button>
      </div>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="completado">Completado</option>
            <option value="anulado">Anulado</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
          <ExportButton onExport={handleExportar} />
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th><th>Código</th><th>Operación</th><th>Sucursal Origen</th>
                <th>Emisor</th><th>Sucursal Destino</th><th>Estado</th><th>Observaciones</th><th></th>
              </tr>
            </thead>
            <tbody>
              {traslados.map((t) => (
                <tr key={t.id}>
                  <td>{t.created_at}</td>
                  <td>{t.codigo}</td>
                  <td>Traslado</td>
                  <td>{t.sucursal_origen_nombre}</td>
                  <td>{t.emisor_nombre || '—'}</td>
                  <td>{t.sucursal_destino_nombre}</td>
                  <td><span className={'badge ' + (t.estado === 'anulado' ? 'badge-critical' : 'badge-good')}>{t.estado === 'anulado' ? 'Anulado' : 'Completado'}</span></td>
                  <td>{t.observaciones || '—'}</td>
                  <td>
                    {t.estado === 'completado' ? (
                      <button className="btn-link danger" onClick={() => handleAnular(t.id)}>Anular</button>
                    ) : (
                      <span className="icon-link muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {traslados.length === 0 && (
                <tr><td colSpan={9} className="empty-row">No hay traslados en el rango seleccionado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar traslado</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div>
                  <label>Sucursal Origen</label>
                  <select required value={origenId} onChange={(e) => setOrigenId(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label>Sucursal Destino</label>
                  <select required value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {sucursales.filter((s) => String(s.id) !== String(origenId)).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              </div>

              <label>Productos a trasladar</label>
              <table className="items-table">
                <thead>
                  <tr>
                    <th>Producto</th><th>Stock en origen</th><th>Lote</th><th>Cantidad a trasladar</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const lotesProducto = it.product_id ? lotesPorProducto[it.product_id] : null;
                    return (
                      <tr key={idx}>
                        <td>
                          <select value={it.product_id} onChange={(e) => handleProductSelect(idx, e.target.value)}>
                            <option value="">Selecciona un producto...</option>
                            {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
                          </select>
                        </td>
                        <td>{it.product_id ? (stockEnOrigen(it.product_id) ?? '...') : '—'}</td>
                        <td>
                          {it.product_id && lotesProducto?.length > 0 ? (
                            <select value={it.lote_id} onChange={(e) => updateItem(idx, { lote_id: e.target.value })}>
                              <option value="">Sin lote</option>
                              {lotesProducto.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.codigo_lote}{l.fecha_vencimiento ? ` (vence ${l.fecha_vencimiento})` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="icon-link muted">—</span>
                          )}
                        </td>
                        <td>
                          <input type="number" min="1" step="1" style={{ width: 90 }} value={it.cantidad}
                            onChange={(e) => updateItem(idx, { cantidad: e.target.value })} />
                        </td>
                        <td>
                          {items.length > 1 && (
                            <button type="button" className="btn-link danger" onClick={() => removeItem(idx)}>x</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={addItem}>+ Agregar producto</button>

              <label>Observaciones</label>
              <textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />

              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Registrar traslado</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
