import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function emptyItem() {
  return { product_id: '', cantidad: 1 };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Produccion() {
  const toast = useToast();
  const navigate = useNavigate();
  const [recetas, setRecetas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('2018-01-01');
  const [hasta, setHasta] = useState(todayStr());

  const [showForm, setShowForm] = useState(false);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [productoSalidaId, setProductoSalidaId] = useState('');
  const [cantidadSalida, setCantidadSalida] = useState(1);
  const [tipoProduccion, setTipoProduccion] = useState('automatico');
  const [items, setItems] = useState([emptyItem()]);
  const [error, setError] = useState('');

  const [showProducir, setShowProducir] = useState(false);
  const [recetaProducir, setRecetaProducir] = useState(null);
  const [cantidadLotes, setCantidadLotes] = useState(1);
  const [errorProducir, setErrorProducir] = useState('');

  function load() {
    const params = {};
    if (q) params.q = q;
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    api.get('/recetas', { params }).then((res) => setRecetas(res.data));
  }

  function handleExportar() {
    const header = ['Fecha creación', 'Descripción', 'Producto de salida', 'Cant. de salida', 'Producción'];
    const rows = recetas.map((r) => [
      r.created_at, r.nombre, `${r.producto_salida_codigo} - ${r.producto_salida_nombre}`,
      r.cantidad_salida, r.tipo_produccion === 'automatico' ? 'Automático' : 'Manual',
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produccion_${desde}_a_${hasta}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Archivo CSV exportado.');
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/products').then((res) => setProductos(res.data.filter((p) => p.tipo === 'producto'))); }, []);

  function handleBuscar(e) {
    e.preventDefault();
    load();
  }

  function openNew() {
    setNombre('');
    setDescripcion('');
    setProductoSalidaId('');
    setCantidadSalida(1);
    setTipoProduccion('automatico');
    setItems([emptyItem()]);
    setError('');
    setShowForm(true);
  }

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!nombre || !productoSalidaId) { setError('Nombre y producto de salida son requeridos.'); return; }
    if (items.some((it) => !it.product_id || !it.cantidad)) { setError('Completa todos los insumos.'); return; }
    try {
      await api.post('/recetas', {
        nombre,
        descripcion,
        product_id_salida: Number(productoSalidaId),
        cantidad_salida: Number(cantidadSalida),
        tipo_produccion: tipoProduccion,
        items: items.map((it) => ({ product_id: Number(it.product_id), cantidad: Number(it.cantidad) })),
      });
      toast.success('Receta creada correctamente.');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear la receta.');
    }
  }

  function openProducir(receta) {
    setRecetaProducir(receta);
    setCantidadLotes(1);
    setErrorProducir('');
    setShowProducir(true);
  }

  async function handleProducir(e) {
    e.preventDefault();
    setErrorProducir('');
    try {
      const res = await api.post(`/recetas/${recetaProducir.id}/producir`, { cantidad_lotes: Number(cantidadLotes) });
      toast.success(`Producción registrada (lote #${res.data.id}).`);
      setShowProducir(false);
      load();
    } catch (err) {
      setErrorProducir(err.response?.data?.error || 'No se pudo registrar la producción.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Desactivar esta receta?')) return;
    try {
      await api.delete(`/recetas/${id}`);
      toast.success('Receta desactivada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo desactivar la receta.');
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Inventario" onClick={() => navigate('/productos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        PRODUCCIÓN
      </h1>

      <div className="ventas-actions" style={{ gridTemplateColumns: '1fr' }}>
        <button className="ventas-action-btn" onClick={openNew}>+ Receta Nueva</button>
      </div>

      <form className="filter-panel" onSubmit={handleBuscar}>
        <div className="filter-field grow">
          <label>Buscar receta</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar receta.." />
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
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha creación</th><th>Descripción</th><th>Producto de salida</th>
                <th style={{ textAlign: 'right' }}>Cant. de salida</th><th>Producción</th><th></th>
              </tr>
            </thead>
            <tbody>
              {recetas.map((r) => (
                <tr key={r.id}>
                  <td>{r.created_at}</td>
                  <td>{r.nombre}{r.descripcion ? <div className="caja-row-auto">{r.descripcion}</div> : null}</td>
                  <td>{r.producto_salida_codigo} — {r.producto_salida_nombre}</td>
                  <td style={{ textAlign: 'right' }}>{r.cantidad_salida} {r.producto_salida_unidad}</td>
                  <td><span className={'badge ' + (r.tipo_produccion === 'automatico' ? 'badge-good' : 'badge-neutral')}>{r.tipo_produccion === 'automatico' ? 'Automático' : 'Manual'}</span></td>
                  <td className="row-actions">
                    <button className="btn-link" onClick={() => openProducir(r)}>Producir</button>
                    <button className="btn-link danger" onClick={() => handleDelete(r.id)}>Desactivar</button>
                  </td>
                </tr>
              ))}
              {recetas.length === 0 && (
                <tr><td colSpan={6} className="empty-row">No hay recetas registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Receta nueva</h2>
            <form onSubmit={handleSubmit}>
              <label>Nombre de la receta</label>
              <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Envasado Pre-Entreno 30gr" />
              <label>Descripción</label>
              <textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />

              <div className="form-row">
                <div>
                  <label>Producto de salida (lo que se produce)</label>
                  <select required value={productoSalidaId} onChange={(e) => setProductoSalidaId(e.target.value)}>
                    <option value="">Selecciona un producto...</option>
                    {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label>Cantidad producida por lote</label>
                  <input required type="number" min="1" step="1" value={cantidadSalida} onChange={(e) => setCantidadSalida(e.target.value)} />
                </div>
              </div>

              <label>Tipo de producción</label>
              <select value={tipoProduccion} onChange={(e) => setTipoProduccion(e.target.value)}>
                <option value="automatico">Automático</option>
                <option value="manual">Manual</option>
              </select>

              <label>Insumos (materia prima que consume por lote)</label>
              <table className="items-table">
                <thead>
                  <tr><th>Producto</th><th>Cantidad por lote</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <select value={it.product_id} onChange={(e) => updateItem(idx, { product_id: e.target.value })}>
                          <option value="">Selecciona un insumo...</option>
                          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" min="1" step="1" style={{ width: 90 }} value={it.cantidad}
                          onChange={(e) => updateItem(idx, { cantidad: e.target.value })} />
                      </td>
                      <td>
                        {items.length > 1 && (
                          <button type="button" className="btn-link danger" onClick={() => removeItem(idx)}>x</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={addItem}>+ Agregar insumo</button>

              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Guardar receta</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProducir && recetaProducir && (
        <div className="modal-overlay" onClick={() => setShowProducir(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Producir — {recetaProducir.nombre}</h2>
            <form onSubmit={handleProducir}>
              <label>Cantidad de lotes a producir</label>
              <input required type="number" min="1" step="1" value={cantidadLotes} onChange={(e) => setCantidadLotes(e.target.value)} autoFocus />
              <p className="caja-row-auto">
                Producirá {Number(cantidadLotes || 0) * recetaProducir.cantidad_salida} {recetaProducir.producto_salida_unidad} de {recetaProducir.producto_salida_nombre}.
              </p>
              {errorProducir && <div className="form-error">{errorProducir}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowProducir(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Producir</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
