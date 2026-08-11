import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const ESTADO_BADGE = { activa: 'badge-good', pago_fallido: 'badge-critical', sin_tarjeta: 'badge-neutral' };
const ESTADO_LABEL = { activa: 'Activa', pago_fallido: 'Pago fallido', sin_tarjeta: 'Sin tarjeta' };

function formatFecha(f) {
  if (!f) return '—';
  return String(f).slice(0, 10);
}

// Carga el script embebido de Izipay (KR.js), que necesita la llave pública
// del comercio en el propio tag <script> para inicializarse — recién se
// puede cargar cuando conocemos la llave (respuesta de POST .../form-token).
// La tarjeta se captura DENTRO del widget de Izipay — nuestro código nunca
// ve el número real, ver routes/suscripcion.js.
function useIzipayScript(publicKey) {
  const [listo, setListo] = useState(false);
  useEffect(() => {
    if (!publicKey) return;
    if (window.KR) { setListo(true); return; }

    // El script solo trae la lógica del formulario — sin esta hoja de
    // estilos oficial (mismo tema "classic" que usan los ejemplos propios
    // de Izipay Perú) los campos se ven como HTML sin diseñar.
    let link = document.querySelector('link[data-izipay-theme]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://static.micuentaweb.pe/static/js/krypton-client/V4.0/ext/classic-reset.min.css';
      link.setAttribute('data-izipay-theme', 'true');
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = 'https://static.micuentaweb.pe/static/js/krypton-client/V4.0/stable/kr-payment-form.min.js';
    script.setAttribute('kr-public-key', publicKey);
    script.setAttribute('kr-theme', 'classic');
    script.async = true;
    script.onload = () => setListo(true);
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [publicKey]);
  return listo;
}

export default function MisPagos() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [noAplica, setNoAplica] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pagando, setPagando] = useState(false);
  const [formToken, setFormToken] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const izipayListo = useIzipayScript(publicKey);

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    api.get('/suscripcion')
      .then((res) => setData(res.data))
      .catch((err) => {
        if (err.response?.status === 404) setNoAplica(true);
        else toast.error(err.response?.data?.error || 'No se pudo cargar tu suscripción.');
      })
      .finally(() => setLoading(false));
  }

  async function pagar() {
    try {
      const res = await api.post('/suscripcion/form-token');
      setPublicKey(res.data.izipay_public_key);
      setFormToken(res.data.formToken);
    } catch (err) {
      toast.error(err.response?.data?.error || 'El cobro de suscripciones todavía no está configurado. Contacta al soporte de la plataforma.');
    }
  }

  useEffect(() => {
    if (!formToken || !izipayListo || !window.KR) return;
    window.KR.setFormConfig({ formToken, 'kr-language': 'es-PE' });
    window.KR.onSubmit((event) => {
      setPagando(true);
      api.post('/suscripcion/tarjeta', { kr_answer: JSON.stringify(event.clientAnswer), kr_hash: event.hash })
        .then(() => {
          toast.success('Tarjeta guardada. El cobro mensual se hace automáticamente.');
          setFormToken(null);
          load();
        })
        .catch((err) => toast.error(err.response?.data?.error || 'No se pudo guardar la tarjeta.'))
        .finally(() => setPagando(false));
      return false; // evita que Izipay redirija la página
    });
  }, [formToken, izipayListo]);

  async function quitarTarjeta() {
    if (!window.confirm('¿Quitar la tarjeta guardada? El cobro automático se pausa hasta que agregues una nueva.')) return;
    try {
      await api.delete('/suscripcion/tarjeta');
      toast.success('Tarjeta eliminada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo quitar la tarjeta.');
    }
  }

  if (user?.role !== 'gerencia') return <Navigate to="/menu" replace />;
  if (loading) return <div className="content-wide">Cargando...</div>;

  if (noAplica) {
    return (
      <div className="content-wide">
        <h1 className="page-title">MIS PAGOS</h1>
        <p style={{ color: 'var(--ink-muted)' }}>
          Esta instancia no tiene una suscripción a la plataforma configurada.
        </p>
      </div>
    );
  }

  const s = data.suscripcion;
  const tieneCosto = s.costo_mensual != null;

  return (
    <div className="content-wide" style={{ maxWidth: 720 }}>
      <h1 className="page-title">MIS PAGOS</h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Suscripción de tu empresa a la plataforma — separado de lo que tú les cobras a tus propios clientes.
      </p>

      <div className="panel" style={{ padding: 20, marginTop: 16 }}>
        {!tieneCosto ? (
          <p>Todavía no tienes un costo de suscripción asignado. Contacta al soporte de la plataforma.</p>
        ) : (
          <>
            <div className="form-row">
              <div>
                <label>Costo mensual</label>
                <p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0' }}>S/ {Number(s.costo_mensual).toFixed(2)}</p>
              </div>
              <div>
                <label>Estado</label>
                <p style={{ margin: '8px 0' }}>
                  <span className={'badge ' + (ESTADO_BADGE[s.suscripcion_estado] || 'badge-neutral')}>
                    {ESTADO_LABEL[s.suscripcion_estado] || s.suscripcion_estado}
                  </span>
                </p>
              </div>
            </div>
            <div className="form-row">
              <div>
                <label>Fecha de inicio</label>
                <p style={{ margin: '4px 0' }}>{formatFecha(s.fecha_inicio_suscripcion)}</p>
              </div>
              <div>
                <label>Próximo cobro</label>
                <p style={{ margin: '4px 0' }}>{formatFecha(s.proximo_cobro_at)}</p>
              </div>
            </div>

            <label style={{ marginTop: 18 }}>Tarjeta</label>
            {s.tiene_tarjeta ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <span>{s.tarjeta_marca || 'Tarjeta'} terminada en {s.tarjeta_ultimos4 || '****'}</span>
                <button type="button" className="btn-link danger" onClick={quitarTarjeta}>Quitar</button>
              </div>
            ) : formToken ? (
              <div style={{ marginTop: 6 }}>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 8 }}>
                  Ingresa los datos de tu tarjeta. El número nunca pasa por nuestros servidores.
                </p>
                <div className="kr-embedded" kr-form-token={formToken} kr-card-form-expanded="true" />
                {pagando && <p style={{ fontSize: 13 }}>Guardando...</p>}
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 8 }}>
                  Todavía no registraste una tarjeta — el cobro mensual automático no puede empezar hasta que agregues una.
                </p>
                <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={pagar}>
                  PAGAR
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Historial de pagos</h2>
      <table className="data-table">
        <thead>
          <tr><th>Fecha</th><th>Monto</th><th>Estado</th><th>Mensaje</th></tr>
        </thead>
        <tbody>
          {(data.historial || []).map((p) => (
            <tr key={p.id}>
              <td>{formatFecha(p.created_at)}</td>
              <td>S/ {Number(p.monto).toFixed(2)}</td>
              <td>
                <span className={'badge ' + (p.estado === 'exitoso' ? 'badge-good' : 'badge-critical')}>
                  {p.estado === 'exitoso' ? 'Exitoso' : 'Fallido'}
                </span>
              </td>
              <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{p.mensaje || '—'}</td>
            </tr>
          ))}
          {(data.historial || []).length === 0 && (
            <tr><td colSpan={4} className="empty-row">Todavía no hay cobros registrados.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
