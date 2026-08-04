import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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

export default function RolForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams();
  const editingId = id && id !== 'nuevo' ? id : null;

  const [modulos, setModulos] = useState([]);
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [preset, setPreset] = useState('personalizado');
  const [permisos, setPermisos] = useState({});
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
      const mapa = {};
      res.data.permisos.forEach((p) => { mapa[p.modulo] = p.habilitado; });
      setPermisos(mapa);
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
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/roles/${editingId}`, { nombre, descripcion, permisos });
        toast.success('Rol actualizado.');
      } else {
        await api.post('/roles', { nombre, descripcion, permisos });
        toast.success('Rol creado. Ya puedes asignarlo a un empleado.');
      }
      navigate('/configuracion');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar el rol.');
    } finally {
      setSaving(false);
    }
  }

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
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Módulos a los que este rol puede acceder.</p>
          </div>
          <div className="panel">
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {modulos.map((m) => (
                <div key={m.key} className="role-permiso-row">
                  <span>{m.label}</span>
                  <button
                    type="button"
                    className={'toggle-switch' + (permisos[m.key] ? ' on' : '')}
                    onClick={() => toggleModulo(m.key)}
                    aria-pressed={!!permisos[m.key]}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              ))}
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
