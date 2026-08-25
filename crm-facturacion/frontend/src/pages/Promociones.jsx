import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useToast } from '../context/ToastContext';
import ProductSearchBar from '../components/ProductSearchBar';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyOfertaForm() {
  return {
    nombre: '', sucursal_id: '', fecha_inicio: todayStr(), fecha_fin: todayStr(),
    product_id: '', producto_nombre: '', producto_precio: 0,
    tipo_descuento: 'porcentaje', precio_promocional: '', descuento_pct: '',
  };
}

function emptyComboForm() {
  return {
    nombre: '', sucursal_id: '', fecha_inicio: todayStr(), fecha_fin: todayStr(),
    items: [], precio_combo: '',
  };
}

function vigenciaEstado(promo) {
  const hoy = todayStr();
  if (!promo.activo) return { label: 'Desactivada', clase: 'badge-neutral' };
  if (hoy < promo.fecha_inicio) return { label: 'Programada', clase: 'badge-neutral' };
  if (hoy > promo.fecha_fin) return { label: 'Vencida', clase: 'badge-critical' };
  return { label: 'Vigente', clase: 'badge-good' };
}

export default function Promociones() {
  const toast = useToast();
  const navigate = useNavigate();

  const [promos, setPromos] = useState([]);
  const [sucursales, setSucursales] = useState([]);

  const [showTipoModal, setShowTipoModal] = useState(false);
  const [showOfertaForm, setShowOfertaForm] = useState(false);
  const [showComboForm, setShowComboForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [ofertaForm, setOfertaForm] = useState(emptyOfertaForm());
  const [comboForm, setComboForm] = useState(emptyComboForm());
  const [errorForm, setErrorForm] = useState('');
  const [guardando, setGuardando] = useState(false);

  function load() {
    api.get('/promociones').then((res) => setPromos(res.data));
  }

  useEffect(() => {
    load();
    api.get('/sucursales', { params: { todas: 1 } }).then((res) => setSucursales(res.data));
  }, []);

  function openNuevaOferta() {
    setEditingId(null);
    setOfertaForm(emptyOfertaForm());
    setErrorForm('');
    setShowTipoModal(false);
    setShowOfertaForm(true);
  }

  function openNuevoCombo() {
    setEditingId(null);
    setComboForm(emptyComboForm());
    setErrorForm('');
    setShowTipoModal(false);
    setShowComboForm(true);
  }

  function openEdit(promo) {
    setEditingId(promo.id);
    setErrorForm('');
    if (promo.tipo === 'oferta') {
      setOfertaForm({
        nombre: promo.nombre, sucursal_id: promo.sucursal_id || '', fecha_inicio: promo.fecha_inicio, fecha_fin: promo.fecha_fin,
        product_id: promo.product_id, producto_nombre: promo.producto?.nombre || '', producto_precio: promo.producto?.precio_unitario || 0,
        tipo_descuento: promo.tipo_descuento, precio_promocional: promo.precio_promocional ?? '', descuento_pct: promo.descuento_pct ?? '',
      });
      setShowOfertaForm(true);
    } else {
      setComboForm({
        nombre: promo.nombre, sucursal_id: promo.sucursal_id || '', fecha_inicio: promo.fecha_inicio, fecha_fin: promo.fecha_fin,
        items: promo.items.map((it) => ({ product_id: it.product_id, nombre: it.nombre, precio_unitario: it.precio_unitario, cantidad: it.cantidad })),
        precio_combo: promo.precio_combo,
      });
      setShowComboForm(true);
    }
  }

  async function handleToggleEstado(promo) {
    try {
      await api.put(`/promociones/${promo.id}/estado`, { activo: !promo.activo });
      toast.success(promo.activo ? 'Promoción desactivada.' : 'Promoción activada.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  async function handleSubmitOferta(e) {
    e.preventDefault();
    setErrorForm('');
    if (!ofertaForm.product_id) { setErrorForm('Busca y selecciona el producto de la oferta.'); return; }
    setGuardando(true);
    try {
      const payload = {
        nombre: ofertaForm.nombre, tipo: 'oferta', sucursal_id: ofertaForm.sucursal_id || null,
        fecha_inicio: ofertaForm.fecha_inicio, fecha_fin: ofertaForm.fecha_fin,
        product_id: ofertaForm.product_id, tipo_descuento: ofertaForm.tipo_descuento,
        precio_promocional: ofertaForm.precio_promocional || null,
        descuento_pct: ofertaForm.descuento_pct || null,
      };
      if (editingId) await api.put(`/promociones/${editingId}`, payload);
      else await api.post('/promociones', payload);
      toast.success(editingId ? 'Oferta actualizada.' : 'Oferta creada.');
      setShowOfertaForm(false);
      load();
    } catch (err) {
      setErrorForm(err.response?.data?.error || 'No se pudo guardar la oferta.');
    } finally {
      setGuardando(false);
    }
  }

  // Si el producto ya está en el combo, volver a agregarlo suma 1 a su
  // cantidad en vez de bloquear — así "2 creatinas" se logra buscando y
  // agregando "Creatina" dos veces, igual que el resto de la app (o
  // escribiendo la cantidad directamente en la columna Cantidad).
  function addProductoCombo(p) {
    setComboForm((f) => {
      const idx = f.items.findIndex((it) => it.product_id === p.id);
      if (idx !== -1) {
        return { ...f, items: f.items.map((it, i) => (i === idx ? { ...it, cantidad: it.cantidad + 1 } : it)) };
      }
      return { ...f, items: [...f.items, { product_id: p.id, nombre: p.nombre, precio_unitario: p.precio_unitario, cantidad: 1 }] };
    });
  }

  function updateItemCombo(idx, cantidad) {
    setComboForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, cantidad } : it)) }));
  }

  function removeItemCombo(idx) {
    setComboForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  async function handleSubmitCombo(e) {
    e.preventDefault();
    setErrorForm('');
    if (comboForm.items.length < 2) { setErrorForm('Agrega al menos 2 productos existentes al combo.'); return; }
    setGuardando(true);
    try {
      const payload = {
        nombre: comboForm.nombre, tipo: 'combo', sucursal_id: comboForm.sucursal_id || null,
        fecha_inicio: comboForm.fecha_inicio, fecha_fin: comboForm.fecha_fin,
        items: comboForm.items.map((it) => ({ product_id: it.product_id, cantidad: Number(it.cantidad) })),
        precio_combo: comboForm.precio_combo,
      };
      if (editingId) await api.put(`/promociones/${editingId}`, payload);
      else await api.post('/promociones', payload);
      toast.success(editingId ? 'Combo actualizado.' : 'Combo creado.');
      setShowComboForm(false);
      load();
    } catch (err) {
      setErrorForm(err.response?.data?.error || 'No se pudo guardar el combo.');
    } finally {
      setGuardando(false);
    }
  }

  const totalTeoricoCombo = comboForm.items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
  const descuentoComboPct = totalTeoricoCombo > 0 && comboForm.precio_combo
    ? Math.max(0, (1 - Number(comboForm.precio_combo) / totalTeoricoCombo) * 100)
    : 0;

  const precioConOferta = ofertaForm.tipo_descuento === 'precio_fijo'
    ? Number(ofertaForm.precio_promocional || 0)
    : round2(ofertaForm.producto_precio * (1 - Number(ofertaForm.descuento_pct || 0) / 100));

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  return (
    <div>
      <h1 className="page-title">Inventario</h1>

      <div className="ventas-actions">
        <button className="ventas-action-btn" onClick={() => navigate('/productos')}>Productos</button>
        <button className="ventas-action-btn">Promociones</button>
        <button className="ventas-action-btn" onClick={() => navigate('/movimientos')}>Movimientos</button>
        <button className="ventas-action-btn" onClick={() => navigate('/lotes')}>Lotes y Series</button>
        <button className="ventas-action-btn" onClick={() => navigate('/traslados')}>Traslados</button>
        <button className="ventas-action-btn" onClick={() => navigate('/produccion')}>Producción</button>
      </div>

      <div className="report-toolbar">
        <h3 style={{ margin: 0 }}>Promociones</h3>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={() => setShowTipoModal(true)}>Nueva promoción</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Ofertas de un producto o combos de varios productos existentes en tu inventario. Mientras estén vigentes,
        se aplican solas al agregar el producto (o el combo) en Registrar Venta.
      </p>

      <div className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th><th>Tipo</th><th>Vinculado a</th><th>Sede</th><th>Vigencia</th>
                <th style={{ textAlign: 'right' }}>Descuento</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => {
                const estado = vigenciaEstado(p);
                return (
                  <tr key={p.id}>
                    <td>{p.nombre}</td>
                    <td>{p.tipo === 'oferta' ? 'Oferta' : 'Combo'}</td>
                    <td>{p.tipo === 'oferta' ? p.producto?.nombre : `${p.items.length} productos`}</td>
                    <td>{p.sede_nombre || 'Todas las sedes'}</td>
                    <td>{p.fecha_inicio} → {p.fecha_fin}</td>
                    <td style={{ textAlign: 'right' }}>{p.descuento_pct_aplicado.toFixed(2)}%</td>
                    <td><span className={`badge ${estado.clase}`}>{estado.label}</span></td>
                    <td>
                      <button className="btn-link" onClick={() => openEdit(p)}>Editar</button>{' '}
                      <button className="btn-link danger" onClick={() => handleToggleEstado(p)}>
                        {p.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {promos.length === 0 && (
                <tr><td colSpan={8} className="empty-row">No hay promociones creadas todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showTipoModal && (
        <div className="modal-overlay" onClick={() => setShowTipoModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>¿Qué tipo de promoción quieres crear?</h2>
            <div className="form-row" style={{ marginTop: 12 }}>
              <button type="button" className="ventas-action-btn" style={{ height: 90, textAlign: 'left', whiteSpace: 'normal' }} onClick={openNuevaOferta}>
                <strong>Oferta simple</strong><br />
                <span style={{ fontSize: 12, fontWeight: 400 }}>Precio o % especial en un producto de tu inventario.</span>
              </button>
              <button type="button" className="ventas-action-btn" style={{ height: 90, textAlign: 'left', whiteSpace: 'normal' }} onClick={openNuevoCombo}>
                <strong>Combo</strong><br />
                <span style={{ fontSize: 12, fontWeight: 400 }}>2 o más productos existentes vendidos juntos a precio especial.</span>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowTipoModal(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showOfertaForm && (
        <div className="modal-overlay" onClick={() => setShowOfertaForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Editar oferta' : 'Nueva oferta'}</h2>
            <form onSubmit={handleSubmitOferta}>
              <label>Nombre de la promoción *</label>
              <input required value={ofertaForm.nombre} onChange={(e) => setOfertaForm({ ...ofertaForm, nombre: e.target.value })} placeholder="Ej. Whey Protein 20% dcto" />

              <label>Producto *</label>
              {ofertaForm.product_id ? (
                <div className="caja-row-auto" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{ofertaForm.producto_nombre} — precio actual S/ {Number(ofertaForm.producto_precio).toFixed(2)}</span>
                  <button type="button" className="btn-link" onClick={() => setOfertaForm({ ...ofertaForm, product_id: '', producto_nombre: '', producto_precio: 0 })}>Cambiar</button>
                </div>
              ) : (
                <ProductSearchBar onSelect={(p) => setOfertaForm({ ...ofertaForm, product_id: p.id, producto_nombre: p.nombre, producto_precio: p.precio_unitario })} placeholder="Busca el producto por nombre o código.." />
              )}

              <div className="form-row">
                <div>
                  <label>Tipo de descuento *</label>
                  <select value={ofertaForm.tipo_descuento} onChange={(e) => setOfertaForm({ ...ofertaForm, tipo_descuento: e.target.value })}>
                    <option value="porcentaje">Porcentaje de descuento</option>
                    <option value="precio_fijo">Precio promocional fijo</option>
                  </select>
                </div>
                {ofertaForm.tipo_descuento === 'porcentaje' ? (
                  <div>
                    <label>Descuento (%) *</label>
                    <input required type="number" min="0.01" max="100" step="0.01" value={ofertaForm.descuento_pct}
                      onChange={(e) => setOfertaForm({ ...ofertaForm, descuento_pct: e.target.value })} />
                  </div>
                ) : (
                  <div>
                    <label>Precio promocional (S/) *</label>
                    <input required type="number" min="0.01" step="0.01" value={ofertaForm.precio_promocional}
                      onChange={(e) => setOfertaForm({ ...ofertaForm, precio_promocional: e.target.value })} />
                  </div>
                )}
              </div>
              {ofertaForm.product_id && (ofertaForm.descuento_pct || ofertaForm.precio_promocional) && (
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  Precio con la promo: <strong>S/ {precioConOferta.toFixed(2)}</strong> (precio actual S/ {Number(ofertaForm.producto_precio).toFixed(2)})
                </p>
              )}

              <div className="form-row">
                <div>
                  <label>Sede</label>
                  <select value={ofertaForm.sucursal_id} onChange={(e) => setOfertaForm({ ...ofertaForm, sucursal_id: e.target.value })}>
                    <option value="">Todas las sedes</option>
                    {sucursales.filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Vigencia desde *</label>
                  <input required type="date" value={ofertaForm.fecha_inicio} onChange={(e) => setOfertaForm({ ...ofertaForm, fecha_inicio: e.target.value })} />
                </div>
                <div>
                  <label>Vigencia hasta *</label>
                  <input required type="date" value={ofertaForm.fecha_fin} min={ofertaForm.fecha_inicio} onChange={(e) => setOfertaForm({ ...ofertaForm, fecha_fin: e.target.value })} />
                </div>
              </div>

              {errorForm && <div className="form-error">{errorForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowOfertaForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={guardando}>{editingId ? 'Guardar cambios' : 'Crear oferta'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showComboForm && (
        <div className="modal-overlay" onClick={() => setShowComboForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Editar combo' : 'Nuevo combo'}</h2>
            <form onSubmit={handleSubmitCombo}>
              <label>Nombre de la promoción *</label>
              <input required value={comboForm.nombre} onChange={(e) => setComboForm({ ...comboForm, nombre: e.target.value })} placeholder="Ej. Combo Proteína + Shaker" />

              <label>Agregar productos del inventario (mínimo 2) *</label>
              <ProductSearchBar onSelect={addProductoCombo} placeholder="Busca y agrega productos por nombre o código.." />

              {comboForm.items.length > 0 && (
                <table className="data-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr><th>Producto</th><th style={{ textAlign: 'right' }}>Precio unit.</th><th>Cantidad</th><th style={{ textAlign: 'right' }}>Subtotal</th><th></th></tr>
                  </thead>
                  <tbody>
                    {comboForm.items.map((it, idx) => (
                      <tr key={it.product_id}>
                        <td>{it.nombre}</td>
                        <td style={{ textAlign: 'right' }}>S/ {Number(it.precio_unitario).toFixed(2)}</td>
                        <td>
                          <input type="number" min="1" step="1" value={it.cantidad} style={{ width: 80 }}
                            onChange={(e) => updateItemCombo(idx, Number(e.target.value) || 0)} />
                        </td>
                        <td style={{ textAlign: 'right' }}>S/ {(it.cantidad * it.precio_unitario).toFixed(2)}</td>
                        <td><button type="button" className="btn-link danger" onClick={() => removeItemCombo(idx)}>x</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="form-row" style={{ marginTop: 12 }}>
                <div>
                  <label>Precio del combo (S/) *</label>
                  <input required type="number" min="0.01" step="0.01" value={comboForm.precio_combo}
                    onChange={(e) => setComboForm({ ...comboForm, precio_combo: e.target.value })} />
                </div>
              </div>
              {comboForm.items.length > 0 && comboForm.precio_combo && (
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  Precio comprado por separado: S/ {totalTeoricoCombo.toFixed(2)} → Precio combo: <strong>S/ {Number(comboForm.precio_combo).toFixed(2)}</strong> ({descuentoComboPct.toFixed(2)}% dcto)
                </p>
              )}

              <div className="form-row">
                <div>
                  <label>Sede</label>
                  <select value={comboForm.sucursal_id} onChange={(e) => setComboForm({ ...comboForm, sucursal_id: e.target.value })}>
                    <option value="">Todas las sedes</option>
                    {sucursales.filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Vigencia desde *</label>
                  <input required type="date" value={comboForm.fecha_inicio} onChange={(e) => setComboForm({ ...comboForm, fecha_inicio: e.target.value })} />
                </div>
                <div>
                  <label>Vigencia hasta *</label>
                  <input required type="date" value={comboForm.fecha_fin} min={comboForm.fecha_inicio} onChange={(e) => setComboForm({ ...comboForm, fecha_fin: e.target.value })} />
                </div>
              </div>

              {errorForm && <div className="form-error">{errorForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowComboForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={guardando}>{editingId ? 'Guardar cambios' : 'Crear combo'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
