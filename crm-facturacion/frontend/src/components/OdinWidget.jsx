import { useRef, useState } from 'react';
import { X, Send } from 'lucide-react';
import OdinAvatar from './OdinAvatar';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { buscarRespuestaFaq, detectarConsultaStock } from '../odinFaq';

const SALUDO = 'Hola, soy ODIN. ¿En qué puedo ayudarte? Puedo responder preguntas frecuentes, decirte el stock de un producto, o mandar tu mensaje a soporte.';

// Construye los mensajes de "resumen del día" a partir de /api/odin/resumen
// (comprobantes con problema, boletas pendientes hace más de un día, stock
// bajo) — solo se arma si hay algo que valga la pena avisar, para no llenar
// el chat de mensajes vacíos cuando todo está en orden.
function armarResumen(data) {
  const avisos = [];
  if (data.totalComprobantesProblema > 0) {
    const detalle = data.comprobantesProblema
      .map((c) => `${c.serie}-${c.numero} (${c.sunat_estado})`)
      .join(', ');
    avisos.push(
      `Tienes ${data.totalComprobantesProblema} comprobante(s) rechazado(s) o con error sin resolver: ${detalle}. Revísalos con Gerencia.`
    );
  }
  if (data.pendientesViejas > 0) {
    avisos.push(
      `${data.pendientesViejas} boleta(s) llevan más de un día en estado "Pendiente" — ya deberían haberse confirmado, vale la pena revisarlas.`
    );
  }
  if (data.totalStockBajo > 0) {
    const detalle = data.stockBajo.map((p) => `${p.nombre} (${p.stock})`).join(', ');
    avisos.push(`Stock bajo en tu sede: ${detalle}.`);
  }
  return avisos;
}

// Widget flotante del asistente ODIN, esquina inferior derecha del CRM.
// No usa ningún modelo de IA (eso queda "más adelante" y tendría costo por
// mensaje) — responde con reglas fijas y datos reales del CRM:
//   1. Resumen del día al abrir (comprobantes con problema, stock bajo).
//   2. Consulta de stock en vivo ("stock de <producto>").
//   3. Respuestas automáticas a preguntas frecuentes (ver odinFaq.js).
//   4. Si nada de eso aplica, el mensaje llega a soporte como antes
//      (ver backend/routes/mensajesSoporte.js).
export default function OdinWidget() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensajes, setMensajes] = useState([{ rol: 'bot', texto: SALUDO }]);
  const [resumenCargado, setResumenCargado] = useState(false);
  const logRef = useRef(null);

  function agregarMensaje(rol, texto) {
    setMensajes((prev) => [...prev, { rol, texto }]);
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 50);
  }

  async function abrir() {
    const yaAbierto = open;
    setOpen(!yaAbierto);
    if (yaAbierto || resumenCargado) return;
    setResumenCargado(true);
    try {
      const res = await api.get('/odin/resumen');
      armarResumen(res.data).forEach((aviso) => agregarMensaje('bot', aviso));
    } catch {
      // Silencioso: el resumen es un plus, no debe romper el saludo normal.
    }
  }

  async function responderConsultaStock(nombreProducto) {
    try {
      const res = await api.get('/odin/stock', { params: { q: nombreProducto } });
      if (!res.data.length) {
        agregarMensaje('bot', `No encontré ningún producto que coincida con "${nombreProducto}" en tu sede.`);
        return;
      }
      const detalle = res.data.map((p) => `${p.nombre}: ${p.stock} unidades`).join('\n');
      agregarMensaje('bot', `Stock en tu sede:\n${detalle}`);
    } catch {
      agregarMensaje('bot', 'No pude consultar el stock justo ahora, intenta de nuevo en un momento.');
    }
  }

  async function enviar(e) {
    e.preventDefault();
    const mensaje = texto.trim();
    if (!mensaje || enviando) return;
    agregarMensaje('user', mensaje);
    setTexto('');

    const productoConsultado = detectarConsultaStock(mensaje);
    if (productoConsultado) {
      await responderConsultaStock(productoConsultado);
      return;
    }

    const respuestaFaq = buscarRespuestaFaq(mensaje);
    if (respuestaFaq) {
      agregarMensaje('bot', respuestaFaq);
      return;
    }

    setEnviando(true);
    try {
      await api.post('/mensajes-soporte', { mensaje });
      agregarMensaje('bot', 'Recibido. Tu mensaje ya está en el panel de soporte, pronto te responderán.');
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
            {mensajes.map((m, i) => (
              <div key={i} className={m.rol === 'user' ? 'odin-msg odin-msg-user' : 'odin-msg odin-msg-bot'}>
                {m.texto}
              </div>
            ))}
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
        onClick={abrir}
        title={open ? 'Cerrar ODIN' : 'Hola, soy ODIN'}
      >
        <OdinAvatar size={40} />
      </button>
    </div>
  );
}
