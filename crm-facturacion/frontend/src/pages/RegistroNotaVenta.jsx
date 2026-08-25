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
  // Descuento con nombre elegido de Configuración → Descuentos — es la
  // única forma de aplicar un descuento global, no se puede escribir un %
  // a mano (el backend solo confía en el % del descuento_id elegido).
  const [descuentosActivos, setDescuentosActivos] = useState([]);
  const [descuentoId, setDescuentoId] = useState('');
  const [cuenta, setCuenta] = useState('efectivo');
  const [pago, setPago] = useState('');
  const [medioAbono, setMedioAbono] = useState('efectivo');
  const [metodosPago, setMetodosPago] = useState([]);
  const [error, setError] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  // Quien registra la nota de venta puede elegir que cuente para un
  // entrenador de su sede en vez de para él mismo, en el Ranking del
  // Tablero de Ventas (mismo mecanismo que RegistroVenta.jsx).
  const [entrenadores, setEntrenadores] = useState([]);
  const [atribuidoAId, setAtribuidoAId] = useState('');

  useEffect(() => {
    api.get('/notas-venta/siguiente-numero').then((res) => {
      setSerie(res.data.serie);
      setNumero(res.data.numero);
    });
    api.get('/metodos-pago').then((res) => setMetodosPago(res.data));
    api.get('/invoices/entrenadores').then((res) => setEntrenadores(res.data)).catch(() => {});
    api.get('/descuentos/activos').then((res) => setDescuentosActivos(res.data)).catch(() => {});
  }, []);

  function seleccionarDescuento(id) {
    setDescuentoId(id);
    const d = descuentosActivos.find((x) => String(x.id) === String(id));
    setDescuentoGlobal(d ? d.porcentaje : 0);
  }

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
    const saldoPendiente = round2(Math.max(0, total - Number(pago || 0)));
    return { rows, total, saldoPendiente };
  }, [items, descuentoGlobal, pago]);

  function validar() {
    if (!cliente) return 'Selecciona un cliente.';
    if (items.length === 0) return 'Agrega al menos un producto.';
    if (cuenta === 'abonado' && cliente?.numero_documento === '10000000') {
      return 'Para una nota de venta abonada selecciona un cliente real — no puede quedar a nombre de "Clientes Varios".';
    }
    if (cuenta === 'abonado' && Number(pago || 0) > computed.total) {
      return 'El abono no puede ser mayor al total de la nota de venta.';
    }
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const msg = validar();
    if (msg) { setError(msg); return; }
    if (!window.confirm(`¿Confirmas el registro de esta nota de venta por S/ ${computed.total.toFixed(2)}?`)) return;
    setEmitiendo(true);
    try {
      const payload = {
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
        descuento_id: descuentoId || null,
        forma_pago: cuenta,
        numero: numero || undefined,
        serie,
      };
      if (cuenta === 'abonado') {
        payload.monto_pagado = Number(pago || 0);
        if (Number(pago || 0) > 0) payload.medio_abono = medioAbono;
      }
      if (atribuidoAId) payload.atribuido_a_id = Number(atribuidoAId);
      await api.post('/notas-venta', payload);
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
                      <input type="number" min="1" step="1" value={it.cantidad}
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
                <span>Descuento:</span>
                {descuentosActivos.length > 0 ? (
                  <select value={descuentoId} onChange={(e) => seleccionarDescuento(e.target.value)}>
                    <option value="">Sin descuento</option>
                    {descuentosActivos.map((d) => (
                      <option key={d.id} value={d.id}>{d.nombre} ({d.porcentaje}%)</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No hay descuentos vigentes</span>
                )}
              </div>
              {descuentoGlobal > 0 && (
                <div className="venta-totals-row">
                  <span>Desc. Global %:</span>
                  <input readOnly value={`${descuentoGlobal}%`} />
                </div>
              )}
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
                <option value="abonado">Abonado (crédito)</option>
              </select>
            </div>
            {entrenadores.length > 0 && (
              <div className="filter-field">
                <label>Atribuir venta a</label>
                <select value={atribuidoAId} onChange={(e) => setAtribuidoAId(e.target.value)}>
                  <option value="">Yo (vendedor)</option>
                  {entrenadores.map((e) => (
                    <option key={e.id} value={e.id}>{e.full_name} ({e.categoria_staff === 'trainer' ? 'Trainer' : 'Supervisor'})</option>
                  ))}
                </select>
              </div>
            )}
            {cuenta === 'abonado' ? (
              <>
                <div className="filter-field">
                  <label>Abono inicial (opcional)</label>
                  <input type="number" min="0" step="0.01" value={pago} onChange={(e) => setPago(e.target.value)} />
                </div>
                {Number(pago || 0) > 0 && (
                  <div className="filter-field">
                    <label>Medio del abono</label>
                    <select value={medioAbono} onChange={(e) => setMedioAbono(e.target.value)}>
                      {metodosPago.map((m) => (
                        <option key={m.codigo} value={m.codigo}>{m.icono} {m.nombre}</option>
                      ))}
                    </select>
                    <MetodoPagoQr metodo={metodosPago.find((m) => m.codigo === medioAbono)} monto={Number(pago || 0)} />
                  </div>
                )}
                <div className="filter-field">
                  <label>Saldo pendiente</label>
                  <input readOnly value={computed.saldoPendiente.toFixed(2)} />
                </div>
              </>
            ) : (
              <MetodoPagoQr metodo={metodosPago.find((m) => m.codigo === cuenta)} monto={computed.total} />
            )}
          </div>
          {cuenta === 'abonado' && (
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
              El cliente debe ser real (no "Clientes Varios") — esta nota de venta va a aparecer en Cuentas por Cobrar
              hasta que se salde el saldo pendiente.
            </p>
          )}

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
