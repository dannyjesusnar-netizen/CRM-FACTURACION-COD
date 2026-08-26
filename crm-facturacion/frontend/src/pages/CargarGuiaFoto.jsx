import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Trash2, Plus } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

// A diferencia de una foto de etiqueta (Cargar Stock por Fotos), acá suele
// llegar una CAPTURA DE PANTALLA de la guía completa (p.ej. el PDF de una
// Guía de Remisión Electrónica abierto en el celular), con la tabla de
// ítems en letra chica. Se probó agrandar la imagen antes del OCR y dio
// PEOR resultado (solo agranda el borroneo de la interpolación) — y
// también se probó subirle contraste acá, pero ahora el backend ubica la
// tabla, la recorta a su resolución real y le aplica su PROPIO contraste
// específico para esa franja (ver utils/ocrGuia.js) — hacerlo acá también
// termina sobre-procesando la imagen dos veces y empeora la lectura. Por
// eso esta función ya solo REDUCE si la foto es más grande de lo
// necesario (nunca la agranda) y no le toca nada más.
function prepararImagenParaOcr(file, anchoMaximo = 2400, calidad = 0.92) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, anchoMaximo / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function nuevaFilaId() {
  return `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

export default function CargarGuiaFoto() {
  const navigate = useNavigate();
  const toast = useToast();
  const [products, setProducts] = useState([]);

  const [fotoGuia, setFotoGuia] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [filas, setFilas] = useState([]);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [textoDetectado, setTextoDetectado] = useState('');
  const [mostrarTexto, setMostrarTexto] = useState(false);

  useEffect(() => { api.get('/products').then((res) => setProducts(res.data)); }, []);

  const productosDisponibles = products.filter((p) => p.tipo === 'producto');

  async function handleFotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const comprimida = await prepararImagenParaOcr(file);
      setFotoGuia(comprimida);
      setAnalizando(true);
      setFilas([]);
      setTextoDetectado('');
      const res = await api.post('/movements/analizar-guia', { foto_data_url: comprimida });
      const detectadas = (res.data.filas || []).map((f) => ({
        id: nuevaFilaId(),
        descripcion_detectada: f.descripcion_detectada,
        cantidad: f.cantidad_detectada,
        product_id: f.product_id ? String(f.product_id) : '',
      }));
      setFilas(detectadas);
      setTextoDetectado(res.data.texto || '');
      if (detectadas.length === 0) {
        setMostrarTexto(true);
        toast.info('No se pudo separar ninguna línea de producto en la foto — revisa el texto leído abajo y agrega las filas a mano.');
      } else {
        toast.success(`Se detectaron ${detectadas.length} línea(s). Revisa el producto y la cantidad de cada una antes de cargar.`);
      }
    } catch (err) {
      toast.error('No se pudo analizar la foto de la guía. Agrega las filas a mano.');
    } finally {
      setAnalizando(false);
    }
  }

  function agregarFilaManual() {
    setFilas((prev) => [...prev, { id: nuevaFilaId(), descripcion_detectada: '', cantidad: '', product_id: '' }]);
  }

  function eliminarFila(id) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  function actualizarFila(id, campo, valor) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  async function handleConfirmar() {
    if (filas.length === 0) { toast.error('Agrega al menos una fila antes de cargar.'); return; }
    const filasInvalidas = filas.filter((f) => !f.product_id || !(Number(f.cantidad) > 0));
    if (filasInvalidas.length > 0) {
      toast.error('Selecciona un producto y una cantidad válida en todas las filas antes de cargar.');
      return;
    }
    setGuardando(true);
    try {
      const rows = filas.map((f) => {
        const producto = products.find((p) => String(p.id) === String(f.product_id));
        return { codigo: producto?.codigo, cantidad: Number(f.cantidad), motivo: motivo.trim() || 'Guía de remisión (foto)' };
      });
      const res = await api.post('/movements/importar-lotes', { rows });
      if (res.data.aplicados?.length > 0) toast.success(`${res.data.aplicados.length} producto(s) cargados al inventario.`);
      if (res.data.errores?.length > 0) toast.error(`${res.data.errores.length} fila(s) con errores: ${res.data.errores.map((e) => e.error).join(' | ')}`);
      if (!res.data.errores || res.data.errores.length === 0) {
        setFilas([]);
        setFotoGuia('');
        setMotivo('');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cargar el inventario.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Movimientos" onClick={() => navigate('/movimientos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CARGAR GUÍA POR FOTO
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Toma una sola foto de la guía de remisión completa del proveedor — el sistema intenta separar sus líneas de
        producto y sugerir a qué producto de tu catálogo corresponde cada una. Es una lectura automática y puede
        equivocarse o saltarse líneas: revisa el producto y la cantidad de cada fila (y agrega las que falten) antes
        de cargarlas al inventario. La tabla de productos suele venir con letra chica — si el sistema no detecta
        nada, prueba tomando la foto solo de esa tabla (haciendo zoom antes de capturar), en vez de la página
        completa.
      </p>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Foto de la guía</h3>
        {fotoGuia && (
          <div style={{ margin: '6px 0' }}>
            <img src={fotoGuia} alt="Guía" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, border: '1px solid var(--border)' }} />
          </div>
        )}
        <label className="btn-primary qr-foto-btn" style={{ marginTop: 4 }}>
          <Camera size={20} /> {fotoGuia ? 'Cambiar foto' : 'Tomar / subir foto de la guía'}
          <input type="file" accept="image/*" capture="environment" onChange={handleFotoChange} style={{ display: 'none' }} />
        </label>
        {analizando && <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Analizando la guía… esto puede tardar unos segundos.</p>}

        <label style={{ marginTop: 10 }}>Motivo / proveedor (opcional, se aplica a todas las filas)</label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Guía Distribuidora XYZ N.º 000456" />

        {textoDetectado && (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn-link" onClick={() => setMostrarTexto((v) => !v)}>
              {mostrarTexto ? 'Ocultar' : 'Ver'} texto que leyó el sistema en la foto
            </button>
            {mostrarTexto && (
              <pre style={{
                marginTop: 8, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, fontSize: 11, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap',
              }}>{textoDetectado}</pre>
            )}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>Líneas por cargar ({filas.length})</h3>
          <button type="button" className="btn-secondary" style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={agregarFilaManual}>
            <Plus size={16} /> Agregar fila manual
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Texto leído</th><th>Producto</th><th>Cantidad</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td style={{ maxWidth: 220, color: 'var(--ink-muted)', fontSize: 12 }}>{f.descripcion_detectada || '(fila manual)'}</td>
                  <td>
                    <select value={f.product_id} onChange={(e) => actualizarFila(f.id, 'product_id', e.target.value)} style={{ minWidth: 220 }}>
                      <option value="">Selecciona un producto...</option>
                      {productosDisponibles.map((p) => (
                        <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="number" step="1" min="1" value={f.cantidad} onChange={(e) => actualizarFila(f.id, 'cantidad', e.target.value)} style={{ width: 90 }} />
                  </td>
                  <td className="row-actions">
                    <button className="btn-link danger" onClick={() => eliminarFila(f.id)} title="Quitar de la lista">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={4} className="empty-row">Todavía no hay filas — toma la foto de la guía o agrega una fila manual.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
          <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={guardando || filas.length === 0} onClick={handleConfirmar}>
            {guardando ? 'Cargando...' : 'Cargar todo al inventario'}
          </button>
        </div>
      </div>
    </div>
  );
}
