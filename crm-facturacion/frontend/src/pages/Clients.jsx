import { useEffect, useState } from 'react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const EMPTY_FORM = { tipo_documento: 'DNI', numero_documento: '', nombre: '', direccion: '', telefono: '', email: '', notas: '', sucursal_id: '', turno: '', referencia: '', contacto: '' };

export default function Clients() {
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('activo');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [duplicados, setDuplicados] = useState([]);
  const [seleccionDuplicados, setSeleccionDuplicados] = useState({});
  const [showDuplicadosModal, setShowDuplicadosModal] = useState(false);
  const [fusionando, setFusionando] = useState(false);
  const [buscandoDoc, setBuscandoDoc] = useState(false);

  function load(query = q, estadoFiltro = estado) {
    const params = { estado: estadoFiltro };
    if (query) params.q = query;
    api.get('/clients', { params }).then((res) => setClients(res.data));
  }

  function loadDuplicados() {
    api.get('/clients/duplicados-ce').then((res) => {
      setDuplicados(res.data);
      setSeleccionDuplicados(Object.fromEntries(res.data.map((d) => [d.legacy_id, true])));
    }).catch(() => {});
  }

  useEffect(() => {
    load();
    api.get('/sucursales').then((res) => setSucursales(res.data));
    loadDuplicados();
  }, []);

  // Autocompletar nombre/dirección apenas se completa un DNI (8 dígitos) o
  // RUC (11 dígitos) válido, igual que en el Cliente Nuevo de una venta —
  // solo al crear (nunca pisa un cliente que ya se está editando). Sin API
  // key configurada o si el proveedor falla, /consultar-documento responde
  // encontrado:false y este efecto no hace nada.
  useEffect(() => {
    if (!showForm || editingId) return;
    const tipo = form.tipo_documento;
    const numero = form.numero_documento.trim();
    const largoValido = (tipo === 'DNI' && numero.length === 8) || (tipo === 'RUC' && numero.length === 11);
    if (!largoValido) return;
    let cancelado = false;
    setBuscandoDoc(true);
    api.get('/clients/consultar-documento', { params: { tipo_documento: tipo, numero_documento: numero } })
      .then((res) => {
        if (cancelado || !res.data.encontrado) return;
        setForm((f) => (
          f.numero_documento.trim() === numero && f.tipo_documento === tipo
            ? { ...f, nombre: f.nombre.trim() ? f.nombre : res.data.nombre, direccion: f.direccion.trim() ? f.direccion : (res.data.direccion || f.direccion) }
            : f
        ));
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setBuscandoDoc(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.tipo_documento, form.numero_documento, showForm, editingId]);

  function handleSearch(e) {
    e.preventDefault();
    load(q, estado);
  }

  function handleEstadoChange(nuevoEstado) {
    setEstado(nuevoEstado);
    load(q, nuevoEstado);
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
    setShowForm(true);
  }

  function openEdit(client) {
    setForm({
      tipo_documento: client.tipo_documento,
      numero_documento: client.numero_documento,
      nombre: client.nombre,
      direccion: client.direccion || '',
      telefono: client.telefono || '',
      email: client.email || '',
      notas: client.notas || '',
      sucursal_id: client.sucursal_id || '',
      turno: client.turno || '',
      referencia: client.referencia || '',
      contacto: client.contacto || '',
    });
    setEditingId(client.id);
    setError('');
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.put(`/clients/${editingId}`, form);
        toast.success('Cliente actualizado correctamente.');
      } else {
        await api.post('/clients', form);
        toast.success('Cliente creado correctamente.');
      }
      setShowForm(false);
      load(q);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar el cliente.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar este cliente?')) return;
    try {
      await api.delete(`/clients/${id}`);
      toast.success('Cliente eliminado.');
      load(q);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo eliminar.');
    }
  }

  // Alternativa a eliminar para un cliente que ya tiene comprobantes
  // asociados (aunque estén anulados) -- lo oculta de las búsquedas activas
  // sin perder su historial.
  async function handleToggleEstado(c) {
    const accion = c.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} a ${c.nombre}?`)) return;
    try {
      await api.put(`/clients/${c.id}/estado`, { activo: !c.activo });
      toast.success(`Cliente ${c.activo ? 'desactivado' : 'activado'}.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  function toggleSeleccionDuplicado(legacyId) {
    setSeleccionDuplicados((prev) => ({ ...prev, [legacyId]: !prev[legacyId] }));
  }

  async function handleFusionarDuplicados() {
    const pares = duplicados
      .filter((d) => seleccionDuplicados[d.legacy_id])
      .map((d) => ({ ce_id: d.ce_id, legacy_id: d.legacy_id }));
    if (pares.length === 0) return;
    setFusionando(true);
    try {
      const res = await api.post('/clients/duplicados-ce/fusionar', { pares });
      const { fusionados, omitidos } = res.data;
      if (fusionados.length > 0) toast.success(`${fusionados.length} cliente(s) duplicado(s) fusionado(s).`);
      if (omitidos.length > 0) toast.error(`${omitidos.length} par(es) no se pudieron fusionar (probablemente ya estaban fusionados).`);
      setShowDuplicadosModal(false);
      load(q);
      loadDuplicados();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo fusionar los duplicados.');
    } finally {
      setFusionando(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Clientes</h1>
        <button className="btn-primary" onClick={openNew}>+ Nuevo cliente</button>
      </div>

      {duplicados.length > 0 && (
        <div className="panel" style={{ background: '#fff7e6', borderColor: '#f0b429', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
          <span>
            Se detectaron <strong>{duplicados.length}</strong> cliente(s) duplicado(s) por Carnet de Extranjería (mismo número de documento, registrado dos veces con distinto tipo).
          </span>
          <button className="btn-secondary" onClick={() => setShowDuplicadosModal(true)}>Revisar y fusionar</button>
        </div>
      )}

      <form className="search-bar" onSubmit={handleSearch}>
        <input placeholder="Buscar por nombre o documento..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={estado} onChange={(e) => handleEstadoChange(e.target.value)}>
          <option value="activo">Activos</option>
          <option value="inactivo">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
        <button type="submit" className="btn-secondary">Buscar</button>
      </form>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Nombre / Razón social</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th>Sede</th>
              <th>Turno</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>{c.tipo_documento} {c.numero_documento}</td>
                <td>{c.nombre}</td>
                <td>{c.telefono || '—'}</td>
                <td>{c.email || '—'}</td>
                <td>{c.sucursal_nombre || '—'}</td>
                <td>{c.turno || '—'}</td>
                <td>{c.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="row-actions">
                  <button className="btn-link" onClick={() => openEdit(c)}>Editar</button>
                  <button className={'btn-link' + (c.activo ? ' danger' : '')} onClick={() => handleToggleEstado(c)}>
                    {c.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="btn-link danger" onClick={() => handleDelete(c.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr><td colSpan={8} className="empty-row">No hay clientes registrados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Editar cliente' : 'Nuevo cliente'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div>
                  <label>Tipo de documento</label>
                  <select value={form.tipo_documento} onChange={(e) => setForm({ ...form, tipo_documento: e.target.value })}>
                    <option value="DNI">DNI</option>
                    <option value="RUC">RUC</option>
                    <option value="CE">Carnet de Extranjería</option>
                  </select>
                </div>
                <div>
                  <label>Número de documento</label>
                  <input required value={form.numero_documento} onChange={(e) => setForm({ ...form, numero_documento: e.target.value })} />
                </div>
              </div>
              <label>Nombre / Razón social{buscandoDoc ? ' — buscando...' : ''}</label>
              <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              <label>Dirección</label>
              <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
              <div className="form-row">
                <div>
                  <label>Teléfono</label>
                  <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
                </div>
                <div>
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Sede</label>
                  <select value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}>
                    <option value="">Sin sede asignada</option>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Turno</label>
                  <input value={form.turno} onChange={(e) => setForm({ ...form, turno: e.target.value })} placeholder="Ej. Mañana, Tarde, Noche..." />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Referencia</label>
                  <input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} placeholder="Ej. Cerca al parque, edificio azul..." />
                </div>
                <div>
                  <label>Contacto</label>
                  <input value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} placeholder="Ej. Persona de contacto adicional" />
                </div>
              </div>
              <label>Notas</label>
              <textarea rows={2} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDuplicadosModal && (
        <div className="modal-overlay" onClick={() => setShowDuplicadosModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>Fusionar clientes duplicados</h2>
            <p style={{ color: '#666', marginTop: -8 }}>
              Se conserva siempre el registro con tipo <strong>CE</strong>. El registro viejo se borra y sus ventas/comprobantes pasan a quedar bajo el registro que se conserva.
            </p>
            <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {duplicados.map((d) => (
                <label key={d.legacy_id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', border: '1px solid #eee', borderRadius: 8, padding: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!seleccionDuplicados[d.legacy_id]}
                    onChange={() => toggleSeleccionDuplicado(d.legacy_id)}
                    style={{ marginTop: 4 }}
                  />
                  <div>
                    <div><strong>{d.ce_nombre}</strong> — Documento {d.numero_documento}</div>
                    <div style={{ fontSize: 13, color: '#666' }}>
                      Se conserva: CE {d.numero_documento} (id {d.ce_id}) · {d.ce_telefono || '—'} · {d.ce_email || '—'}
                    </div>
                    <div style={{ fontSize: 13, color: '#666' }}>
                      Se elimina: {d.legacy_tipo_documento} {d.numero_documento} (id {d.legacy_id}) · {d.legacy_nombre}
                      {(d.legacy_comprobantes + d.legacy_cotizaciones + d.legacy_guias + d.legacy_notas_venta) > 0 && (
                        <> — tiene {d.legacy_comprobantes} comprobante(s), {d.legacy_cotizaciones} cotización(es), {d.legacy_guias} guía(s), {d.legacy_notas_venta} nota(s) de venta que se reasignarán.</>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowDuplicadosModal(false)}>Cancelar</button>
              <button
                type="button"
                className="btn-primary"
                disabled={fusionando || Object.values(seleccionDuplicados).every((v) => !v)}
                onClick={handleFusionarDuplicados}
              >
                {fusionando ? 'Fusionando...' : 'Fusionar seleccionados'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
