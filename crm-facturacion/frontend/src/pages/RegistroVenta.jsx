import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import ProductSearchBar from '../components/ProductSearchBar';
import ClientPicker from '../components/ClientPicker';
import MetodoPagoQr from '../components/MetodoPagoQr';

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
  // Descuento con nombre elegido de Configuración → Descuentos (ver
  // routes/descuentos.js) — es la única forma de aplicar un descuento
  // global: no se puede escribir un % a mano, el backend solo confía en el
  // % del descuento_id elegido (ver utils/descuentos.js:resolverDescuentoPct).
  const [descuentosActivos, setDescuentosActivos] = useState([]);
  const [descuentoId, setDescuentoId] = useState('');
  const [cuenta, setCuenta] = useState('efectivo');
  const [pago, setPago] = useState('');
  const [pagosMixto, setPagosMixto] = useState([{ medio: 'efectivo', monto: '' }, { medio: '', monto: '' }]);
  const [error, setError] = useState('');
  const [metodosPago, setMetodosPago] = useState([]);
  const [igvRate, setIgvRate] = useState(0.18);
  // Quien registra la venta puede elegir que cuente para un entrenador de
  // su sede en vez de para él mismo, en el Ranking del Tablero de Ventas.
  const [entrenadores, setEntrenadores] = useState([]);
  const [atribuidoAId, setAtribuidoAId] = useState('');

  // Promociones vigentes en la sede activa (ver routes/promociones.js). Las
  // ofertas de un solo producto se aplican solas al agregarlo con el
  // buscador; los combos necesitan un clic explícito (agregan varias líneas
  // a la vez) — ver addProducto/addCombo más abajo.
  const [promosActivas, setPromosActivas] = useState([]);

  // Vista previa: se genera el PDF real (el mismo diseño del comprobante
  // emitido) antes de confirmar — así "Enter"/"Emitir" ya no dispara la
  // emisión directamente, primero hay que revisar y confirmar.
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const previewUrlRef = useRef('');

  const endpoint = tipo === 'cotizacion' ? '/cotizaciones' : '/invoices';

  useEffect(() => {
    api.get('/metodos-pago').then((res) => {
      setMetodosPago(res.data);
      if (res.data.length && !res.data.some((m) => m.codigo === 'efectivo')) {
        setCuenta((prev) => (prev === 'mixto' ? prev : res.data[0].codigo));
        setMedioAbono(res.data[0].codigo);
      }
    });
    api.get('/empresa').then((res) => {
      if (res.data?.igv_rate) setIgvRate(Number(res.data.igv_rate));
    });
    if (tipo !== 'cotizacion') {
      api.get('/invoices/entrenadores').then((res) => setEntrenadores(res.data)).catch(() => {});
    }
    api.get('/promociones/activas').then((res) => setPromosActivas(res.data)).catch(() => {});
    api.get('/descuentos/activos').then((res) => setDescuentosActivos(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = tipo === 'cotizacion' ? {} : { tipo };
    api.get(`${endpoint}/siguiente-numero`, { params }).then((res) => {
      setSerie(res.data.serie);
      setNumero(res.data.numero);
    });
    setItems([]);
    setShowPreview(false);
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = ''; }
    setPreviewUrl('');
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

  useEffect(() => {
    return () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); };
  }, []);

  // Ofertas de un solo producto: se aplican solas al agregar el producto,
  // mientras estén vigentes en la sede activa (ver GET /promociones/activas).
  const ofertaPorProducto = useMemo(() => {
    const m = new Map();
    promosActivas.filter((p) => p.tipo === 'oferta').forEach((p) => m.set(p.product_id, p));
    return m;
  }, [promosActivas]);
  const combosActivos = useMemo(() => promosActivas.filter((p) => p.tipo === 'combo'), [promosActivas]);

  function seleccionarDescuento(id) {
    setDescuentoId(id);
    const d = descuentosActivos.find((x) => String(x.id) === String(id));
    setDescuentoGlobal(d ? d.porcentaje : 0);
  }

  function addProducto(p) {
    const oferta = ofertaPorProducto.get(p.id);
    setItems((prev) => [...prev, {
      product_id: p.id,
      descripcion: p.nombre,
      stock: p.stock,
      unidad: p.unidad,
      cantidad: 1,
      precio_unitario: p.precio_unitario,
      descuento_pct: oferta ? oferta.descuento_pct_aplicado : 0,
      costo: p.precio_compra || 0,
      afectacion_igv: p.afectacion_igv,
      promocion_id: oferta ? oferta.id : null,
      promocion_nombre: oferta ? oferta.nombre : null,
    }]);
    if (oferta) toast.success(`Promoción aplicada: ${oferta.nombre}`);
  }

  // Combo: agrega de una sola vez una línea por cada producto del combo,
  // con el mismo % de descuento en todas (calculado por el backend para que
  // la suma dé exacto el precio del combo) — así cada producto sigue
  // consumiendo su propio stock real al emitir, como si se hubieran
  // agregado uno por uno.
  function addCombo(promo) {
    setItems((prev) => [
      ...prev,
      ...promo.items.map((it) => ({
        product_id: it.product_id,
        descripcion: it.nombre,
        stock: undefined,
        unidad: it.unidad,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        descuento_pct: promo.descuento_pct_aplicado,
        costo: it.precio_compra || 0,
        afectacion_igv: it.afectacion_igv,
        promocion_id: promo.id,
        promocion_nombre: promo.nombre,
      })),
    ]);
    toast.success(`Combo agregado: ${promo.nombre}`);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function addPagoMixto() {
    setPagosMixto((prev) => [...prev, { medio: '', monto: '' }]);
  }

  function updatePagoMixto(idx, patch) {
    setPagosMixto((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function removePagoMixto(idx) {
    setPagosMixto((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));
  }

  // Autocompleta el monto de una fila con lo que falta para llegar al total
  // — así, tras poner "50 en efectivo", basta un clic para asignar el resto
  // a otro medio en vez de calcularlo a mano.
  function completarRestoPagoMixto(idx) {
    setPagosMixto((prev) => {
      const otros = prev.reduce((s, p, i) => (i === idx ? s : s + Number(p.monto || 0)), 0);
      const resto = Math.max(0, round2(computed.total - otros));
      return prev.map((p, i) => (i === idx ? { ...p, monto: resto } : p));
    });
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
      const igvLinea = gravado ? round2(lineNeta - lineNeta / (1 + igvRate)) : 0;
      totalBruto += lineNeta;
      costoTotal += cantidad * Number(it.costo || 0);
      return { ...it, importe: lineNeta, igv: igvLinea };
    });
    totalBruto = round2(totalBruto);
    const total = round2(totalBruto * (1 - Number(descuentoGlobal || 0) / 100));
    const ganancia = round2(total - costoTotal);
    const vuelto = pago !== '' ? Math.max(0, round2(Number(pago) - total)) : 0;
    const saldoPendiente = round2(Math.max(0, total - Number(pago || 0)));
    return { rows, totalBruto, total, ganancia, vuelto, saldoPendiente };
  }, [items, descuentoGlobal, pago, igvRate]);

  const sumaPagosMixto = useMemo(
    () => round2(pagosMixto.reduce((s, p) => s + Number(p.monto || 0), 0)),
    [pagosMixto]
  );

  function validar() {
    if (tipo === 'factura' && (!cliente || cliente.tipo_documento !== 'RUC')) {
      return 'Para emitir factura selecciona un cliente con RUC.';
    }
    if (tipo !== 'cotizacion' && !cliente) {
      return 'Selecciona un cliente.';
    }
    if (tipo !== 'cotizacion' && cuenta === 'mixto') {
      if (pagosMixto.some((p) => !p.medio || !(Number(p.monto) > 0))) {
        return 'Completa el método y el monto de cada pago del pago mixto.';
      }
      if (Math.abs(sumaPagosMixto - computed.total) > 0.01) {
        return `La suma de los pagos (S/ ${sumaPagosMixto.toFixed(2)}) debe ser igual al total (S/ ${computed.total.toFixed(2)}).`;
      }
    }
    if (items.length === 0) {
      return 'Agrega al menos un producto.';
    }
    return '';
  }

  function buildPayload() {
    const payload = {
      client_id: cliente ? cliente.id : null,
      items: computed.rows.map((it) => ({
        product_id: it.product_id,
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad),
        precio_unitario: Number(it.precio_unitario),
        descuento_pct: Number(it.descuento_pct || 0),
        promocion_id: it.promocion_id || null,
      })),
      moneda,
      observaciones,
      fecha_emision: fecha,
      descuento_global_pct: Number(descuentoGlobal || 0),
      descuento_id: descuentoId || null,
      numero: numero || undefined,
      serie,
    };
    if (tipo !== 'cotizacion') {
      payload.tipo_comprobante = tipo;
      payload.forma_pago = cuenta;
      if (cuenta === 'mixto') {
        payload.pagos = pagosMixto.map((p) => ({ medio: p.medio, monto: Number(p.monto) }));
      }
      if (atribuidoAId) payload.atribuido_a_id = Number(atribuidoAId);
    }
    return payload;
  }

  async function abrirVistaPrevia(e) {
    e.preventDefault();
    setError('');
    const msg = validar();
    if (msg) {
      setError(msg);
      return;
    }
    setLoadingPreview(true);
    setPreviewError('');
    try {
      const payload = buildPayload();
      const res = await api.post('/invoices/preview-pdf', { ...payload, tipo_comprobante: tipo }, { responseType: 'blob' });
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(res.data);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setShowPreview(true);
    } catch {
      setPreviewError('No se pudo generar la vista previa. Puedes confirmar y emitir de todas formas.');
      setShowPreview(true);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmarEmision() {
    setEmitiendo(true);
    setError('');
    try {
      const payload = buildPayload();
      if (tipo === 'cotizacion') {
        await api.post('/cotizaciones', payload);
      } else {
        await api.post('/invoices', payload);
      }
      toast.success(`${TITULOS[tipo]} registrada correctamente.`);
      navigate('/ventas');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el comprobante.');
      setShowPreview(false);
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <div className="venta-page">
      <h1 className="page-title">Registro de {TITULOS[tipo] || tipo}</h1>

      <form onSubmit={abrirVistaPrevia}>
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

          {combosActivos.length > 0 && (
            <div className="venta-fields-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {combosActivos.map((c) => (
                <button type="button" key={c.id} className="ventas-action-btn" onClick={() => addCombo(c)} title={c.items.map((it) => `${it.cantidad} x ${it.nombre}`).join(', ')}>
                  🏷 Agregar combo: {c.nombre} — S/ {Number(c.precio_combo).toFixed(2)}
                </button>
              ))}
            </div>
          )}

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
                    <td className="col-desc">
                      {it.descripcion}
                      {it.promocion_nombre && (
                        <div style={{ fontSize: 11, color: 'var(--good)' }}>🏷 {it.promocion_nombre}</div>
                      )}
                    </td>
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
                  {metodosPago.map((m) => (
                    <option key={m.codigo} value={m.codigo}>{m.icono} {m.nombre}</option>
                  ))}
                  <option value="mixto">🔀 Pago mixto (2 o más medios)</option>
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
              {cuenta !== 'mixto' && (
                <>
                  <div className="filter-field">
                    <label>Pago</label>
                    <input type="number" min="0" step="0.01" value={pago} onChange={(e) => setPago(e.target.value)} />
                  </div>
                  <div className="filter-field">
                    <label>Vuelto</label>
                    <input readOnly value={computed.vuelto.toFixed(2)} />
                  </div>
                  <MetodoPagoQr metodo={metodosPago.find((m) => m.codigo === cuenta)} monto={computed.total} />
                </>
              )}
            </div>
          )}

          {cuenta === 'mixto' && tipo !== 'cotizacion' && (
            <div className="venta-pago-mixto">
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Desglose del pago mixto — ej. S/ 50 en efectivo y el resto por Yape
              </label>
              {pagosMixto.map((p, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <select value={p.medio} onChange={(e) => updatePagoMixto(idx, { medio: e.target.value })} style={{ minWidth: 150 }}>
                    <option value="">Selecciona un medio</option>
                    {metodosPago.map((m) => (
                      <option key={m.codigo} value={m.codigo}>{m.icono} {m.nombre}</option>
                    ))}
                  </select>
                  <input type="number" min="0" step="0.01" placeholder="Monto" value={p.monto}
                    onChange={(e) => updatePagoMixto(idx, { monto: e.target.value })} style={{ width: 120 }} />
                  <button type="button" className="btn-link" onClick={() => completarRestoPagoMixto(idx)}>Completar resto</button>
                  {pagosMixto.length > 2 && (
                    <button type="button" className="btn-link danger" onClick={() => removePagoMixto(idx)}>Quitar</button>
                  )}
                  <MetodoPagoQr metodo={metodosPago.find((m) => m.codigo === p.medio)} monto={Number(p.monto || 0)} />
                </div>
              ))}
              <button type="button" className="btn-secondary" onClick={addPagoMixto}>+ Agregar método</button>
              <p style={{ fontSize: 12, marginTop: 8, color: Math.abs(sumaPagosMixto - computed.total) < 0.005 ? 'var(--good)' : 'var(--critical)' }}>
                Asignado: S/ {sumaPagosMixto.toFixed(2)} de S/ {computed.total.toFixed(2)}
                {Math.abs(sumaPagosMixto - computed.total) >= 0.005 && ` — falta S/ ${(computed.total - sumaPagosMixto).toFixed(2)}`}
              </p>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="venta-actions-row">
            <button type="submit" className="btn-primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }} disabled={loadingPreview}>
              {loadingPreview ? 'Generando vista previa...' : 'Vista previa y emitir'}
            </button>
            <button type="button" className="btn-secondary" style={{ color: 'var(--critical)', borderColor: 'var(--critical)' }} onClick={() => navigate('/ventas')}>Cancelar</button>
          </div>
        </div>
      </form>

      {showPreview && (
        <div className="modal-overlay" onClick={() => !emitiendo && setShowPreview(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Confirmar {TITULOS[tipo]} — {serie}-{String(numero || 0).padStart(6, '0')}</h2>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
              Revisa el comprobante antes de emitirlo. Una vez confirmado no se puede editar (solo anular).
            </p>
            {previewError && <div className="form-error">{previewError}</div>}
            {previewUrl && (
              <iframe title="Vista previa del comprobante" src={previewUrl}
                style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
            )}
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowPreview(false)} disabled={emitiendo}>Seguir editando</button>
              <button type="button" className="btn-primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }}
                onClick={confirmarEmision} disabled={emitiendo}>
                {emitiendo ? 'Emitiendo...' : `Confirmar y ${tipo === 'cotizacion' ? 'Registrar' : 'Emitir'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
