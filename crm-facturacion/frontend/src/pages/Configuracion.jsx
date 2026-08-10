import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Users as UsersIcon, Store, ShieldCheck, FileText, Wallet, Hash } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const DEPARTAMENTOS_PERU = [
  'Amazonas', 'Áncash', 'Apurímac', 'Arequipa', 'Ayacucho', 'Cajamarca', 'Callao', 'Cusco',
  'Huancavelica', 'Huánuco', 'Ica', 'Junín', 'La Libertad', 'Lambayeque', 'Lima', 'Loreto',
  'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martín', 'Tacna', 'Tumbes', 'Ucayali',
];

const PASSWORD_PREDETERMINADA = 'Lima2026*';

function emptyUserForm() {
  return { username: '', password: PASSWORD_PREDETERMINADA, nombres: '', apellidos: '', email: '', telefono: '', dni: '', role: 'vendedor', sucursal_id: '', custom_role_id: '' };
}

function emptySucursalForm() {
  return { nombre: '', direccion: '' };
}

const TIPOS_METODO_PAGO = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'billetera', label: 'Billetera digital' },
  { value: 'pos', label: 'Tarjeta / POS' },
  { value: 'transferencia', label: 'Transferencia bancaria' },
  { value: 'link', label: 'Link de pago' },
  { value: 'otro', label: 'Otro' },
];

const ICONOS_SUGERIDOS = ['💵', '📲', '📱', '💳', '🏦', '🔗', '🔖', '💰', '🧾', '⭐'];

function emptyMetodoForm() {
  return { nombre: '', tipo: 'otro', color: '#0f4c81', icono: '💳', qr_data_url: '', link_pago: '' };
}

const DOC_LABELS = {
  factura: 'Factura Electrónica',
  boleta: 'Boleta Electrónica',
  nota_credito: 'Nota de Crédito',
  cotizacion: 'Cotización',
  guia_remitente: 'Guía Remitente',
  orden_compra: 'Orden de Compra',
  orden_servicio: 'Orden de Servicio',
};

// Cómo se reparte la tabla de "Series y correlativos" en columnas, igual que
// la pantalla de referencia: Ventas en dos columnas lado a lado, Compras aparte.
const SERIES_VENTAS_COL1 = ['factura', 'nota_credito', 'guia_remitente'];
const SERIES_VENTAS_COL2 = ['boleta', 'cotizacion'];
const SERIES_COMPRAS = ['orden_compra', 'orden_servicio'];

function SerieTable({ tipos, series, updateSerieField }) {
  const filas = tipos.map((t) => series.find((s) => s.tipo_documento === t)).filter(Boolean);
  return (
    <table className="data-table">
      <thead>
        <tr><th>Documento</th><th>Serie</th><th>Correlativo</th></tr>
      </thead>
      <tbody>
        {filas.map((s) => (
          <tr key={s.tipo_documento}>
            <td>{DOC_LABELS[s.tipo_documento] || s.tipo_documento}</td>
            <td>
              <input value={s.serie} maxLength={10}
                onChange={(e) => updateSerieField(s.tipo_documento, { serie: e.target.value.toUpperCase() })}
                style={{ width: 90 }} />
            </td>
            <td>
              <input type="number" min="1" value={s.siguiente_numero}
                onChange={(e) => updateSerieField(s.tipo_documento, { siguiente_numero: e.target.value })}
                style={{ width: 100 }} />
            </td>
          </tr>
        ))}
        {filas.length === 0 && (
          <tr><td colSpan={3} className="empty-row">Cargando series...</td></tr>
        )}
      </tbody>
    </table>
  );
}

export default function Configuracion() {
  const { user, refreshEmpresa, sucursal: sucursalActiva, setSucursal: setSucursalActiva } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [seccion, setSeccion] = useState('empresa');

  // --- Datos de la empresa ---
  const [empresa, setEmpresa] = useState(null);
  const [errorEmpresa, setErrorEmpresa] = useState('');
  const [savingEmpresa, setSavingEmpresa] = useState(false);

  // --- Comprobantes (diseño del PDF) ---
  const [errorComprobantes, setErrorComprobantes] = useState('');
  const [savingComprobantes, setSavingComprobantes] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const previewUrlRef = useRef(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // --- Empleados ---
  const [usuarios, setUsuarios] = useState([]);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyUserForm());
  const [errorForm, setErrorForm] = useState('');

  // --- Sucursales ---
  const [sucursales, setSucursales] = useState([]);
  const [limiteSucursales, setLimiteSucursales] = useState(null);
  const [showSucursalForm, setShowSucursalForm] = useState(false);
  const [editingSucursalId, setEditingSucursalId] = useState(null);
  const [sucursalForm, setSucursalForm] = useState(emptySucursalForm());
  const [errorSucursal, setErrorSucursal] = useState('');

  // --- Roles de usuario ---
  const [roles, setRoles] = useState([]);

  // --- Métodos de pago ---
  const [metodosPago, setMetodosPago] = useState([]);
  const [showMetodoForm, setShowMetodoForm] = useState(false);
  const [editingMetodoId, setEditingMetodoId] = useState(null);
  const [metodoForm, setMetodoForm] = useState(emptyMetodoForm());
  const [errorMetodo, setErrorMetodo] = useState('');

  // --- Series y Sucursal ---
  const [series, setSeries] = useState([]);
  const [errorSeries, setErrorSeries] = useState('');
  const [savingSeriesVentas, setSavingSeriesVentas] = useState(false);
  const [savingSeriesCompras, setSavingSeriesCompras] = useState(false);
  const [direccionPrincipal, setDireccionPrincipal] = useState('');
  const [savingDireccion, setSavingDireccion] = useState(false);
  const [sucursalSeleccionadaId, setSucursalSeleccionadaId] = useState('');
  const [sucursalEditNombre, setSucursalEditNombre] = useState('');
  const [sucursalEditDireccion, setSucursalEditDireccion] = useState('');
  const [savingSucursalSerie, setSavingSucursalSerie] = useState(false);
  const [igvPct, setIgvPct] = useState(18);
  const [savingIgv, setSavingIgv] = useState(false);

  useEffect(() => {
    api.get('/empresa').then((res) => setEmpresa(res.data));
    loadUsuarios();
    loadSucursales();
    loadLimiteSucursales();
    loadRoles();
    loadMetodosPago();
  }, []);

  useEffect(() => {
    if (!empresa) return;
    setDireccionPrincipal(empresa.direccion_fiscal || '');
    setIgvPct(empresa.igv_rate ? Math.round(Number(empresa.igv_rate) * 1000) / 10 : 18);
  }, [empresa]);

  useEffect(() => {
    if (sucursales.length && !sucursalSeleccionadaId) {
      const principal = sucursales.find((s) => s.es_principal) || sucursales[0];
      setSucursalSeleccionadaId(String(principal.id));
    }
  }, [sucursales, sucursalSeleccionadaId]);

  useEffect(() => {
    const s = sucursales.find((x) => String(x.id) === String(sucursalSeleccionadaId));
    if (s) {
      setSucursalEditNombre(s.nombre);
      setSucursalEditDireccion(s.direccion || '');
    }
  }, [sucursalSeleccionadaId, sucursales]);

  // Las series son por sede (SUNAT exige una serie distinta por punto de
  // emisión) — cada vez que se cambia la sede seleccionada arriba, se
  // recargan sus propias series.
  useEffect(() => {
    if (sucursalSeleccionadaId) loadSeries(sucursalSeleccionadaId);
  }, [sucursalSeleccionadaId]);

  function loadUsuarios() {
    const params = {};
    if (q) params.q = q;
    api.get('/users', { params }).then((res) => setUsuarios(res.data));
  }

  function loadSucursales() {
    api.get('/sucursales', { params: { todas: 1 } }).then((res) => setSucursales(res.data));
  }

  function loadLimiteSucursales() {
    api.get('/sucursales/limite').then((res) => setLimiteSucursales(res.data));
  }

  function loadRoles() {
    api.get('/roles').then((res) => setRoles(res.data));
  }

  function loadMetodosPago() {
    api.get('/metodos-pago', { params: { todos: 1 } }).then((res) => setMetodosPago(res.data));
  }

  function loadSeries(sucursalId) {
    // El correlativo editable arranca en el número real que se va a usar
    // (ya combinado con lo que se emitió), no en el valor crudo guardado —
    // así el admin ve y edita el número que de verdad importa.
    api.get('/series', { params: { sucursal_id: sucursalId } })
      .then((res) => setSeries(res.data.map((s) => ({ ...s, siguiente_numero: s.siguiente_numero_real }))));
  }

  async function handleModificarDireccion() {
    setErrorSeries('');
    setSavingDireccion(true);
    try {
      const res = await api.put('/empresa/direccion', { direccion_fiscal: direccionPrincipal });
      setEmpresa(res.data);
      refreshEmpresa();
      toast.success('Dirección principal actualizada.');
    } catch (err) {
      setErrorSeries(err.response?.data?.error || 'No se pudo actualizar la dirección.');
    } finally {
      setSavingDireccion(false);
    }
  }

  async function handleModificarSucursalSerie() {
    if (!sucursalSeleccionadaId) return;
    setErrorSeries('');
    setSavingSucursalSerie(true);
    try {
      await api.put(`/sucursales/${sucursalSeleccionadaId}`, { nombre: sucursalEditNombre, direccion: sucursalEditDireccion });
      await loadSucursales();
      // Si la sede que se acaba de renombrar es la sede activa de esta sesión,
      // el encabezado (que guarda el nombre por separado) también se actualiza.
      if (sucursalActiva && String(sucursalActiva.id) === String(sucursalSeleccionadaId)) {
        setSucursalActiva(sucursalSeleccionadaId, sucursalEditNombre);
      }
      toast.success('Nombre y dirección de la sede actualizados.');
    } catch (err) {
      setErrorSeries(err.response?.data?.error || 'No se pudo actualizar la sede.');
    } finally {
      setSavingSucursalSerie(false);
    }
  }

  async function handleModificarIgv() {
    setErrorSeries('');
    setSavingIgv(true);
    try {
      const res = await api.put('/empresa/igv-rate', { igv_rate_pct: Number(igvPct) });
      setEmpresa(res.data);
      refreshEmpresa();
      toast.success('Tasa de IGV actualizada.');
    } catch (err) {
      setErrorSeries(err.response?.data?.error || 'No se pudo actualizar la tasa de IGV.');
    } finally {
      setSavingIgv(false);
    }
  }

  function updateSerieField(tipo, patch) {
    setSeries((prev) => prev.map((s) => (s.tipo_documento === tipo ? { ...s, ...patch } : s)));
  }

  async function handleModificarSeries(tipos, setSaving) {
    if (!sucursalSeleccionadaId) return;
    setErrorSeries('');
    setSaving(true);
    try {
      const payload = series
        .filter((s) => tipos.includes(s.tipo_documento))
        .map((s) => ({ tipo_documento: s.tipo_documento, serie: s.serie, siguiente_numero: s.siguiente_numero }));
      const res = await api.put('/series', { sucursal_id: sucursalSeleccionadaId, series: payload });
      setSeries(res.data.map((s) => ({ ...s, siguiente_numero: s.siguiente_numero_real })));
      toast.success('Series actualizadas.');
    } catch (err) {
      setErrorSeries(err.response?.data?.error || 'No se pudieron actualizar las series.');
    } finally {
      setSaving(false);
    }
  }

  if (!user || user.role !== 'gerencia') {
    return (
      <div className="panel">
        <h3>Acceso restringido</h3>
        <p className="empty-row">Solo un usuario de Gerencia puede acceder a Configuración.</p>
        <button className="btn-secondary" onClick={() => navigate('/menu')}>Volver al menú</button>
      </div>
    );
  }

  async function handleGuardarEmpresa(e) {
    e.preventDefault();
    setErrorEmpresa('');
    setSavingEmpresa(true);
    try {
      const res = await api.put('/empresa', empresa);
      setEmpresa(res.data);
      refreshEmpresa();
      toast.success('Datos de la empresa actualizados. Ya aparecen en el encabezado y en los comprobantes.');
    } catch (err) {
      setErrorEmpresa(err.response?.data?.error || 'No se pudo guardar.');
    } finally {
      setSavingEmpresa(false);
    }
  }

  async function handleGuardarComprobantes(e) {
    e.preventDefault();
    setErrorComprobantes('');
    setSavingComprobantes(true);
    try {
      const res = await api.put('/empresa', empresa);
      setEmpresa(res.data);
      refreshEmpresa();
      toast.success('Diseño del comprobante actualizado.');
      loadPreview();
    } catch (err) {
      setErrorComprobantes(err.response?.data?.error || 'No se pudo guardar.');
    } finally {
      setSavingComprobantes(false);
    }
  }

  function loadPreview() {
    setLoadingPreview(true);
    api.get('/empresa/comprobante-preview', { responseType: 'blob' })
      .then((res) => {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(res.data);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      })
      .finally(() => setLoadingPreview(false));
  }

  useEffect(() => {
    if (seccion === 'comprobantes' && !previewUrl) loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccion]);

  useEffect(() => {
    return () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); };
  }, []);

  function handleLogoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.3 * 1024 * 1024) {
      toast.error('La imagen es muy pesada. Usa una de menos de 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEmpresa({ ...empresa, logo_data_url: reader.result });
    reader.readAsDataURL(file);
  }

  function openNewUser() {
    setEditingId(null);
    setForm(emptyUserForm());
    setErrorForm('');
    setShowForm(true);
  }

  function openEditUser(u) {
    setEditingId(u.id);
    setForm({
      username: u.username, password: '', nombres: u.nombres || '', apellidos: u.apellidos || '',
      email: u.email || '', telefono: u.telefono || '', dni: u.dni || '', role: u.role,
      sucursal_id: u.sucursal_id || '', custom_role_id: u.custom_role_id || '',
    });
    setErrorForm('');
    setShowForm(true);
  }

  async function handleSubmitUser(e) {
    e.preventDefault();
    setErrorForm('');
    const payloadComun = {
      nombres: form.nombres, apellidos: form.apellidos, email: form.email || null, telefono: form.telefono || null,
      dni: form.dni, role: form.role, sucursal_id: form.sucursal_id || null, custom_role_id: form.custom_role_id || null,
    };
    try {
      if (editingId) {
        const payload = { ...payloadComun };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${editingId}`, payload);
        toast.success('Empleado actualizado.');
      } else {
        await api.post('/users', { ...payloadComun, username: form.username, password: form.password });
        toast.success('Empleado creado. Ya puede iniciar sesión con esas credenciales.');
      }
      setShowForm(false);
      loadUsuarios();
    } catch (err) {
      setErrorForm(err.response?.data?.error || 'No se pudo guardar el empleado.');
    }
  }

  async function handleToggleEstado(u) {
    const accion = u.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} a ${u.full_name}?`)) return;
    try {
      await api.put(`/users/${u.id}/estado`, { activo: !u.activo });
      toast.success(`Empleado ${u.activo ? 'desactivado' : 'activado'}.`);
      loadUsuarios();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  async function handleRestablecerContrasena(u) {
    if (!window.confirm(`¿Restablecer la contraseña de ${u.full_name} a la predeterminada (${PASSWORD_PREDETERMINADA})?`)) return;
    try {
      await api.put(`/users/${u.id}`, { password: PASSWORD_PREDETERMINADA });
      toast.success(`Contraseña de ${u.full_name} restablecida a ${PASSWORD_PREDETERMINADA}.`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo restablecer la contraseña.');
    }
  }

  function exportarEmpleadosCsv() {
    const header = ['Nombres', 'Apellidos', 'Rol', 'Sede', 'DNI', 'Correo', 'Teléfono', 'Estado'];
    const rows = usuarios.map((u) => [
      u.nombres || '', u.apellidos || '',
      u.role === 'gerencia' ? 'Gerencia' : (u.rol_personalizado_nombre || 'Sin rol asignado'),
      u.sucursal_nombre || 'Todas las sedes',
      u.dni || '', u.email || '', u.telefono || '', u.activo ? 'Habilitado' : 'Deshabilitado',
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'empleados.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openNewSucursal() {
    setEditingSucursalId(null);
    setSucursalForm(emptySucursalForm());
    setErrorSucursal('');
    setShowSucursalForm(true);
  }

  function openEditSucursal(s) {
    setEditingSucursalId(s.id);
    setSucursalForm({ nombre: s.nombre, direccion: s.direccion || '' });
    setErrorSucursal('');
    setShowSucursalForm(true);
  }

  async function handleSubmitSucursal(e) {
    e.preventDefault();
    setErrorSucursal('');
    try {
      if (editingSucursalId) {
        await api.put(`/sucursales/${editingSucursalId}`, sucursalForm);
        toast.success('Sede actualizada.');
      } else {
        await api.post('/sucursales', sucursalForm);
        toast.success('Sede creada.');
      }
      setShowSucursalForm(false);
      loadSucursales();
      loadLimiteSucursales();
    } catch (err) {
      setErrorSucursal(err.response?.data?.error || 'No se pudo guardar la sede.');
    }
  }

  async function handleToggleSucursalEstado(s) {
    const accion = s.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} la sede "${s.nombre}"?`)) return;
    try {
      await api.put(`/sucursales/${s.id}/estado`, { activo: !s.activo });
      toast.success(`Sede ${s.activo ? 'desactivada' : 'activada'}.`);
      loadSucursales();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  async function handleToggleRoleEstado(r) {
    const accion = r.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} el rol "${r.nombre}"?`)) return;
    try {
      await api.put(`/roles/${r.id}/estado`, { activo: !r.activo });
      toast.success(`Rol ${r.activo ? 'desactivado' : 'activado'}.`);
      loadRoles();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  function openNewMetodo() {
    setEditingMetodoId(null);
    setMetodoForm(emptyMetodoForm());
    setErrorMetodo('');
    setShowMetodoForm(true);
  }

  function openEditMetodo(m) {
    setEditingMetodoId(m.id);
    setMetodoForm({ nombre: m.nombre, tipo: m.tipo, color: m.color, icono: m.icono, qr_data_url: m.qr_data_url || '', link_pago: m.link_pago || '' });
    setErrorMetodo('');
    setShowMetodoForm(true);
  }

  function handleMetodoQrChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.3 * 1024 * 1024) {
      toast.error('La imagen es muy pesada. Usa una de menos de 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setMetodoForm((prev) => ({ ...prev, qr_data_url: reader.result }));
    reader.readAsDataURL(file);
  }

  async function handleSubmitMetodo(e) {
    e.preventDefault();
    setErrorMetodo('');
    try {
      if (editingMetodoId) {
        await api.put(`/metodos-pago/${editingMetodoId}`, metodoForm);
        toast.success('Método de pago actualizado.');
      } else {
        await api.post('/metodos-pago', metodoForm);
        toast.success('Método de pago creado.');
      }
      setShowMetodoForm(false);
      loadMetodosPago();
    } catch (err) {
      setErrorMetodo(err.response?.data?.error || 'No se pudo guardar el método de pago.');
    }
  }

  async function handleToggleMetodoEstado(m) {
    const accion = m.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} "${m.nombre}"?`)) return;
    try {
      await api.put(`/metodos-pago/${m.id}/estado`, { activo: !m.activo });
      toast.success(`"${m.nombre}" ${m.activo ? 'desactivado' : 'activado'}.`);
      loadMetodosPago();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver al menú" onClick={() => navigate('/menu')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CONFIGURACIÓN
      </h1>

      <div className="reports-shell">
        <div className="reports-sidebar">
          <div className={'reports-sidebar-item' + (seccion === 'empresa' ? ' active' : '')} onClick={() => setSeccion('empresa')} role="button" tabIndex={0}>
            <Building2 size={16} /><span>Empresa</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'comprobantes' ? ' active' : '')} onClick={() => setSeccion('comprobantes')} role="button" tabIndex={0}>
            <FileText size={16} /><span>Comprobantes</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'sucursales' ? ' active' : '')} onClick={() => setSeccion('sucursales')} role="button" tabIndex={0}>
            <Store size={16} /><span>Sucursales</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'series' ? ' active' : '')} onClick={() => setSeccion('series')} role="button" tabIndex={0}>
            <Hash size={16} /><span>Series y Sucursal</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'empleados' ? ' active' : '')} onClick={() => setSeccion('empleados')} role="button" tabIndex={0}>
            <UsersIcon size={16} /><span>Empleados</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'roles' ? ' active' : '')} onClick={() => setSeccion('roles')} role="button" tabIndex={0}>
            <ShieldCheck size={16} /><span>Roles de usuario</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'metodos_pago' ? ' active' : '')} onClick={() => setSeccion('metodos_pago')} role="button" tabIndex={0}>
            <Wallet size={16} /><span>Métodos de pago</span>
          </div>
        </div>

        <div className="reports-content">
          {seccion === 'empresa' && empresa && (
            <>
              <h3 style={{ marginTop: 0 }}>Información de tu empresa</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Estos datos aparecen como emisor en el encabezado de la app y en los comprobantes (PDF). Son los datos
                legales del negocio que usa este CRM — deben coincidir con los registrados ante SUNAT.
              </p>
              <form onSubmit={handleGuardarEmpresa} style={{ maxWidth: 560 }}>
                <label>Nombre de mi empresa *</label>
                <input required value={empresa.razon_social || ''} onChange={(e) => setEmpresa({ ...empresa, razon_social: e.target.value })} />
                <label>RUC * (11 dígitos)</label>
                <input required value={empresa.ruc || ''} onChange={(e) => setEmpresa({ ...empresa, ruc: e.target.value })} maxLength={11} />
                <label>Nombre Comercial</label>
                <input value={empresa.nombre_comercial || ''} onChange={(e) => setEmpresa({ ...empresa, nombre_comercial: e.target.value })} placeholder="Si es distinto al Nombre de mi empresa" />

                <div className="form-row">
                  <div>
                    <label>Actividad económica (CIIU)</label>
                    <input value={empresa.actividad_ciiu || ''} onChange={(e) => setEmpresa({ ...empresa, actividad_ciiu: e.target.value })} placeholder="Código/descripción según tu ficha RUC" />
                  </div>
                  <div>
                    <label>Actividad comercial (MCC)</label>
                    <input value={empresa.actividad_mcc || ''} onChange={(e) => setEmpresa({ ...empresa, actividad_mcc: e.target.value })} placeholder="Opcional" />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -10 }}>
                  Texto libre: escribe el código/descripción tal como aparece en tu ficha RUC (no validamos contra el catálogo oficial de SUNAT).
                </p>

                <div className="form-row">
                  <div>
                    <label>Departamento *</label>
                    <select required value={empresa.departamento || ''} onChange={(e) => setEmpresa({ ...empresa, departamento: e.target.value })}>
                      <option value="">Selecciona un departamento</option>
                      {DEPARTAMENTOS_PERU.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Provincia *</label>
                    <input required value={empresa.provincia || ''} onChange={(e) => setEmpresa({ ...empresa, provincia: e.target.value })} />
                  </div>
                  <div>
                    <label>Distrito *</label>
                    <input required value={empresa.distrito || ''} onChange={(e) => setEmpresa({ ...empresa, distrito: e.target.value })} />
                  </div>
                </div>
                <label>Dirección de facturación *</label>
                <input required value={empresa.direccion_fiscal || ''} onChange={(e) => setEmpresa({ ...empresa, direccion_fiscal: e.target.value })} />
                <div className="form-row">
                  <div>
                    <label>Teléfono</label>
                    <input value={empresa.telefono || ''} onChange={(e) => setEmpresa({ ...empresa, telefono: e.target.value })} />
                  </div>
                  <div>
                    <label>Email</label>
                    <input value={empresa.email || ''} onChange={(e) => setEmpresa({ ...empresa, email: e.target.value })} />
                  </div>
                </div>
                {errorEmpresa && <div className="form-error">{errorEmpresa}</div>}
                <button type="submit" className="btn-primary" style={{ width: 'auto', marginTop: 16 }} disabled={savingEmpresa}>
                  {savingEmpresa ? 'Guardando…' : 'Guardar'}
                </button>
              </form>

              <div className="panel" style={{ maxWidth: 560, marginTop: 20 }}>
                <h3 style={{ marginTop: 0 }}>Logotipo de tu empresa</h3>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Medidas recomendadas: 320 px de ancho x 160 px de alto, en formato .PNG o .JPG.</p>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{ width: 160, height: 90, border: '1px dashed var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface)' }}>
                    {empresa.logo_data_url ? (
                      <img src={empresa.logo_data_url} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Sin logo</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="btn-secondary" style={{ width: 'auto', textAlign: 'center', cursor: 'pointer' }}>
                      Subir logo
                      <input type="file" accept="image/png,image/jpeg" onChange={handleLogoChange} style={{ display: 'none' }} />
                    </label>
                    {empresa.logo_data_url && (
                      <button type="button" className="btn-secondary" onClick={async () => {
                        const res = await api.put('/empresa', { ...empresa, logo_data_url: null });
                        setEmpresa(res.data);
                        refreshEmpresa();
                        toast.success('Logo eliminado.');
                      }}>Quitar logo</button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {seccion === 'comprobantes' && empresa && (
            <>
              <h3 style={{ marginTop: 0 }}>Diseño de comprobantes</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Personaliza cómo se ven las facturas, boletas, notas de crédito, cotizaciones y guías en PDF. La vista
                previa de la derecha usa un comprobante de ejemplo con los ajustes actuales.
              </p>
              {(!empresa.razon_social || !empresa.ruc) ? (
                <p className="form-error">
                  Antes de personalizar el comprobante, completa el RUC de tu empresa en la pestaña{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); setSeccion('empresa'); }}>Empresa</a> — se imprime en cada comprobante.
                </p>
              ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, alignItems: 'flex-start' }}>
                <form onSubmit={handleGuardarComprobantes}>
                  <label>Color de acento</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="color"
                      value={empresa.color_acento || '#0f4c81'}
                      onChange={(e) => setEmpresa({ ...empresa, color_acento: e.target.value })}
                      style={{ width: 44, height: 34, padding: 2, cursor: 'pointer' }}
                    />
                    <input
                      value={empresa.color_acento || '#0f4c81'}
                      onChange={(e) => setEmpresa({ ...empresa, color_acento: e.target.value })}
                      style={{ maxWidth: 120 }}
                    />
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -6 }}>
                    Se usa en los títulos, el recuadro del tipo de comprobante y los totales del PDF.
                  </p>

                  <label>Tamaño de papel</label>
                  <select value={empresa.tamano_pdf || 'A4'} onChange={(e) => setEmpresa({ ...empresa, tamano_pdf: e.target.value })} style={{ maxWidth: 260 }}>
                    <option value="A4">Hoja A4</option>
                    <option value="ticket_80mm">Ticket / rollo térmico (80mm)</option>
                  </select>

                  <div className="role-permiso-row" style={{ marginTop: 16 }}>
                    <span>Mostrar el logo de la empresa en el PDF</span>
                    <button
                      type="button"
                      className={'toggle-switch' + (empresa.mostrar_logo_pdf ? ' on' : '')}
                      onClick={() => setEmpresa({ ...empresa, mostrar_logo_pdf: empresa.mostrar_logo_pdf ? 0 : 1 })}
                      aria-pressed={!!empresa.mostrar_logo_pdf}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>
                  {!empresa.logo_data_url && (
                    <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -6 }}>
                      Todavía no subiste un logo — hazlo en la pestaña "Empresa" para que aparezca aquí.
                    </p>
                  )}
                  <div className="role-permiso-row">
                    <span>Mostrar teléfono / email en el encabezado</span>
                    <button
                      type="button"
                      className={'toggle-switch' + (empresa.mostrar_datos_contacto_pdf ? ' on' : '')}
                      onClick={() => setEmpresa({ ...empresa, mostrar_datos_contacto_pdf: empresa.mostrar_datos_contacto_pdf ? 0 : 1 })}
                      aria-pressed={!!empresa.mostrar_datos_contacto_pdf}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>

                  <label style={{ marginTop: 16 }}>Términos y condiciones / pie de página</label>
                  <textarea
                    rows={3}
                    placeholder="Ej. Cambios y devoluciones solo con comprobante, dentro de los 7 días."
                    value={empresa.terminos_condiciones_pdf || ''}
                    onChange={(e) => setEmpresa({ ...empresa, terminos_condiciones_pdf: e.target.value })}
                  />

                  {errorComprobantes && <div className="form-error">{errorComprobantes}</div>}
                  <button type="submit" className="btn-primary" style={{ width: 'auto', marginTop: 16 }} disabled={savingComprobantes}>
                    {savingComprobantes ? 'Guardando…' : 'Guardar'}
                  </button>
                </form>

                <div className="panel" style={{ padding: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 10px' }}>
                    <strong style={{ fontSize: 12 }}>Vista previa</strong>
                    <button type="button" className="btn-link" onClick={loadPreview} disabled={loadingPreview}>
                      {loadingPreview ? 'Actualizando…' : 'Actualizar vista previa'}
                    </button>
                  </div>
                  {previewUrl ? (
                    <iframe title="Vista previa del comprobante" src={previewUrl} style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
                  ) : (
                    <p className="empty-row">Generando vista previa…</p>
                  )}
                </div>
              </div>
              )}
            </>
          )}

          {seccion === 'sucursales' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Sucursales</h3>
                <button
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  onClick={openNewSucursal}
                  disabled={limiteSucursales?.max != null && limiteSucursales.actual >= limiteSucursales.max}
                  title={limiteSucursales?.max != null && limiteSucursales.actual >= limiteSucursales.max
                    ? `Llegaste al máximo de sedes de tu plan (${limiteSucursales.max}).`
                    : undefined}
                >
                  + Nueva sede
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Cada sede tiene su propio stock, ventas, compras y caja — como negocios independientes bajo la misma
                empresa. Al iniciar sesión, quien tenga acceso a más de una elige con cuál trabajar.
                {limiteSucursales?.max != null && (
                  <> Tu plan permite hasta <strong>{limiteSucursales.max}</strong> sede(s) — llevas usadas{' '}
                    <strong>{limiteSucursales.actual}</strong> de {limiteSucursales.max}.</>
                )}
              </p>
              {limiteSucursales?.max != null && limiteSucursales.actual >= limiteSucursales.max && (
                <p style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: -6 }}>
                  Llegaste al máximo de sedes de tu plan. Contacta a tu proveedor para ampliarlo.
                </p>
              )}
              <table className="data-table">
                <thead>
                  <tr><th>Nombre</th><th>Dirección</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {sucursales.map((s) => (
                    <tr key={s.id}>
                      <td>{s.nombre}{s.es_principal ? ' (principal)' : ''}</td>
                      <td>{s.direccion || '—'}</td>
                      <td>
                        <span className={'badge ' + (s.activo ? 'badge-good' : 'badge-critical')}>
                          {s.activo ? 'Activa' : 'Desactivada'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => openEditSucursal(s)}>Editar</button>
                        {s.es_principal ? (
                          <span className="icon-link muted" title="No puedes desactivar la sede principal">—</span>
                        ) : (
                          <button className={'btn-link' + (s.activo ? ' danger' : '')} onClick={() => handleToggleSucursalEstado(s)}>
                            {s.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sucursales.length === 0 && (
                    <tr><td colSpan={4} className="empty-row">No hay sedes registradas.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'series' && (
            <>
              <h3 style={{ marginTop: 0 }}>Series y Sucursal</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Dirección principal, datos de cada sede, la tasa de IGV con la que se calculan tus ventas y compras,
                y la serie + correlativo de cada documento que emite el sistema.
              </p>

              <div className="filter-panel" style={{ alignItems: 'flex-end' }}>
                <div className="filter-field grow">
                  <label>Editar Dirección Principal</label>
                  <input value={direccionPrincipal} onChange={(e) => setDireccionPrincipal(e.target.value)} />
                </div>
                <div className="filter-actions">
                  <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={handleModificarDireccion} disabled={savingDireccion}>
                    {savingDireccion ? 'Guardando...' : 'Modificar Dirección'}
                  </button>
                </div>
              </div>

              <div className="filter-panel" style={{ alignItems: 'flex-end' }}>
                <div className="filter-field">
                  <label>Editar Series de la Sucursal</label>
                  <select value={sucursalSeleccionadaId} onChange={(e) => setSucursalSeleccionadaId(e.target.value)}>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}{s.es_principal ? ' (principal)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Nombre</label>
                  <input value={sucursalEditNombre} onChange={(e) => setSucursalEditNombre(e.target.value)} />
                </div>
                <div className="filter-field grow">
                  <label>Dirección</label>
                  <input value={sucursalEditDireccion} onChange={(e) => setSucursalEditDireccion(e.target.value)} />
                </div>
                <div className="filter-actions">
                  <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={handleModificarSucursalSerie} disabled={savingSucursalSerie || !sucursalSeleccionadaId}>
                    {savingSucursalSerie ? 'Guardando...' : 'Modificar Nombre y Dirección'}
                  </button>
                </div>
              </div>

              <div className="filter-panel" style={{ alignItems: 'flex-end' }}>
                <div className="filter-field">
                  <label>Tasas IGV</label>
                  <select value={igvPct} onChange={(e) => setIgvPct(Number(e.target.value))}>
                    <option value={18}>18%</option>
                    <option value={10}>10%</option>
                    <option value={0}>0% (exonerado)</option>
                  </select>
                </div>
                <div className="filter-actions">
                  <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={handleModificarIgv} disabled={savingIgv}>
                    {savingIgv ? 'Guardando...' : 'Modificar Tasa'}
                  </button>
                </div>
              </div>

              {errorSeries && <div className="form-error">{errorSeries}</div>}

              <h3>Series y correlativos {sucursalEditNombre && `— ${sucursalEditNombre}`}</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Estas series son solo de la sede elegida arriba en "Editar Series de la Sucursal" — SUNAT exige que
                cada sede (punto de emisión) tenga su propia serie por tipo de documento, nunca compartida con otra.
                El correlativo es el siguiente número que se va a usar al emitir; nunca puede quedar por debajo de lo
                que ya se emitió — subirlo es seguro (por ejemplo, para retomar una numeración física ya usada).
              </p>

              <h4 style={{ marginBottom: 6 }}>VENTAS</h4>
              <div className="series-columns">
                <SerieTable tipos={SERIES_VENTAS_COL1} series={series} updateSerieField={updateSerieField} />
                <SerieTable tipos={SERIES_VENTAS_COL2} series={series} updateSerieField={updateSerieField} />
              </div>
              <div className="report-toolbar" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn-primary" style={{ width: 'auto' }}
                  onClick={() => handleModificarSeries([...SERIES_VENTAS_COL1, ...SERIES_VENTAS_COL2], setSavingSeriesVentas)}
                  disabled={savingSeriesVentas || series.length === 0}>
                  {savingSeriesVentas ? 'Guardando...' : 'Modificar Series'}
                </button>
              </div>

              <h4 style={{ marginBottom: 6, marginTop: 24 }}>COMPRAS</h4>
              <div className="series-columns">
                <SerieTable tipos={SERIES_COMPRAS} series={series} updateSerieField={updateSerieField} />
              </div>
              <div className="report-toolbar" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn-primary" style={{ width: 'auto' }}
                  onClick={() => handleModificarSeries(SERIES_COMPRAS, setSavingSeriesCompras)}
                  disabled={savingSeriesCompras || series.length === 0}>
                  {savingSeriesCompras ? 'Guardando...' : 'Modificar Series'}
                </button>
              </div>
            </>
          )}

          {seccion === 'empleados' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Empleados</h3>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-export" onClick={exportarEmpleadosCsv}>Exportar</button>
                  <button className="btn-primary" style={{ width: 'auto' }} onClick={openNewUser}>Nuevo Empleado</button>
                </div>
              </div>

              <form className="filter-panel" onSubmit={(e) => { e.preventDefault(); loadUsuarios(); }}>
                <div className="filter-field grow">
                  <label>Buscar por nombre, apellido, DNI o correo</label>
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar.." />
                </div>
                <div className="filter-actions">
                  <button type="submit" className="btn-secondary">Buscar</button>
                </div>
              </form>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombres</th><th>Apellidos</th><th>Rol</th><th>Sede</th><th>N° documento</th><th>Correo</th><th>Teléfono</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id}>
                      <td>{u.nombres || u.full_name}</td>
                      <td>{u.apellidos || ''}</td>
                      <td>{u.role === 'gerencia' ? 'Gerencia (administrador)' : (u.rol_personalizado_nombre || 'Sin rol asignado')}</td>
                      <td>{u.sucursal_nombre || 'Todas las sedes'}</td>
                      <td>{u.dni ? `DNI : ${u.dni}` : '—'}</td>
                      <td>{u.email || '—'}</td>
                      <td>{u.telefono || '—'}</td>
                      <td>
                        <span className={'badge ' + (u.activo ? 'badge-good' : 'badge-critical')}>
                          {u.activo ? 'Habilitado' : 'Deshabilitado'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => openEditUser(u)}>Editar</button>
                        <button className="btn-link" onClick={() => handleRestablecerContrasena(u)}>Restablecer contraseña</button>
                        {u.id === user.id ? (
                          <span className="icon-link muted" title="No puedes desactivar tu propia cuenta">—</span>
                        ) : (
                          <button className={'btn-link' + (u.activo ? ' danger' : '')} onClick={() => handleToggleEstado(u)}>
                            {u.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {usuarios.length === 0 && (
                    <tr><td colSpan={9} className="empty-row">No hay empleados registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'roles' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Roles de usuario</h3>
                <button className="btn-primary" style={{ width: 'auto' }} onClick={() => navigate('/configuracion/roles/nuevo')}>Nuevo Rol de usuario</button>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id}>
                      <td>{r.nombre}</td>
                      <td>{r.descripcion || '—'}</td>
                      <td>
                        <span className={'badge ' + (r.activo ? 'badge-good' : 'badge-critical')}>
                          {r.activo ? 'Habilitado' : 'Deshabilitado'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => navigate(`/configuracion/roles/${r.id}`)}>Editar</button>
                        <button className={'btn-link' + (r.activo ? ' danger' : '')} onClick={() => handleToggleRoleEstado(r)}>
                          {r.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {roles.length === 0 && (
                    <tr><td colSpan={4} className="empty-row">No hay roles creados todavía.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'metodos_pago' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Métodos de pago</h3>
                <button className="btn-primary" style={{ width: 'auto' }} onClick={openNewMetodo}>+ Nuevo método de pago</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Estos son los métodos que tus vendedores pueden elegir al cobrar una venta, y con los que Caja y Bancos
                arma el detalle de "con qué se pagó" cada día.
              </p>
              <div className="metodos-pago-grid">
                {metodosPago.map((m) => (
                  <div key={m.id} className={'metodo-pago-card' + (m.activo ? '' : ' inactivo')} style={{ '--metodo-color': m.color }}>
                    <div className="metodo-pago-icon" style={{ background: m.color }}>{m.icono}</div>
                    <div className="metodo-pago-info">
                      <strong>{m.nombre}</strong>
                      <span className="metodo-pago-tipo">{TIPOS_METODO_PAGO.find((t) => t.value === m.tipo)?.label || m.tipo}</span>
                      {(m.qr_data_url || m.link_pago) && (
                        <span style={{ fontSize: 11, color: 'var(--good, #16a34a)' }}>✓ Tiene QR / link de pago</span>
                      )}
                    </div>
                    <span className={'badge ' + (m.activo ? 'badge-good' : 'badge-critical')}>
                      {m.activo ? 'Activo' : 'Inactivo'}
                    </span>
                    <div className="metodo-pago-actions">
                      <button className="btn-link" onClick={() => openEditMetodo(m)}>Editar</button>
                      <button className={'btn-link' + (m.activo ? ' danger' : '')} onClick={() => handleToggleMetodoEstado(m)}>
                        {m.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>
                ))}
                {metodosPago.length === 0 && (
                  <p className="empty-row">No hay métodos de pago creados todavía.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Editar empleado' : 'Nuevo empleado'}</h2>
            <form onSubmit={handleSubmitUser}>
              <div className="form-row">
                <div>
                  <label>Nombre *</label>
                  <input required value={form.nombres} onChange={(e) => setForm({ ...form, nombres: e.target.value })} />
                </div>
                <div>
                  <label>Apellidos *</label>
                  <input required value={form.apellidos} onChange={(e) => setForm({ ...form, apellidos: e.target.value })} />
                </div>
              </div>
              <label>Usuario (identificador interno) *</label>
              <input required disabled={!!editingId} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <label>DNI * (8 dígitos) — se usa para iniciar sesión junto con el RUC de la empresa</label>
              <input required value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value })} maxLength={8} />
              <div className="form-row">
                <div>
                  <label>Teléfono</label>
                  <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
                </div>
                <div>
                  <label>Correo electrónico</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -10 }}>
                El correo es solo para tenerlo como contacto — no enviamos ningún email automático (esta instancia no tiene un proveedor de correo configurado). El empleado inicia sesión con RUC + DNI + contraseña.
              </p>
              <label>Nivel *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="vendedor">Empleado (permisos por rol)</option>
                <option value="gerencia">Gerencia (administrador, acceso total)</option>
              </select>
              {form.role === 'vendedor' && (
                <>
                  <label>Rol</label>
                  <select value={form.custom_role_id} onChange={(e) => setForm({ ...form, custom_role_id: e.target.value })}>
                    <option value="">Sin rol asignado (sin restricciones, como antes)</option>
                    {roles.filter((r) => r.activo).map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </select>
                </>
              )}
              <label>Sede</label>
              <select value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}>
                <option value="">Todas las sedes (puede elegir al ingresar)</option>
                {sucursales.filter((s) => s.activo).map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <label>{editingId ? 'Nueva contraseña (dejar en blanco para no cambiarla)' : 'Contraseña * (mínimo 8 caracteres, mayúscula, minúscula, número y carácter especial)'}</label>
              <input required={!editingId} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {!editingId && (
                <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -10 }}>
                  Contraseña predeterminada — puedes dejarla así o cambiarla antes de guardar.
                </p>
              )}
              {errorForm && <div className="form-error">{errorForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingId ? 'Guardar cambios' : 'Guardar empleado'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSucursalForm && (
        <div className="modal-overlay" onClick={() => setShowSucursalForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingSucursalId ? 'Editar sede' : 'Nueva sede'}</h2>
            <form onSubmit={handleSubmitSucursal}>
              <label>Nombre</label>
              <input required value={sucursalForm.nombre} onChange={(e) => setSucursalForm({ ...sucursalForm, nombre: e.target.value })} />
              <label>Dirección</label>
              <input value={sucursalForm.direccion} onChange={(e) => setSucursalForm({ ...sucursalForm, direccion: e.target.value })} />
              {errorSucursal && <div className="form-error">{errorSucursal}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSucursalForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingSucursalId ? 'Guardar cambios' : 'Crear sede'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMetodoForm && (
        <div className="modal-overlay" onClick={() => setShowMetodoForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingMetodoId ? 'Editar método de pago' : 'Nuevo método de pago'}</h2>
            <form onSubmit={handleSubmitMetodo}>
              <label>Nombre *</label>
              <input required value={metodoForm.nombre} onChange={(e) => setMetodoForm({ ...metodoForm, nombre: e.target.value })} placeholder="Ej. Yape, Plin, Transferencia BCP..." />
              <label>Tipo</label>
              <select value={metodoForm.tipo} onChange={(e) => setMetodoForm({ ...metodoForm, tipo: e.target.value })}>
                {TIPOS_METODO_PAGO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="form-row">
                <div>
                  <label>Color</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="color"
                      value={metodoForm.color}
                      onChange={(e) => setMetodoForm({ ...metodoForm, color: e.target.value })}
                      style={{ width: 44, height: 34, padding: 2, cursor: 'pointer' }}
                    />
                    <input value={metodoForm.color} onChange={(e) => setMetodoForm({ ...metodoForm, color: e.target.value })} style={{ maxWidth: 110 }} />
                  </div>
                </div>
                <div>
                  <label>Ícono</label>
                  <input value={metodoForm.icono} onChange={(e) => setMetodoForm({ ...metodoForm, icono: e.target.value })} style={{ maxWidth: 80, fontSize: 18, textAlign: 'center' }} maxLength={2} />
                </div>
              </div>
              <div className="metodo-icono-picker">
                {ICONOS_SUGERIDOS.map((ic) => (
                  <button type="button" key={ic} className={'metodo-icono-opcion' + (metodoForm.icono === ic ? ' selected' : '')} onClick={() => setMetodoForm({ ...metodoForm, icono: ic })}>
                    {ic}
                  </button>
                ))}
              </div>
              <div className="metodo-pago-preview" style={{ '--metodo-color': metodoForm.color }}>
                <div className="metodo-pago-icon" style={{ background: metodoForm.color }}>{metodoForm.icono}</div>
                <strong>{metodoForm.nombre || 'Nombre del método'}</strong>
              </div>

              <label style={{ marginTop: 16 }}>QR de pago (opcional)</label>
              <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: -6 }}>
                Sube una foto o captura de tu QR real de Yape, Plin, etc. Se va a mostrar al vendedor durante el
                cobro para que el cliente lo escanee con su app y pague el monto — no queda enlazado a tu cuenta,
                solo se muestra la imagen.
              </p>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ width: 90, height: 90, border: '1px dashed var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'var(--surface)' }}>
                  {metodoForm.qr_data_url ? (
                    <img src={metodoForm.qr_data_url} alt="QR" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--ink-muted)', textAlign: 'center' }}>Sin QR</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label className="btn-secondary" style={{ width: 'auto', textAlign: 'center', cursor: 'pointer' }}>
                    Subir QR
                    <input type="file" accept="image/png,image/jpeg" onChange={handleMetodoQrChange} style={{ display: 'none' }} />
                  </label>
                  {metodoForm.qr_data_url && (
                    <button type="button" className="btn-secondary" onClick={() => setMetodoForm({ ...metodoForm, qr_data_url: '' })}>
                      Quitar QR
                    </button>
                  )}
                </div>
              </div>

              <label style={{ marginTop: 16 }}>Link de pago (opcional)</label>
              <input
                type="url"
                value={metodoForm.link_pago}
                onChange={(e) => setMetodoForm({ ...metodoForm, link_pago: e.target.value })}
                placeholder="https://yape.me/tu-negocio o el link de tu pasarela"
              />

              {errorMetodo && <div className="form-error">{errorMetodo}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowMetodoForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingMetodoId ? 'Guardar cambios' : 'Crear método'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
