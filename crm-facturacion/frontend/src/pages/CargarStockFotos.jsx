import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Trash2, Download } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

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

function nuevaFilaId() {
  return `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

export default function CargarStockFotos() {
  const navigate = useNavigate();
  const toast = useToast();
  const [products, setProducts] = useState([]);

  const [productId, setProductId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fotoEtiqueta, setFotoEtiqueta] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [codigoLote, setCodigoLote] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');

  const [filas, setFilas] = useState([]);

  useEffect(() => { api.get('/products').then((res) => setProducts(res.data)); }, []);

  function limpiarFormulario() {
    setProductId('');
    setCantidad('');
    setMotivo('');
    setFotoEtiqueta('');
    setCodigoLote('');
    setFechaVencimiento('');
  }

  async function handleFotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const comprimida = await comprimirImagen(file);
      setFotoEtiqueta(comprimida);
      setAnalizando(true);
      const res = await api.post('/movements/analizar-etiqueta', { foto_data_url: comprimida });
      setCodigoLote(res.data.codigo_lote_detectado || '');
      setFechaVencimiento(res.data.fecha_vencimiento_detectada || '');
      if (!res.data.codigo_lote_detectado && !res.data.fecha_vencimiento_detectada) {
        toast.info('No pudimos leer el lote ni el vencimiento en la foto — complétalos tú si corresponde.');
      }
    } catch (err) {
      toast.error('No se pudo analizar la foto. Completa el lote y vencimiento manualmente.');
    } finally {
      setAnalizando(false);
    }
  }

  function agregarFila() {
    if (!productId) { toast.error('Selecciona un producto.'); return; }
    if (!(Number(cantidad) > 0)) { toast.error('Ingresa una cantidad válida.'); return; }
    const producto = products.find((p) => String(p.id) === String(productId));
    setFilas((prev) => [...prev, {
      id: nuevaFilaId(),
      codigo: producto?.codigo || '',
      producto_nombre: producto?.nombre || '',
      cantidad: Number(cantidad),
      codigo_lote: codigoLote.trim(),
      fecha_vencimiento: fechaVencimiento,
      motivo: motivo.trim(),
      foto_data_url: fotoEtiqueta,
    }]);
    toast.success('Fila agregada. Puedes tomar la siguiente foto.');
    limpiarFormulario();
  }

  function eliminarFila(id) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  function actualizarFila(id, campo, valor) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  function descargarCsv() {
    if (filas.length === 0) { toast.error('Agrega al menos una fila antes de descargar.'); return; }
    const header = ['codigo', 'cantidad', 'codigo_lote', 'fecha_vencimiento', 'motivo'];
    const rows = filas.map((f) => [f.codigo, f.cantidad, f.codigo_lote, f.fecha_vencimiento, f.motivo]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carga_stock_fotos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('CSV descargado. Súbelo en "Cargar Stock + Lotes (CSV)".');
  }

  const productosDisponibles = products.filter((p) => p.tipo === 'producto');

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Movimientos" onClick={() => navigate('/movimientos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CARGAR STOCK POR FOTOS
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Elige el producto, ingresa la cantidad y toma una foto de la etiqueta — el sistema intentará leer el N.º de
        lote y la fecha de vencimiento automáticamente. Revisa y corrige lo que haga falta, agrega la fila y repite
        con el siguiente producto. Al final descarga el CSV y súbelo en "Cargar Stock + Lotes (CSV)".
      </p>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Agregar producto</h3>
        <label>Producto</label>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Selecciona un producto...</option>
          {productosDisponibles.map((p) => (
            <option key={p.id} value={p.id}>{p.codigo} — {p.nombre} (stock actual: {p.stock})</option>
          ))}
        </select>

        <label style={{ marginTop: 10 }}>Cantidad</label>
        <input type="number" step="1" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 20" />

        <label style={{ marginTop: 10 }}>Foto de la etiqueta (opcional, para leer lote/vencimiento)</label>
        {fotoEtiqueta && (
          <div style={{ margin: '6px 0' }}>
            <img src={fotoEtiqueta} alt="Etiqueta" style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, border: '1px solid var(--border)' }} />
          </div>
        )}
        <label className="btn-primary qr-foto-btn" style={{ marginTop: 4 }}>
          <Camera size={20} /> {fotoEtiqueta ? 'Cambiar foto' : 'Tomar / subir foto'}
          <input type="file" accept="image/*" capture="environment" onChange={handleFotoChange} style={{ display: 'none' }} />
        </label>
        {analizando && <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Analizando etiqueta…</p>}

        <label style={{ marginTop: 10 }}>N.º de lote (opcional)</label>
        <input value={codigoLote} onChange={(e) => setCodigoLote(e.target.value)} placeholder="Ej: L-2026-08" />

        <label style={{ marginTop: 10 }}>Fecha de vencimiento (opcional)</label>
        <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} />

        <label style={{ marginTop: 10 }}>Motivo (opcional)</label>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Compra a proveedor XYZ" />

        <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
          <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={agregarFila} disabled={analizando}>
            Agregar a la lista
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="report-toolbar">
          <h3 style={{ margin: 0 }}>Filas por cargar ({filas.length})</h3>
          <button type="button" className="btn-primary" style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={descargarCsv} disabled={filas.length === 0}>
            <Download size={16} /> Descargar CSV
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Foto</th><th>Producto</th><th>Cantidad</th><th>N.º de lote</th><th>Vencimiento</th><th>Motivo</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.foto_data_url ? (
                      <img src={f.foto_data_url} alt="Etiqueta" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
                    ) : '—'}
                  </td>
                  <td>{f.codigo} — {f.producto_nombre}</td>
                  <td style={{ textAlign: 'right' }}>{f.cantidad}</td>
                  <td>
                    <input value={f.codigo_lote} onChange={(e) => actualizarFila(f.id, 'codigo_lote', e.target.value)} style={{ minWidth: 110 }} />
                  </td>
                  <td>
                    <input type="date" value={f.fecha_vencimiento} onChange={(e) => actualizarFila(f.id, 'fecha_vencimiento', e.target.value)} />
                  </td>
                  <td>
                    <input value={f.motivo} onChange={(e) => actualizarFila(f.id, 'motivo', e.target.value)} style={{ minWidth: 140 }} />
                  </td>
                  <td className="row-actions">
                    <button className="btn-link danger" onClick={() => eliminarFila(f.id)} title="Quitar de la lista">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={7} className="empty-row">Todavía no agregaste ninguna fila.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
