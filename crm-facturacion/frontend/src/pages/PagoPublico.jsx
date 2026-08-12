import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Receipt } from 'lucide-react';
import api from '../api';

const DEFAULTS = {
  yape: { nombre: 'Yape', icono: '📲', color: '#7c3aed' },
  plin: { nombre: 'Plin', icono: '📱', color: '#00bcd4' },
};

export default function PagoPublico() {
  const { ruc } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [datos, setDatos] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.get(`/pago-publico/${ruc}`)
      .then((res) => setDatos(res.data))
      .catch((err) => setError(err.response?.data?.error || 'No se pudo cargar este comercio.'))
      .finally(() => setLoading(false));
  }, [ruc]);

  function copiarNumero(telefono) {
    navigator.clipboard?.writeText(telefono).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="pago-publico-page">
        <div className="pago-publico-card">
          <p>Cargando…</p>
        </div>
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div className="pago-publico-page">
        <div className="pago-publico-card">
          <h1>😕 {error || 'No se pudo cargar este comercio.'}</h1>
        </div>
      </div>
    );
  }

  const medioSeleccionado = seleccion ? datos.medios.find((m) => m.medio === seleccion) : null;

  return (
    <div className="pago-publico-page">
      <div className="pago-publico-card">
        {datos.logo_data_url && <img src={datos.logo_data_url} alt="Logo" className="pago-publico-logo" />}
        <p className="pago-publico-eyebrow">Métodos de pago del comercio</p>
        <h1>{datos.nombre_comercio}</h1>

        {!medioSeleccionado ? (
          <>
            <p className="pago-publico-hint">Elige con qué app quieres pagar:</p>
            <div className="pago-publico-opciones">
              {datos.medios.map((m) => (
                <button
                  key={m.medio}
                  type="button"
                  className="pago-publico-opcion"
                  style={{ '--medio-color': DEFAULTS[m.medio]?.color }}
                  onClick={() => { setSeleccion(m.medio); setCopiado(false); }}
                >
                  <span className="pago-publico-opcion-icono">{DEFAULTS[m.medio]?.icono}</span>
                  {DEFAULTS[m.medio]?.nombre || m.medio}
                </button>
              ))}
              {datos.medios.length === 0 && (
                <p style={{ color: 'var(--ink-muted)' }}>Este comercio todavía no configuró sus datos de pago.</p>
              )}
            </div>
          </>
        ) : (
          <div className="pago-publico-detalle">
            <button type="button" className="pago-publico-volver" onClick={() => setSeleccion(null)}>
              <ArrowLeft size={14} /> Elegir otra app
            </button>

            <div className="pago-publico-detalle-header" style={{ '--medio-color': DEFAULTS[medioSeleccionado.medio]?.color }}>
              <span className="pago-publico-opcion-icono">{DEFAULTS[medioSeleccionado.medio]?.icono}</span>
              <h2>{DEFAULTS[medioSeleccionado.medio]?.nombre}</h2>
            </div>

            {medioSeleccionado.qr_data_url && (
              <img src={medioSeleccionado.qr_data_url} alt={`QR ${DEFAULTS[medioSeleccionado.medio]?.nombre}`} className="pago-publico-qr-img" />
            )}

            {medioSeleccionado.titular_nombre && (
              <p className="pago-publico-dato">
                <span>A nombre de</span>
                <strong>{medioSeleccionado.titular_nombre}</strong>
              </p>
            )}

            {medioSeleccionado.titular_telefono && (
              <>
                <p className="pago-publico-dato">
                  <span>Número</span>
                  <strong>{medioSeleccionado.titular_telefono}</strong>
                </p>
                <button type="button" className="btn-primary pago-publico-copiar-btn" onClick={() => copiarNumero(medioSeleccionado.titular_telefono)}>
                  {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? 'Copiado' : 'Copiar número'}
                </button>
              </>
            )}

            <p className="pago-publico-instrucciones">
              <Receipt size={14} /> Copia este número e ingresa a tu app {DEFAULTS[medioSeleccionado.medio]?.nombre} para
              realizar el pago con el monto que te indicó el negocio.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
