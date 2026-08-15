import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const PRESETS = {
  personalizado: null,
  vendedor: ['ventas', 'clientes', 'inventario'],
  cajero: ['ventas', 'caja'],
  supervisor: ['dashboard', 'ventas', 'compras', 'inventario', 'clientes', 'caja', 'reportes'],
};

const PRESET_LABELS = {
  personalizado: 'Personalizado',
  vendedor: 'Vendedor',
  cajero: 'Cajero',
  supervisor: 'Supervisor',
};

function agruparAcciones(acciones) {
  const grupos = [];
  const porNombre = {};
  (acciones || []).forEach((a) => {
    const nombre = a.grupo || 'General';
    if (!porNombre[nombre]) {
      porNombre[nombre] = { nombre, items: [] };
      grupos.push(porNombre[nombre]);
    }
    porNombre[nombre].items.push(a);
  });
  return grupos;
}

export default function RolForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams();
  const editingId = id && id !== 'nuevo' ? id : null;

  const [modulos, setModulos] = useState([]);
  const [moduloSeleccionado, setModuloSeleccionado] = useState('ventas');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [preset, setPreset] = useState('personalizado');
  const [permisos, setPermisos] = useState({});
  const [acciones, setAcciones] = useState({}); // { [modulo]: { [accion]: boolean } }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/roles/modulos').then((res) => {
      setModulos(res.data);
      if (!editingId) {
        const inicial = {};
        res.data.forEach((m) => { inicial[m.key] = false; });
        setPermisos(inicial);
      }
    });
  }, []);

  useEffect(() => {
    if (!editingId) return;
    api.get(`/roles/${editingId}`).then((res) => {
      setNombre(res.data.nombre);
      setDescripcion(res.data.descripcion || '');
      const mapaPermisos = {};
      const mapaAcciones = {};
      res.data.permisos.forEach((p) => {
        mapaPermisos[p.modulo] = p.habilitado;
        mapaAcciones[p.modulo] = {};
        (p.acciones || []).forEach((a) => { mapaAcciones[p.modulo][a.accion] = a.habilitado; });
      });
      setPermisos(mapaPermisos);
      setAcciones(mapaAcciones);
    });
  }, [editingId]);

  if (!user || user.role !== 'gerencia') {
    return (
      <div className="panel">
        <h3>Acceso restringido</h3>
        <p className="empty-row">Solo un usuario de Gerencia puede administrar roles.</p>
        <button className="btn-secondary" onClick={() => navigate('/menu')}>Volver al menú</button>
      </div>
    );
  }

  function aplicarPreset(key) {
    setPreset(key);
    const modulosPreset = PRESETS[key];
    if (!modulosPreset) return; // "Personalizado": deja los toggles como están
    const nuevo = {};
    modulos.forEach((m) => { nuevo[m.key] = modulosPreset.includes(m.key); });
    setPermisos(nuevo);
  }

  function toggleModulo(key) {
    setPreset('personalizado');
    setPermisos((prev) => ({ ...prev, [key]: !prev[key] }));
    setModuloSeleccionado(key);
  }

  function accionesDelModulo(moduloKey) {
    const modulo = modulos.find((m) => m.key === moduloKey);
    if (!modulo) return {};
    const guardadas = acciones[moduloKey] || {};
    const mapa = {};
    (modulo.acciones || []).forEach((a) => { mapa[a.key] = guardadas[a.key] ?? (a.default !== false); });
    return mapa;
  }

  function toggleAccion(moduloKey, accionKey) {
    setAcciones((prev) => {
      const modulo = modulos.find((m) => m.key === moduloKey);
      const base = {};
      (modulo?.acciones || []).forEach((a) => { base[a.key] = a.default !== false; });
      const actuales = { ...base, ...(prev[moduloKey] || {}) };
      return { ...prev, [moduloKey]: { ...actuales, [accionKey]: !actuales[accionKey] } };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { nombre, descripcion, permisos, acciones };
      if (editingId) {
        await api.put(`/roles/${editingId}`, payload);
        toast.success('Rol actualizado.');
      } else {
        await api.post('/roles', payload);
        toast.success('Rol creado. Ya puedes asignarlo a un empleado.');
      }
      navigate('/configuracion');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar el rol.');
    } finally {
      setSaving(false);
    }
  }

  const moduloActivo = modulos.find((m) => m.key === moduloSeleccionado);
  const grupos = agruparAcciones(moduloActivo?.acciones);

  return (
    <div>
      <button className="icon-link" onClick={() => navigate('/configuracion')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <ArrowLeft size={16} /> Regresar
      </button>
      <h1 className="page-title">{editingId ? 'Editar rol' : 'Nuevo rol'}</h1>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, marginTop: 20 }}>
          <div>
            <h4 style={{ margin: 0 }}>Datos básicos</h4>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Nombre y descripción del rol.</p>
          </div>
          <div className="panel">
            <label>Nombre *</label>
            <input required value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <label>Descripción (Opcional)</label>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </div>

          <div>
            <h4 style={{ margin: 0 }}>Permisos de usuarios</h4>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Módulos a los que este rol puede acceder. Al activar un módulo, elige qué acciones específicas puede hacer dentro de él.
            </p>
          </div>
          <div>
            <label>Permisos predefinidos</label>
            <select value={preset} onChange={(e) => aplicarPreset(e.target.value)} style={{ maxWidth: 260 }}>
              {Object.keys(PRESETS).map((key) => (
                <option key={key} value={key}>{PRESET_LABELS[key]}</option>
              ))}
            </select>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 16 }}>
              {preset === 'personalizado'
                ? 'Con esta opción puedes personalizar los permisos manualmente.'
                : 'Puedes seguir ajustando los toggles; al tocar uno pasa a "Personalizado".'}
            </p>

            <div className="rol-modulos-shell">
              <div className="rol-modulos-list">
                {modulos.map((m) => (
                  <div
                    key={m.key}
                    className={'rol-modulo-row' + (moduloSeleccionado === m.key ? ' active' : '')}
                    onClick={() => setModuloSeleccionado(m.key)}
                  >
                    <span>{m.label}</span>
                    <button
                      type="button"
                      className={'toggle-switch' + (permisos[m.key] ? ' on' : '')}
                      onClick={(e) => { e.stopPropagation(); toggleModulo(m.key); }}
                      aria-pressed={!!permisos[m.key]}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="rol-acciones-panel">
                {moduloActivo && (
                  <div className="rol-acciones-panel-header">
                    <h4>{moduloActivo.label}</h4>
                    <button
                      type="button"
                      className={'toggle-switch' + (permisos[moduloActivo.key] ? ' on' : '')}
                      onClick={() => toggleModulo(moduloActivo.key)}
                      aria-pressed={!!permisos[moduloActivo.key]}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>
                )}

                {!moduloActivo && <p className="rol-acciones-empty">Selecciona un módulo a la izquierda.</p>}

                {moduloActivo && !permisos[moduloActivo.key] && (
                  <p className="rol-acciones-empty">Activa este módulo para elegir qué acciones puede hacer este rol dentro de él.</p>
                )}

                {moduloActivo && permisos[moduloActivo.key] && grupos.length === 0 && (
                  <p className="rol-acciones-empty">Este módulo no tiene acciones configurables — el acceso es todo o nada.</p>
                )}

                {moduloActivo && permisos[moduloActivo.key] && grupos.map((grupo) => {
                  const valores = accionesDelModulo(moduloActivo.key);
                  return (
                    <div key={grupo.nombre}>
                      <div className="rol-acciones-grupo-titulo">{grupo.nombre}</div>
                      {grupo.items.map((a) => {
                        const on = valores[a.key];
                        return (
                          <div key={a.key} className={'rol-accion-row' + (on ? '' : ' off')}>
                            <span className="rol-accion-label">
                              <CheckCircle2 size={15} className="rol-accion-check" />
                              {a.label}
                            </span>
                            <button
                              type="button"
                              className={'toggle-switch small' + (on ? ' on' : '')}
                              onClick={() => toggleAccion(moduloActivo.key, a.key)}
                              aria-pressed={!!on}
                            >
                              <span className="toggle-knob" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {error && <div className="form-error" style={{ marginTop: 16 }}>{error}</div>}

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn-secondary" onClick={() => navigate('/configuracion')}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Guardar rol')}</button>
        </div>
      </form>
    </div>
  );
}
