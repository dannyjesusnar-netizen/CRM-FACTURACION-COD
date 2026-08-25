import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, Users as UsersIcon, Store, ShieldCheck, FileText, Wallet, Hash, Percent,
  Upload, Boxes, PackagePlus, RefreshCw, UserPlus, Tags,
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { leerArchivoComoTextoCsv, descargarComoExcel } from '../utils/excelImport';

const DEPARTAMENTOS_PERU = [
  'Amazonas', 'Áncash', 'Apurímac', 'Arequipa', 'Ayacucho', 'Cajamarca', 'Callao', 'Cusco',
  'Huancavelica', 'Huánuco', 'Ica', 'Junín', 'La Libertad', 'Lambayeque', 'Lima', 'Loreto',
  'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martín', 'Tacna', 'Tumbes', 'Ucayali',
];

const PASSWORD_PREDETERMINADA = 'Lima2026*';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CATEGORIA_STAFF_LABEL = { vendedor: 'Vendedor', trainer: 'Trainer', supervisor: 'Supervisor' };

function emptyUserForm() {
  return { username: '', password: PASSWORD_PREDETERMINADA, nombres: '', apellidos: '', email: '', telefono: '', dni: '', role: 'vendedor', sucursal_id: '', custom_role_id: '', categoria_staff: 'vendedor', turno: '' };
}

function emptyOperativoForm() {
  return { nombres: '', apellidos: '', dni: '', categoria_staff: 'trainer', sucursal_id: '', turno: '' };
}

// Carga masiva de Entrenadores/Supervisores operativos: sin username ni
// password (no se crea usuario real, ver comentario en users.js) ni "nivel"
// (siempre quedan sin acceso al sistema) — solo lo mínimo para el ranking.
const CARGA_MASIVA_OPERATIVOS_COLUMNAS = ['dni', 'nombres', 'apellidos', 'categoria_staff', 'sede', 'turno'];

function parseCsvOperativos(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  let start = 0;
  if (/dni/i.test(lines[0]) && /nombres/i.test(lines[0])) start = 1;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!cols[0]) continue;
    const row = {};
    CARGA_MASIVA_OPERATIVOS_COLUMNAS.forEach((key, idx) => { row[key] = cols[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// Importador de Datos Masivos (Configuración): 5 flujos de carga por Excel/CSV
// que reutilizan endpoints ya existentes de products.js/clients.js — cada uno
// solo cambia columnas esperadas, endpoint destino y un cuerpo extra opcional.
function parseCsvGenerico(text, columnas) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  let start = 0;
  if (columnas.some((c) => new RegExp(c, 'i').test(lines[0]))) start = 1;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!cols[0]) continue;
    const row = {};
    columnas.forEach((key, idx) => { row[key] = cols[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// Primer valor de la fila de error que no sea el mensaje — cada endpoint usa
// una llave distinta como identificador (codigo, numero_documento...).
function primerIdentificadorError(errorRow) {
  const entrada = Object.entries(errorRow).find(([k]) => k !== 'error');
  return entrada ? entrada[1] : '';
}

const IMPORTADORES_MASIVOS = [
  {
    key: 'inventario',
    titulo: 'Inventario',
    Icon: Boxes,
    endpoint: '/products/carga-masiva/inventario',
    columnas: ['codigo', 'stock'],
    filaEjemplo: ['PROD001', '25'],
    descripcion: 'Actualiza solo el stock (de tu sede activa) de productos que YA existen, por código. No crea productos nuevos ni cambia nombre o precio.',
  },
  {
    key: 'productos_nuevos',
    titulo: 'Productos nuevos',
    Icon: PackagePlus,
    endpoint: '/products/carga-masiva',
    columnas: ['codigo', 'nombre', 'categoria', 'unidad', 'precio_unitario', 'precio_compra', 'stock', 'stock_minimo', 'codigo_barras'],
    filaEjemplo: ['PROD002', 'Proteína Whey 1kg', 'Suplementos', 'NIU', '120', '80', '30', '5', '7501234567890'],
    descripcion: 'Crea productos nuevos por código. Si el código ya existe, actualiza sus datos (mismo criterio de siempre).',
  },
  {
    key: 'actualizacion_datos',
    titulo: 'Actualización de datos',
    Icon: RefreshCw,
    endpoint: '/products/carga-masiva',
    extraBody: { crear_nuevos: false },
    columnas: ['codigo', 'nombre', 'categoria', 'unidad', 'precio_unitario', 'precio_compra', 'stock', 'stock_minimo', 'codigo_barras'],
    filaEjemplo: ['PROD001', 'Creatina Monohidratada 300g', 'Suplementos', 'NIU', '89.9', '55', '40', '5', '7501234500001'],
    descripcion: 'Actualiza productos que YA existen por código. Si un código no existe, esa fila queda en error (a diferencia de "Productos nuevos", esta opción nunca crea productos).',
  },
  {
    key: 'clientes',
    titulo: 'Clientes',
    Icon: UserPlus,
    endpoint: '/clients/carga-masiva',
    columnas: ['tipo_documento', 'numero_documento', 'nombre', 'direccion', 'telefono', 'email', 'sede', 'turno'],
    filaEjemplo: ['DNI', '87654321', 'Lucía Fernández', 'Av. Larco 123, Miraflores', '987654321', 'lucia@correo.com', '', 'manana'],
    descripcion: 'Crea clientes nuevos o actualiza los existentes por tipo y número de documento. "sede" es el nombre de la sede (déjalo vacío si no aplica).',
  },
  {
    key: 'lista_precios',
    titulo: 'Lista de precios',
    Icon: Tags,
    endpoint: '/products/carga-masiva/precios',
    columnas: ['codigo', 'precio_venta', 'precio_mayorista', 'precio_distribuidor'],
    filaEjemplo: ['PROD001', '89.9', '75', '65'],
    descripcion: 'Actualiza precio de venta, precio de mayorista y precio de distribuidor de productos que YA existen, por código.',
  },
];

// Los tres únicos niveles que se pueden asignar a un empleado desde este
// formulario (reemplaza el antiguo par Nivel + Rol personalizado libre).
// Administrador = Gerencia (acceso total, sin rol personalizado). Supervisor
// y Cajero son roles personalizados con estos módulos habilitados — se crean
// automáticamente la primera vez que se necesitan (ver ensureRolesPredeterminados).
const ROLES_PRESET_MODULOS = {
  Supervisor: ['dashboard', 'ventas', 'compras', 'inventario', 'clientes', 'caja', 'reportes'],
  Cajero: ['ventas', 'caja'],
};

function idRolPorNombre(roles, nombre) {
  const r = roles.find((x) => x.nombre === nombre);
  return r ? String(r.id) : '';
}

// Deriva cuál de los 3 niveles representa el form actual (para que el
// select siempre muestre una opción válida, incluso para empleados
// existentes creados antes de este cambio).
function nivelDesdeForm(f, roles) {
  if (f.role === 'gerencia') return 'administrador';
  if (f.custom_role_id && String(f.custom_role_id) === idRolPorNombre(roles, 'Supervisor')) return 'supervisor';
  return 'cajero';
}

function emptySucursalForm() {
  return { nombre: '', direccion: '' };
}

function emptySolicitudSedeForm() {
  return { nombre: '', direccion: '', motivo: '' };
}

const ESTADO_SOLICITUD_LABEL = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };
const ESTADO_SOLICITUD_BADGE = { pendiente: 'badge-warning', aprobada: 'badge-good', rechazada: 'badge-critical' };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyDescuentoForm() {
  return { nombre: '', porcentaje: '', sucursal_id: '', fecha_inicio: todayStr(), fecha_fin: todayStr() };
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

  // --- Entrenadores y Supervisores operativos (registro sin usuario) ---
  // Solo alimentan el Tablero de Ventas (ranking + "Atribuir venta a") — no
  // inician sesión ni facturan, así que no llevan usuario/contraseña.
  const [operativos, setOperativos] = useState([]);
  const [qOperativos, setQOperativos] = useState('');
  const [showOperativoForm, setShowOperativoForm] = useState(false);
  const [editingOperativoId, setEditingOperativoId] = useState(null);
  const [operativoForm, setOperativoForm] = useState(emptyOperativoForm());
  const [errorOperativoForm, setErrorOperativoForm] = useState('');
  const [showCargaMasivaOperativos, setShowCargaMasivaOperativos] = useState(false);
  const [cargaOperativosFileName, setCargaOperativosFileName] = useState('');
  const [cargaOperativosRows, setCargaOperativosRows] = useState([]);
  const [cargaOperativosResult, setCargaOperativosResult] = useState(null);
  const [errorCargaOperativos, setErrorCargaOperativos] = useState('');

  // --- Importador de Datos Masivos ---
  const [importadorActivo, setImportadorActivo] = useState(null); // key de IMPORTADORES_MASIVOS o null
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [errorImport, setErrorImport] = useState('');
  const [savingImport, setSavingImport] = useState(false);

  // --- Metas de venta (Tablero de Ventas) ---
  // Gerencia asigna un monto "pool" por sede y categoría (Vendedores /
  // Trainers) cada mes; el backend lo reparte entre la dotación asignada a
  // mano para ese equipo (o entre los empleados activos si no se asignó
  // ninguna dotación). filasMetas: [{ sucursal_id, sede_nombre,
  // categoria_staff, cantidad_empleados, monto_meta, dotacion }] — una fila
  // por sede x categoría.
  const hoy = new Date();
  const [metasAnio, setMetasAnio] = useState(hoy.getFullYear());
  const [metasMes, setMetasMes] = useState(hoy.getMonth() + 1);
  const [filasMetas, setFilasMetas] = useState([]);
  const [metasGuardando, setMetasGuardando] = useState(null);

  // --- Descuentos (Registrar Venta) ---
  // Un % con nombre y vigencia que el vendedor elige de una lista al
  // registrar una venta, en vez de escribir el % a mano (ver
  // routes/descuentos.js y el selector en RegistroVenta.jsx). A diferencia
  // de las Promociones de Inventario, este descuento aplica sobre el total
  // de toda la venta, no sobre un producto puntual.
  const [descuentos, setDescuentos] = useState([]);
  const [showDescuentoForm, setShowDescuentoForm] = useState(false);
  const [editingDescuentoId, setEditingDescuentoId] = useState(null);
  const [descuentoForm, setDescuentoForm] = useState(emptyDescuentoForm());
  const [errorDescuentoForm, setErrorDescuentoForm] = useState('');

  // --- Sucursales ---
  const [sucursales, setSucursales] = useState([]);
  const [limiteSucursales, setLimiteSucursales] = useState(null);
  const [showSucursalForm, setShowSucursalForm] = useState(false);
  const [editingSucursalId, setEditingSucursalId] = useState(null);
  const [sucursalForm, setSucursalForm] = useState(emptySucursalForm());
  const [errorSucursal, setErrorSucursal] = useState('');
  const [solicitudesSede, setSolicitudesSede] = useState([]);
  const [showSolicitudSedeForm, setShowSolicitudSedeForm] = useState(false);
  const [solicitudSedeForm, setSolicitudSedeForm] = useState(emptySolicitudSedeForm());
  const [errorSolicitudSede, setErrorSolicitudSede] = useState('');

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
    loadOperativos();
    loadSucursales();
    loadLimiteSucursales();
    loadSolicitudesSede();
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

  function loadOperativos() {
    const params = {};
    if (qOperativos) params.q = qOperativos;
    api.get('/users/operativos', { params }).then((res) => setOperativos(res.data));
  }

  function loadMetas() {
    api.get('/metas-venta', { params: { anio: metasAnio, mes: metasMes } }).then((res) => setFilasMetas(res.data));
  }

  useEffect(() => {
    if (seccion === 'metas') loadMetas();
  }, [seccion, metasAnio, metasMes]);

  async function guardarMetaPool(sucursalId, categoriaStaff, montoMeta) {
    const key = `${sucursalId}:${categoriaStaff}`;
    setMetasGuardando(key);
    try {
      await api.put('/metas-venta', { sucursal_id: sucursalId, categoria_staff: categoriaStaff, anio: metasAnio, mes: metasMes, monto_meta: montoMeta });
      setFilasMetas((filas) => filas.map((f) => (
        f.sucursal_id === sucursalId && f.categoria_staff === categoriaStaff ? { ...f, monto_meta: montoMeta } : f
      )));
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo guardar la meta.');
    } finally {
      setMetasGuardando(null);
    }
  }

  async function guardarDotacion(sucursalId, categoriaStaff, dotacion) {
    const key = `${sucursalId}:${categoriaStaff}`;
    setMetasGuardando(key);
    try {
      await api.put('/metas-venta', { sucursal_id: sucursalId, categoria_staff: categoriaStaff, anio: metasAnio, mes: metasMes, dotacion });
      setFilasMetas((filas) => filas.map((f) => (
        f.sucursal_id === sucursalId && f.categoria_staff === categoriaStaff ? { ...f, dotacion } : f
      )));
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo guardar la dotación.');
    } finally {
      setMetasGuardando(null);
    }
  }

  function loadDescuentos() {
    api.get('/descuentos').then((res) => setDescuentos(res.data));
  }

  useEffect(() => {
    if (seccion === 'descuentos') loadDescuentos();
  }, [seccion]);

  function openNuevoDescuento() {
    setEditingDescuentoId(null);
    setDescuentoForm(emptyDescuentoForm());
    setErrorDescuentoForm('');
    setShowDescuentoForm(true);
  }

  function openEditDescuento(d) {
    setEditingDescuentoId(d.id);
    setDescuentoForm({
      nombre: d.nombre, porcentaje: d.porcentaje, sucursal_id: d.sucursal_id || '',
      fecha_inicio: d.fecha_inicio, fecha_fin: d.fecha_fin,
    });
    setErrorDescuentoForm('');
    setShowDescuentoForm(true);
  }

  async function handleSubmitDescuento(e) {
    e.preventDefault();
    setErrorDescuentoForm('');
    try {
      const payload = {
        nombre: descuentoForm.nombre, porcentaje: Number(descuentoForm.porcentaje),
        sucursal_id: descuentoForm.sucursal_id || null,
        fecha_inicio: descuentoForm.fecha_inicio, fecha_fin: descuentoForm.fecha_fin,
      };
      if (editingDescuentoId) await api.put(`/descuentos/${editingDescuentoId}`, payload);
      else await api.post('/descuentos', payload);
      toast.success(editingDescuentoId ? 'Descuento actualizado.' : 'Descuento creado.');
      setShowDescuentoForm(false);
      loadDescuentos();
    } catch (err) {
      setErrorDescuentoForm(err.response?.data?.error || 'No se pudo guardar el descuento.');
    }
  }

  async function handleToggleEstadoDescuento(d) {
    try {
      await api.put(`/descuentos/${d.id}/estado`, { activo: !d.activo });
      toast.success(d.activo ? 'Descuento desactivado.' : 'Descuento activado.');
      loadDescuentos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  function loadSucursales() {
    api.get('/sucursales', { params: { todas: 1 } }).then((res) => setSucursales(res.data));
  }

  function loadLimiteSucursales() {
    api.get('/sucursales/limite').then((res) => setLimiteSucursales(res.data));
  }

  function loadSolicitudesSede() {
    api.get('/sucursales/solicitudes').then((res) => setSolicitudesSede(res.data));
  }

  function openNuevaSolicitudSede() {
    setSolicitudSedeForm(emptySolicitudSedeForm());
    setErrorSolicitudSede('');
    setShowSolicitudSedeForm(true);
  }

  async function handleSubmitSolicitudSede(e) {
    e.preventDefault();
    setErrorSolicitudSede('');
    try {
      await api.post('/sucursales/solicitudes', solicitudSedeForm);
      toast.success('Solicitud enviada — tu proveedor la revisará.');
      setShowSolicitudSedeForm(false);
      loadSolicitudesSede();
    } catch (err) {
      setErrorSolicitudSede(err.response?.data?.error || 'No se pudo enviar la solicitud.');
    }
  }

  async function ensureRolesPredeterminados(rolesActuales) {
    const faltantes = Object.entries(ROLES_PRESET_MODULOS).filter(
      ([nombre]) => !rolesActuales.some((r) => r.nombre === nombre)
    );
    if (faltantes.length === 0) return rolesActuales;
    for (const [nombre, modulos] of faltantes) {
      const permisos = {};
      modulos.forEach((m) => { permisos[m] = true; });
      await api.post('/roles', { nombre, descripcion: `Rol predeterminado: ${nombre}.`, permisos });
    }
    const res = await api.get('/roles');
    return res.data;
  }

  function loadRoles() {
    api.get('/roles').then(async (res) => {
      const asegurados = await ensureRolesPredeterminados(res.data);
      setRoles(asegurados);
    });
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
    setForm({ ...emptyUserForm(), custom_role_id: idRolPorNombre(roles, 'Cajero') });
    setErrorForm('');
    setShowForm(true);
  }

  function handleNivelChange(valor) {
    if (valor === 'administrador') {
      setForm((f) => ({ ...f, role: 'gerencia', custom_role_id: '' }));
    } else if (valor === 'supervisor') {
      setForm((f) => ({ ...f, role: 'vendedor', custom_role_id: idRolPorNombre(roles, 'Supervisor') }));
    } else {
      setForm((f) => ({ ...f, role: 'vendedor', custom_role_id: idRolPorNombre(roles, 'Cajero') }));
    }
  }

  function openEditUser(u) {
    setEditingId(u.id);
    setForm({
      username: u.username, password: '', nombres: u.nombres || '', apellidos: u.apellidos || '',
      email: u.email || '', telefono: u.telefono || '', dni: u.dni || '', role: u.role,
      sucursal_id: u.sucursal_id || '', custom_role_id: u.custom_role_id || '',
      categoria_staff: u.categoria_staff || 'vendedor', turno: u.turno || '',
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
      categoria_staff: form.categoria_staff || 'vendedor', turno: form.turno || null,
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

  function openNewOperativo() {
    setEditingOperativoId(null);
    setOperativoForm(emptyOperativoForm());
    setErrorOperativoForm('');
    setShowOperativoForm(true);
  }

  function openEditOperativo(o) {
    setEditingOperativoId(o.id);
    setOperativoForm({
      nombres: o.nombres || '', apellidos: o.apellidos || '', dni: o.dni || '',
      categoria_staff: o.categoria_staff || 'trainer', sucursal_id: o.sucursal_id || '', turno: o.turno || '',
    });
    setErrorOperativoForm('');
    setShowOperativoForm(true);
  }

  async function handleSubmitOperativo(e) {
    e.preventDefault();
    setErrorOperativoForm('');
    const payload = {
      nombres: operativoForm.nombres, apellidos: operativoForm.apellidos, dni: operativoForm.dni,
      categoria_staff: operativoForm.categoria_staff, sucursal_id: operativoForm.sucursal_id || null,
      turno: operativoForm.turno || null,
    };
    try {
      if (editingOperativoId) {
        await api.put(`/users/${editingOperativoId}`, payload);
        toast.success('Registro actualizado.');
      } else {
        await api.post('/users/operativos', payload);
        toast.success('Registro creado — no tiene usuario ni contraseña, no puede iniciar sesión.');
      }
      setShowOperativoForm(false);
      loadOperativos();
    } catch (err) {
      setErrorOperativoForm(err.response?.data?.error || 'No se pudo guardar el registro.');
    }
  }

  async function handleToggleEstadoOperativo(o) {
    const accion = o.activo ? 'desactivar' : 'activar';
    if (!window.confirm(`¿Seguro que quieres ${accion} a ${o.full_name}?`)) return;
    try {
      await api.put(`/users/${o.id}/estado`, { activo: !o.activo });
      toast.success(`Registro ${o.activo ? 'desactivado' : 'activado'}.`);
      loadOperativos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'No se pudo cambiar el estado.');
    }
  }

  function openCargaMasivaOperativos() {
    setCargaOperativosFileName('');
    setCargaOperativosRows([]);
    setCargaOperativosResult(null);
    setErrorCargaOperativos('');
    setShowCargaMasivaOperativos(true);
  }

  async function handleCargaOperativosFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCargaOperativosFileName(file.name);
    setCargaOperativosResult(null);
    setErrorCargaOperativos('');
    try {
      const texto = await leerArchivoComoTextoCsv(file);
      const rows = parseCsvOperativos(texto);
      setCargaOperativosRows(rows);
      if (rows.length === 0) setErrorCargaOperativos('No se encontraron filas válidas (columnas esperadas: dni, nombres, apellidos, categoria_staff, sede, turno).');
    } catch {
      setErrorCargaOperativos('No se pudo leer el archivo. Verifica que sea un CSV o Excel (.xlsx) válido.');
    }
  }

  async function handleCargaMasivaOperativosSubmit(e) {
    e.preventDefault();
    setErrorCargaOperativos('');
    if (cargaOperativosRows.length === 0) { setErrorCargaOperativos('Selecciona un archivo CSV con al menos una fila.'); return; }
    try {
      const res = await api.post('/users/operativos/carga-masiva', { rows: cargaOperativosRows });
      setCargaOperativosResult(res.data);
      if (res.data.creados.length > 0) toast.success(`${res.data.creados.length} registro(s) creados.`);
      if (res.data.actualizados.length > 0) toast.success(`${res.data.actualizados.length} registro(s) actualizados.`);
      if (res.data.errores.length > 0) toast.error(`${res.data.errores.length} fila(s) con errores. Revisa el detalle.`);
      loadOperativos();
    } catch (err) {
      setErrorCargaOperativos(err.response?.data?.error || 'No se pudo procesar el archivo.');
    }
  }

  function descargarPlantillaCargaMasivaOperativos() {
    const header = CARGA_MASIVA_OPERATIVOS_COLUMNAS;
    const ejemplo = ['87654321', 'Lucía', 'Fernández', 'trainer', sucursales[0]?.nombre || '', 'manana'];
    const csv = [header, ejemplo].map((r) => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'plantilla_carga_masiva_operativos.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function descargarPlantillaCargaMasivaOperativosExcel() {
    const ejemplo = ['87654321', 'Lucía', 'Fernández', 'trainer', sucursales[0]?.nombre || '', 'manana'];
    descargarComoExcel('plantilla_carga_masiva_operativos.xlsx', CARGA_MASIVA_OPERATIVOS_COLUMNAS, [ejemplo]);
  }

  function openImportador(key) {
    setImportFileName('');
    setImportRows([]);
    setImportResult(null);
    setErrorImport('');
    setImportadorActivo(key);
  }

  async function handleImportFileChange(e) {
    const file = e.target.files?.[0];
    const config = IMPORTADORES_MASIVOS.find((i) => i.key === importadorActivo);
    if (!file || !config) return;
    setImportFileName(file.name);
    setImportResult(null);
    setErrorImport('');
    try {
      const texto = await leerArchivoComoTextoCsv(file);
      const rows = parseCsvGenerico(texto, config.columnas);
      setImportRows(rows);
      if (rows.length === 0) setErrorImport(`No se encontraron filas válidas (columnas esperadas: ${config.columnas.join(', ')}).`);
    } catch {
      setErrorImport('No se pudo leer el archivo. Verifica que sea un CSV o Excel (.xlsx) válido.');
    }
  }

  async function handleImportSubmit(e) {
    e.preventDefault();
    const config = IMPORTADORES_MASIVOS.find((i) => i.key === importadorActivo);
    if (!config) return;
    setErrorImport('');
    if (importRows.length === 0) { setErrorImport('Selecciona un archivo CSV o Excel con al menos una fila.'); return; }
    setSavingImport(true);
    try {
      const res = await api.post(config.endpoint, { rows: importRows, ...(config.extraBody || {}) });
      setImportResult(res.data);
      if (res.data.creados?.length > 0) toast.success(`${res.data.creados.length} registro(s) creados.`);
      if (res.data.actualizados?.length > 0) toast.success(`${res.data.actualizados.length} registro(s) actualizados.`);
      if (res.data.errores?.length > 0) toast.error(`${res.data.errores.length} fila(s) con errores. Revisa el detalle.`);
    } catch (err) {
      setErrorImport(err.response?.data?.error || 'No se pudo procesar el archivo.');
    } finally {
      setSavingImport(false);
    }
  }

  function descargarPlantillaImportador(config) {
    const csv = [config.columnas, config.filaEjemplo].map((r) => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `plantilla_${config.key}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function descargarPlantillaImportadorExcel(config) {
    descargarComoExcel(`plantilla_${config.key}.xlsx`, config.columnas, [config.filaEjemplo]);
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
          <div className={'reports-sidebar-item' + (seccion === 'metas' ? ' active' : '')} onClick={() => setSeccion('metas')} role="button" tabIndex={0}>
            <Wallet size={16} /><span>Metas de venta</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'descuentos' ? ' active' : '')} onClick={() => setSeccion('descuentos')} role="button" tabIndex={0}>
            <Percent size={16} /><span>Descuentos</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'roles' ? ' active' : '')} onClick={() => setSeccion('roles')} role="button" tabIndex={0}>
            <ShieldCheck size={16} /><span>Roles de usuario</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'metodos_pago' ? ' active' : '')} onClick={() => setSeccion('metodos_pago')} role="button" tabIndex={0}>
            <Wallet size={16} /><span>Métodos de pago</span>
          </div>
          <div className={'reports-sidebar-item' + (seccion === 'importador' ? ' active' : '')} onClick={() => setSeccion('importador')} role="button" tabIndex={0}>
            <Upload size={16} /><span>Importador de Datos Masivos</span>
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

          {seccion === 'sucursales' && (() => {
            const alcanzoLibres = limiteSucursales?.libres != null && limiteSucursales.actual >= limiteSucursales.libres;
            return (
              <>
                <div className="report-toolbar">
                  <h3 style={{ margin: 0 }}>Sucursales</h3>
                  {alcanzoLibres ? (
                    <button className="btn-primary" style={{ width: 'auto' }} onClick={openNuevaSolicitudSede}>
                      Solicitar nueva sede
                    </button>
                  ) : (
                    <button className="btn-primary" style={{ width: 'auto' }} onClick={openNewSucursal}>
                      + Nueva sede
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                  Cada sede tiene su propio stock, ventas, compras y caja — como negocios independientes bajo la misma
                  empresa. Al iniciar sesión, quien tenga acceso a más de una elige con cuál trabajar.
                  {limiteSucursales?.libres != null && (
                    <> Puedes crear hasta <strong>{limiteSucursales.libres}</strong> sede(s) sin aprobación — llevas{' '}
                      <strong>{limiteSucursales.actual}</strong> de {limiteSucursales.libres}.</>
                  )}
                </p>
                {alcanzoLibres && (
                  <p style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: -6 }}>
                    Ya usaste tus sedes libres. Para crear una sede adicional, envía una solicitud — la aprueba tu proveedor.
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

                {solicitudesSede.length > 0 && (
                  <>
                    <h4 style={{ marginTop: 24 }}>Mis solicitudes de sede</h4>
                    <table className="data-table">
                      <thead>
                        <tr><th>Fecha</th><th>Sede solicitada</th><th>Dirección</th><th>Estado</th><th>Respuesta</th></tr>
                      </thead>
                      <tbody>
                        {solicitudesSede.map((s) => (
                          <tr key={s.id}>
                            <td>{(s.created_at || '').slice(0, 10)}</td>
                            <td>{s.nombre}</td>
                            <td>{s.direccion || '—'}</td>
                            <td>
                              <span className={'badge ' + (ESTADO_SOLICITUD_BADGE[s.estado] || 'badge-neutral')}>
                                {ESTADO_SOLICITUD_LABEL[s.estado] || s.estado}
                              </span>
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{s.respuesta || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            );
          })()}

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
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ width: 'auto' }}
                    onClick={() => {
                      const alcanzoLibres = limiteSucursales?.libres != null && limiteSucursales.actual >= limiteSucursales.libres;
                      if (alcanzoLibres) openNuevaSolicitudSede();
                      else openNewSucursal();
                    }}
                  >
                    + Agregar sede
                  </button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Cada sede emite documentos con su propia serie — actualiza aquí su dirección apenas cambie de local,
                para que salga correctamente impresa en boletas, facturas y notas.
              </p>

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

              <div className="report-toolbar" style={{ marginTop: 28 }}>
                <h3 style={{ margin: 0 }}>Entrenadores y Supervisores operativos</h3>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-secondary" style={{ width: 'auto' }} onClick={openCargaMasivaOperativos}>Carga masiva</button>
                  <button className="btn-primary" style={{ width: 'auto' }} onClick={openNewOperativo}>Nuevo registro</button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Solo alimentan el Ranking Trainers/Supervisores y el selector "Atribuir venta a" del Tablero de Ventas —
                no tienen usuario ni contraseña, no pueden iniciar sesión ni facturar.
              </p>

              <form className="filter-panel" onSubmit={(e) => { e.preventDefault(); loadOperativos(); }}>
                <div className="filter-field grow">
                  <label>Buscar por nombre, apellido o DNI</label>
                  <input value={qOperativos} onChange={(e) => setQOperativos(e.target.value)} placeholder="Buscar.." />
                </div>
                <div className="filter-actions">
                  <button type="submit" className="btn-secondary">Buscar</button>
                </div>
              </form>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombres</th><th>Apellidos</th><th>Categoría</th><th>Sede</th><th>N° documento</th><th>Turno</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {operativos.map((o) => (
                    <tr key={o.id}>
                      <td>{o.nombres || o.full_name}</td>
                      <td>{o.apellidos || ''}</td>
                      <td>{CATEGORIA_STAFF_LABEL[o.categoria_staff] || o.categoria_staff}</td>
                      <td>{o.sucursal_nombre || 'Todas las sedes'}</td>
                      <td>{o.dni ? `DNI : ${o.dni}` : '—'}</td>
                      <td>{o.turno === 'manana' ? 'Mañana' : o.turno === 'tarde' ? 'Tarde' : '—'}</td>
                      <td>
                        <span className={'badge ' + (o.activo ? 'badge-good' : 'badge-critical')}>
                          {o.activo ? 'Habilitado' : 'Deshabilitado'}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button className="btn-link" onClick={() => openEditOperativo(o)}>Editar</button>
                        <button className={'btn-link' + (o.activo ? ' danger' : '')} onClick={() => handleToggleEstadoOperativo(o)}>
                          {o.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {operativos.length === 0 && (
                    <tr><td colSpan={8} className="empty-row">No hay entrenadores ni supervisores operativos registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'metas' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Metas de venta</h3>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Asigna una meta mensual (S/) por sede para Vendedores y para Trainers, y opcionalmente la
                dotación de ese equipo (cuántas personas la reparten) — si no la asignas, se reparte entre
                los empleados activos de esa categoría en esa sede. Alimenta el Ranking Trainers/Vendedores
                y el Resumen de sedes del Dashboard.
              </p>
              <div className="filter-panel">
                <div className="filter-field">
                  <label>Año</label>
                  <input type="number" value={metasAnio} onChange={(e) => setMetasAnio(Number(e.target.value))} style={{ width: 100 }} />
                </div>
                <div className="filter-field">
                  <label>Mes</label>
                  <select value={metasMes} onChange={(e) => setMetasMes(Number(e.target.value))}>
                    {MESES.map((nombre, idx) => (
                      <option key={idx} value={idx + 1}>{nombre}</option>
                    ))}
                  </select>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sede</th><th>Categoría</th><th style={{ textAlign: 'right' }}>Empleados activos</th>
                    <th style={{ textAlign: 'right' }}>Dotación</th>
                    <th style={{ textAlign: 'right' }}>Meta total del pool (S/)</th>
                    <th style={{ textAlign: 'right' }}>Meta individual aprox.</th>
                  </tr>
                </thead>
                <tbody>
                  {filasMetas.map((f) => {
                    const key = `${f.sucursal_id}:${f.categoria_staff}`;
                    const dotacionEfectiva = f.dotacion > 0 ? f.dotacion : f.cantidad_empleados;
                    const individual = dotacionEfectiva > 0 ? f.monto_meta / dotacionEfectiva : 0;
                    return (
                      <tr key={key}>
                        <td>{f.sede_nombre}</td>
                        <td>{CATEGORIA_STAFF_LABEL[f.categoria_staff] || f.categoria_staff}</td>
                        <td style={{ textAlign: 'right' }}>{f.cantidad_empleados}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            style={{ width: 80, textAlign: 'right' }}
                            disabled={metasGuardando === key}
                            placeholder={String(f.cantidad_empleados)}
                            value={f.dotacion || ''}
                            onChange={(e) => {
                              const valor = e.target.value;
                              setFilasMetas((filas) => filas.map((fila) => (
                                fila.sucursal_id === f.sucursal_id && fila.categoria_staff === f.categoria_staff
                                  ? { ...fila, dotacion: valor === '' ? '' : Number(valor) }
                                  : fila
                              )));
                            }}
                            onBlur={(e) => guardarDotacion(f.sucursal_id, f.categoria_staff, Number(e.target.value) || 0)}
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            style={{ width: 130, textAlign: 'right' }}
                            disabled={metasGuardando === key}
                            value={f.monto_meta ?? ''}
                            onChange={(e) => {
                              const valor = e.target.value;
                              setFilasMetas((filas) => filas.map((fila) => (
                                fila.sucursal_id === f.sucursal_id && fila.categoria_staff === f.categoria_staff
                                  ? { ...fila, monto_meta: valor === '' ? '' : Number(valor) }
                                  : fila
                              )));
                            }}
                            onBlur={(e) => guardarMetaPool(f.sucursal_id, f.categoria_staff, Number(e.target.value) || 0)}
                          />
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--ink-muted)' }}>
                          {dotacionEfectiva > 0 ? `S/ ${individual.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {filasMetas.length === 0 && (
                    <tr><td colSpan={6} className="empty-row">No hay sedes activas.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {seccion === 'descuentos' && (
            <>
              <div className="report-toolbar">
                <h3 style={{ margin: 0 }}>Descuentos</h3>
                <button className="btn-primary" style={{ width: 'auto' }} onClick={openNuevoDescuento}>Nuevo descuento</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Un % con nombre y vigencia (ej. "Descuento Gimnasio" 10%) que el vendedor elige de una lista al
                registrar una venta, en vez de escribir el % a mano. Aplica sobre el total de toda la venta.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre</th><th style={{ textAlign: 'right' }}>Porcentaje</th><th>Sede</th>
                    <th>Vigencia</th><th>Estado</th><th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {descuentos.map((d) => (
                    <tr key={d.id}>
                      <td>{d.nombre}</td>
                      <td style={{ textAlign: 'right' }}>{d.porcentaje}%</td>
                      <td>{d.sede_nombre || 'Todas las sedes'}</td>
                      <td>{d.fecha_inicio} → {d.fecha_fin}</td>
                      <td><span className={`badge ${d.activo ? 'badge-good' : 'badge-neutral'}`}>{d.activo ? 'Activo' : 'Desactivado'}</span></td>
                      <td>
                        <button className="btn-link" onClick={() => openEditDescuento(d)}>Editar</button>{' '}
                        <button className="btn-link danger" onClick={() => handleToggleEstadoDescuento(d)}>
                          {d.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {descuentos.length === 0 && (
                    <tr><td colSpan={6} className="empty-row">No hay descuentos creados todavía.</td></tr>
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

          {seccion === 'importador' && (
            <>
              <h3 style={{ marginTop: 0 }}>Importador de Datos Masivos</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
                Sube un CSV o Excel (.xlsx) para cargar muchos registros de una sola vez. Cada tarjeta tiene su propia
                plantilla — descárgala, complétala y súbela de vuelta.
              </p>
              <div className="metodos-pago-grid">
                {IMPORTADORES_MASIVOS.map((config) => (
                  <div key={config.key} className="metodo-pago-card">
                    <div className="metodo-pago-icon" style={{ background: 'var(--brand-blue, #0f4c81)' }}>
                      <config.Icon size={18} color="#fff" />
                    </div>
                    <div className="metodo-pago-info">
                      <strong>{config.titulo}</strong>
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{config.descripcion}</span>
                    </div>
                    <div className="metodo-pago-actions">
                      <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => openImportador(config.key)}>
                        Cargar
                      </button>
                    </div>
                  </div>
                ))}
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
              <label>Rol *</label>
              <select required value={nivelDesdeForm(form, roles)} onChange={(e) => handleNivelChange(e.target.value)}>
                <option value="administrador">Administrador (acceso total)</option>
                <option value="supervisor">Supervisor</option>
                <option value="cajero">Cajero</option>
              </select>
              <label>Sede</label>
              <select value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}>
                <option value="">Todas las sedes (puede elegir al ingresar)</option>
                {sucursales.filter((s) => s.activo).map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <div className="form-row">
                <div>
                  <label>Categoría (Tablero de Ventas)</label>
                  <select value={form.categoria_staff} onChange={(e) => setForm({ ...form, categoria_staff: e.target.value })}>
                    <option value="vendedor">Vendedor</option>
                    <option value="trainer">Trainer</option>
                    <option value="supervisor">Supervisor</option>
                  </select>
                </div>
                <div>
                  <label>Turno</label>
                  <select value={form.turno} onChange={(e) => setForm({ ...form, turno: e.target.value })}>
                    <option value="">Sin turno</option>
                    <option value="manana">Mañana</option>
                    <option value="tarde">Tarde</option>
                  </select>
                </div>
              </div>
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

      {showOperativoForm && (
        <div className="modal-overlay" onClick={() => setShowOperativoForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingOperativoId ? 'Editar registro' : 'Nuevo Entrenador o Supervisor operativo'}</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
              No crea un usuario del sistema — esta persona no puede iniciar sesión ni facturar, solo queda
              disponible para el Ranking del Tablero de Ventas y para atribuirle ventas desde Ventas.
            </p>
            <form onSubmit={handleSubmitOperativo}>
              <div className="form-row">
                <div>
                  <label>Nombre *</label>
                  <input required value={operativoForm.nombres} onChange={(e) => setOperativoForm({ ...operativoForm, nombres: e.target.value })} />
                </div>
                <div>
                  <label>Apellidos *</label>
                  <input required value={operativoForm.apellidos} onChange={(e) => setOperativoForm({ ...operativoForm, apellidos: e.target.value })} />
                </div>
              </div>
              <label>DNI * (8 dígitos)</label>
              <input required value={operativoForm.dni} onChange={(e) => setOperativoForm({ ...operativoForm, dni: e.target.value })} maxLength={8} />
              <div className="form-row">
                <div>
                  <label>Categoría *</label>
                  <select required value={operativoForm.categoria_staff} onChange={(e) => setOperativoForm({ ...operativoForm, categoria_staff: e.target.value })}>
                    <option value="trainer">Trainer</option>
                    <option value="supervisor">Supervisor operativo</option>
                  </select>
                </div>
                <div>
                  <label>Turno</label>
                  <select value={operativoForm.turno} onChange={(e) => setOperativoForm({ ...operativoForm, turno: e.target.value })}>
                    <option value="">Sin turno</option>
                    <option value="manana">Mañana</option>
                    <option value="tarde">Tarde</option>
                  </select>
                </div>
              </div>
              <label>Sede</label>
              <select value={operativoForm.sucursal_id} onChange={(e) => setOperativoForm({ ...operativoForm, sucursal_id: e.target.value })}>
                <option value="">Todas las sedes</option>
                {sucursales.filter((s) => s.activo).map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              {errorOperativoForm && <div className="form-error">{errorOperativoForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowOperativoForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingOperativoId ? 'Guardar cambios' : 'Guardar registro'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCargaMasivaOperativos && (
        <div className="modal-overlay" onClick={() => setShowCargaMasivaOperativos(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Carga masiva de Entrenadores/Supervisores operativos</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
              Sube un CSV o Excel (.xlsx) con columnas: dni, nombres, apellidos, categoria_staff, sede, turno. "categoria_staff" es
              trainer o supervisor. Si el DNI ya existe como registro operativo, lo actualiza; si no, lo crea.
              Ninguno de estos registros tiene usuario ni contraseña — no pueden iniciar sesión.
            </p>
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <button type="button" className="btn-link" onClick={descargarPlantillaCargaMasivaOperativos}>
                Descargar plantilla (CSV)
              </button>
              <button type="button" className="btn-link" onClick={descargarPlantillaCargaMasivaOperativosExcel}>
                Descargar plantilla (Excel)
              </button>
            </div>
            <form onSubmit={handleCargaMasivaOperativosSubmit}>
              <label>Archivo CSV o Excel</label>
              <input required type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleCargaOperativosFileChange} />
              {cargaOperativosFileName && (
                <p className="caja-row-auto">{cargaOperativosFileName} — {cargaOperativosRows.length} fila(s) detectadas.</p>
              )}
              {cargaOperativosResult && (
                <div style={{ marginTop: 10 }}>
                  <p>
                    <strong>{cargaOperativosResult.creados.length}</strong> creados, <strong>{cargaOperativosResult.actualizados.length}</strong> actualizados,{' '}
                    <strong>{cargaOperativosResult.errores.length}</strong> con error.
                  </p>
                  {cargaOperativosResult.errores.length > 0 && (
                    <ul style={{ fontSize: 12, color: 'var(--critical)', maxHeight: 120, overflowY: 'auto' }}>
                      {cargaOperativosResult.errores.map((e, i) => <li key={i}>{e.dni}: {e.error}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {errorCargaOperativos && <div className="form-error">{errorCargaOperativos}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCargaMasivaOperativos(false)}>Cerrar</button>
                <button type="submit" className="btn-primary">Cargar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {importadorActivo && (() => {
        const config = IMPORTADORES_MASIVOS.find((i) => i.key === importadorActivo);
        if (!config) return null;
        return (
          <div className="modal-overlay" onClick={() => setImportadorActivo(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Importar — {config.titulo}</h2>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
                Sube un CSV o Excel (.xlsx) con columnas: {config.columnas.join(', ')}. {config.descripcion}
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                <button type="button" className="btn-link" onClick={() => descargarPlantillaImportador(config)}>
                  Descargar plantilla (CSV)
                </button>
                <button type="button" className="btn-link" onClick={() => descargarPlantillaImportadorExcel(config)}>
                  Descargar plantilla (Excel)
                </button>
              </div>
              <form onSubmit={handleImportSubmit}>
                <label>Archivo CSV o Excel</label>
                <input required type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleImportFileChange} />
                {importFileName && (
                  <p className="caja-row-auto">{importFileName} — {importRows.length} fila(s) detectadas.</p>
                )}
                {importResult && (
                  <div style={{ marginTop: 10 }}>
                    <p>
                      <strong>{importResult.creados?.length || 0}</strong> creados, <strong>{importResult.actualizados?.length || 0}</strong> actualizados,{' '}
                      <strong>{importResult.errores?.length || 0}</strong> con error.
                    </p>
                    {importResult.errores?.length > 0 && (
                      <ul style={{ fontSize: 12, color: 'var(--critical)', maxHeight: 120, overflowY: 'auto' }}>
                        {importResult.errores.map((e, i) => <li key={i}>{primerIdentificadorError(e)}: {e.error}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                {errorImport && <div className="form-error">{errorImport}</div>}
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setImportadorActivo(null)}>Cerrar</button>
                  <button type="submit" className="btn-primary" disabled={savingImport}>{savingImport ? 'Cargando...' : 'Cargar'}</button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {showOperativoForm && (
        <div className="modal-overlay" onClick={() => setShowOperativoForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingOperativoId ? 'Editar registro' : 'Nuevo Entrenador o Supervisor operativo'}</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -6 }}>
              No crea un usuario del sistema — esta persona no puede iniciar sesión ni facturar, solo queda
              disponible para el Ranking del Tablero de Ventas y para atribuirle ventas desde Ventas.
            </p>
            <form onSubmit={handleSubmitOperativo}>
              <div className="form-row">
                <div>
                  <label>Nombre *</label>
                  <input required value={operativoForm.nombres} onChange={(e) => setOperativoForm({ ...operativoForm, nombres: e.target.value })} />
                </div>
                <div>
                  <label>Apellidos *</label>
                  <input required value={operativoForm.apellidos} onChange={(e) => setOperativoForm({ ...operativoForm, apellidos: e.target.value })} />
                </div>
              </div>
              <label>DNI * (8 dígitos)</label>
              <input required value={operativoForm.dni} onChange={(e) => setOperativoForm({ ...operativoForm, dni: e.target.value })} maxLength={8} />
              <div className="form-row">
                <div>
                  <label>Categoría *</label>
                  <select required value={operativoForm.categoria_staff} onChange={(e) => setOperativoForm({ ...operativoForm, categoria_staff: e.target.value })}>
                    <option value="trainer">Trainer</option>
                    <option value="supervisor">Supervisor operativo</option>
                  </select>
                </div>
                <div>
                  <label>Turno</label>
                  <select value={operativoForm.turno} onChange={(e) => setOperativoForm({ ...operativoForm, turno: e.target.value })}>
                    <option value="">Sin turno</option>
                    <option value="manana">Mañana</option>
                    <option value="tarde">Tarde</option>
                  </select>
                </div>
              </div>
              <label>Sede</label>
              <select value={operativoForm.sucursal_id} onChange={(e) => setOperativoForm({ ...operativoForm, sucursal_id: e.target.value })}>
                <option value="">Todas las sedes</option>
                {sucursales.filter((s) => s.activo).map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              {errorOperativoForm && <div className="form-error">{errorOperativoForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowOperativoForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingOperativoId ? 'Guardar cambios' : 'Guardar registro'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDescuentoForm && (
        <div className="modal-overlay" onClick={() => setShowDescuentoForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingDescuentoId ? 'Editar descuento' : 'Nuevo descuento'}</h2>
            <form onSubmit={handleSubmitDescuento}>
              <label>Nombre *</label>
              <input required value={descuentoForm.nombre} onChange={(e) => setDescuentoForm({ ...descuentoForm, nombre: e.target.value })} placeholder="Ej. Descuento Gimnasio" />

              <label>Porcentaje (%) *</label>
              <input required type="number" min="0.01" max="100" step="0.01" value={descuentoForm.porcentaje}
                onChange={(e) => setDescuentoForm({ ...descuentoForm, porcentaje: e.target.value })} />

              <label>Sede</label>
              <select value={descuentoForm.sucursal_id} onChange={(e) => setDescuentoForm({ ...descuentoForm, sucursal_id: e.target.value })}>
                <option value="">Todas las sedes</option>
                {sucursales.filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>

              <div className="form-row">
                <div>
                  <label>Vigencia desde *</label>
                  <input required type="date" value={descuentoForm.fecha_inicio} onChange={(e) => setDescuentoForm({ ...descuentoForm, fecha_inicio: e.target.value })} />
                </div>
                <div>
                  <label>Vigencia hasta *</label>
                  <input required type="date" value={descuentoForm.fecha_fin} min={descuentoForm.fecha_inicio} onChange={(e) => setDescuentoForm({ ...descuentoForm, fecha_fin: e.target.value })} />
                </div>
              </div>

              {errorDescuentoForm && <div className="form-error">{errorDescuentoForm}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowDescuentoForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingDescuentoId ? 'Guardar cambios' : 'Crear descuento'}</button>
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

      {showSolicitudSedeForm && (
        <div className="modal-overlay" onClick={() => setShowSolicitudSedeForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Solicitar nueva sede</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Ya usaste tus sedes libres. Esta solicitud la revisa tu proveedor — te avisamos cuando quede lista.
            </p>
            <form onSubmit={handleSubmitSolicitudSede}>
              <label>Nombre</label>
              <input required value={solicitudSedeForm.nombre} onChange={(e) => setSolicitudSedeForm({ ...solicitudSedeForm, nombre: e.target.value })} />
              <label>Dirección</label>
              <input value={solicitudSedeForm.direccion} onChange={(e) => setSolicitudSedeForm({ ...solicitudSedeForm, direccion: e.target.value })} />
              <label>Motivo (opcional)</label>
              <input value={solicitudSedeForm.motivo} onChange={(e) => setSolicitudSedeForm({ ...solicitudSedeForm, motivo: e.target.value })} placeholder="Ej. Abrimos un local nuevo en..." />
              {errorSolicitudSede && <div className="form-error">{errorSolicitudSede}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowSolicitudSedeForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Enviar solicitud</button>
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
