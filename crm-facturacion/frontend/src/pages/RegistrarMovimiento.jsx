import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function nuevaFilaId() {
  return `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

export default function RegistrarMovimiento() {
  const navigate = useNavigate();
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [canales, setCanales] = useState([]);

  const [productId, setProductId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [canal, setCanal] = useState('Compras');
  const [motivo, setMotivo] = useState('');
  const [codigoLote, setCodigoLote] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');

  const [filas, setFilas] = useState([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { api.get('/products').then((res) => setProducts(res.data)); }, []);
  useEffect(() => {
    api.get('/movements/canales').then((res) => {
      setCanales(res.data);
      const compras = res.data.find((c) => c.nombre === 'Compras') || res.data[0];
      if (compras) setCanal(compras.nombre);
    });
  }, []);

  const esIngreso = Number(cantidad) > 0;
  const productosDisponibles = products.filter((p) => p.tipo === 'producto');
  const productoSeleccionado = productosDisponibles.find((p) => String(p.id) === String(productId));

  function limpiarFormulario() {
    setProductId('');
    setCantidad('');
    setMotivo('');
    setCodigoLote('');
    setFechaVencimiento('');
  }

  function agregarFila() {
    if (!productId) { toast.error('Selecciona un producto.'); return; }
    if (!cantidad || Number(cantidad) === 0) { toast.error('Ingresa una cantidad distinta de cero.'); return; }
    const producto = productosDisponibles.find((p) => String(p.id) === String(productId));
    setFilas((prev) => [...prev, {
      id: nuevaFilaId(),
      product_id: Number(productId),
      codigo: producto?.codigo || '',
      producto_nombre: producto?.nombre || '',
      cantidad: Number(cantidad),
      canal,
      motivo: motivo.trim(),
      codigo_lote: Number(cantidad) > 0 ? codigoLote.trim() : '',
      fecha_vencimiento: Number(cantidad) > 0 ? fechaVencimiento : '',
    }]);
    toast.success('Fila agregada. Selecciona el siguiente producto.');
    limpiarFormulario();
  }

  function eliminarFila(id) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  function actualizarFila(id, campo, valor) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  async function handleRegistrarTodo() {
    if (filas.length === 0) { toast.error('Agrega al menos una fila antes de registrar.'); return; }
    setEnviando(true);
    let creados = 0;
    const errores = [];
    for (const f of filas) {
      try {
        await api.post('/movements', {
          product_id: f.product_id,
          cantidad: f.cantidad,
          motivo: f.motivo,
          canal: f.canal,
          codigo_lote: f.cantidad > 0 ? f.codigo_lote : undefined,
          fecha_vencimiento: f.cantidad > 0 ? (f.fecha_vencimiento || undefined) : undefined,
        });
        creados += 1;
      } catch (err) {
        errores.push(`${f.codigo} — ${err.response?.data?.error || 'error desconocido'}`);
      }
    }
    setEnviando(false);
    if (creados > 0) toast.success(`${creados} movimiento(s) registrado(s).`);
    if (errores.length > 0) {
      toast.error(`${errores.length} fila(s) no se pudieron registrar.`);
      setFilas((prev) => prev.filter((f) => errores.some((e) => e.startsWith(f.codigo))));
      return;
    }
    setFilas([]);
    navigate('/movimientos');
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Movimientos" onClick={() => navigate('/movimientos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        REGISTRAR MOVIMIENTO
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Elige un producto ya existente y solo ajusta la cantidad — positiva para un ingreso, negativa para una
        salida. Agrega tantas filas como necesites y al final regístralas todas juntas.
      </p>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Agregar producto</h3>
        <label>Producto</label>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Selecciona un producto...</option>
          {productosDisponibles.map((p) => (
            <option key={p.id} value={p.id}>{p.codigo} — {p.nombre} (stock actual: {p.stock})</option>
          ))}
        </select>
        {productoSeleccionado && (
          <p className="caja-row-auto">Stock actual en el sistema: {productoSeleccionado.stock} {productoSeleccionado.unidad}</p>
        )}

        <label style={{ marginTop: 10 }}>Cantidad (positivo = ingreso, negativo = salida)</label>
        <input type="number" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 10 ó -5" />

        <label style={{ marginTop: 10 }}>Canal</label>
        <select value={canal} onChange={(e) => setCanal(e.target.value)}>
          {canales.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
        </select>

        <label style={{ marginTop: 10 }}>Motivo (opcional)</label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Conteo físico, mercadería dañada..." />

        {esIngreso && (
          <>
            <label style={{ marginTop: 10 }}>N.º de lote (opcional)</label>
            <input value={codigoLote} onChange={(e) => setCodigoLote(e.target.value)} placeholder="Ej: L-2026-08" />
            <label style={{ marginTop: 10 }}>Fecha de vencimiento (opcional)</label>
            <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} disabled={!codigoLote} />
            <p className="caja-row-auto" style={{ marginTop: -4 }}>
              Si ingresas un N.º de lote, este ingreso también quedará registrado en Lotes y Series.
            </p>
          </>
        )}

        <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
          <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={agregarFila}>
            Agregar a la lista
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>Movimientos por registrar ({filas.length})</h3>
          <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={handleRegistrarTodo} disabled={enviando || filas.length === 0}>
            {enviando ? 'Registrando...' : 'Registrar todo'}
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Producto</th><th>Cantidad</th><th>Canal</th><th>Motivo</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.codigo} — {f.producto_nombre}</td>
                  <td style={{ textAlign: 'right' }}>{f.cantidad > 0 ? `+${f.cantidad}` : f.cantidad}</td>
                  <td>
                    <select value={f.canal} onChange={(e) => actualizarFila(f.id, 'canal', e.target.value)}>
                      {canales.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                    </select>
                  </td>
                  <td>
                    <input value={f.motivo} onChange={(e) => actualizarFila(f.id, 'motivo', e.target.value)} style={{ minWidth: 140 }} />
                  </td>
                  <td className="row-actions">
                    <button className="btn-link danger" onClick={() => eliminarFila(f.id)} title="Quitar de la lista">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={5} className="empty-row">Todavía no agregaste ningún movimiento.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
