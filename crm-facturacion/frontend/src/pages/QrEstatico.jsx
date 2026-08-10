import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Camera, Trash2 } from 'lucide-react';
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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Redimensiona/comprime la foto en el navegador antes de subirla — una foto
// de cámara sin comprimir puede pesar varios MB, esto la deja liviana sin
// perder legibilidad del texto del comprobante.
function comprimirImagen(file, maxWidth = 1000, calidad = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

export default function QrEstatico() {
  const navigate = useNavigate();
  const toast = useToast();
  const { empresa } = useAuth();
  const [metodos, setMetodos] = useState(emptyMetodos());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linkForm, setLinkForm] = useState({ yape: '', plin: '' });
  const [savingLink, setSavingLink] = useState(emptyMetodos());

  // --- Registrar pago ---
  const [showRegistro, setShowRegistro] = useState(false);
  const [fotoPago, setFotoPago] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [medioPago, setMedioPago] = useState('yape');
  const [montoPago, setMontoPago] = useState('');
  const [montoDetectado, setMontoDetectado] = useState(null);
  const [guardandoPago, setGuardandoPago] = useState(false);

  // --- Historial del día ---
  const [fechaHistorial, setFechaHistorial] = useState(todayStr());
  const [historial, setHistorial] = useState({ pagos: [], total: 0, porMedio: { yape: 0, plin: 0 } });

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadHistorial(fechaHistorial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaHistorial]);

  function load() {
    api.get('/metodos-pago', { params: { todos: 1 } }).then((res) => {
      const yape = res.data.find((m) => m.codigo === 'yape') || null;
      const plin = res.data.find((m) => m.codigo === 'plin') || null;
      setMetodos({ yape, plin });
      setLinkForm({ yape: yape?.link_pago || '', plin: plin?.link_pago || '' });
      setLoading(false);
    });
  }

  function loadHistorial(fecha) {
    api.get('/pagos-qr', { params: { fecha } }).then((res) => setHistorial(res.data));
  }

  // Yape y Plin son interoperables en Perú (mandato BCRP, 2023): el mismo QR
  // se puede escanear desde cualquiera de las dos apps y el pago llega igual.
  // Por eso se sube una sola imagen de QR, y se guarda ese mismo data URL en
  // ambos métodos de pago (yape/plin) para no romper la pantalla de Cobrar,
  // que ya busca el QR por código de medio.
  async function handleQrUnico(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.3 * 1024 * 1024) {
      toast.error('La imagen es muy pesada. Usa una de menos de 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving(true);
      try {
        const dataUrl = reader.result;
        await Promise.all(
          ['yape', 'plin'].map((codigo) => {
            const existente = metodos[codigo];
            return existente
              ? api.put(`/metodos-pago/${existente.id}`, { ...existente, qr_data_url: dataUrl })
              : api.post('/metodos-pago', { ...DEFAULTS[codigo], qr_data_url: dataUrl });
          })
        );
        toast.success('QR interoperable guardado.');
        load();
      } catch (err) {
        toast.error(err.response?.data?.error || 'No se pudo guardar el QR.');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function quitarQrUnico() {
    if (!window.confirm('¿Quitar el QR interoperable?')) return;
    await Promise.all(
      ['yape', 'plin'].map((codigo) => {
        const existente = metodos[codigo];
        return existente ? api.put(`/metodos-pago/${existente.id}`, { ...existente, qr_data_url: '' }) : Promise.resolve();
      })
    );
    toast.success('QR eliminado.');
    load();
  }

  async function guardarLink(codigo) {
    setSavingLink((prev) => ({ ...prev, [codigo]: true }));
    try {
      const existente = metodos[codigo];
      if (existente) {
        await api.put(`/metodos-pago/${existente.id}`, { ...existente, link_pago: linkForm[codigo] });
      } else {
        await api.post('/metodos-pago', { ...DEFAULTS[codigo], link_pago: linkForm[codigo] });
      }
      toast.success(`Link de ${DEFAULTS[codigo].nombre} guardado.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo guardar el link.');
    } finally {
      setSavingLink((prev) => ({ ...prev, [codigo]: false }));
    }
  }

  function abrirRegistroPago() {
    setFotoPago('');
    setMedioPago('yape');
    setMontoPago('');
    setMontoDetectado(null);
    setShowRegistro(true);
  }

  async function handleFotoPago(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const comprimida = await comprimirImagen(file);
      setFotoPago(comprimida);
      setAnalizando(true);
      const res = await api.post('/pagos-qr/detectar-monto', { foto_data_url: comprimida });
      setMontoDetectado(res.data.monto_detectado);
      if (res.data.monto_detectado != null) setMontoPago(String(res.data.monto_detectado));
      if (res.data.medio_detectado) setMedioPago(res.data.medio_detectado);
      if (res.data.monto_detectado == null) {
        toast.info('No pudimos detectar el monto automáticamente — ingrésalo tú.');
      }
    } catch (err) {
      toast.error('No se pudo analizar la foto. Ingresa el monto manualmente.');
    } finally {
      setAnalizando(false);
    }
  }

  async function handleGuardarPago(e) {
    e.preventDefault();
    if (!fotoPago) { toast.error('Adjunta la foto del comprobante.'); return; }
    if (!(Number(montoPago) > 0)) { toast.error('Ingresa un monto válido.'); return; }
    setGuardandoPago(true);
    try {
      await api.post('/pagos-qr', {
        medio: medioPago,
        monto: Number(montoPago),
        monto_detectado: montoDetectado,
        foto_data_url: fotoPago,
      });
      toast.success('Pago registrado.');
      setShowRegistro(false);
      setFechaHistorial(todayStr());
      loadHistorial(todayStr());
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo registrar el pago.');
    } finally {
      setGuardandoPago(false);
    }
  }

  async function eliminarPago(id) {
    if (!window.confirm('¿Eliminar este pago del historial?')) return;
    try {
      await api.delete(`/pagos-qr/${id}`);
      loadHistorial(fechaHistorial);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo eliminar.');
    }
  }

  const nombreEmpresa = empresa?.nombre_comercial || empresa?.razon_social || '';
  const qrUnico = metodos.yape?.qr_data_url || metodos.plin?.qr_data_url || '';

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver al menú" onClick={() => navigate('/menu')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        QR ESTÁTICO
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }} className="no-print">
        Sube la foto de tu QR real (el que aparece en tu app, en "Mi código QR" de Yape o de Plin). Como en Perú Yape y
        Plin son interoperables, ese mismo QR ya lo puede escanear cualquiera de las dos apps — no necesitas subir dos.
        Agrega tus links de pago si tienes, y genera un cartel listo para imprimir y pegar en tu tienda.
      </p>

      {!loading && (
        <>
          <div className="panel no-print" style={{ maxWidth: 480 }}>
            <h3 style={{ marginTop: 0 }}>🔗 QR interoperable (Yape y Plin)</h3>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 130, height: 130, border: '1px dashed var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface)' }}>
                {qrUnico ? (
                  <img src={qrUnico} alt="QR interoperable" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center' }}>Sin QR</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="btn-secondary" style={{ width: 'auto', textAlign: 'center', cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : (qrUnico ? 'Cambiar QR' : 'Subir QR')}
                  <input type="file" accept="image/png,image/jpeg" onChange={handleQrUnico} style={{ display: 'none' }} disabled={saving} />
                </label>
                {qrUnico && (
                  <button type="button" className="btn-secondary" onClick={quitarQrUnico}>Quitar QR</button>
                )}
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 10, marginBottom: 0 }}>
              Un solo código: el cliente lo escanea con la app que tenga (Yape o Plin) y el pago te llega igual.
            </p>

            {['yape', 'plin'].map((codigo) => (
              <div key={codigo}>
                <label style={{ marginTop: 14, display: 'block' }}>{DEFAULTS[codigo].icono} Link de pago {DEFAULTS[codigo].nombre} (opcional)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="url"
                    value={linkForm[codigo]}
                    onChange={(e) => setLinkForm((prev) => ({ ...prev, [codigo]: e.target.value }))}
                    placeholder={`https://${codigo}.me/tu-negocio`}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn-secondary" style={{ width: 'auto' }} disabled={savingLink[codigo]} onClick={() => guardarLink(codigo)}>
                    {savingLink[codigo] ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="report-toolbar no-print" style={{ justifyContent: 'center', marginBottom: 24 }}>
            <button type="button" className="btn-primary qr-registrar-pago-btn" onClick={abrirRegistroPago}>
              <Camera size={20} /> REGISTRAR PAGO
            </button>
          </div>

          {qrUnico && (
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
                <p className="qr-print-subtitulo">Escanea con Yape o Plin y paga al instante</p>
                <div className="qr-print-codigos">
                  <div className="qr-print-item">
                    <img src={qrUnico} alt="QR interoperable Yape/Plin" />
                    <span>📲 Yape · 📱 Plin</span>
                  </div>
                </div>
                {empresa?.ruc && <p className="qr-print-ruc">RUC {empresa.ruc}</p>}
              </div>
            </div>
          )}

          <div className="no-print" style={{ marginTop: 32 }}>
            <div className="report-toolbar">
              <h3 style={{ margin: 0 }}>Historial de pagos por QR</h3>
              <input type="date" value={fechaHistorial} onChange={(e) => setFechaHistorial(e.target.value)} style={{ width: 'auto' }} />
            </div>

            <div className="qr-resumen-dia">
              <div className="qr-resumen-card">
                <span>Total del día</span>
                <strong>S/ {historial.total.toFixed(2)}</strong>
              </div>
              <div className="qr-resumen-card">
                <span>📲 Yape</span>
                <strong>S/ {historial.porMedio.yape.toFixed(2)}</strong>
              </div>
              <div className="qr-resumen-card">
                <span>📱 Plin</span>
                <strong>S/ {historial.porMedio.plin.toFixed(2)}</strong>
              </div>
              <div className="qr-resumen-card">
                <span>Cantidad de pagos</span>
                <strong>{historial.pagos.length}</strong>
              </div>
            </div>

            <table className="data-table">
              <thead>
                <tr><th>Hora</th><th>Medio</th><th>Monto</th><th>Registrado por</th><th>Comprobante</th><th></th></tr>
              </thead>
              <tbody>
                {historial.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{DEFAULTS[p.medio]?.icono} {DEFAULTS[p.medio]?.nombre || p.medio}</td>
                    <td>S/ {p.monto.toFixed(2)}</td>
                    <td>{p.usuario_nombre || '—'}</td>
                    <td>
                      <a href={p.foto_data_url} target="_blank" rel="noreferrer" className="btn-link">Ver foto</a>
                    </td>
                    <td className="row-actions">
                      <button className="btn-link danger" onClick={() => eliminarPago(p.id)} title="Eliminar">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {historial.pagos.length === 0 && (
                  <tr><td colSpan={6} className="empty-row">No hay pagos registrados en esta fecha.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showRegistro && (
        <div className="modal-overlay" onClick={() => setShowRegistro(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar pago recibido</h2>
            <form onSubmit={handleGuardarPago}>
              <label>Foto del comprobante *</label>
              {fotoPago ? (
                <div style={{ marginBottom: 10 }}>
                  <img src={fotoPago} alt="Comprobante" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, border: '1px solid var(--border)' }} />
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                  Toma una foto de la pantalla de tu celular (o del celular del cliente) con el comprobante de pago,
                  o sube una que ya tengas guardada.
                </p>
              )}
              <label className="btn-secondary" style={{ width: 'auto', textAlign: 'center', cursor: 'pointer', display: 'inline-block' }}>
                {fotoPago ? 'Cambiar foto' : 'Tomar / subir foto'}
                <input type="file" accept="image/*" capture="environment" onChange={handleFotoPago} style={{ display: 'none' }} />
              </label>
              {analizando && <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Analizando comprobante…</p>}

              {fotoPago && !analizando && (
                <>
                  <label style={{ marginTop: 16 }}>Medio *</label>
                  <select value={medioPago} onChange={(e) => setMedioPago(e.target.value)}>
                    <option value="yape">📲 Yape</option>
                    <option value="plin">📱 Plin</option>
                  </select>

                  <label>Monto *</label>
                  <input required type="number" min="0.01" step="0.01" value={montoPago} onChange={(e) => setMontoPago(e.target.value)} />
                  {montoDetectado != null ? (
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -6 }}>
                      Detectamos S/ {montoDetectado.toFixed(2)} en la foto — corrígelo si no es correcto.
                    </p>
                  ) : (
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -6 }}>
                      No pudimos leer el monto de la foto — ingrésalo tú.
                    </p>
                  )}
                </>
              )}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowRegistro(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={!fotoPago || analizando || guardandoPago}>
                  {guardandoPago ? 'Guardando...' : 'Guardar pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
