import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

const ESTADO_LABEL = { pendiente: 'Pendiente', recibida: 'Recibida', anulada: 'Anulada' };
const ESTADO_BADGE = { pendiente: 'badge-warning', recibida: 'badge-good', anulada: 'badge-critical' };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function RecepcionCompras() {
  const navigate = useNavigate();
  const toast = useToast();
  const { sucursal } = useAuth();

  const [orders, setOrders] = useState([]);
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [estado, setEstado] = useState('');

  const [showPicker, setShowPicker] = useState(false);
  const [pendientes, setPendientes] = useState([]);
  const [recibiendoId, setRecibiendoId] = useState(null);

  function load() {
    const params = {};
    if (desde) params.from = desde;
    if (hasta) params.to = hasta;
    if (q) params.q = q;
    if (estado) params.estado = estado;
    api.get('/purchase-orders', { params }).then((res) => setOrders(res.data));
  }

  useEffect(() => { load(); }, []);

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  function abrirRegistrarRecepcion() {
    api.get('/purchase-orders', { params: { estado: 'pendiente' } }).then((res) => {
      setPendientes(res.data);
      setShowPicker(true);
    });
  }

  async function recibir(id) {
    setRecibiendoId(id);
    try {
      await api.post(`/purchase-orders/${id}/recibir`);
      toast.success('Recepción registrada: el stock ya fue ingresado.');
      setShowPicker(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo registrar la recepción.');
    } finally {
      setRecibiendoId(null);
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Compras" onClick={() => navigate('/compras')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        RECEPCIÓN DE COMPRAS
      </h1>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={abrirRegistrarRecepcion}>Registrar Recepción</button>
      </div>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field grow">
          <label>Nombre o razón social</label>
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
          <label>Sucursal</label>
          <input readOnly value={sucursal?.nombre || '—'} style={{ width: 130 }} />
        </div>
        <div className="filter-field">
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="pendiente">Pendiente</option>
            <option value="recibida">Recibida</option>
            <option value="anulada">Anulada</option>
          </select>
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
                <th>Fecha Registro</th>
                <th>Fecha Recepción</th>
                <th>Documento</th>
                <th>Sucursal</th>
                <th>Nombre o Razón Social</th>
                <th>Moneda</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
                <th>Usuario</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.fecha}</td>
                  <td>{o.fecha_recepcion || '—'}</td>
                  <td>{o.serie ? `${o.serie}-${o.numero_doc}` : String(o.numero).padStart(5, '0')}</td>
                  <td>{o.sucursal_nombre || '—'}</td>
                  <td>{o.proveedor_nombre}</td>
                  <td>{o.moneda}</td>
                  <td style={{ textAlign: 'right' }}>S/ {Number(o.total).toFixed(2)}</td>
                  <td><span className={'badge ' + ESTADO_BADGE[o.estado]}>{ESTADO_LABEL[o.estado] || o.estado}</span></td>
                  <td>{o.usuario_nombre || '—'}</td>
                  <td>
                    {o.estado === 'pendiente' ? (
                      <button className="btn-link" disabled={recibiendoId === o.id} onClick={() => recibir(o.id)}>
                        {recibiendoId === o.id ? 'Recibiendo...' : 'Recibir'}
                      </button>
                    ) : (
                      <span className="icon-link muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={10} className="empty-row">No hay órdenes de compra en el rango seleccionado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showPicker && (
        <div className="modal-overlay" onClick={() => setShowPicker(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar Recepción</h2>
            <p style={{ color: 'var(--ink-secondary)', fontSize: 13.5, marginTop: -4 }}>
              Elige la orden de compra que llegó, para ingresar su stock.
            </p>
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Documento</th>
                    <th>Proveedor</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((o) => (
                    <tr key={o.id}>
                      <td>{o.fecha}</td>
                      <td>{o.serie ? `${o.serie}-${o.numero_doc}` : String(o.numero).padStart(5, '0')}</td>
                      <td>{o.proveedor_nombre}</td>
                      <td style={{ textAlign: 'right' }}>S/ {Number(o.total).toFixed(2)}</td>
                      <td>
                        <button className="btn-secondary" disabled={recibiendoId === o.id} onClick={() => recibir(o.id)}>
                          {recibiendoId === o.id ? 'Recibiendo...' : 'Recibir'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {pendientes.length === 0 && (
                    <tr><td colSpan={5} className="empty-row">No hay órdenes de compra pendientes.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowPicker(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
