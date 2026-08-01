import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const INGRESO_LABELS = { ventas: 'Ventas', cuentas_cobrar: 'Cuentas x Cobrar', transferencia: 'Transferencias', otros: 'Otros Ingresos' };
const EGRESO_LABELS = { compras: 'Compras', cuentas_pagar: 'Cuentas x Pagar', transferencia: 'Transferencias', otros: 'Otros Egresos' };
const INGRESO_LABELS_TB = { ventas: 'Ventas', cuentas_cobrar: 'Cuentas x Cobrar', transferencia: 'Transferencia', otros: 'Otros Ingresos' };
const EGRESO_LABELS_TB = { compras: 'Compras', cuentas_pagar: 'Cuentas x Pagar', transferencia: 'Transferencia', otros: 'Otros Egresos' };
const MEDIO_LABELS = { tarjeta: 'Tarjeta', banco: 'Banco', otros: 'Otros' };
const INGRESO_CATS = ['ventas', 'cuentas_cobrar', 'transferencia', 'otros'];
const EGRESO_CATS = ['compras', 'cuentas_pagar', 'transferencia', 'otros'];
const MEDIOS_TB = ['tarjeta', 'banco', 'otros'];
const CAT_MEDIOS_TB = { ventas: MEDIOS_TB, cuentas_cobrar: MEDIOS_TB, transferencia: ['tarjeta', 'banco'], compras: MEDIOS_TB, cuentas_pagar: MEDIOS_TB, otros: MEDIOS_TB };
const TIPO_MOV_LABEL = { ingreso: 'Ingreso', egreso: 'Egreso' };

export default function Caja() {
  const toast = useToast();
  const [fecha, setFecha] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showSaldoForm, setShowSaldoForm] = useState(false);
  const [saldoInput, setSaldoInput] = useState('');

  const [showMovForm, setShowMovForm] = useState(false);
  const [movContext, setMovContext] = useState(null); // { tipo, medio, categoria, label }
  const [movMonto, setMovMonto] = useState('');
  const [movDescripcion, setMovDescripcion] = useState('');
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    api.get('/caja', { params: { fecha } }).then((res) => setData(res.data)).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [fecha]);

  function openSaldoForm() {
    setSaldoInput(data?.efectivo?.saldo_inicial ?? 0);
    setShowSaldoForm(true);
  }

  async function handleSaldoSubmit(e) {
    e.preventDefault();
    try {
      await api.put('/caja/saldo-inicial', { fecha, monto: Number(saldoInput || 0) });
      toast.success('Saldo inicial de efectivo actualizado.');
      setShowSaldoForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo actualizar el saldo inicial.');
    }
  }

  function openMovForm(tipo, medio, categoria, label) {
    setMovContext({ tipo, medio, categoria, label });
    setMovMonto('');
    setMovDescripcion('');
    setError('');
    setShowMovForm(true);
  }

  async function handleMovSubmit(e) {
    e.preventDefault();
    setError('');
    if (!movMonto || Number(movMonto) <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    try {
      await api.post('/caja/movimientos', {
        fecha,
        tipo: movContext.tipo,
        medio: movContext.medio,
        categoria: movContext.categoria,
        monto: Number(movMonto),
        descripcion: movDescripcion,
      });
      toast.success('Movimiento registrado.');
      setShowMovForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar el movimiento.');
    }
  }

  async function handleDeleteMov(id) {
    if (!window.confirm('¿Eliminar este movimiento de caja?')) return;
    try {
      await api.delete(`/caja/movimientos/${id}`);
      toast.success('Movimiento eliminado.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo eliminar el movimiento.');
    }
  }

  function fmt(n) {
    return Number(n || 0).toFixed(2);
  }

  return (
    <div>
      <h1 className="page-title">Caja y Bancos</h1>

      <div className="caja-date-bar filter-panel">
        <div className="filter-field">
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Sucursal</label>
          <select defaultValue="principal">
            <option value="principal">Miraflores</option>
          </select>
        </div>
      </div>

      {loading || !data ? (
        <div className="panel"><span className="spinner" /> Cargando arqueo de caja...</div>
      ) : (
        <div className="caja-columns">
          {/* --- COLUMNA EFECTIVO --- */}
          <div>
            <div className="caja-banner">
              <span>Saldo Inicial Efectivo</span>
              <span className="caja-banner-value">
                S/ {fmt(data.efectivo.saldo_inicial)}
                <button className="caja-banner-edit" title="Editar saldo inicial" onClick={openSaldoForm}>
                  <Pencil size={14} />
                </button>
              </span>
            </div>

            <div className="caja-section">
              <div className="caja-section-header">
                <span>Ingresos Efectivo</span>
                <span className="caja-section-total">{fmt(data.efectivo.ingresos.total)}</span>
              </div>
              {INGRESO_CATS.map((cat) => (
                <div className="caja-row" key={cat}>
                  <span className="caja-row-label">{INGRESO_LABELS[cat]}</span>
                  <span className="caja-row-right">
                    <span className="caja-row-amount">{fmt(data.efectivo.ingresos[cat])}</span>
                    {cat === 'ventas' ? (
                      <span className="caja-row-auto">auto</span>
                    ) : (
                      <button className="caja-row-add" title="Registrar ingreso" onClick={() => openMovForm('ingreso', 'efectivo', cat, `${INGRESO_LABELS[cat]} (Efectivo)`)}>
                        <Plus size={13} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="caja-section">
              <div className="caja-section-header">
                <span>Egresos Efectivo</span>
                <span className="caja-section-total">{fmt(data.efectivo.egresos.total)}</span>
              </div>
              {EGRESO_CATS.map((cat) => (
                <div className="caja-row" key={cat}>
                  <span className="caja-row-label">{EGRESO_LABELS[cat]}</span>
                  <span className="caja-row-right">
                    <span className="caja-row-amount">{fmt(data.efectivo.egresos[cat])}</span>
                    <button className="caja-row-add" title="Registrar egreso" onClick={() => openMovForm('egreso', 'efectivo', cat, `${EGRESO_LABELS[cat]} (Efectivo)`)}>
                      <Plus size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="caja-banner">
              <span>Efectivo Final</span>
              <span className="caja-banner-value">S/ {fmt(data.efectivo.saldo_final)}</span>
            </div>
          </div>

          {/* --- COLUMNA TARJETA / BANCO --- */}
          <div>
            <div className="caja-section">
              <div className="caja-section-header">
                <span>Ingresos Tarjeta Banco</span>
                <span className="caja-section-total">{fmt(data.tarjeta_banco.ingresos.total)}</span>
              </div>
              {INGRESO_CATS.map((cat) => CAT_MEDIOS_TB[cat].map((medio) => (
                <div className="caja-row" key={cat + medio}>
                  <span className="caja-row-label">{INGRESO_LABELS_TB[cat]} {MEDIO_LABELS[medio]}</span>
                  <span className="caja-row-right">
                    <span className="caja-row-amount">{fmt(data.tarjeta_banco.ingresos[cat][medio])}</span>
                    {cat === 'ventas' && medio !== 'otros' ? (
                      <span className="caja-row-auto">auto</span>
                    ) : (
                      <button className="caja-row-add" title="Registrar ingreso" onClick={() => openMovForm('ingreso', medio, cat, `${INGRESO_LABELS_TB[cat]} ${MEDIO_LABELS[medio]}`)}>
                        <Plus size={13} />
                      </button>
                    )}
                  </span>
                </div>
              )))}
            </div>

            <div className="caja-section">
              <div className="caja-section-header">
                <span>Egresos Tarjeta Banco</span>
                <span className="caja-section-total">{fmt(data.tarjeta_banco.egresos.total)}</span>
              </div>
              {EGRESO_CATS.map((cat) => CAT_MEDIOS_TB[cat].map((medio) => (
                <div className="caja-row" key={cat + medio}>
                  <span className="caja-row-label">{EGRESO_LABELS_TB[cat]} {MEDIO_LABELS[medio]}</span>
                  <span className="caja-row-right">
                    <span className="caja-row-amount">{fmt(data.tarjeta_banco.egresos[cat][medio])}</span>
                    <button className="caja-row-add" title="Registrar egreso" onClick={() => openMovForm('egreso', medio, cat, `${EGRESO_LABELS_TB[cat]} ${MEDIO_LABELS[medio]}`)}>
                      <Plus size={13} />
                    </button>
                  </span>
                </div>
              )))}
            </div>

            <div className="caja-banner">
              <span>Saldo Final Tarjeta Banco</span>
              <span className="caja-banner-value">S/ {fmt(data.tarjeta_banco.saldo_final)}</span>
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="panel">
          <h3>Movimientos manuales del día</h3>
          <div className="table-scroll">
            <table className="data-table caja-mov-table">
              <thead>
                <tr>
                  <th>Tipo</th><th>Medio</th><th>Categoría</th>
                  <th style={{ textAlign: 'right' }}>Monto</th><th>Descripción</th><th>Usuario</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.movimientos.map((m) => (
                  <tr key={m.id}>
                    <td><span className={'badge ' + (m.tipo === 'ingreso' ? 'badge-good' : 'badge-critical')}>{TIPO_MOV_LABEL[m.tipo]}</span></td>
                    <td style={{ textTransform: 'capitalize' }}>{m.medio}</td>
                    <td>{(m.tipo === 'ingreso' ? INGRESO_LABELS[m.categoria] : EGRESO_LABELS[m.categoria]) || m.categoria}</td>
                    <td style={{ textAlign: 'right' }}>S/ {fmt(m.monto)}</td>
                    <td>{m.descripcion || '—'}</td>
                    <td>{m.usuario_nombre || '—'}</td>
                    <td><button className="btn-link danger" onClick={() => handleDeleteMov(m.id)} title="Eliminar"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {data.movimientos.length === 0 && (
                  <tr><td colSpan={7} className="empty-row">No hay movimientos manuales registrados para esta fecha.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showSaldoForm && (
        <div className="modal-overlay" onClick={() => setShowSaldoForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Saldo inicial de efectivo</h2>
            <form onSubmit={handleSaldoSubmit}>
              <label>Monto (S/)</label>
              <input required type="number" step="0.01" value={saldoInput} onChange={(e) => setSaldoInput(e.target.value)} autoFocus />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSaldoForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMovForm && (
        <div className="modal-overlay" onClick={() => setShowMovForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{movContext?.tipo === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo egreso'} — {movContext?.label}</h2>
            <form onSubmit={handleMovSubmit}>
              <label>Monto (S/)</label>
              <input required type="number" step="0.01" min="0.01" value={movMonto} onChange={(e) => setMovMonto(e.target.value)} autoFocus />
              <label>Descripción</label>
              <input value={movDescripcion} onChange={(e) => setMovDescripcion(e.target.value)} placeholder="Ej: Cobro a cliente, comisión bancaria..." />
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowMovForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
