import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import ProductSearchBar from '../components/ProductSearchBar';
import ClientPicker from '../components/ClientPicker';

const TITULOS = { factura: 'Factura', boleta: 'Boleta', cotizacion: 'Cotización' };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function RegistroVenta() {
  const { tipo } = useParams(); // 'factura' | 'boleta' | 'cotizacion'
  const navigate = useNavigate();
  const toast = useToast();

  const [serie, setSerie] = useState('');
  const [numero, setNumero] = useState('');
  const [moneda, setMoneda] = useState('PEN');
  const [fecha, setFecha] = useState(todayStr());
  const [tipoOperacion, setTipoOperacion] = useState('venta_interna');
  const [cliente, setCliente] = useState(null);
  const [items, setItems] = useState([]);
  const [observaciones, setObservaciones] = useState('');
  const [descuentoGlobal, setDescuentoGlobal] = useState(0);
  const [cuenta, setCuenta] = useState('efectivo');
  const [pago, setPago] = useState('');
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const endpoint = tipo === 'cotizacion' ? '/cotizaciones' : '/invoices';

  useEffect(() => {
    const params = tipo === 'cotizacion' ? {} : { tipo };
    api.get(`${endpoint}/siguiente-numero`, { params }).then((res) => {
      setSerie(res.data.serie);
      setNumero(res.data.numero);
    });
    setItems([]);
    if (tipo === 'boleta') {
      api.get('/clients', { params: { q: '10000000' } }).then((res) => {
        const clientesVarios = res.data.find((c) => c.numero_documento === '10000000');
        setCliente(clientesVarios || null);
      });
    } else {
      setCliente(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  function addProducto(p) {
    setItems((prev) => [...prev, {
      product_id: p.id,
      descripcion: p.nombre,
      stock: p.stock,
      unidad: p.unidad,
      cantidad: 1,
      precio_unitario: p.precio_unitario,
      descuento_pct: 0,
      costo: p.precio_compra || 0,
      afectacion_igv: p.afectacion_igv,
    }]);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const computed = useMemo(() => {
    let totalBruto = 0;
    let costoTotal = 0;
    const rows = items.map((it) => {
      const cantidad = Number(it.cantidad || 0);
      const precio = Number(it.precio_unitario || 0);
      const desc = Number(it.descuento_pct || 0);
      const lineBruta = cantidad * precio;
      const lineNeta = round2(lineBruta - lineBruta * (desc / 100));
      const gravado = !it.afectacion_igv || it.afectacion_igv === 'gravado' || it.afectacion_igv === 'gratuito';
      const igvLinea = gravado ? round2(lineNeta - lineNeta / 1.18) : 0;
      totalBruto += lineNeta;
      costoTotal += cantidad * Number(it.costo || 0);
      return { ...it, importe: lineNeta, igv: igvLinea };
    });
    totalBruto = round2(totalBruto);
    const total = round2(totalBruto * (1 - Number(descuentoGlobal || 0) / 100));
    const ganancia = round2(total - costoTotal);
    const vuelto = pago !== '' ? Math.max(0, round2(Number(pago) - total)) : 0;
    return { rows, totalBruto, total, ganancia, vuelto };
  }, [items, descuentoGlobal, pago]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (tipo === 'factura' && (!cliente || cliente.tipo_documento !== 'RUC')) {
      setError('Para emitir factura selecciona un cliente con RUC.');
      return;
    }
    if (tipo !== 'cotizacion' && !cliente) {
      setError('Selecciona un cliente.');
      return;
    }
    if (items.length === 0) {
      setError('Agrega al menos un producto.');
      return;
    }
    const payload = {
      client_id: cliente ? cliente.id : null,
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
      numero: numero || undefined,
    };
    try {
      if (tipo === 'cotizacion') {
        await api.post('/cotizaciones', payload);
      } else {
        await api.post('/invoices', { ...payload, tipo_comprobante: tipo, forma_pago: cuenta });
      }
      toast.success(`${TITULOS[tipo]} registrada correctamente.`);
      navigate('/ventas');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el comprobante.');
    }
  }

  return (
    <div className="venta-page">
      <h1 className="page-title">Registro de {TITULOS[tipo] || tipo}</h1>

      <form onSubmit={handleSubmit}>
        <div className="venta-panel">
          <div className="venta-fields-row">
            <div className="filter-field">
              <label>Tipo Comprobante</label>
              <select value={tipo} onChange={(e) => navigate(`/ventas/nuevo/${e.target.value}`)}>
                <option value="factura">Factura</option>
                <option value="boleta">Boleta</option>
                <option value="cotizacion">Cotización</option>
              </select>
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
            {tipo !== 'cotizacion' && (
              <div className="filter-field">
                <label>Tipo de Operación</label>
                <select value={tipoOperacion} onChange={(e) => setTipoOperacion(e.target.value)}>
                  <option value="venta_interna">Venta interna</option>
                  <option value="exportacion">Exportación</option>
                </select>
              </div>
            )}
          </div>

          <div className="venta-fields-row">
            <ClientPicker value={cliente} onChange={setCliente} required={tipo === 'factura'} />
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
                  <th className="num">Compra</th>
                  <th className="num">IGV</th>
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
                    <td className="num">S/ {Number(it.costo || 0).toFixed(2)}</td>
                    <td className="num">S/ {it.igv.toFixed(2)}</td>
                    <td className="num">S/ {it.importe.toFixed(2)}</td>
                    <td><button type="button" className="btn-link danger" onClick={() => removeItem(idx)}>x</button></td>
                  </tr>
                ))}
                {computed.rows.length === 0 && (
                  <tr><td colSpan={10} className="venta-table-empty">Busca un producto arriba para agregarlo.</td></tr>
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
              <div className="venta-totals-row">
                <span>Ganancia:</span>
                <input readOnly value={computed.ganancia.toFixed(2)} />
              </div>
              <div className="venta-totals-row final">
                <span>Importe Total:</span>
                <input readOnly value={computed.total.toFixed(2)} />
              </div>
            </div>
          </div>

          {tipo !== 'cotizacion' && (
            <div className="venta-cuenta-row">
              <div className="filter-field">
                <label>Cuenta</label>
                <select value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="banco">Banco</option>
                </select>
              </div>
              <div className="filter-field">
                <label>Pago</label>
                <input type="number" min="0" step="0.01" value={pago} onChange={(e) => setPago(e.target.value)} />
              </div>
              <div className="filter-field">
                <label>Vuelto</label>
                <input readOnly value={computed.vuelto.toFixed(2)} />
              </div>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="venta-actions-row">
            <button type="submit" className="btn-primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }}>Emitir</button>
            <button type="button" className="btn-secondary" onClick={() => setShowPreview(true)}>Vista Previa</button>
            <button type="button" className="btn-secondary" style={{ color: 'var(--critical)', borderColor: 'var(--critical)' }} onClick={() => navigate('/ventas')}>Cancelar</button>
          </div>
        </div>
      </form>

      {showPreview && (
        <div className="modal-overlay" onClick={() => setShowPreview(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Vista previa — {TITULOS[tipo]} {serie}-{String(numero || 0).padStart(6, '0')}</h2>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
              Cliente: {cliente ? `${cliente.numero_documento} - ${cliente.nombre}` : 'Sin cliente'}
            </p>
            <table className="items-table">
              <thead>
                <tr><th>Descripción</th><th>Cant.</th><th>P.U.</th><th>Importe</th></tr>
              </thead>
              <tbody>
                {computed.rows.map((it, idx) => (
                  <tr key={idx}>
                    <td>{it.descripcion}</td>
                    <td>{it.cantidad}</td>
                    <td>S/ {Number(it.precio_unitario).toFixed(2)}</td>
                    <td>S/ {it.importe.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="totals-box" style={{ marginTop: 12 }}>
              <div className="totals-final"><span>Total:</span><span>S/ {computed.total.toFixed(2)}</span></div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowPreview(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
