import { useRef, useState } from 'react';
import { X, Send } from 'lucide-react';
import OdinAvatar from './OdinAvatar';
import api from '../api';
import { useToast } from '../context/ToastContext';

// Widget flotante del asistente ODIN, esquina inferior derecha del CRM.
// Por ahora no responde con IA (eso queda "más adelante"): cada mensaje
// que se envía llega directo al panel-central del dueño de la plataforma
// (ver backend/routes/mensajesSoporte.js).
export default function OdinWidget() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviados, setEnviados] = useState([]);
  const logRef = useRef(null);

  async function enviar(e) {
    e.preventDefault();
    const mensaje = texto.trim();
    if (!mensaje || enviando) return;
    setEnviando(true);
    try {
      await api.post('/mensajes-soporte', { mensaje });
      setEnviados((prev) => [...prev, mensaje]);
      setTexto('');
      setTimeout(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      }, 50);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo enviar el mensaje. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="odin-widget">
      {open && (
        <div className="odin-panel">
          <div className="odin-panel-header">
            <OdinAvatar size={34} />
            <div>
              <div className="odin-panel-title">ODIN</div>
              <div className="odin-panel-subtitle">Asistente del CRM</div>
            </div>
            <button type="button" className="odin-close-btn" onClick={() => setOpen(false)} title="Cerrar">
              <X size={16} />
            </button>
          </div>

          <div className="odin-msg-log" ref={logRef}>
            <div className="odin-msg odin-msg-bot">
              Hola, soy ODIN. ¿En qué puedo ayudarte? Escríbeme y tu mensaje llega directo a soporte.
            </div>
            {enviados.map((m, i) => (
              <div key={i} className="odin-msg odin-msg-user">{m}</div>
            ))}
            {enviados.length > 0 && (
              <div className="odin-msg odin-msg-bot">
                Recibido. Tu mensaje ya está en el panel de soporte, pronto te responderán.
              </div>
            )}
          </div>

          <form className="odin-input-row" onSubmit={enviar}>
            <textarea
              rows={1}
              placeholder="Escribe tu mensaje..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  enviar(e);
                }
              }}
            />
            <button type="submit" className="odin-send-btn" disabled={enviando || !texto.trim()} title="Enviar">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="odin-fab"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Cerrar ODIN' : 'Hola, soy ODIN'}
      >
        <OdinAvatar size={40} />
      </button>
    </div>
  );
}
