import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';

const CARGA_MASIVA_COLUMNAS = ['codigo', 'nombre', 'categoria', 'unidad', 'precio_unitario', 'stock', 'stock_minimo', 'precio_compra', 'codigo_barras'];

function parseCsvProductos(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  let start = 0;
  if (/codigo/i.test(lines[0]) && /nombre/i.test(lines[0])) start = 1;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!cols[0]) continue;
    const row = {};
    CARGA_MASIVA_COLUMNAS.forEach((key, idx) => { row[key] = cols[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

const EMPTY_FORM = {
  codigo: '', codigo_barras: '', nombre: '', descripcion: '', categoria: 'General',
  unidad: 'NIU', afectacion_igv: 'gravado', control: 'ninguno', tipo_inventario: 'MERCADERIAS',
  tipo_clasificacion: 'Otros', subtipo_clasificacion: 'Otros', peso: '', favorito: false,
  precio_compra: '', precio_unitario: '', stock: '', stock_minimo: '', palabras_clave: '', proveedor_id: '',
};

function emptySupplier() {
  return { ruc: '', nombre: '', direccion: '', telefono: '', email: '' };
}

const UNIDADES = [
  { value: 'NIU', label: 'UNIDAD' },
  { value: 'ZZ', label: 'SERVICIO' },
  { value: 'KGM', label: 'KILOGRAMO' },
  { value: 'LTR', label: 'LITRO' },
  { value: 'MTR', label: 'METRO' },
  { value: 'GLL', label: 'GALÓN' },
  { value: 'CJA', label: 'CAJA' },
  { value: 'PAR', label: 'PAR' },
  { value: 'DOC', label: 'DOCENA' },
];

const AFECTACIONES_IGV = [
  { value: 'gravado', label: 'Gravado - Operación Onerosa' },
  { value: 'exonerado', label: 'Exonerado - Operación Onerosa' },
  { value: 'inafecto', label: 'Inafecto - Operación Onerosa' },
  { value: 'gratuito', label: 'Gravado - Operación Gratuita' },
];

const CONTROLES = [
  { value: 'ninguno', label: 'Ninguno' },
  { value: 'lote', label: 'Lote' },
  { value: 'serie', label: 'Serie' },
];

const TIPOS_INVENTARIO = [
  { value: 'MERCADERIAS', label: 'MERCADERÍAS' },
  { value: 'MATERIA_PRIMA', label: 'MATERIA PRIMA' },
  { value: 'PRODUCTO_TERMINADO', label: 'PRODUCTO TERMINADO' },
  { value: 'ACTIVO_FIJO', label: 'ACTIVO FIJO' },
  { value: 'SUMINISTROS', label: 'SUMINISTROS' },
];

export default function Products() {
  const toast = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [q, setQ] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState('');

  const [equivalencias, setEquivalencias] = useState([]);
  const [equivNombre, setEquivNombre] = useState('');
  const [equivFactor, setEquivFactor] = useState('');
  const [equivPrecio, setEquivPrecio] = useState('');
  const [equivMinimo, setEquivMinimo] = useState('');
  const [equivMaximo, setEquivMaximo] = useState('');

  const [showCargaMasiva, setShowCargaMasiva] = useState(false);
  const [cargaFileName, setCargaFileName] = useState('');
  const [cargaRows, setCargaRows] = useState([]);
  const [cargaResult, setCargaResult] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [newSupplier, setNewSupplier] = useState(emptySupplier());

  function load() {
    const params = {};
    if (q) params.q = q;
    if (categoriaFiltro) params.categoria = categoriaFiltro;
    api.get('/products', { params }).then((res) => setProducts(res.data));
  }

  function loadSuppliers() {
    return api.get('/suppliers').then((res) => setSuppliers(res.data));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/products/categorias').then((res) => setCategorias(res.data)); }, []);
  useEffect(() => { loadSuppliers(); }, []);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  function handleExportar() {
    const header = ['Código', 'Producto', 'Categoría', 'U.M.', 'Mínimo', 'Stock', 'Precio'];
    const rows = products.map((p) => [p.codigo, p.nombre, p.categoria, p.unidad, p.stock_minimo ?? '', p.stock ?? '', p.precio_unitario]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'lista_de_precios.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success('Lista de precios exportada.');
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
    setShowMore(false);
    setShowForm(true);
  }

  function openEdit(p) {
    setForm({
      codigo: p.codigo,
      codigo_barras: p.codigo_barras || '',
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      categoria: p.categoria || 'General',
      unidad: p.unidad,
      afectacion_igv: p.afectacion_igv || 'gravado',
      control: p.control || 'ninguno',
      tipo_inventario: p.tipo_inventario || 'MERCADERIAS',
      tipo_clasificacion: p.tipo_clasificacion || 'Otros',
      subtipo_clasificacion: p.subtipo_clasificacion || 'Otros',
      peso: p.peso ?? '',
      favorito: !!p.favorito,
      precio_compra: p.precio_compra ?? '',
      precio_unitario: p.precio_unitario,
      stock: p.stock ?? '',
      stock_minimo: p.stock_minimo ?? '',
      palabras_clave: p.palabras_clave || '',
      proveedor_id: p.proveedor_id ?? '',
    });
    setEditingId(p.id);
    setError('');
    setShowMore(false);
    loadEquivalencias(p.id);
    resetEquivForm();
    setShowForm(true);
  }

  function resetEquivForm() {
    setEquivNombre('');
    setEquivFactor('');
    setEquivPrecio('');
    setEquivMinimo('');
    setEquivMaximo('');
  }

  function loadEquivalencias(productId) {
    api.get('/equivalencias', { params: { product_id: productId } }).then((res) => setEquivalencias(res.data));
  }

  async function handleAddEquivalencia() {
    if (!equivNombre || !equivFactor) {
      toast.error('Nombre y factor de conversión son requeridos.');
      return;
    }
    try {
      await api.post('/equivalencias', {
        product_id: editingId,
        nombre: equivNombre,
        factor: Number(equivFactor),
        precio: equivPrecio || null,
        stock_minimo: equivMinimo || null,
        stock_maximo: equivMaximo || null,
      });
      toast.success('Equivalencia agregada.');
      resetEquivForm();
      loadEquivalencias(editingId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo agregar la equivalencia.');
    }
  }

  async function handleDeleteEquivalencia(id) {
    try {
      await api.delete(`/equivalencias/${id}`);
      toast.success('Equivalencia eliminada.');
      loadEquivalencias(editingId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo eliminar la equivalencia.');
    }
  }

  async function handleNewSupplier(e) {
    e.preventDefault();
    if (!newSupplier.nombre) { toast.error('El nombre del proveedor es requerido.'); return; }
    try {
      const res = await api.post('/suppliers', newSupplier);
      await loadSuppliers();
      setForm((f) => ({ ...f, proveedor_id: res.data.id }));
      setNewSupplier(emptySupplier());
      setShowSupplierForm(false);
      toast.success('Proveedor creado.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo crear el proveedor.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.put(`/products/${editingId}`, form);
        toast.success('Producto actualizado correctamente.');
      } else {
        await api.post('/products', form);
        toast.success('Producto creado correctamente.');
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar el producto.');
    }
  }

  function openCargaMasiva() {
    setCargaFileName('');
    setCargaRows([]);
    setCargaResult(null);
    setErrorCarga('');
    setShowCargaMasiva(true);
  }

  function handleCargaFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCargaFileName(file.name);
    setCargaResult(null);
    setErrorCarga('');
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvProductos(String(reader.result || ''));
      setCargaRows(rows);
      if (rows.length === 0) setErrorCarga('No se encontraron filas válidas (columnas esperadas: código, nombre, categoría, unidad, precio_unitario, stock, stock_mínimo, precio_compra, código_barras).');
    };
    reader.readAsText(file);
  }

  async function handleCargaMasivaSubmit(e) {
    e.preventDefault();
    setErrorCarga('');
    if (cargaRows.length === 0) { setErrorCarga('Selecciona un archivo CSV con al menos una fila.'); return; }
    try {
      const res = await api.post('/products/carga-masiva', { rows: cargaRows });
      setCargaResult(res.data);
      if (res.data.creados.length > 0) toast.success(`${res.data.creados.length} producto(s) creados.`);
      if (res.data.actualizados.length > 0) toast.success(`${res.data.actualizados.length} producto(s) actualizados.`);
      if (res.data.errores.length > 0) toast.error(`${res.data.errores.length} fila(s) con errores. Revisa el detalle.`);
      load();
    } catch (err) {
      setErrorCarga(err.response?.data?.error || 'No se pudo procesar el archivo.');
    }
  }

  function descargarPlantillaCargaMasiva() {
    const header = CARGA_MASIVA_COLUMNAS;
    const ejemplo = ['P100', 'Producto de ejemplo', 'General', 'NIU', '19.90', '10', '2', '12.00', ''];
    const csv = [header, ejemplo].map((r) => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla_carga_masiva_productos.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Desactivar este producto?')) return;
    try {
      await api.delete(`/products/${id}`);
      toast.success('Producto desactivado.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo desactivar el producto.');
    }
  }

  const esServicio = form.unidad === 'ZZ';

  return (
    <div>
      <h1 className="page-title">Inventario</h1>

      <div className="ventas-actions">
        <button className="ventas-action-btn">Productos</button>
        <button className="ventas-action-btn" onClick={() => navigate('/promociones')}>Promociones</button>
        <button className="ventas-action-btn" onClick={() => navigate('/movimientos')}>Movimientos</button>
        <button className="ventas-action-btn" onClick={() => navigate('/lotes')}>Lotes y Series</button>
        <button className="ventas-action-btn" onClick={handleExportar}>Lista de Precios</button>
        <button className="ventas-action-btn" onClick={() => navigate('/traslados')}>Traslados</button>
        <button className="ventas-action-btn" onClick={() => navigate('/produccion')}>Producción</button>
        <button className="ventas-action-btn disabled" title="Próximamente" onClick={() => toast.info('Precio por márgenes estará disponible próximamente.')}>Precio por Márgenes</button>
      </div>

      <form className="filter-panel" onSubmit={handleSearch}>
        <div className="filter-field grow">
          <label>Buscar producto por nombre o código</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por nombre o codigo.." />
        </div>
        <div className="filter-field">
          <label>Categoría</label>
          <select defaultValue="principal">
            <option value="principal">Miraflores</option>
          </select>
        </div>
        <div className="filter-field">
          <label>IGV</label>
          <select value={categoriaFiltro} onChange={(e) => setCategoriaFiltro(e.target.value)}>
            <option value="">Todos</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
          <button type="button" className="btn-export" onClick={handleExportar}>Exportar</button>
        </div>
      </form>

      <div className="page-header">
        <span />
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-secondary" style={{ width: 'auto' }} onClick={openCargaMasiva}>Carga masiva</button>
          <button className="btn-primary" style={{ width: 'auto' }} onClick={openNew}>+ Nuevo producto</button>
        </div>
      </div>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Categoría</th>
                <th>U.M.</th>
                <th>Cod. Barra</th>
                <th>Afectación IGV</th>
                <th>Proveedor</th>
                <th>Favorito</th>
                <th style={{ textAlign: 'right' }}>Mínimo</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th style={{ textAlign: 'right' }}>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const bajoMinimo = p.stock !== null && p.stock_minimo !== null && p.stock <= p.stock_minimo;
                const afectacionLabel = AFECTACIONES_IGV.find((o) => o.value === p.afectacion_igv)?.label || '—';
                return (
                  <tr key={p.id}>
                    <td>{p.codigo}</td>
                    <td>{p.nombre}</td>
                    <td>{p.categoria || '—'}</td>
                    <td>{p.unidad}</td>
                    <td>{p.codigo_barras || '—'}</td>
                    <td>{afectacionLabel}</td>
                    <td>{p.proveedor_nombre || '—'}</td>
                    <td>{p.favorito ? <span className="badge badge-good">Sí</span> : 'No'}</td>
                    <td style={{ textAlign: 'right' }}>{p.stock_minimo ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {p.stock === null ? '—' : (
                        <span className={bajoMinimo ? 'badge badge-critical' : ''}>{p.stock}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>S/ {Number(p.precio_unitario).toFixed(2)}</td>
                    <td className="row-actions">
                      <button className="btn-link" onClick={() => openEdit(p)}>Editar</button>
                      <button className="btn-link danger" onClick={() => handleDelete(p.id)}>Desactivar</button>
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr><td colSpan={12} className="empty-row">No hay productos registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <h2>Producto</h2>
              <button type="button" className="btn-link" onClick={() => setShowMore((v) => !v)}>
                {showMore ? 'Mostrar menos' : 'Mostrar Más'}
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div>
                  <label>Código producto</label>
                  <input required value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
                </div>
                <div>
                  <label>Código barras</label>
                  <input value={form.codigo_barras} onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>Unidad medida</label>
                  <select value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })}>
                    {UNIDADES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Categoria</label>
                  <input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} list="categorias-list" />
                  <datalist id="categorias-list">
                    {categorias.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>Afectación IGV</label>
                  <select value={form.afectacion_igv} onChange={(e) => setForm({ ...form, afectacion_igv: e.target.value })}>
                    {AFECTACIONES_IGV.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Tipo</label>
                  <input value={form.tipo_clasificacion} onChange={(e) => setForm({ ...form, tipo_clasificacion: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>Control</label>
                  <select value={form.control} onChange={(e) => setForm({ ...form, control: e.target.value })}>
                    {CONTROLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Subtipo</label>
                  <input value={form.subtipo_clasificacion} onChange={(e) => setForm({ ...form, subtipo_clasificacion: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>Tipo inventario</label>
                  <select value={form.tipo_inventario} onChange={(e) => setForm({ ...form, tipo_inventario: e.target.value })}>
                    {TIPOS_INVENTARIO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Peso</label>
                  <input type="number" step="0.01" value={form.peso} onChange={(e) => setForm({ ...form, peso: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>Favorito</label>
                  <select value={form.favorito ? '1' : '0'} onChange={(e) => setForm({ ...form, favorito: e.target.value === '1' })}>
                    <option value="0">No</option>
                    <option value="1">Sí</option>
                  </select>
                </div>
                {esServicio ? <div /> : (
                  <div>
                    <label>Stock inicial</label>
                    <input type="number" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                  </div>
                )}
              </div>

              <div className="form-row">
                <div>
                  <label>Precio Compra S/</label>
                  <input type="number" step="0.01" value={form.precio_compra} onChange={(e) => setForm({ ...form, precio_compra: e.target.value })} />
                </div>
                <div>
                  <label>Precio venta S/</label>
                  <input required type="number" step="0.01" value={form.precio_unitario} onChange={(e) => setForm({ ...form, precio_unitario: e.target.value })} />
                </div>
              </div>

              <label>Proveedor</label>
              <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
                <option value="">Sin proveedor</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}{s.ruc ? ` (${s.ruc})` : ''}</option>
                ))}
              </select>
              <button type="button" className="btn-link" style={{ marginTop: 4 }} onClick={() => setShowSupplierForm(true)}>
                + Nuevo proveedor
              </button>

              <label>Producto</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />

              <label>Palabra clave</label>
              <input
                value={form.palabras_clave}
                onChange={(e) => setForm({ ...form, palabras_clave: e.target.value })}
                placeholder="Agrega tags o palabras con las que deseas buscar el producto"
              />

              {showMore && (
                <>
                  <label>Descripción</label>
                  <textarea rows={2} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
                  {!esServicio && (
                    <>
                      <label>Stock mínimo</label>
                      <input type="number" step="1" value={form.stock_minimo} onChange={(e) => setForm({ ...form, stock_minimo: e.target.value })} />
                    </>
                  )}
                </>
              )}

              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Guardar</button>
              </div>
            </form>

            {editingId && !esServicio && (
              <div className="equiv-section">
                <h3>Equivalencias</h3>
                {equivalencias.length > 0 && (
                  <table className="items-table" style={{ marginBottom: 10 }}>
                    <thead>
                      <tr><th>Nombre</th><th>Factor</th><th>Precio</th><th>Mínimo</th><th>Máximo</th><th>Stock (equiv.)</th><th></th></tr>
                    </thead>
                    <tbody>
                      {equivalencias.map((eq) => (
                        <tr key={eq.id}>
                          <td>{eq.nombre}</td>
                          <td>x{eq.factor}</td>
                          <td>{eq.precio != null ? `S/ ${Number(eq.precio).toFixed(2)}` : '—'}</td>
                          <td>{eq.stock_minimo ?? '—'}</td>
                          <td>{eq.stock_maximo ?? '—'}</td>
                          <td>{Math.floor((form.stock || 0) / eq.factor)}</td>
                          <td><button type="button" className="btn-link danger" onClick={() => handleDeleteEquivalencia(eq.id)}>x</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="form-row">
                  <div>
                    <label>Nombre (ej: Caja x12)</label>
                    <input value={equivNombre} onChange={(e) => setEquivNombre(e.target.value)} />
                  </div>
                  <div>
                    <label>Factor (unidades base por equivalencia)</label>
                    <input type="number" step="0.01" min="0.01" value={equivFactor} onChange={(e) => setEquivFactor(e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <label>Precio de venta (opcional)</label>
                    <input type="number" step="0.01" value={equivPrecio} onChange={(e) => setEquivPrecio(e.target.value)} />
                  </div>
                  <div>
                    <label>Mínimo</label>
                    <input type="number" step="1" value={equivMinimo} onChange={(e) => setEquivMinimo(e.target.value)} />
                  </div>
                  <div>
                    <label>Máximo</label>
                    <input type="number" step="1" value={equivMaximo} onChange={(e) => setEquivMaximo(e.target.value)} />
                  </div>
                </div>
                <button type="button" className="btn-secondary" onClick={handleAddEquivalencia}>+ Agregar Equivalencia</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showSupplierForm && (
        <div className="modal-overlay" onClick={() => setShowSupplierForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nuevo proveedor</h2>
            <form onSubmit={handleNewSupplier}>
              <label>Nombre / Razón social</label>
              <input required value={newSupplier.nombre} onChange={(e) => setNewSupplier((s) => ({ ...s, nombre: e.target.value }))} />
              <label>RUC</label>
              <input value={newSupplier.ruc} onChange={(e) => setNewSupplier((s) => ({ ...s, ruc: e.target.value }))} />
              <label>Dirección</label>
              <input value={newSupplier.direccion} onChange={(e) => setNewSupplier((s) => ({ ...s, direccion: e.target.value }))} />
              <label>Teléfono</label>
              <input value={newSupplier.telefono} onChange={(e) => setNewSupplier((s) => ({ ...s, telefono: e.target.value }))} />
              <label>Email</label>
              <input value={newSupplier.email} onChange={(e) => setNewSupplier((s) => ({ ...s, email: e.target.value }))} />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSupplierForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Crear proveedor</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCargaMasiva && (
        <div className="modal-overlay" onClick={() => setShowCargaMasiva(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Carga masiva de productos</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
              Sube un CSV con columnas: código, nombre, categoría, unidad, precio_unitario, stock, stock_mínimo, precio_compra, código_barras.
              Si el código ya existe, actualiza ese producto; si no, lo crea. El stock que subas es el de esta sede.
            </p>
            <button type="button" className="btn-link" onClick={descargarPlantillaCargaMasiva} style={{ marginBottom: 10 }}>
              Descargar plantilla de ejemplo
            </button>
            <form onSubmit={handleCargaMasivaSubmit}>
              <label>Archivo CSV</label>
              <input required type="file" accept=".csv,text/csv" onChange={handleCargaFileChange} />
              {cargaFileName && (
                <p className="caja-row-auto">{cargaFileName} — {cargaRows.length} fila(s) detectadas.</p>
              )}
              {cargaResult && (
                <div style={{ marginTop: 10 }}>
                  <p>
                    <strong>{cargaResult.creados.length}</strong> creados, <strong>{cargaResult.actualizados.length}</strong> actualizados,{' '}
                    <strong>{cargaResult.errores.length}</strong> con error.
                  </p>
                  {cargaResult.errores.length > 0 && (
                    <ul style={{ fontSize: 12, color: 'var(--critical)', maxHeight: 120, overflowY: 'auto' }}>
                      {cargaResult.errores.map((e, i) => <li key={i}>{e.codigo}: {e.error}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {errorCarga && <div className="form-error">{errorCarga}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCargaMasiva(false)}>Cerrar</button>
                <button type="submit" className="btn-primary">Cargar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
