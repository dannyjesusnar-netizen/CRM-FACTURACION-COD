import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, FileText, Trash2, Plus } from 'lucide-react';
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
  const [creandoProductoFilaId, setCreandoProductoFilaId] = useState(null);
  const [formNuevoProducto, setFormNuevoProducto] = useState({ codigo: '', nombre: '', unidad: 'NIU', precio_unitario: '' });
  const [guardandoProducto, setGuardandoProducto] = useState(false);
  const [proveedorDetectado, setProveedorDetectado] = useState(null);

  useEffect(() => { api.get('/products').then((res) => setProducts(res.data)); }, []);

  const productosDisponibles = products.filter((p) => p.tipo === 'producto');

  function filasDesdeRespuesta(filasRes) {
    return (filasRes || []).map((f) => ({
      id: nuevaFilaId(),
      descripcion_detectada: f.descripcion_detectada,
      cantidad: f.cantidad_detectada,
      unidad: f.unidad_detectada || 'NIU',
      product_id: f.product_id ? String(f.product_id) : '',
      codigo_lote: '',
      fecha_vencimiento: '',
    }));
  }

  async function handleFotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const comprimida = await prepararImagenParaOcr(file);
      setFotoGuia(comprimida);
      setAnalizando(true);
      setFilas([]);
      setTextoDetectado('');
      setProveedorDetectado(null);
      const res = await api.post('/movements/analizar-guia', { foto_data_url: comprimida });
      const detectadas = filasDesdeRespuesta(res.data.filas);
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

  // A diferencia de la foto, acá se sube el ARCHIVO real de la guía (el XML
  // que emite SUNAT, o un PDF con texto embebido — no una foto/captura de
  // pantalla): se lee el texto directamente, sin OCR de por medio, así que
  // es mucho más confiable en documentos con tablas de letra chica.
  async function handleArchivoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAnalizando(true);
    setFilas([]);
    setTextoDetectado('');
    setFotoGuia('');
    setProveedorDetectado(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/movements/analizar-guia-archivo', formData);
      const detectadas = filasDesdeRespuesta(res.data.filas);
      setFilas(detectadas);
      if (res.data.razon_social || res.data.ruc) {
        setProveedorDetectado({ id: res.data.proveedor_id || null, razon_social: res.data.razon_social, ruc: res.data.ruc });
      }
      if (detectadas.length === 0) {
        toast.info('El archivo se leyó pero no se encontraron líneas de producto — agrega las filas a mano.');
      } else {
        toast.success(res.data.advertencia || `Se detectaron ${detectadas.length} línea(s) desde el archivo. Revisa el producto y la cantidad antes de cargar.`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo leer el archivo de la guía.');
    } finally {
      setAnalizando(false);
    }
  }

  function agregarFilaManual() {
    setFilas((prev) => [...prev, {
      id: nuevaFilaId(), descripcion_detectada: '', cantidad: '', product_id: '', codigo_lote: '', fecha_vencimiento: '',
    }]);
  }

  function eliminarFila(id) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  function actualizarFila(id, campo, valor) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  function filaLista(f) {
    return !!f.product_id && Number(f.cantidad) > 0;
  }

  // Carga solo las filas que ya tienen producto y cantidad válida — las que
  // falten (típicamente productos de la guía que todavía no existen en el
  // catálogo) se quedan en la tabla en vez de bloquear TODA la carga, para
  // que el resto de la guía no quede detenido por un par de productos nuevos.
  async function handleConfirmar() {
    const listas = filas.filter(filaLista);
    if (listas.length === 0) {
      toast.error('Selecciona el producto de al menos una fila (o créalo) antes de cargar.');
      return;
    }
    setGuardando(true);
    try {
      const rows = listas.map((f) => {
        const producto = products.find((p) => String(p.id) === String(f.product_id));
        return {
          codigo: producto?.codigo,
          cantidad: Number(f.cantidad),
          motivo: motivo.trim() || 'Guía de remisión',
          codigo_lote: f.codigo_lote?.trim() || undefined,
          fecha_vencimiento: f.codigo_lote?.trim() ? (f.fecha_vencimiento || undefined) : undefined,
          descripcion_detectada: f.descripcion_detectada || undefined,
        };
      });
      const res = await api.post('/movements/importar-lotes', { rows });
      const codigosAplicados = new Set((res.data.aplicados || []).map((a) => a.codigo));
      const idsAplicados = new Set(
        listas
          .filter((f) => {
            const producto = products.find((p) => String(p.id) === String(f.product_id));
            return producto && codigosAplicados.has(producto.codigo);
          })
          .map((f) => f.id)
      );
      if (res.data.aplicados?.length > 0) toast.success(`${res.data.aplicados.length} producto(s) cargados al inventario.`);
      if (res.data.errores?.length > 0) toast.error(`${res.data.errores.length} fila(s) con errores: ${res.data.errores.map((e) => e.error).join(' | ')}`);
      const restantes = filas.filter((f) => !idsAplicados.has(f.id));
      setFilas(restantes);
      if (restantes.length === 0) {
        setFotoGuia('');
        setMotivo('');
      } else if (idsAplicados.size > 0) {
        toast.info(`Quedan ${restantes.length} fila(s) por completar (falta el producto o la cantidad).`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cargar el inventario.');
    } finally {
      setGuardando(false);
    }
  }

  function abrirCrearProducto(fila) {
    setFormNuevoProducto({ codigo: '', nombre: fila.descripcion_detectada || '', unidad: fila.unidad || 'NIU', precio_unitario: '' });
    setCreandoProductoFilaId(fila.id);
  }

  // El stock NO se pide acá: al confirmar la carga, "Cargar al inventario"
  // toma la cantidad de la misma fila y se la asigna a este producto recién
  // creado, igual que a cualquier otro — no hace falta duplicar el dato.
  async function handleCrearProducto(e) {
    e.preventDefault();
    const { codigo, nombre, unidad, precio_unitario } = formNuevoProducto;
    if (!codigo.trim() || !nombre.trim() || !(Number(precio_unitario) > 0)) {
      toast.error('Código, nombre y un precio de venta mayor a 0 son requeridos.');
      return;
    }
    setGuardandoProducto(true);
    try {
      const res = await api.post('/products', {
        codigo: codigo.trim(), nombre: nombre.trim(), unidad, precio_unitario: Number(precio_unitario),
        proveedor_id: proveedorDetectado?.id || undefined,
      });
      setProducts((prev) => [...prev, res.data]);
      setFilas((prev) => prev.map((f) => (f.id === creandoProductoFilaId ? { ...f, product_id: String(res.data.id) } : f)));
      toast.success('Producto creado y seleccionado en la fila.');
      setCreandoProductoFilaId(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo crear el producto.');
    } finally {
      setGuardandoProducto(false);
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Movimientos" onClick={() => navigate('/movimientos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CARGAR GUÍA
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Si tienes el archivo real de la guía (el XML que emite SUNAT, o un PDF con texto — no una foto), súbelo: se
        lee el texto directamente y es mucho más confiable. Si solo tienes una foto o captura de pantalla, el sistema
        intenta leerla igual, pero es una lectura automática que puede equivocarse o saltarse líneas, sobre todo si la
        tabla de productos viene con letra chica. En ambos casos revisa el producto y la cantidad de cada fila (y
        agrega las que falten) antes de cargarlas al inventario.
      </p>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Archivo o foto de la guía</h3>
        {fotoGuia && (
          <div style={{ margin: '6px 0' }}>
            <img src={fotoGuia} alt="Guía" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, border: '1px solid var(--border)' }} />
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <label className="btn-primary qr-foto-btn" style={{ marginTop: 4, width: 'auto' }}>
            <FileText size={20} /> Subir XML o PDF de la guía
            <input type="file" accept=".xml,.pdf,application/pdf,text/xml,application/xml" onChange={handleArchivoChange} style={{ display: 'none' }} />
          </label>
          <label className="btn-secondary qr-foto-btn" style={{ marginTop: 4, width: 'auto' }}>
            <Camera size={20} /> {fotoGuia ? 'Cambiar foto' : 'Tomar / subir foto de la guía'}
            <input type="file" accept="image/*" capture="environment" onChange={handleFotoChange} style={{ display: 'none' }} />
          </label>
        </div>
        {analizando && <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Analizando la guía… esto puede tardar unos segundos.</p>}

        {proveedorDetectado && (
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 8 }}>
            Proveedor detectado en la guía: <strong>{proveedorDetectado.razon_social || proveedorDetectado.ruc}</strong>
            {proveedorDetectado.ruc ? ` (RUC ${proveedorDetectado.ruc})` : ''}
            {proveedorDetectado.id
              ? ' — ya está registrado; los productos que crees desde esta guía quedarán con este proveedor asignado.'
              : ' — no está registrado en Proveedores; los productos nuevos se crearán sin proveedor asignado.'}
          </p>
        )}

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
                <th>Texto leído</th><th>Producto</th><th>Cantidad</th><th>Lote (opcional)</th><th>Vencimiento</th><th></th>
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
                    {!f.product_id && (
                      <button type="button" className="btn-link" style={{ fontSize: 11, display: 'block', marginTop: 4 }} onClick={() => abrirCrearProducto(f)}>
                        + Crear producto nuevo
                      </button>
                    )}
                  </td>
                  <td>
                    <input type="number" step="1" min="1" value={f.cantidad} onChange={(e) => actualizarFila(f.id, 'cantidad', e.target.value)} style={{ width: 90 }} />
                  </td>
                  <td>
                    <input placeholder="Ej: LOTE-01" style={{ width: 100 }} value={f.codigo_lote}
                      onChange={(e) => actualizarFila(f.id, 'codigo_lote', e.target.value)} />
                  </td>
                  <td>
                    <input type="date" disabled={!f.codigo_lote} style={{ width: 135 }} value={f.fecha_vencimiento}
                      onChange={(e) => actualizarFila(f.id, 'fecha_vencimiento', e.target.value)} />
                  </td>
                  <td className="row-actions">
                    <button className="btn-link danger" onClick={() => eliminarFila(f.id)} title="Quitar de la lista">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={6} className="empty-row">Todavía no hay filas — toma la foto de la guía o agrega una fila manual.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
          <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={guardando || filas.filter(filaLista).length === 0} onClick={handleConfirmar}>
            {guardando ? 'Cargando...' : 'Cargar al inventario'}
          </button>
        </div>
      </div>

      {creandoProductoFilaId && (
        <div className="modal-overlay" onClick={() => setCreandoProductoFilaId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Crear producto</h2>
            <form onSubmit={handleCrearProducto}>
              <label>Código</label>
              <input required value={formNuevoProducto.codigo} onChange={(e) => setFormNuevoProducto((f) => ({ ...f, codigo: e.target.value }))} />
              <label style={{ marginTop: 10 }}>Nombre</label>
              <input required value={formNuevoProducto.nombre} onChange={(e) => setFormNuevoProducto((f) => ({ ...f, nombre: e.target.value }))} />
              <div className="form-row" style={{ marginTop: 10 }}>
                <div>
                  <label>Unidad medida</label>
                  <select value={formNuevoProducto.unidad} onChange={(e) => setFormNuevoProducto((f) => ({ ...f, unidad: e.target.value }))}>
                    {!['NIU', 'KGM', 'LTR', 'ZZ'].includes(formNuevoProducto.unidad) && (
                      <option value={formNuevoProducto.unidad}>{formNuevoProducto.unidad} (detectada en la guía)</option>
                    )}
                    <option value="NIU">UNIDAD</option>
                    <option value="KGM">KILOGRAMO</option>
                    <option value="LTR">LITRO</option>
                    <option value="ZZ">SERVICIO</option>
                  </select>
                </div>
                <div>
                  <label>Precio venta S/</label>
                  <input required type="number" step="0.01" min="0.01" value={formNuevoProducto.precio_unitario} onChange={(e) => setFormNuevoProducto((f) => ({ ...f, precio_unitario: e.target.value }))} />
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 8 }}>
                El stock se carga solo al confirmar "Cargar al inventario" — no hace falta indicarlo acá.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setCreandoProductoFilaId(null)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={guardandoProducto}>{guardandoProducto ? 'Creando...' : 'Crear y seleccionar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
