import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import ProductSearchBar from '../components/ProductSearchBar';
import ClientPicker from '../components/ClientPicker';
import MetodoPagoQr from '../components/MetodoPagoQr';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function RegistroNotaVenta() {
  const navigate = useNavigate();
  const toast = useToast();

  const [serie, setSerie] = useState('');
  const [numero, setNumero] = useState('');
  const [moneda, setMoneda] = useState('PEN');
  const [fecha, setFecha] = useState(todayStr());
  const [cliente, setCliente] = useState(null);
  const [items, setItems] = useState([]);
  const [observaciones, setObservaciones] = useState('');
  const [descuentoGlobal, setDescuentoGlobal] = useState(0);
  const [cuenta, setCuenta] = useState('efectivo');
  const [metodosPago, setMetodosPago] = useState([]);
  const [error, setError] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);

  useEffect(() => {
    api.get('/notas-venta/siguiente-numero').then((res) => {
      setSerie(res.data.serie);
      setNumero(res.data.numero);
    });
    api.get('/metodos-pago').then((res) => setMetodosPago(res.data));
  }, []);

  function addProducto(p) {
    setItems((prev) => [...prev, {
      product_id: p.id,
      descripcion: p.nombre,
      stock: p.stock,
      unidad: p.unidad,
      cantidad: 1,
      precio_unitario: p.precio_unitario,
      descuento_pct: 0,
    }]);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // Sin IGV: el importe de cada línea es el total final tal cual, sin
  // desglose de impuesto — es justamente lo que distingue a este documento
  // de una Boleta/Factura reales.
  const computed = useMemo(() => {
    let totalBruto = 0;
    const rows = items.map((it) => {
      const cantidad = Number(it.cantidad || 0);
      const precio = Number(it.precio_unitario || 0);
      const desc = Number(it.descuento_pct || 0);
      const lineBruta = cantidad * precio;
      const lineNeta = round2(lineBruta - lineBruta * (desc / 100));
      totalBruto += lineNeta;
      return { ...it, importe: lineNeta };
    });
    totalBruto = round2(totalBruto);
    const total = round2(totalBruto * (1 - Number(descuentoGlobal || 0) / 100));
    return { rows, total };
  }, [items, descuentoGlobal]);

  function validar() {
    if (!cliente) return 'Selecciona un cliente.';
    if (items.length === 0) return 'Agrega al menos un producto.';
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const msg = validar();
    if (msg) { setError(msg); return; }
    setEmitiendo(true);
    try {
      await api.post('/notas-venta', {
        client_id: cliente.id,
        items: computed.rows.map((it) => ({
          product_id: it.product_id,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario),
          descuento_pct: Number(it.descuento_pct || 0),
        })),
        moneda,
        observaciones,
        fecha_emision: fecha,
        descuento_global_pct: Number(descuentoGlobal || 0),
        forma_pago: cuenta,
        numero: numero || undefined,
        serie,
      });
      toast.success('Nota de venta interna registrada correctamente.');
      navigate('/ventas');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar la nota de venta.');
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <div className="venta-page">
      <h1 className="page-title">Registro de Nota de Venta Interna</h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8, marginBottom: 16 }}>
        Documento sin efectos tributarios — no es un comprobante de pago, no incluye IGV ni tiene validez ante SUNAT.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="venta-panel">
          <div className="venta-fields-row">
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
              <label>Moneda</label>
              <select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </select>
            </div>
            <div className="filter-field">
              <label>Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>

          <div className="venta-fields-row">
            <ClientPicker value={cliente} onChange={setCliente} />
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
                  <th className="num">P.U.</th>
                  <th className="num">Desc %</th>
                  <th className="num">Importe</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {computed.rows.map((it, idx) => (
                  <tr key={idx}>
                    <td className="col-desc">{it.descripcion}</td>
                    <td className="num">{it.stock ?? '—'}</td>
                    <td>
                      <input type="number" min="0.01" step="0.01" value={it.cantidad}
                        onChange={(e) => updateItem(idx, { cantidad: e.target.value })} />
                    </td>
                    <td>{it.unidad}</td>
                    <td className="num">
                      <input type="number" min="0" step="0.01" value={it.precio_unitario}
                        onChange={(e) => updateItem(idx, { precio_unitario: e.target.value })} />
                    </td>
                    <td className="num">
                      <input type="number" min="0" max="100" step="1" value={it.descuento_pct}
                        onChange={(e) => updateItem(idx, { descuento_pct: e.target.value })} style={{ width: 56 }} />
                    </td>
                    <td className="num">S/ {it.importe.toFixed(2)}</td>
                    <td><button type="button" className="btn-link danger" onClick={() => removeItem(idx)}>x</button></td>
                  </tr>
                ))}
                {computed.rows.length === 0 && (
                  <tr><td colSpan={8} className="venta-table-empty">Busca un producto arriba para agregarlo.</td></tr>
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
                <span>Desc. Global %:</span>
                <input type="number" min="0" max="100" value={descuentoGlobal} onChange={(e) => setDescuentoGlobal(e.target.value)} />
              </div>
              <div className="venta-totals-row final">
                <span>Importe Total:</span>
                <input readOnly value={computed.total.toFixed(2)} />
              </div>
            </div>
          </div>

          <div className="venta-cuenta-row">
            <div className="filter-field">
              <label>Cuenta</label>
              <select value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                {metodosPago.map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.icono} {m.nombre}</option>
                ))}
              </select>
            </div>
            <MetodoPagoQr metodo={metodosPago.find((m) => m.codigo === cuenta)} monto={computed.total} />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="venta-actions-row">
            <button type="submit" className="btn-primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }} disabled={emitiendo}>
              {emitiendo ? 'Registrando...' : 'Registrar Nota de Venta Interna'}
            </button>
            <button type="button" className="btn-secondary" style={{ color: 'var(--critical)', borderColor: 'var(--critical)' }} onClick={() => navigate('/ventas')}>Cancelar</button>
          </div>
        </div>
      </form>
    </div>
  );
}
