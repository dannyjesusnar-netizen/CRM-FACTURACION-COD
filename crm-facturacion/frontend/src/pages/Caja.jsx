import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const INGRESO_LABELS = { ventas: 'Ventas', cuentas_cobrar: 'Cuentas x Cobrar', transferencia: 'Transferencias', otros: 'Otros Ingresos' };
const EGRESO_LABELS = { compras: 'Compras', cuentas_pagar: 'Cuentas x Pagar', transferencia: 'Transferencias', otros: 'Otros Egresos' };
const INGRESO_CATS = ['ventas', 'cuentas_cobrar', 'transferencia', 'otros'];
const EGRESO_CATS = ['compras', 'cuentas_pagar', 'transferencia', 'otros'];
const TIPO_MOV_LABEL = { ingreso: 'Ingreso', egreso: 'Egreso' };

export default function Caja() {
  const toast = useToast();
  const navigate = useNavigate();
  const [fecha, setFecha] = useState(todayStr());
  const [empleadoId, setEmpleadoId] = useState('');
  const [moneda, setMoneda] = useState('');
  const [empleados, setEmpleados] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showSaldoForm, setShowSaldoForm] = useState(false);
  const [saldoInput, setSaldoInput] = useState('');

  const [showMovForm, setShowMovForm] = useState(false);
  const [movContext, setMovContext] = useState(null); // { tipo, medio, categoria, label, color, icono }
  const [movMonto, setMovMonto] = useState('');
  const [movDescripcion, setMovDescripcion] = useState('');
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    const params = { fecha };
    if (empleadoId) params.empleado_id = empleadoId;
    if (moneda) params.moneda = moneda;
    api.get('/caja', { params }).then((res) => setData(res.data)).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [fecha, empleadoId, moneda]);
  useEffect(() => { api.get('/caja/empleados').then((res) => setEmpleados(res.data)); }, []);

  const metodoPorCodigo = useMemo(() => {
    const map = {};
    (data?.resumen || []).forEach((m) => { map[m.codigo] = m; });
    return map;
  }, [data]);

  function openSaldoForm() {
    const efectivo = metodoPorCodigo.efectivo;
    setSaldoInput(efectivo?.saldo_inicial ?? 0);
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

  function openMovForm(tipo, metodo, categoria) {
    setMovContext({ tipo, medio: metodo.codigo, categoria, label: `${(tipo === 'ingreso' ? INGRESO_LABELS : EGRESO_LABELS)[categoria]} (${metodo.nombre})`, color: metodo.color, icono: metodo.icono });
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
      <div className="page-header">
        <h1 className="page-title">Caja y Bancos</h1>
        {data && (
          <div className="caja-total-general">
            <span>Total del día</span>
            <strong>S/ {fmt(data.totalGeneral)}</strong>
          </div>
        )}
      </div>

      <div className="actions-buttons" style={{ marginBottom: 16 }}>
        <button className="ventas-action-btn" onClick={() => navigate('/caja/cuentas-por-cobrar')}>Cuentas por Cobrar</button>
      </div>

      <div className="caja-date-bar filter-panel">
        <div className="filter-field">
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Cuenta</label>
          <select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
            <option value="">Todos los empleados</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Moneda</label>
          <select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="">Todas</option>
            <option value="PEN">Soles</option>
            <option value="USD">Dólares</option>
          </select>
        </div>
      </div>
      {(empleadoId || moneda) && (
        <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -12, marginBottom: 16 }}>
          Con filtros activos, el saldo inicial de Efectivo no se muestra (es un monto físico del día completo, no se puede acotar por empleado o moneda) — igual verás los ingresos y egresos que sí calzan con el filtro.
        </p>
      )}

      {loading || !data ? (
        <div className="panel"><span className="spinner" /> Cargando arqueo de caja...</div>
      ) : (
        <div className="caja-metodos-grid">
          {data.resumen.map((m) => (
            <div key={m.codigo} className="caja-metodo-card" style={{ '--metodo-color': m.color }}>
              <div className="caja-metodo-header">
                <div className="caja-metodo-icon" style={{ background: m.color }}>{m.icono}</div>
                <div className="caja-metodo-titulo">
                  <strong>{m.nombre}</strong>
                  {m.codigo === 'efectivo' && (
                    <span className="caja-metodo-saldo-inicial">
                      Inicial S/ {fmt(m.saldo_inicial)}
                      <button className="caja-banner-edit" title="Editar saldo inicial" onClick={openSaldoForm}>
                        <Pencil size={12} />
                      </button>
                    </span>
                  )}
                </div>
                <div className="caja-metodo-final">
                  <span>Saldo</span>
                  <strong>S/ {fmt(m.saldo_final)}</strong>
                </div>
              </div>

              <div className="caja-metodo-section">
                <div className="caja-metodo-section-header ingreso">
                  <span>Ingresos</span>
                  <span>{fmt(m.ingresos.total)}</span>
                </div>
                {INGRESO_CATS.map((cat) => (
                  <div className="caja-row" key={cat}>
                    <span className="caja-row-label">{INGRESO_LABELS[cat]}</span>
                    <span className="caja-row-right">
                      <span className="caja-row-amount">{fmt(m.ingresos[cat])}</span>
                      {cat === 'ventas' ? (
                        <span className="caja-row-auto">auto</span>
                      ) : (
                        <button className="caja-row-add" title="Registrar ingreso" onClick={() => openMovForm('ingreso', m, cat)}>
                          <Plus size={13} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <div className="caja-metodo-section">
                <div className="caja-metodo-section-header egreso">
                  <span>Egresos</span>
                  <span>{fmt(m.egresos.total)}</span>
                </div>
                {EGRESO_CATS.map((cat) => (
                  <div className="caja-row" key={cat}>
                    <span className="caja-row-label">{EGRESO_LABELS[cat]}</span>
                    <span className="caja-row-right">
                      <span className="caja-row-amount">{fmt(m.egresos[cat])}</span>
                      <button className="caja-row-add" title="Registrar egreso" onClick={() => openMovForm('egreso', m, cat)}>
                        <Plus size={13} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {data.resumen.length === 0 && (
            <p className="empty-row">No hay métodos de pago activos. Créalos en Configuración → Métodos de pago.</p>
          )}
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
                {data.movimientos.map((m) => {
                  const metodo = metodoPorCodigo[m.medio];
                  return (
                    <tr key={m.id}>
                      <td><span className={'badge ' + (m.tipo === 'ingreso' ? 'badge-good' : 'badge-critical')}>{TIPO_MOV_LABEL[m.tipo]}</span></td>
                      <td>
                        <span className="caja-mov-medio">
                          <span className="caja-mov-medio-dot" style={{ background: metodo?.color || '#94a3b8' }}>{metodo?.icono || '💳'}</span>
                          {metodo?.nombre || m.medio}
                        </span>
                      </td>
                      <td>{(m.tipo === 'ingreso' ? INGRESO_LABELS[m.categoria] : EGRESO_LABELS[m.categoria]) || m.categoria}</td>
                      <td style={{ textAlign: 'right' }}>S/ {fmt(m.monto)}</td>
                      <td>{m.descripcion || '—'}</td>
                      <td>{m.usuario_nombre || '—'}</td>
                      <td><button className="btn-link danger" onClick={() => handleDeleteMov(m.id)} title="Eliminar"><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
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
            <h2>
              <span className="caja-mov-medio-dot" style={{ background: movContext?.color }}>{movContext?.icono}</span>{' '}
              {movContext?.tipo === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo egreso'} — {movContext?.label}
            </h2>
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
