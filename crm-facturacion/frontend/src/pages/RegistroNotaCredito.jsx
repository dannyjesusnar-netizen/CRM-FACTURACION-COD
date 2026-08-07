import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';

const TIPOS_NOTA = [
  { value: 'anulacion_operacion', label: 'Anulación de la operación' },
  { value: 'anulacion_error_ruc', label: 'Anulación por error en el RUC' },
  { value: 'correccion_descripcion', label: 'Corrección por error en la descripción' },
  { value: 'descuento_global', label: 'Descuento global' },
  { value: 'descuento_item', label: 'Descuento por ítem' },
  { value: 'devolucion_total', label: 'Devolución total' },
  { value: 'devolucion_item', label: 'Devolución por ítem' },
  { value: 'bonificacion', label: 'Bonificación' },
  { value: 'otros', label: 'Otros conceptos' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function RegistroNotaCredito() {
  const navigate = useNavigate();
  const toast = useToast();

  const [serie, setSerie] = useState('');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState(todayStr());
  const [modificaTipo, setModificaTipo] = useState('factura');
  const [modificaSerie, setModificaSerie] = useState('');
  const [modificaNumero, setModificaNumero] = useState('');
  const [tipoNota, setTipoNota] = useState('anulacion_operacion');
  const [original, setOriginal] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [items, setItems] = useState([]);
  const [observaciones, setObservaciones] = useState('ANULACIÓN DE LA OPERACIÓN');
  const [cuenta, setCuenta] = useState('efectivo');
  const [error, setError] = useState('');
  const [loadingRecuperar, setLoadingRecuperar] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [igvRate, setIgvRate] = useState(0.18);

  useEffect(() => {
    api.get('/invoices/siguiente-numero', { params: { tipo: 'nota_credito' } }).then((res) => {
      setSerie(res.data.serie);
      setNumero(res.data.numero);
    });
    api.get('/empresa').then((res) => {
      if (res.data?.igv_rate) setIgvRate(Number(res.data.igv_rate));
    });
  }, []);

  useEffect(() => {
    const found = TIPOS_NOTA.find((t) => t.value === tipoNota);
    setObservaciones(found ? found.label.toUpperCase() : '');
  }, [tipoNota]);

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleRecuperar() {
    if (!modificaSerie || !modificaNumero) {
      toast.error('Ingresa la serie y el número del comprobante a modificar.');
      return;
    }
    setLoadingRecuperar(true);
    try {
      const res = await api.get('/invoices/buscar', {
        params: { tipo: modificaTipo, serie: modificaSerie, numero: modificaNumero },
      });
      const inv = res.data;
      setOriginal(inv);
      setCliente({
        id: inv.client_id,
        numero_documento: inv.cliente_documento,
        nombre: inv.cliente_nombre,
        tipo_documento: inv.cliente_tipo_documento,
      });
      const withProducts = await Promise.all(
        inv.items.map(async (it) => {
          let prod = null;
          if (it.product_id) {
            try { prod = (await api.get(`/products/${it.product_id}`)).data; } catch { /* producto pudo haberse desactivado */ }
          }
          return {
            product_id: it.product_id,
            descripcion: it.descripcion,
            stock: prod ? prod.stock : null,
            unidad: prod ? prod.unidad : '',
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            descuento_pct: it.descuento_pct || 0,
            costo: prod ? prod.precio_compra || 0 : 0,
            afectacion_igv: prod ? prod.afectacion_igv : 'gravado',
          };
        })
      );
      setItems(withProducts);
      toast.success('Comprobante recuperado.');
    } catch (err) {
      setOriginal(null);
      setItems([]);
      toast.error(err.response?.data?.error || 'No se encontró el comprobante.');
    } finally {
      setLoadingRecuperar(false);
    }
  }

  function verComprobante() {
    if (!original) { toast.info('Primero recupera un comprobante.'); return; }
    window.open(`/api/invoices/${original.id}/pdf`, '_blank');
  }

  const computed = useMemo(() => {
    let total = 0;
    const rows = items.map((it) => {
      const cantidad = Number(it.cantidad || 0);
      const precio = Number(it.precio_unitario || 0);
      const desc = Number(it.descuento_pct || 0);
      const lineBruta = cantidad * precio;
      const lineNeta = round2(lineBruta - lineBruta * (desc / 100));
      const gravado = !it.afectacion_igv || it.afectacion_igv === 'gravado' || it.afectacion_igv === 'gratuito';
      const igvLinea = gravado ? round2(lineNeta - lineNeta / (1 + igvRate)) : 0;
      total += lineNeta;
      return { ...it, importe: lineNeta, igv: igvLinea };
    });
    return { rows, total: round2(total) };
  }, [items, igvRate]);

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!original) { setError('Primero recupera el comprobante que quieres modificar (Serie y Número + Recuperar).'); return; }
    if (items.length === 0) { setError('No hay items para la nota de crédito.'); return; }
    setShowConfirm(true);
  }

  async function confirmarEmision() {
    setEmitiendo(true);
    try {
      await api.post('/invoices', {
        tipo_comprobante: 'nota_credito',
        client_id: cliente.id,
        items: computed.rows.map((it) => ({
          product_id: it.product_id,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario),
          descuento_pct: Number(it.descuento_pct || 0),
        })),
        fecha_emision: fecha,
        numero: numero || undefined,
        observaciones,
        forma_pago: cuenta,
        modifica_tipo: modificaTipo,
        modifica_serie: modificaSerie,
        modifica_numero: modificaNumero,
        tipo_nota: tipoNota,
      });
      toast.success('Nota de crédito registrada correctamente.');
      navigate('/ventas');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar la nota de crédito.');
      setShowConfirm(false);
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <div className="venta-page">
      <h1 className="page-title">Registro de Nota de Crédito</h1>

      <form onSubmit={handleSubmit}>
        <div className="venta-panel">
          <div className="venta-fields-row">
            <div className="filter-field">
              <label>Tipo Comprobante</label>
              <input value="Nota de crédito" readOnly />
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
          </div>

          <div className="venta-fields-row">
            <div className="filter-field">
              <label>Modificar</label>
              <select value={modificaTipo} onChange={(e) => setModificaTipo(e.target.value)}>
                <option value="factura">Factura</option>
                <option value="boleta">Boleta</option>
              </select>
            </div>
            <div className="venta-nc-recuperar">
              <div className="filter-field">
                <label>Serie</label>
                <input value={modificaSerie} onChange={(e) => setModificaSerie(e.target.value)} placeholder="Serie" style={{ width: 90 }} />
              </div>
              <div className="filter-field">
                <label>Correlativo</label>
                <input value={modificaNumero} onChange={(e) => setModificaNumero(e.target.value)} placeholder="Correlativo" style={{ width: 100 }} />
              </div>
              <button type="button" className="btn-secondary" onClick={handleRecuperar} disabled={loadingRecuperar}>
                {loadingRecuperar ? 'Buscando…' : 'Recuperar'}
              </button>
              <button type="button" className="btn-secondary" onClick={verComprobante}>Ver Comprobante</button>
            </div>
            <div className="filter-field">
              <label>Tipo Nota</label>
              <select value={tipoNota} onChange={(e) => setTipoNota(e.target.value)}>
                {TIPOS_NOTA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div className="venta-fields-row">
            <div className="filter-field grow">
              <label>Cliente</label>
              <input readOnly value={cliente ? `${cliente.numero_documento} - ${cliente.nombre}` : 'Recupera un comprobante para ver el cliente'} />
            </div>
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
                  <tr><td colSpan={10} className="venta-table-empty">Usa "Recuperar" para traer los items del comprobante a modificar.</td></tr>
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
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="banco">Banco</option>
              </select>
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
        message="Se emitirá la nota de crédito y ya no podrás editarla."
        loading={emitiendo}
        onConfirm={confirmarEmision}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
