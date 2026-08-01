import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const ESTADO_LABEL = { ok: 'Vigente', por_vencer: 'Por vencer', vencido: 'Vencido' };
const ESTADO_BADGE = { ok: 'badge-good', por_vencer: 'badge-warning', vencido: 'badge-critical' };

const EMPTY_FORM = {
  product_id: '', codigo_lote: '', tipo: 'lote', fecha_vencimiento: '', cantidad_inicial: '',
};

export default function Lotes() {
  const toast = useToast();
  const navigate = useNavigate();
  const [lotes, setLotes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);

  const [mostrar, setMostrar] = useState('con_stock');
  const [q, setQ] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  function load() {
    const params = {};
    if (mostrar) params.mostrar = mostrar;
    if (q) params.q = q;
    if (categoriaFiltro) params.categoria = categoriaFiltro;
    if (tipoFiltro) params.tipo = tipoFiltro;
    api.get('/lotes', { params }).then((res) => setLotes(res.data));
  }

  useEffect(() => { load(); }, [mostrar, categoriaFiltro, tipoFiltro]);
  useEffect(() => {
    api.get('/products').then((res) => setProductos(res.data.filter((p) => p.tipo === 'producto')));
    api.get('/products/categorias').then((res) => setCategorias(res.data));
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.product_id || !form.codigo_lote || !form.cantidad_inicial) {
      setError('Producto, código de lote y cantidad inicial son requeridos.');
      return;
    }
    try {
      await api.post('/lotes', {
        ...form,
        product_id: Number(form.product_id),
        cantidad_inicial: Number(form.cantidad_inicial),
        fecha_vencimiento: form.fecha_vencimiento || null,
      });
      toast.success('Lote registrado correctamente.');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el lote.');
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-link" title="Volver a Inventario" onClick={() => navigate('/productos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <ArrowLeft size={20} />
          </button>
          LOTES Y SERIES
        </h1>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={openNew}>+ Nuevo lote</button>
      </div>

      <form className="filter-panel" onSubmit={handleSearch}>
        <div className="filter-field">
          <label>Mostrar</label>
          <select value={mostrar} onChange={(e) => setMostrar(e.target.value)}>
            <option value="con_stock">Con stock</option>
            <option value="todos">Todos</option>
            <option value="agotados">Agotados</option>
            <option value="por_vencer">Por vencer (30 días)</option>
          </select>
        </div>
        <div className="filter-field grow">
          <label>Buscar</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto o código de lote.." />
        </div>
        <div className="filter-field">
          <label>Sucursal</label>
          <select defaultValue="principal">
            <option value="principal">Miraflores</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Categoría</label>
          <select value={categoriaFiltro} onChange={(e) => setCategoriaFiltro(e.target.value)}>
            <option value="">Todas</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Tipo</label>
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
            <option value="">Todos</option>
            <option value="lote">Lote</option>
            <option value="serie">Serie</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn-secondary">Buscar</button>
        </div>
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Tipo</th>
                <th>U.M.</th>
                <th style={{ textAlign: 'right' }}>Stock inicial</th>
                <th style={{ textAlign: 'right' }}>Stock actual</th>
                <th>Fecha de vencimiento</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.id}>
                  <td>{l.codigo_lote}</td>
                  <td>{l.producto_codigo} — {l.producto_nombre}</td>
                  <td>{l.producto_categoria || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{l.tipo}</td>
                  <td>{l.producto_unidad}</td>
                  <td style={{ textAlign: 'right' }}>{l.cantidad_inicial}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={l.cantidad_actual <= 0 ? 'badge badge-critical' : ''}>{l.cantidad_actual}</span>
                  </td>
                  <td>{l.fecha_vencimiento || 'Sin vencimiento'}</td>
                  <td><span className={'badge ' + (ESTADO_BADGE[l.estado_vencimiento] || 'badge-neutral')}>{ESTADO_LABEL[l.estado_vencimiento] || l.estado_vencimiento}</span></td>
                </tr>
              ))}
              {lotes.length === 0 && (
                <tr><td colSpan={9} className="empty-row">No hay lotes o series registrados con estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nuevo lote / serie</h2>
            <form onSubmit={handleSubmit}>
              <label>Producto</label>
              <select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">Selecciona un producto...</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
              </select>
              <div className="form-row">
                <div>
                  <label>Código de lote / serie</label>
                  <input required value={form.codigo_lote} onChange={(e) => setForm({ ...form, codigo_lote: e.target.value })} placeholder="Ej: CRE-2026-03" />
                </div>
                <div>
                  <label>Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                    <option value="lote">Lote</option>
                    <option value="serie">Serie</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Fecha de vencimiento (opcional)</label>
                  <input type="date" value={form.fecha_vencimiento} onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })} />
                </div>
                <div>
                  <label>Cantidad inicial</label>
                  <input required type="number" step="1" value={form.cantidad_inicial} onChange={(e) => setForm({ ...form, cantidad_inicial: e.target.value })} />
                </div>
              </div>
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Registrar lote</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
