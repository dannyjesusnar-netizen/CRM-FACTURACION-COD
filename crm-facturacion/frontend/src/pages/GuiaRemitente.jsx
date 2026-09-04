import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { hoyPeru } from '../utils/fechas';
import { useToast } from '../context/ToastContext';
import ProductSearchBar from '../components/ProductSearchBar';
import ClientPicker from '../components/ClientPicker';
import ConfirmDialog from '../components/ConfirmDialog';

const MOTIVOS = [
  { value: 'venta', label: 'Venta' },
  { value: 'compra', label: 'Compra' },
  { value: 'traslado_entre_establecimientos', label: 'Traslado entre establecimientos' },
  { value: 'consignacion', label: 'Consignación' },
  { value: 'otros', label: 'Otros' },
];

function todayStr() {
  return hoyPeru();
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function GuiaRemitente() {
  const navigate = useNavigate();
  const toast = useToast();

  const [serie, setSerie] = useState('');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState(todayStr());
  const [motivo, setMotivo] = useState('venta');
  const [cliente, setCliente] = useState(null);
  const [puntoPartida, setPuntoPartida] = useState('');
  const [puntoLlegada, setPuntoLlegada] = useState('');
  const [items, setItems] = useState([]);
  const [observaciones, setObservaciones] = useState('');
  const [cantidadBultos, setCantidadBultos] = useState(0);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);

  useEffect(() => {
    api.get('/guias/siguiente-numero').then((res) => {
      setSerie(res.data.serie);
      setNumero(res.data.numero);
    });
  }, []);

  function addProducto(p) {
    setItems((prev) => [...prev, {
      product_id: p.id,
      descripcion: p.nombre,
      stock: p.stock,
      unidad: p.unidad,
      cantidad: 1,
      peso_unitario: p.peso || 0,
    }]);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const computed = useMemo(() => {
    let pesoTotal = 0;
    const rows = items.map((it) => {
      const cantidad = Number(it.cantidad || 0);
      const pesoUnit = Number(it.peso_unitario || 0);
      const pesoSubtotal = round2(cantidad * pesoUnit);
      pesoTotal += pesoSubtotal;
      return { ...it, pesoSubtotal };
    });
    return { rows, pesoTotal: round2(pesoTotal) };
  }, [items]);

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (items.length === 0) { setError('Agrega al menos un producto.'); return; }
    setShowConfirm(true);
  }

  async function confirmarEmision() {
    setEmitiendo(true);
    try {
      await api.post('/guias', {
        client_id: cliente ? cliente.id : null,
        motivo_traslado: motivo,
        punto_partida: puntoPartida,
        punto_llegada: puntoLlegada,
        cantidad_bultos: Number(cantidadBultos || 0),
        observaciones,
        numero: numero || undefined,
        items: computed.rows.map((it) => ({
          product_id: it.product_id,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          peso_unitario: Number(it.peso_unitario || 0),
        })),
      });
      toast.success('Guía de remisión registrada correctamente.');
      navigate('/ventas');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar la guía.');
      setShowConfirm(false);
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <div className="venta-page">
      <h1 className="page-title">Guía Remitente</h1>

      <form onSubmit={handleSubmit}>
        <div className="venta-panel">
          <div className="venta-fields-row">
            <div className="filter-field">
              <label>Tipo Comprobante</label>
              <input value="Guía remitente" readOnly />
            </div>
            <div className="venta-doc-group">
              <div className="filter-field">
                <label>Documento</label>
                <input value={serie} readOnly style={{ width: 70 }} />
              </div>
              <span>-</span>
              <div className="filter-field">
                <label>&nbsp;</label>
                <input type="number" value={numero} onChange={(e) => setNumero(e.target.value)} style={{ width: 80 }} />
              </div>
            </div>
            <div className="filter-field">
              <label>Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Motivo Traslado</label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MOTIVOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          <div className="venta-fields-row">
            <ClientPicker value={cliente} onChange={setCliente} />
          </div>

          <div className="venta-fields-row">
            <div className="filter-field grow">
              <label>Punto de Partida</label>
              <input value={puntoPartida} onChange={(e) => setPuntoPartida(e.target.value)} placeholder="Dirección de partida" />
            </div>
            <div className="filter-field grow">
              <label>Punto de Llegada</label>
              <input value={puntoLlegada} onChange={(e) => setPuntoLlegada(e.target.value)} placeholder="Dirección de llegada" />
            </div>
          </div>

          <div className="venta-fields-row">
            <ProductSearchBar onSelect={addProducto} />
          </div>

          <div className="table-scroll">
            <table className="venta-table">
              <thead>
                <tr>
                  <th className="col-desc">Descripción</th>
                  <th className="num">Stock</th>
                  <th>Cantidad</th>
                  <th>Uni. Med.</th>
                  <th className="num">Peso</th>
                  <th className="num">Peso Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {computed.rows.map((it, idx) => (
                  <tr key={idx}>
                    <td className="col-desc">{it.descripcion}</td>
                    <td className="num">{it.stock ?? '—'}</td>
                    <td>
                      <input type="number" min="1" step="1" value={it.cantidad}
                        onChange={(e) => updateItem(idx, { cantidad: e.target.value })} />
                    </td>
                    <td>{it.unidad}</td>
                    <td className="num">
                      <input type="number" min="0" step="0.01" value={it.peso_unitario}
                        onChange={(e) => updateItem(idx, { peso_unitario: e.target.value })} />
                    </td>
                    <td className="num">{it.pesoSubtotal.toFixed(2)}</td>
                    <td><button type="button" className="btn-link danger" onClick={() => removeItem(idx)}>x</button></td>
                  </tr>
                ))}
                {computed.rows.length === 0 && (
                  <tr><td colSpan={7} className="venta-table-empty">Busca un producto arriba para agregarlo.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="venta-bottom-row">
            <div className="venta-bottom-left">
              <label>Observación</label>
              <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            </div>
            <div className="venta-bottom-right">
              <div className="venta-totals-row">
                <span>Peso Total:</span>
                <input readOnly value={computed.pesoTotal.toFixed(2)} />
              </div>
              <div className="venta-totals-row">
                <span>Cantidad Bultos:</span>
                <input type="number" min="0" step="1" value={cantidadBultos} onChange={(e) => setCantidadBultos(e.target.value)} />
              </div>
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="venta-actions-row">
            <button type="submit" className="btn-primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }}>Emitir</button>
            <button type="button" className="btn-secondary" style={{ color: 'var(--critical)', borderColor: 'var(--critical)' }} onClick={() => navigate('/ventas')}>Cancelar</button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={showConfirm}
        message="Se emitirá la guía de remisión y ya no podrás editarla."
        loading={emitiendo}
        onConfirm={confirmarEmision}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
