import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';

const TIPO_LABEL = {
  venta: 'Venta', anulacion: 'Anulación', ajuste: 'Ajuste manual',
  ingreso_lote: 'Ingreso de lote', produccion_consumo: 'Consumo (Producción)', produccion_ingreso: 'Ingreso (Producción)',
};
const TIPO_BADGE = {
  venta: 'badge-critical', anulacion: 'badge-good', ajuste: 'badge-neutral',
  ingreso_lote: 'badge-good', produccion_consumo: 'badge-critical', produccion_ingreso: 'badge-good',
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const rows = [];
  let start = 0;
  // saltar encabezado si la primera fila no parece numérica en la 2da columna
  const firstCols = lines[0].split(',');
  if (firstCols.length >= 2 && Number.isNaN(Number(firstCols[1]))) start = 1;
  for (let i = start; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length >= 2 && cols[0]) rows.push({ codigo: cols[0], stock_real: cols[1] });
  }
  return rows;
}

export default function Movements() {
  const toast = useToast();
  const navigate = useNavigate();
  const [movements, setMovements] = useState([]);
  const [products, setProducts] = useState([]);
  const [productoFiltro, setProductoFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [productId, setProductId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  const [showConteo, setShowConteo] = useState(false);
  const [conteoProductId, setConteoProductId] = useState('');
  const [conteoCantidad, setConteoCantidad] = useState('');
  const [conteoMotivo, setConteoMotivo] = useState('');
  const [errorConteo, setErrorConteo] = useState('');

  const [showImportar, setShowImportar] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importFileName, setImportFileName] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [errorImportar, setErrorImportar] = useState('');

  function load() {
    const params = {};
    if (productoFiltro) params.product_id = productoFiltro;
    if (tipoFiltro) params.tipo = tipoFiltro;
    api.get('/movements', { params }).then((res) => setMovements(res.data));
  }

  useEffect(() => { load(); }, [productoFiltro, tipoFiltro]);
  useEffect(() => { api.get('/products').then((res) => setProducts(res.data)); }, []);

  function openForm() {
    setProductId('');
    setCantidad('');
    setMotivo('');
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!productId || !cantidad) {
      setError('Selecciona un producto e ingresa una cantidad.');
      return;
    }
    try {
      await api.post('/movements', { product_id: Number(productId), cantidad: Number(cantidad), motivo });
      toast.success('Ajuste de stock registrado.');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el ajuste.');
    }
  }

  function openConteo() {
    setConteoProductId('');
    setConteoCantidad('');
    setConteoMotivo('');
    setErrorConteo('');
    setShowConteo(true);
  }

  async function handleConteoSubmit(e) {
    e.preventDefault();
    setErrorConteo('');
    if (!conteoProductId || conteoCantidad === '') {
      setErrorConteo('Selecciona un producto e ingresa la cantidad contada.');
      return;
    }
    try {
      const res = await api.post('/movements/conteo', {
        product_id: Number(conteoProductId), cantidad_contada: Number(conteoCantidad), motivo: conteoMotivo,
      });
      if (res.data.diferencia === 0) {
        toast.info('El conteo coincide con el stock del sistema. No se registró ningún ajuste.');
      } else {
        toast.success(`Inventario físico registrado. Diferencia: ${res.data.diferencia > 0 ? '+' : ''}${res.data.diferencia}.`);
      }
      setShowConteo(false);
      load();
    } catch (err) {
      setErrorConteo(err.response?.data?.error || 'No se pudo registrar el conteo.');
    }
  }

  function openImportar() {
    setImportRows([]);
    setImportFileName('');
    setImportResult(null);
    setErrorImportar('');
    setShowImportar(true);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportResult(null);
    setErrorImportar('');
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result || ''));
      setImportRows(rows);
      if (rows.length === 0) setErrorImportar('No se encontraron filas válidas en el archivo (formato esperado: codigo,stock_real).');
    };
    reader.readAsText(file);
  }

  async function handleImportarSubmit(e) {
    e.preventDefault();
    setErrorImportar('');
    if (importRows.length === 0) { setErrorImportar('Selecciona un archivo CSV con filas código,stock_real.'); return; }
    try {
      const res = await api.post('/movements/importar', { rows: importRows });
      setImportResult(res.data);
      if (res.data.aplicados.length > 0) toast.success(`${res.data.aplicados.length} producto(s) actualizados.`);
      if (res.data.errores.length > 0) toast.error(`${res.data.errores.length} fila(s) con errores. Revisa el detalle.`);
      load();
    } catch (err) {
      setErrorImportar(err.response?.data?.error || 'No se pudo importar el archivo.');
    }
  }

  const productoConteo = products.find((p) => String(p.id) === String(conteoProductId));

  return (
    <div>
      <h1 className="page-title">Movimientos de inventario</h1>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={() => navigate('/productos')}>Productos</button>
        <button className="ventas-action-btn">Movimientos</button>
        <button className="ventas-action-btn" onClick={() => navigate('/lotes')}>Lotes y Series</button>
        <button className="ventas-action-btn" onClick={() => navigate('/productos')}>Lista de Precios</button>
        <button className="ventas-action-btn" onClick={() => navigate('/traslados')}>Traslados</button>
        <button className="ventas-action-btn" onClick={() => navigate('/produccion')}>Producción</button>
        <button className="ventas-action-btn disabled" title="Próximamente" onClick={() => toast.info('Precio por márgenes estará disponible próximamente.')}>Precio por Márgenes</button>
      </div>

      <div className="ventas-actions" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <button className="ventas-action-btn" onClick={openForm}>Registrar Movimiento</button>
        <button className="ventas-action-btn" onClick={openConteo}>Inventario Físico</button>
        <button className="ventas-action-btn" onClick={openImportar}>Importar Stock Real</button>
      </div>

      <form className="filter-panel" onSubmit={(e) => e.preventDefault()}>
        <div className="filter-field grow">
          <label>Producto</label>
          <select value={productoFiltro} onChange={(e) => setProductoFiltro(e.target.value)}>
            <option value="">Todos los productos</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Tipo</label>
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
            <option value="">Todos</option>
            <option value="venta">Venta</option>
            <option value="anulacion">Anulación</option>
            <option value="ajuste">Ajuste manual</option>
            <option value="ingreso_lote">Ingreso de lote</option>
            <option value="produccion_consumo">Consumo (Producción)</option>
            <option value="produccion_ingreso">Ingreso (Producción)</option>
          </select>
        </div>
      </form>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Fecha</th><th>Producto</th><th>Tipo</th>
              <th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Stock resultante</th>
              <th>Motivo</th><th>Referencia</th><th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{m.created_at}</td>
                <td>{m.producto_codigo} — {m.producto_nombre}</td>
                <td><span className={'badge ' + (TIPO_BADGE[m.tipo] || 'badge-neutral')}>{TIPO_LABEL[m.tipo] || m.tipo}</span></td>
                <td style={{ textAlign: 'right' }}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                <td style={{ textAlign: 'right' }}>{m.stock_resultante ?? '—'}</td>
                <td>{m.motivo || '—'}</td>
                <td>{m.referencia || '—'}</td>
                <td>{m.usuario_nombre || '—'}</td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr><td colSpan={8} className="empty-row">No hay movimientos registrados todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar movimiento (ajuste manual)</h2>
            <form onSubmit={handleSubmit}>
              <label>Producto</label>
              <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Selecciona un producto...</option>
                {products.filter((p) => p.tipo === 'producto').map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre} (stock actual: {p.stock})</option>
                ))}
              </select>
              <label>Cantidad (positivo = ingreso, negativo = salida)</label>
              <input required type="number" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 10 ó -5" />
              <label>Motivo</label>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Conteo físico, mercadería dañada..." />
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Registrar ajuste</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConteo && (
        <div className="modal-overlay" onClick={() => setShowConteo(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Inventario físico</h2>
            <form onSubmit={handleConteoSubmit}>
              <label>Producto</label>
              <select required value={conteoProductId} onChange={(e) => setConteoProductId(e.target.value)}>
                <option value="">Selecciona un producto...</option>
                {products.filter((p) => p.tipo === 'producto').map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre} (stock sistema: {p.stock})</option>
                ))}
              </select>
              {productoConteo && (
                <p className="caja-row-auto">Stock actual en el sistema: {productoConteo.stock} {productoConteo.unidad}</p>
              )}
              <label>Cantidad contada físicamente</label>
              <input required type="number" step="0.01" value={conteoCantidad} onChange={(e) => setConteoCantidad(e.target.value)} />
              <label>Motivo / observación</label>
              <input value={conteoMotivo} onChange={(e) => setConteoMotivo(e.target.value)} placeholder="Ej: Conteo mensual de agosto" />
              {errorConteo && <div className="form-error">{errorConteo}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowConteo(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Registrar conteo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportar && (
        <div className="modal-overlay" onClick={() => setShowImportar(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Importar stock real</h2>
            <form onSubmit={handleImportarSubmit}>
              <label>Archivo CSV (columnas: código, stock real)</label>
              <input required type="file" accept=".csv,text/csv" onChange={handleFileChange} />
              {importFileName && (
                <p className="caja-row-auto">{importFileName} — {importRows.length} fila(s) detectadas.</p>
              )}
              {importResult && (
                <div style={{ marginTop: 10 }}>
                  <p><strong>{importResult.aplicados.length}</strong> actualizados, <strong>{importResult.errores.length}</strong> con error.</p>
                  {importResult.errores.length > 0 && (
                    <ul style={{ fontSize: 12, color: 'var(--critical)', maxHeight: 120, overflowY: 'auto' }}>
                      {importResult.errores.map((e, i) => <li key={i}>{e.codigo}: {e.error}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {errorImportar && <div className="form-error">{errorImportar}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowImportar(false)}>Cerrar</button>
                <button type="submit" className="btn-primary">Importar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
