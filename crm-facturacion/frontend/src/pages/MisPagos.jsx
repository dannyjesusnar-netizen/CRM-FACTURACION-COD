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

// Carga el script de Culqi.js una sola vez (checkout emergente que
// tokeniza la tarjeta en el navegador — el número real nunca pasa por
// nuestro backend, ver routes/suscripcion.js).
function useCulqiScript() {
  const [listo, setListo] = useState(Boolean(window.Culqi));
  useEffect(() => {
    if (window.Culqi) { setListo(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.culqi.com/js/v4';
    script.async = true;
    script.onload = () => setListo(true);
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);
  return listo;
}

export default function MisPagos() {
  const { user } = useAuth();
  const toast = useToast();
  const culqiListo = useCulqiScript();
  const [data, setData] = useState(null);
  const [noAplica, setNoAplica] = useState(false);
  const [loading, setLoading] = useState(true);
  const [guardandoTarjeta, setGuardandoTarjeta] = useState(false);

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

  function abrirCulqi() {
    if (!culqiListo || !window.Culqi) {
      toast.error('El formulario de pago todavía está cargando, esperá un segundo e intentá de nuevo.');
      return;
    }
    if (!data?.culqi_public_key) {
      toast.error('El cobro de suscripciones todavía no está configurado. Contacta al soporte de la plataforma.');
      return;
    }
    window.Culqi.publicKey = data.culqi_public_key;
    window.culqi = function culqiCallback() {
      if (window.Culqi.token) {
        const tokenId = window.Culqi.token.id;
        setGuardandoTarjeta(true);
        api.post('/suscripcion/tarjeta', { token_id: tokenId })
          .then(() => {
            toast.success('Tarjeta guardada. El cobro mensual se hace automáticamente.');
            load();
          })
          .catch((err) => toast.error(err.response?.data?.error || 'No se pudo guardar la tarjeta.'))
          .finally(() => setGuardandoTarjeta(false));
      } else if (window.Culqi.order) {
        toast.error('No se pudo completar. Intenta con otro método.');
      } else {
        toast.error(window.Culqi.error?.user_message || 'No se pudo procesar la tarjeta.');
      }
    };
    window.Culqi.settings({
      title: 'CRM Facturación — Suscripción',
      currency: 'PEN',
      amount: Math.round((data.suscripcion?.costo_mensual || 0) * 100),
    });
    window.Culqi.open();
  }

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
            ) : (
              <div style={{ marginTop: 6 }}>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 8 }}>
                  Todavía no registraste una tarjeta — el cobro mensual automático no puede empezar hasta que agregues una.
                </p>
                <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={guardandoTarjeta} onClick={abrirCulqi}>
                  {guardandoTarjeta ? 'Guardando...' : 'Agregar tarjeta'}
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
