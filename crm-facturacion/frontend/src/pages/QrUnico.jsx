import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Camera, QrCode, Trash2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const DEFAULTS = {
  yape: { nombre: 'Yape', icono: '📲' },
  plin: { nombre: 'Plin', icono: '📱' },
};

function emptyMedios() {
  return { yape: { medio: 'yape' }, plin: { medio: 'plin' } };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Redimensiona/comprime la foto en el navegador antes de subirla — una foto
// de cámara sin comprimir puede pesar varios MB.
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

export default function QrUnico() {
  const navigate = useNavigate();
  const toast = useToast();
  const { empresa } = useAuth();
  const [medios, setMedios] = useState(emptyMedios());
  const [form, setForm] = useState({
    yape: { titular_nombre: '', titular_telefono: '' },
    plin: { titular_nombre: '', titular_telefono: '' },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({ yape: false, plin: false });

  // --- QR Único generado ---
  const [qrUnico, setQrUnico] = useState(null); // { url, qr_data_url }
  const [generando, setGenerando] = useState(false);

  // --- Registrar pago ---
  const [showRegistro, setShowRegistro] = useState(false);
  const [fotoPago, setFotoPago] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [medioPago, setMedioPago] = useState('yape');
  const [montoPago, setMontoPago] = useState('');
  const [montoDetectado, setMontoDetectado] = useState(null);
  const [horaDetectada, setHoraDetectada] = useState(null);
  const [comentarioPago, setComentarioPago] = useState('');
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
    api.get('/qr-unico/medios').then((res) => {
      const porMedio = Object.fromEntries(res.data.map((m) => [m.medio, m]));
      setMedios({ ...emptyMedios(), ...porMedio });
      setForm({
        yape: { titular_nombre: porMedio.yape?.titular_nombre || '', titular_telefono: porMedio.yape?.titular_telefono || '' },
        plin: { titular_nombre: porMedio.plin?.titular_nombre || '', titular_telefono: porMedio.plin?.titular_telefono || '' },
      });
      setLoading(false);
    });
  }

  function loadHistorial(fecha) {
    api.get('/pagos-qr', { params: { fecha } }).then((res) => setHistorial(res.data));
  }

  async function handleQrChange(medio, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.3 * 1024 * 1024) {
      toast.error('La imagen es muy pesada. Usa una de menos de 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving((prev) => ({ ...prev, [medio]: true }));
      try {
        await api.put(`/qr-unico/medios/${medio}`, { qr_data_url: reader.result });
        toast.success(`QR de ${DEFAULTS[medio].nombre} guardado.`);
        load();
      } catch (err) {
        toast.error(err.response?.data?.error || 'No se pudo guardar el QR.');
      } finally {
        setSaving((prev) => ({ ...prev, [medio]: false }));
      }
    };
    reader.readAsDataURL(file);
  }

  async function quitarQr(medio) {
    if (!window.confirm(`¿Quitar el QR de ${DEFAULTS[medio].nombre}?`)) return;
    await api.put(`/qr-unico/medios/${medio}`, { qr_data_url: '' });
    toast.success('QR eliminado.');
    load();
  }

  async function guardarDatos(medio) {
    setSaving((prev) => ({ ...prev, [medio]: true }));
    try {
      await api.put(`/qr-unico/medios/${medio}`, {
        titular_nombre: form[medio].titular_nombre,
        titular_telefono: form[medio].titular_telefono,
      });
      toast.success(`Datos de ${DEFAULTS[medio].nombre} guardados.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudieron guardar los datos.');
    } finally {
      setSaving((prev) => ({ ...prev, [medio]: false }));
    }
  }

  async function generarQr() {
    setGenerando(true);
    try {
      const res = await api.get('/qr-unico/generar');
      setQrUnico(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo generar el QR.');
    } finally {
      setGenerando(false);
    }
  }

  function abrirRegistroPago() {
    setFotoPago('');
    setMedioPago('yape');
    setMontoPago('');
    setMontoDetectado(null);
    setHoraDetectada(null);
    setComentarioPago('');
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
      setHoraDetectada(res.data.hora_detectada);
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
        hora_detectada: horaDetectada,
        comentario: comentarioPago || null,
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

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver al menú" onClick={() => navigate('/menu')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        QR ÚNICO
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }} className="no-print">
        Registra el QR, nombre y teléfono de tu cuenta de Yape y de Plin. Con eso genera tu QR Único: un solo código
        para imprimir y pegar en tu tienda — al escanearlo, el cliente elige Yape o Plin y ve los datos para pagarte
        desde su propia app.
      </p>

      {!loading && (
        <>
          <div className="qr-estatico-grid no-print">
            {['yape', 'plin'].map((medio) => (
              <div key={medio} className="panel">
                <h3 style={{ marginTop: 0 }}>{DEFAULTS[medio].icono} {DEFAULTS[medio].nombre}</h3>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ width: 110, height: 110, border: '1px dashed var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface)' }}>
                    {medios[medio]?.qr_data_url ? (
                      <img src={medios[medio].qr_data_url} alt={`QR ${DEFAULTS[medio].nombre}`} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center' }}>Sin QR</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="btn-secondary" style={{ width: 'auto', textAlign: 'center', cursor: 'pointer' }}>
                      {saving[medio] ? 'Guardando...' : (medios[medio]?.qr_data_url ? 'Cambiar QR' : 'Subir QR')}
                      <input type="file" accept="image/png,image/jpeg" onChange={(e) => handleQrChange(medio, e)} style={{ display: 'none' }} disabled={saving[medio]} />
                    </label>
                    {medios[medio]?.qr_data_url && (
                      <button type="button" className="btn-secondary" onClick={() => quitarQr(medio)}>Quitar QR</button>
                    )}
                  </div>
                </div>

                <label style={{ marginTop: 14, display: 'block' }}>Nombre completo</label>
                <input
                  type="text"
                  value={form[medio].titular_nombre}
                  onChange={(e) => setForm((prev) => ({ ...prev, [medio]: { ...prev[medio], titular_nombre: e.target.value } }))}
                  placeholder="Nombre y apellido de quien recibe el pago"
                />

                <label style={{ marginTop: 10, display: 'block' }}>Teléfono</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="tel"
                    value={form[medio].titular_telefono}
                    onChange={(e) => setForm((prev) => ({ ...prev, [medio]: { ...prev[medio], titular_telefono: e.target.value.replace(/\D/g, '') } }))}
                    placeholder="987654321"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn-secondary" style={{ width: 'auto' }} disabled={saving[medio]} onClick={() => guardarDatos(medio)}>
                    {saving[medio] ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="report-toolbar no-print" style={{ justifyContent: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary qr-generar-btn" onClick={generarQr} disabled={generando}>
              <QrCode size={20} /> {generando ? 'Generando...' : 'GENERAR QR'}
            </button>
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
                <p className="qr-print-subtitulo">Escanea y elige cómo pagar</p>
                <div className="qr-print-codigos">
                  <div className="qr-print-item">
                    <img src={qrUnico.qr_data_url} alt="QR Único" />
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
                <tr><th>Hora</th><th>Medio</th><th>Monto</th><th>Registrado por</th><th>Comentario</th><th>Comprobante</th><th></th></tr>
              </thead>
              <tbody>
                {historial.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{DEFAULTS[p.medio]?.icono} {DEFAULTS[p.medio]?.nombre || p.medio}</td>
                    <td>S/ {p.monto.toFixed(2)}</td>
                    <td>{p.usuario_nombre || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)', maxWidth: 220 }}>{p.comentario || '—'}</td>
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
                  <tr><td colSpan={7} className="empty-row">No hay pagos registrados en esta fecha.</td></tr>
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
                  Toma una foto de la pantalla del celular del cliente con el comprobante de pago, o sube una que ya
                  tengas guardada.
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
                  {horaDetectada && (
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -6 }}>
                      Hora detectada en el comprobante: {horaDetectada}
                    </p>
                  )}

                  <label style={{ marginTop: 4 }}>Comentario (opcional)</label>
                  <input
                    type="text"
                    value={comentarioPago}
                    onChange={(e) => setComentarioPago(e.target.value)}
                    placeholder="Ej. nombre del cliente, número de mesa, etc."
                  />
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
