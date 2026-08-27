import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { leerArchivoComoTextoCsv, descargarComoExcel } from '../utils/excelImport';

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

function parseCsvLotes(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const rows = [];
  let start = 0;
  // saltar encabezado si la primera fila no parece numérica en la 2da columna
  const firstCols = lines[0].split(',');
  if (firstCols.length >= 2 && Number.isNaN(Number(firstCols[1]))) start = 1;
  for (let i = start; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length >= 2 && cols[0]) {
      rows.push({
        codigo: cols[0],
        cantidad: cols[1],
        codigo_lote: cols[2] || '',
        fecha_vencimiento: cols[3] || '',
        motivo: cols[4] || '',
      });
    }
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
  const [canalFiltro, setCanalFiltro] = useState('');
  const [desde, setDesde] = useState(todayStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayStr());
  const [mostrarPor, setMostrarPor] = useState('f_registro');
  const [canales, setCanales] = useState([]);

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

  const [showImportarLotes, setShowImportarLotes] = useState(false);
  const [importLotesRows, setImportLotesRows] = useState([]);
  const [importLotesFileName, setImportLotesFileName] = useState('');
  const [importLotesResult, setImportLotesResult] = useState(null);
  const [errorImportarLotes, setErrorImportarLotes] = useState('');

  function load() {
    const params = {};
    if (q) params.q = q;
    if (tipoFiltro) params.tipo = tipoFiltro;
    if (canalFiltro) params.canal = canalFiltro;
    if (desde) params.from = desde;
    if (hasta) params.to = hasta;
    api.get('/movements', { params }).then((res) => setMovements(res.data));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/products').then((res) => setProducts(res.data)); }, []);
  useEffect(() => { api.get('/movements/canales').then((res) => setCanales(res.data)); }, []);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  function handleExportar() {
    const header = ['Fecha', 'Documento', 'Producto', 'Tipo', 'Canal', 'Cliente/Proveedor', 'Observación', 'Cantidad', 'Stock resultante', 'Usuario'];
    const rows = movements.map((m) => [
      m.created_at, m.referencia || '', `${m.producto_codigo} - ${m.producto_nombre}`,
      TIPO_LABEL[m.tipo] || m.tipo, m.canal || '', m.cliente_proveedor || '', m.motivo || '', m.cantidad, m.stock_resultante ?? '', m.usuario_nombre || '',
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

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportResult(null);
    setErrorImportar('');
    try {
      const texto = await leerArchivoComoTextoCsv(file);
      const rows = parseCsv(texto);
      setImportRows(rows);
      if (rows.length === 0) setErrorImportar('No se encontraron filas válidas en el archivo (formato esperado: codigo,stock_real).');
    } catch {
      setErrorImportar('No se pudo leer el archivo. Verifica que sea un CSV o Excel (.xlsx) válido.');
    }
  }

  function descargarPlantillaImportarExcel() {
    descargarComoExcel('plantilla_importar_stock_real.xlsx', ['codigo', 'stock_real'], [['P100', 25]]);
  }

  function descargarPlantillaImportarCsv() {
    const csv = ['codigo,stock_real', 'P100,25'].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla_importar_stock_real.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
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

  function openImportarLotes() {
    setImportLotesRows([]);
    setImportLotesFileName('');
    setImportLotesResult(null);
    setErrorImportarLotes('');
    setShowImportarLotes(true);
  }

  async function handleFileChangeLotes(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLotesFileName(file.name);
    setImportLotesResult(null);
    setErrorImportarLotes('');
    try {
      const texto = await leerArchivoComoTextoCsv(file);
      const rows = parseCsvLotes(texto);
      setImportLotesRows(rows);
      if (rows.length === 0) setErrorImportarLotes('No se encontraron filas válidas en el archivo (formato esperado: codigo,cantidad,codigo_lote,fecha_vencimiento,motivo).');
    } catch {
      setErrorImportarLotes('No se pudo leer el archivo. Verifica que sea un CSV o Excel (.xlsx) válido.');
    }
  }

  function descargarPlantillaImportarLotesExcel() {
    descargarComoExcel(
      'plantilla_importar_stock_lotes.xlsx',
      ['codigo', 'cantidad', 'codigo_lote', 'fecha_vencimiento', 'motivo'],
      [['P100', 25, 'L001', '2027-01-31', 'Compra inicial']]
    );
  }

  async function handleImportarLotesSubmit(e) {
    e.preventDefault();
    setErrorImportarLotes('');
    if (importLotesRows.length === 0) { setErrorImportarLotes('Selecciona un archivo CSV con al menos una fila.'); return; }
    try {
      const res = await api.post('/movements/importar-lotes', { rows: importLotesRows });
      setImportLotesResult(res.data);
      if (res.data.aplicados.length > 0) toast.success(`${res.data.aplicados.length} ingreso(s) de stock registrados.`);
      if (res.data.errores.length > 0) toast.error(`${res.data.errores.length} fila(s) con errores. Revisa el detalle.`);
      load();
    } catch (err) {
      setErrorImportarLotes(err.response?.data?.error || 'No se pudo importar el archivo.');
    }
  }

  const productoConteo = products.find((p) => String(p.id) === String(conteoProductId));

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
          <button className="ventas-action-btn" onClick={() => navigate('/movimientos/registrar')}>Registrar Movimiento</button>
          <button className="ventas-action-btn" onClick={openConteo}>Inventario Físico</button>
          <button className="ventas-action-btn" onClick={openImportar}>Importar Stock Real</button>
          <button className="ventas-action-btn" onClick={openImportarLotes}>Cargar Stock + Lotes (CSV)</button>
          <button className="ventas-action-btn" onClick={() => navigate('/movimientos/fotos')}>Cargar Stock por Fotos</button>
          <button className="ventas-action-btn" onClick={() => navigate('/movimientos/guia-foto')}>Cargar Guía</button>
          <button className="ventas-action-btn" onClick={() => navigate('/traslados')}>Traslados</button>
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
          <label>Canal</label>
          <select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)}>
            <option value="">Todos</option>
            {canales.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
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
                <th>Fecha</th><th>Documento</th><th>Producto</th><th>Tipo</th><th>Canal</th>
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
                  <td>{m.canal || '—'}</td>
                  <td>{m.cliente_proveedor || '—'}</td>
                  <td>{m.motivo || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                  <td style={{ textAlign: 'right' }}>{m.stock_resultante ?? '—'}</td>
                  <td>{m.usuario_nombre || '—'}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr><td colSpan={10} className="empty-row">No hay movimientos registrados todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
              <input required type="number" min="0" step="1" value={conteoCantidad} onChange={(e) => setConteoCantidad(e.target.value)} />
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
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <button type="button" className="btn-link" onClick={descargarPlantillaImportarCsv}>
                Descargar plantilla (CSV)
              </button>
              <button type="button" className="btn-link" onClick={descargarPlantillaImportarExcel}>
                Descargar plantilla (Excel)
              </button>
            </div>
            <form onSubmit={handleImportarSubmit}>
              <label>Archivo CSV o Excel (columnas: código, stock real)</label>
              <input required type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleFileChange} />
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

      {showImportarLotes && (
        <div className="modal-overlay" onClick={() => setShowImportarLotes(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Cargar stock + lotes (CSV o Excel)</h2>
            <form onSubmit={handleImportarLotesSubmit}>
              <label>Archivo CSV o Excel (columnas: código, cantidad, N.º de lote, fecha de vencimiento, motivo)</label>
              <p className="caja-row-auto" style={{ marginTop: -6 }}>
                El N.º de lote, la fecha de vencimiento (AAAA-MM-DD) y el motivo son opcionales — puedes dejarlos
                vacíos en la fila. Cada fila suma esa cantidad al stock (ingreso); no sirve para dar de baja stock.
              </p>
              <button type="button" className="btn-link" onClick={descargarPlantillaImportarLotesExcel} style={{ marginBottom: 10 }}>
                Descargar plantilla (Excel)
              </button>
              <input required type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleFileChangeLotes} />
              {importLotesFileName && (
                <p className="caja-row-auto">{importLotesFileName} — {importLotesRows.length} fila(s) detectadas.</p>
              )}
              {importLotesResult && (
                <div style={{ marginTop: 10 }}>
                  <p><strong>{importLotesResult.aplicados.length}</strong> aplicados, <strong>{importLotesResult.errores.length}</strong> con error.</p>
                  {importLotesResult.errores.length > 0 && (
                    <ul style={{ fontSize: 12, color: 'var(--critical)', maxHeight: 120, overflowY: 'auto' }}>
                      {importLotesResult.errores.map((e, i) => <li key={i}>{e.codigo}: {e.error}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {errorImportarLotes && <div className="form-error">{errorImportarLotes}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowImportarLotes(false)}>Cerrar</button>
                <button type="submit" className="btn-primary">Importar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
