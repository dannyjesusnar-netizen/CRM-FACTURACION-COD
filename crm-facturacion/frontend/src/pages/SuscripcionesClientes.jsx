import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const ESTADO_LABEL = { sin_tarjeta: 'Sin tarjeta', activa: 'Activa', pago_fallido: 'Pago fallido', pausada: 'Pausada' };
const ESTADO_BADGE = { sin_tarjeta: 'badge-neutral', activa: 'badge-good', pago_fallido: 'badge-critical', pausada: 'badge-warning' };

function formatFecha(f) {
  if (!f) return '—';
  return String(f).slice(0, 10);
}

// Carga el script embebido de Izipay (KR.js), que necesita la llave pública
// del comercio en el propio tag <script> para inicializarse — por eso no se
// puede cargar de antemano como el de Culqi, recién cuando conocemos la
// llave (respuesta de POST .../form-token). La tarjeta se captura DENTRO
// del widget de Izipay — nuestro código nunca ve el número real (ver
// routes/suscripcionesClientes.js y utils/izipay.js).
function useIzipayScript(publicKey) {
  const [listo, setListo] = useState(false);
  useEffect(() => {
    if (!publicKey) return;
    if (window.KR) { setListo(true); return; }
    const script = document.createElement('script');
    script.src = 'https://static.micuentaweb.pe/static/js/krypton-client/V4.0/stable/kr-payment-form.min.js';
    script.setAttribute('kr-public-key', publicKey);
    script.async = true;
    script.onload = () => setListo(true);
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [publicKey]);
  return listo;
}

export default function SuscripcionesClientes() {
  const navigate = useNavigate();
  const toast = useToast();

  const [suscripciones, setSuscripciones] = useState([]);
  const [clients, setClients] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState('');
  const [montoMensual, setMontoMensual] = useState('');
  const [diaCobro, setDiaCobro] = useState(1);
  const [error, setError] = useState('');
  const [formToken, setFormToken] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [guardandoTarjeta, setGuardandoTarjeta] = useState(false);
  const [yaTieneTarjeta, setYaTieneTarjeta] = useState(false);
  const [editandoExistente, setEditandoExistente] = useState(false);
  const izipayListo = useIzipayScript(publicKey);

  function load() {
    api.get('/clientes-suscripciones').then((res) => setSuscripciones(res.data));
  }

  useEffect(() => {
    load();
    api.get('/clients').then((res) => setClients(res.data));
  }, []);

  function openNew() {
    setClientId('');
    setMontoMensual('');
    setDiaCobro(1);
    setFormToken(null);
    setPublicKey(null);
    setYaTieneTarjeta(false);
    setEditandoExistente(false);
    setError('');
    setShowForm(true);
  }

  function openEdit(s) {
    setClientId(s.client_id);
    setMontoMensual(s.monto_mensual);
    setDiaCobro(s.dia_cobro);
    setFormToken(null);
    setPublicKey(null);
    setYaTieneTarjeta(Boolean(s.izipay_token));
    setEditandoExistente(true);
    setError('');
    setShowForm(true);
  }

  async function guardarDatos(e) {
    e.preventDefault();
    setError('');
    if (!clientId) { setError('Selecciona un cliente.'); return; }
    if (!montoMensual || Number(montoMensual) <= 0) { setError('Ingresa el monto mensual.'); return; }
    try {
      await api.post(`/clientes-suscripciones/${clientId}`, {
        monto_mensual: Number(montoMensual),
        dia_cobro: Number(diaCobro),
      });
      load();
      if (yaTieneTarjeta) {
        toast.success('Monto y día de cobro actualizados.');
        setShowForm(false);
        return;
      }
      toast.success('Monto y día de cobro guardados. Ahora agrega la tarjeta.');
      await pedirFormulario();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar.');
    }
  }

  async function pedirFormulario() {
    try {
      const res = await api.post(`/clientes-suscripciones/${clientId}/form-token`, {
        monto_mensual: Number(montoMensual),
      });
      setPublicKey(res.data.izipay_public_key);
      setFormToken(res.data.formToken);
    } catch (err) {
      setError(err.response?.data?.error || 'Izipay no está configurado todavía en este servidor.');
    }
  }

  useEffect(() => {
    if (!formToken || !izipayListo || !window.KR) return;
    window.KR.setFormConfig({ formToken, 'kr-language': 'es-PE' });
    window.KR.onSubmit((event) => {
      setGuardandoTarjeta(true);
      const respuesta = event.clientAnswer;
      api.post(`/clientes-suscripciones/${clientId}`, {
        monto_mensual: Number(montoMensual),
        dia_cobro: Number(diaCobro),
        kr_answer: JSON.stringify(respuesta),
        kr_hash: event.hash,
      })
        .then(() => {
          toast.success('Tarjeta guardada. El cobro mensual se hace automáticamente.');
          setShowForm(false);
          load();
        })
        .catch((err) => toast.error(err.response?.data?.error || 'No se pudo guardar la tarjeta.'))
        .finally(() => setGuardandoTarjeta(false));
      return false; // evita que Izipay redirija la página
    });
  }, [formToken, izipayListo]);

  async function pausar(id) {
    try {
      await api.post(`/clientes-suscripciones/${id}/pausar`);
      toast.success('Suscripción pausada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo pausar.');
    }
  }

  async function reanudar(id) {
    try {
      await api.post(`/clientes-suscripciones/${id}/reanudar`);
      toast.success('Suscripción reanudada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo reanudar.');
    }
  }

  async function quitarTarjeta(id) {
    if (!window.confirm('¿Quitar la tarjeta guardada? El cobro automático se detiene hasta que agregues una nueva.')) return;
    try {
      await api.delete(`/clientes-suscripciones/${id}`);
      toast.success('Tarjeta eliminada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo quitar la tarjeta.');
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Clientes" onClick={() => navigate('/clientes')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        SUSCRIPCIONES
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Cobro mensual automático a tus clientes con tarjeta guardada (Izipay) — separado de lo que tú le pagas a la plataforma.
      </p>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={openNew}>+ Nueva suscripción</button>
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th style={{ textAlign: 'right' }}>Monto mensual</th>
              <th>Día de cobro</th>
              <th>Estado</th>
              <th>Próximo cobro</th>
              <th>Tarjeta</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {suscripciones.map((s) => (
              <tr key={s.id}>
                <td>{s.cliente_nombre}</td>
                <td style={{ textAlign: 'right' }}>{s.moneda === 'USD' ? '$' : 'S/'} {Number(s.monto_mensual).toFixed(2)}</td>
                <td>{s.dia_cobro}</td>
                <td><span className={'badge ' + (ESTADO_BADGE[s.estado] || 'badge-neutral')}>{ESTADO_LABEL[s.estado] || s.estado}</span></td>
                <td>{formatFecha(s.proximo_cobro_at)}</td>
                <td>{s.izipay_token ? `${s.tarjeta_marca || 'Tarjeta'} ****${s.tarjeta_ultimos4 || ''}` : '—'}</td>
                <td>
                  <button className="btn-link" onClick={() => openEdit(s)}>Editar</button>
                  {' '}
                  {s.estado === 'pausada' ? (
                    <button className="btn-link" onClick={() => reanudar(s.client_id)}>Reanudar</button>
                  ) : s.izipay_token ? (
                    <button className="btn-link" onClick={() => pausar(s.client_id)}>Pausar</button>
                  ) : null}
                  {' '}
                  {s.izipay_token && (
                    <button className="btn-link danger" onClick={() => quitarTarjeta(s.client_id)}>Quitar tarjeta</button>
                  )}
                </td>
              </tr>
            ))}
            {suscripciones.length === 0 && (
              <tr><td colSpan={7} className="empty-row">Todavía no hay suscripciones configuradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editandoExistente ? 'Editar suscripción' : 'Nueva suscripción'}</h2>
            {!formToken ? (
              <form onSubmit={guardarDatos}>
                <label>Cliente</label>
                <select required disabled={editandoExistente} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Selecciona un cliente...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                <label>Monto mensual (S/)</label>
                <input required type="number" min="0.01" step="0.01" value={montoMensual}
                  onChange={(e) => setMontoMensual(e.target.value)} />
                <label>Día de cobro (1-28)</label>
                <input required type="number" min="1" max="28" value={diaCobro}
                  onChange={(e) => setDiaCobro(e.target.value)} />
                {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                  <button type="submit" className="btn-primary">{yaTieneTarjeta ? 'Guardar' : 'Continuar a la tarjeta'}</button>
                </div>
              </form>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 10 }}>
                  Ingresa los datos de la tarjeta del cliente. El número nunca pasa por nuestros servidores.
                </p>
                <div className="kr-embedded" kr-form-token={formToken} kr-card-form-expanded="true" />
                {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
                {guardandoTarjeta && <p style={{ fontSize: 13 }}>Guardando...</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cerrar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
