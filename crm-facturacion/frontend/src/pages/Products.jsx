import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';

const EMPTY_FORM = {
  codigo: '', codigo_barras: '', nombre: '', descripcion: '', categoria: 'General',
  unidad: 'NIU', afectacion_igv: 'gravado', control: 'ninguno', tipo_inventario: 'MERCADERIAS',
  tipo_clasificacion: 'Otros', subtipo_clasificacion: 'Otros', peso: '', favorito: false,
  precio_compra: '', precio_unitario: '', stock: '', stock_minimo: '', palabras_clave: '',
};

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

  function load() {
    const params = {};
    if (q) params.q = q;
    if (categoriaFiltro) params.categoria = categoriaFiltro;
    api.get('/products', { params }).then((res) => setProducts(res.data));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/products/categorias').then((res) => setCategorias(res.data)); }, []);

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
        <button className="btn-primary" style={{ width: 'auto' }} onClick={openNew}>+ Nuevo producto</button>
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
                <th style={{ textAlign: 'right' }}>Mínimo</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th style={{ textAlign: 'right' }}>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const bajoMinimo = p.stock !== null && p.stock_minimo !== null && p.stock <= p.stock_minimo;
                return (
                  <tr key={p.id}>
                    <td>{p.codigo}</td>
                    <td>{p.nombre}</td>
                    <td>{p.categoria || '—'}</td>
                    <td>{p.unidad}</td>
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
                <tr><td colSpan={8} className="empty-row">No hay productos registrados.</td></tr>
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
    </div>
  );
}
