import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import ProductSearchBar from '../components/ProductSearchBar';

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
  const [proveedorRuc, setProveedorRuc] = useState('');
  const [proveedorNombre, setProveedorNombre] = useState('');
  const [buscandoProveedor, setBuscandoProveedor] = useState(false);
  const [lotesProducto, setLotesProducto] = useState([]);
  const [loteIdSalida, setLoteIdSalida] = useState('');

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

  // Autocompletar el nombre del proveedor apenas se completa un RUC válido
  // (11 dígitos) — primero busca en Proveedores (Compras), si no consulta
  // SUNAT. Si no encuentra nada, no bloquea: la persona escribe el nombre
  // a mano.
  useEffect(() => {
    const ruc = proveedorRuc.trim();
    if (ruc.length !== 11) return;
    let cancelado = false;
    setBuscandoProveedor(true);
    api.get('/movements/consultar-proveedor', { params: { ruc } })
      .then((res) => {
        if (cancelado || !res.data.encontrado) return;
        setProveedorNombre((actual) => (proveedorRuc.trim() === ruc ? res.data.nombre : actual));
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setBuscandoProveedor(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorRuc]);

  const esIngreso = Number(cantidad) > 0;
  const esSalida = Number(cantidad) < 0;
  const productosDisponibles = products.filter((p) => p.tipo === 'producto');
  const productoSeleccionado = productosDisponibles.find((p) => String(p.id) === String(productId));

  // Al registrar una salida, se puede elegir de qué lote/serie específico
  // sale la mercadería (para trazabilidad) — se listan solo los lotes de
  // ESTE producto que todavía tienen stock. Es opcional: sin elegir uno, la
  // salida descuenta del stock general del producto, como antes.
  useEffect(() => {
    if (esSalida && productId) {
      api.get('/lotes', { params: { product_id: productId, mostrar: 'con_stock' } })
        .then((res) => setLotesProducto(res.data))
        .catch(() => setLotesProducto([]));
    } else {
      setLotesProducto([]);
    }
    setLoteIdSalida('');
  }, [esSalida, productId]);

  function limpiarFormulario() {
    setProductId('');
    setCantidad('');
    setMotivo('');
    setCodigoLote('');
    setFechaVencimiento('');
    setProveedorRuc('');
    setProveedorNombre('');
    setLoteIdSalida('');
  }

  function agregarFila() {
    if (!productId) { toast.error('Selecciona un producto.'); return; }
    if (!cantidad || Number(cantidad) === 0) { toast.error('Ingresa una cantidad distinta de cero.'); return; }
    if (proveedorRuc.trim() && proveedorRuc.trim().length !== 11) {
      toast.error('El RUC del proveedor debe tener 11 dígitos.');
      return;
    }
    const producto = productosDisponibles.find((p) => String(p.id) === String(productId));
    const loteSeleccionado = esSalida ? lotesProducto.find((l) => String(l.id) === String(loteIdSalida)) : null;
    setFilas((prev) => [...prev, {
      id: nuevaFilaId(),
      product_id: Number(productId),
      codigo: producto?.codigo || '',
      producto_nombre: producto?.nombre || '',
      unidad: producto?.unidad || '',
      cantidad: Number(cantidad),
      canal,
      motivo: motivo.trim(),
      codigo_lote: Number(cantidad) > 0 ? codigoLote.trim() : '',
      fecha_vencimiento: Number(cantidad) > 0 ? fechaVencimiento : '',
      lote_id: loteSeleccionado ? loteSeleccionado.id : '',
      lote_codigo: loteSeleccionado ? loteSeleccionado.codigo_lote : '',
      proveedor_ruc: proveedorRuc.trim(),
      proveedor_nombre: proveedorNombre.trim(),
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
          lote_id: f.cantidad < 0 ? (f.lote_id || undefined) : undefined,
          proveedor_ruc: f.proveedor_ruc || undefined,
          proveedor_nombre: f.proveedor_nombre || undefined,
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
    // Se navega a la constancia con una copia de las filas recién
    // registradas (ya no viven en el servidor como un solo "comprobante",
    // así que se arma acá mismo, con los mismos datos que se acaban de
    // mandar) — igual que Mi Cierre de Caja, pensada para capturarla o
    // imprimirla antes de seguir.
    const filasRegistradas = filas;
    setFilas([]);
    navigate('/movimientos/constancia', { state: { filas: filasRegistradas } });
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
        {productoSeleccionado ? (
          <p className="caja-row-auto">
            <strong>{productoSeleccionado.codigo} — {productoSeleccionado.nombre}</strong>
            {' '}(stock actual: {productoSeleccionado.stock} {productoSeleccionado.unidad}){' '}
            <button type="button" className="btn-link" onClick={() => setProductId('')}>Cambiar</button>
          </p>
        ) : (
          <ProductSearchBar
            placeholder="Buscar producto por nombre, código o código de barras..."
            onSelect={(p) => {
              if (p.tipo !== 'producto') { toast.error('Los servicios no tienen stock — selecciona un producto.'); return; }
              setProductId(p.id);
            }}
          />
        )}

        <label style={{ marginTop: 10 }}>Cantidad (positivo = ingreso, negativo = salida)</label>
        <input type="number" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 10 ó -5" />

        <label style={{ marginTop: 10 }}>Canal</label>
        <select value={canal} onChange={(e) => setCanal(e.target.value)}>
          {canales.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
        </select>

        <label style={{ marginTop: 10 }}>Motivo (opcional)</label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Conteo físico, mercadería dañada..." />

        <label style={{ marginTop: 10 }}>RUC del proveedor (opcional)</label>
        <input
          value={proveedorRuc}
          onChange={(e) => setProveedorRuc(e.target.value.replace(/\D/g, '').slice(0, 11))}
          placeholder="Ej: 20123456789"
          inputMode="numeric"
        />
        {proveedorRuc.trim().length === 11 && (
          <>
            <label style={{ marginTop: 10 }}>Empresa</label>
            <input
              value={proveedorNombre}
              onChange={(e) => setProveedorNombre(e.target.value)}
              placeholder={buscandoProveedor ? 'Buscando...' : 'No se encontró — escribe el nombre'}
            />
          </>
        )}

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

        {esSalida && productId && (
          <>
            <label style={{ marginTop: 10 }}>Lote/serie de salida (opcional)</label>
            <select value={loteIdSalida} onChange={(e) => setLoteIdSalida(e.target.value)}>
              <option value="">Sin lote específico (descuenta del stock general)</option>
              {lotesProducto.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.codigo_lote} — disponible: {l.cantidad_actual}{l.fecha_vencimiento ? ` (vence ${l.fecha_vencimiento})` : ''}
                </option>
              ))}
            </select>
            <p className="caja-row-auto" style={{ marginTop: -4 }}>
              {lotesProducto.length === 0
                ? 'Este producto no tiene lotes/series con stock registrados.'
                : 'Si eliges un lote, esta salida se descuenta de ese lote específico (para trazabilidad).'}
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
                <th>Producto</th><th>Cantidad</th><th>Lote</th><th>Canal</th><th>Proveedor</th><th>Motivo</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.codigo} — {f.producto_nombre}</td>
                  <td style={{ textAlign: 'right' }}>{f.cantidad > 0 ? `+${f.cantidad}` : f.cantidad}</td>
                  <td>{f.codigo_lote || f.lote_codigo || '—'}</td>
                  <td>
                    <select value={f.canal} onChange={(e) => actualizarFila(f.id, 'canal', e.target.value)}>
                      {canales.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                    </select>
                  </td>
                  <td>{f.proveedor_nombre || '—'}</td>
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
                <tr><td colSpan={7} className="empty-row">Todavía no agregaste ningún movimiento.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
