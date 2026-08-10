import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// Yape y Plin ya existen como métodos de pago sembrados por defecto (ver
// db.js) con codigo 'yape' / 'plin' — codigo es inmutable aunque Gerencia
// renombre el método, así que es un enlace estable. Si alguna vez los
// borraron, esta pantalla los vuelve a crear sola al subir un QR.
const DEFAULTS = {
  yape: { nombre: 'Yape', tipo: 'billetera', color: '#7c3aed', icono: '📲' },
  plin: { nombre: 'Plin', tipo: 'billetera', color: '#00bcd4', icono: '📱' },
};

function emptyMetodos() {
  return { yape: null, plin: null };
}

export default function QrEstatico() {
  const navigate = useNavigate();
  const toast = useToast();
  const { empresa } = useAuth();
  const [metodos, setMetodos] = useState(emptyMetodos());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(emptyMetodos());

  useEffect(() => {
    load();
  }, []);

  function load() {
    api.get('/metodos-pago', { params: { todos: 1 } }).then((res) => {
      setMetodos({
        yape: res.data.find((m) => m.codigo === 'yape') || null,
        plin: res.data.find((m) => m.codigo === 'plin') || null,
      });
      setLoading(false);
    });
  }

  async function handleQrChange(codigo, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.3 * 1024 * 1024) {
      toast.error('La imagen es muy pesada. Usa una de menos de 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving((prev) => ({ ...prev, [codigo]: true }));
      try {
        const existente = metodos[codigo];
        if (existente) {
          await api.put(`/metodos-pago/${existente.id}`, { ...existente, qr_data_url: reader.result });
        } else {
          await api.post('/metodos-pago', { ...DEFAULTS[codigo], qr_data_url: reader.result });
        }
        toast.success(`QR de ${DEFAULTS[codigo].nombre} guardado.`);
        load();
      } catch (err) {
        toast.error(err.response?.data?.error || 'No se pudo guardar el QR.');
      } finally {
        setSaving((prev) => ({ ...prev, [codigo]: false }));
      }
    };
    reader.readAsDataURL(file);
  }

  async function quitarQr(codigo) {
    const existente = metodos[codigo];
    if (!existente) return;
    if (!window.confirm(`¿Quitar el QR de ${DEFAULTS[codigo].nombre}?`)) return;
    await api.put(`/metodos-pago/${existente.id}`, { ...existente, qr_data_url: '' });
    toast.success('QR eliminado.');
    load();
  }

  const nombreEmpresa = empresa?.nombre_comercial || empresa?.razon_social || '';
  const tieneAlgunQr = metodos.yape?.qr_data_url || metodos.plin?.qr_data_url;

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver al menú" onClick={() => navigate('/menu')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        QR ESTÁTICO
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }} className="no-print">
        Sube la foto de tu QR real de Yape y/o Plin (lo mismo que aparece en tu app, en "Mi código QR") y genera un
        cartel listo para imprimir y pegar en tu tienda. Es un QR estático: el cliente confirma el monto en su
        propia app al escanear. Estos mismos QR también aparecen al cobrar una venta con Yape o Plin.
      </p>

      {!loading && (
        <>
          <div className="qr-estatico-grid no-print">
            {['yape', 'plin'].map((codigo) => (
              <div key={codigo} className="panel">
                <h3 style={{ marginTop: 0 }}>{DEFAULTS[codigo].icono} {metodos[codigo]?.nombre || DEFAULTS[codigo].nombre}</h3>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ width: 130, height: 130, border: '1px dashed var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface)' }}>
                    {metodos[codigo]?.qr_data_url ? (
                      <img src={metodos[codigo].qr_data_url} alt={`QR ${DEFAULTS[codigo].nombre}`} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center' }}>Sin QR</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="btn-secondary" style={{ width: 'auto', textAlign: 'center', cursor: 'pointer' }}>
                      {saving[codigo] ? 'Guardando...' : (metodos[codigo]?.qr_data_url ? 'Cambiar QR' : 'Subir QR')}
                      <input type="file" accept="image/png,image/jpeg" onChange={(e) => handleQrChange(codigo, e)} style={{ display: 'none' }} disabled={saving[codigo]} />
                    </label>
                    {metodos[codigo]?.qr_data_url && (
                      <button type="button" className="btn-secondary" onClick={() => quitarQr(codigo)}>Quitar QR</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {tieneAlgunQr && (
            <div className="qr-print-section">
              <div className="report-toolbar no-print">
                <h3 style={{ margin: 0 }}>Cartel para imprimir</h3>
                <button type="button" className="btn-primary" style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => window.print()}>
                  <Printer size={16} /> Imprimir
                </button>
              </div>

              <div className="qr-print-poster">
                {empresa?.logo_data_url && <img src={empresa.logo_data_url} alt="Logo" className="qr-print-logo" />}
                <h2>{nombreEmpresa}</h2>
                <p className="qr-print-subtitulo">Escanea y paga con tu app</p>
                <div className="qr-print-codigos">
                  {metodos.yape?.qr_data_url && (
                    <div className="qr-print-item">
                      <img src={metodos.yape.qr_data_url} alt="QR Yape" />
                      <span>📲 Yape</span>
                    </div>
                  )}
                  {metodos.plin?.qr_data_url && (
                    <div className="qr-print-item">
                      <img src={metodos.plin.qr_data_url} alt="QR Plin" />
                      <span>📱 Plin</span>
                    </div>
                  )}
                </div>
                {empresa?.ruc && <p className="qr-print-ruc">RUC {empresa.ruc}</p>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
