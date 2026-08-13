import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Movements() {
  const toast = useToast();
  const navigate = useNavigate();
  const [movements, setMovements] = useState([]);
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [mostrarPor, setMostrarPor] = useState('f_registro');

  const [showForm, setShowForm] = useState(false);
  const [productId, setProductId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [codigoLote, setCodigoLote] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
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
    if (q) params.q = q;
    if (tipoFiltro) params.tipo = tipoFiltro;
    if (desde) params.from = desde;
    if (hasta) params.to = hasta;
    api.get('/movements', { params }).then((res) => setMovements(res.data));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/products').then((res) => setProducts(res.data)); }, []);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  function handleExportar() {
    const header = ['Fecha', 'Documento', 'Producto', 'Tipo', 'Cliente/Proveedor', 'Observación', 'Cantidad', 'Stock resultante', 'Usuario'];
    const rows = movements.map((m) => [
      m.created_at, m.referencia || '', `${m.producto_codigo} - ${m.producto_nombre}`,
      TIPO_LABEL[m.tipo] || m.tipo, m.cliente_proveedor || '', m.motivo || '', m.cantidad, m.stock_resultante ?? '', m.usuario_nombre || '',
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movimientos_${desde}_a_${hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Archivo CSV exportado.');
  }

  function openForm() {
    setProductId('');
    setCantidad('');
    setMotivo('');
    setCodigoLote('');
    setFechaVencimiento('');
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
      await api.post('/movements', {
        product_id: Number(productId),
        cantidad: Number(cantidad),
        motivo,
        codigo_lote: esIngreso ? codigoLote : undefined,
        fecha_vencimiento: esIngreso ? (fechaVencimiento || undefined) : undefined,
      });
      toast.success(esIngreso && codigoLote ? 'Stock y lote registrados.' : 'Ajuste de stock registrado.');
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
  const esIngreso = Number(cantidad) > 0;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-link" title="Volver a Inventario" onClick={() => navigate('/productos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <ArrowLeft size={20} />
          </button>
          MOVIMIENTOS
        </h1>
      </div>

      <div className="actions-with-select-row">
        <div className="actions-buttons">
          <button className="ventas-action-btn" onClick={openForm}>Registrar Movimiento</button>
          <button className="ventas-action-btn" onClick={openConteo}>Inventario Físico</button>
          <button className="ventas-action-btn" onClick={openImportar}>Importar Stock Real</button>
        </div>
        <div className="filter-field">
          <label>Mostrar por</label>
          <select value={mostrarPor} onChange={(e) => setMostrarPor(e.target.value)}>
            <option value="f_registro">F. Registro</option>
          </select>
        </div>
      </div>

      <form className="filter-panel" onSubmit={handleSearch}>
        <div className="filter-field grow">
          <label>Buscar nombre o número de documento</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre o número de documento" />
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
        <div className="filter-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
          <button type="button" className="btn-export" onClick={handleExportar}>Exportar</button>
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Fecha</th><th>Documento</th><th>Producto</th><th>Tipo</th>
                <th>Cliente/Proveedor</th><th>Observación</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Stock resultante</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{m.created_at}</td>
                  <td>{m.referencia || '—'}</td>
                  <td>{m.producto_codigo} — {m.producto_nombre}</td>
                  <td><span className={'badge ' + (TIPO_BADGE[m.tipo] || 'badge-neutral')}>{TIPO_LABEL[m.tipo] || m.tipo}</span></td>
                  <td>{m.cliente_proveedor || '—'}</td>
                  <td>{m.motivo || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                  <td style={{ textAlign: 'right' }}>{m.stock_resultante ?? '—'}</td>
                  <td>{m.usuario_nombre || '—'}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr><td colSpan={9} className="empty-row">No hay movimientos registrados todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
              {esIngreso && (
                <>
                  <label>N.º de lote (opcional)</label>
                  <input value={codigoLote} onChange={(e) => setCodigoLote(e.target.value)} placeholder="Ej: L-2026-08" />
                  <label>Fecha de vencimiento (opcional)</label>
                  <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} disabled={!codigoLote} />
                  <p className="caja-row-auto" style={{ marginTop: -4 }}>
                    Si ingresas un N.º de lote, este ingreso también quedará registrado en Lotes y Series.
                  </p>
                </>
              )}
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
