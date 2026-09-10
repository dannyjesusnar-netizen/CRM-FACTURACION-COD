require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

// Red de seguridad: Express 4 no atrapa un error async sin try/catch dentro
// de un route handler (a diferencia de Express 5) — esa promesa rechazada
// queda "unhandled", y desde Node 15 el comportamiento por defecto es
// terminar el proceso completo, afectando a todas las empresas de esta
// instancia, no solo a la petición que falló. Cada ruta async debería tener
// su propio try/catch (ver routes/invoices.js, routes/movements.js, etc.),
// pero esto evita que un caso que se nos haya escapado tumbe el servidor
// entero — la petición que causó el error queda sin respuesta (el cliente
// verá un timeout), pero el resto de usuarios sigue funcionando.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (revisar el try/catch de la ruta que la originó):', reason);
});

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const productRoutes = require('./routes/products');
const promocionRoutes = require('./routes/promociones');
const descuentoRoutes = require('./routes/descuentos');
const invoiceRoutes = require('./routes/invoices');
const reportRoutes = require('./routes/reports');
const movementRoutes = require('./routes/movements');
const loteRoutes = require('./routes/lotes');
const cajaRoutes = require('./routes/caja');
const sucursalRoutes = require('./routes/sucursales');
const trasladoRoutes = require('./routes/traslados');
const recetaRoutes = require('./routes/recetas');
const equivalenciaRoutes = require('./routes/equivalencias');
const supplierRoutes = require('./routes/suppliers');
const purchaseRoutes = require('./routes/purchases');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const tiposCompraRoutes = require('./routes/tiposCompra');
const tiposInventarioRoutes = require('./routes/tiposInventario');
const cotizacionRoutes = require('./routes/cotizaciones');
const guiaRoutes = require('./routes/guias');
const notaVentaRoutes = require('./routes/notasVenta');
const empresaRoutes = require('./routes/empresa');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const platformRoutes = require('./routes/platform');
const metodoPagoRoutes = require('./routes/metodosPago');
const serieRoutes = require('./routes/series');
const suscripcionRoutes = require('./routes/suscripcion');
const mensajesSoporteRoutes = require('./routes/mensajesSoporte');
const pagosQrRoutes = require('./routes/pagosQr');
const qrUnicoRoutes = require('./routes/qrUnico');
const pagoPublicoRoutes = require('./routes/pagoPublico');
const metasVentaRoutes = require('./routes/metasVenta');
const tableroRoutes = require('./routes/tablero');
const planillaRoutes = require('./routes/planilla');
const { procesarCobrosVencidos } = require('./utils/facturacionPlataforma');
const backup = require('./utils/backup');
const db = require('./db');
const tenantRegistry = require('./tenantRegistry');

// panel-central es una app hermana en este mismo repo (login propio, por
// correo+contraseña, con su propia base de datos — ver panel-central/README.md).
// Se sirve bajo el mismo dominio que este CRM, en /panel, en vez de tener su
// propia URL — cuando existe (build hecho, ver render.yaml), se monta acá.
const PANEL_CENTRAL_DIR = path.join(__dirname, '..', '..', 'panel-central');
const panelBackendDir = path.join(PANEL_CENTRAL_DIR, 'backend');
const panelCentralDisponible = fs.existsSync(panelBackendDir);
const panelAuthRoutes = panelCentralDisponible ? require(path.join(panelBackendDir, 'routes', 'auth')) : null;
const panelCompanyRoutes = panelCentralDisponible ? require(path.join(panelBackendDir, 'routes', 'companies')) : null;

const app = express();
const PORT = process.env.PORT || 4000;

// Render (y cualquier proxy delante de este servicio) reenvía la IP real del
// visitante en X-Forwarded-For — sin esto, Express ve la IP del proxy para
// TODAS las peticiones, y el límite de intentos de login (ver routes/auth.js
// y panel-central/backend/routes/auth.js, montado en este mismo app) se
// aplicaría a todo el tráfico junto en vez de por usuario. "1" = confiar en
// un solo salto de proxy (el de Render), no en cualquier IP que el cliente
// diga tener.
app.set('trust proxy', 1);

app.use(cors());
// Limite mayor al default (100kb) para permitir subir el logo de la empresa
// y las fotos de comprobantes de pago (QR estático) como data URL.
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'crm-facturacion-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/products', productRoutes);
app.use('/api/promociones', promocionRoutes);
app.use('/api/descuentos', descuentoRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/movements', movementRoutes);
app.use('/api/lotes', loteRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/sucursales', sucursalRoutes);
app.use('/api/traslados', trasladoRoutes);
app.use('/api/recetas', recetaRoutes);
app.use('/api/equivalencias', equivalenciaRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/tipos-compra', tiposCompraRoutes);
app.use('/api/tipos-inventario', tiposInventarioRoutes);
app.use('/api/cotizaciones', cotizacionRoutes);
app.use('/api/guias', guiaRoutes);
app.use('/api/notas-venta', notaVentaRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/metodos-pago', metodoPagoRoutes);
app.use('/api/series', serieRoutes);
app.use('/api/suscripcion', suscripcionRoutes);
app.use('/api/mensajes-soporte', mensajesSoporteRoutes);
app.use('/api/pagos-qr', pagosQrRoutes);
app.use('/api/qr-unico', qrUnicoRoutes);
app.use('/api/metas-venta', metasVentaRoutes);
app.use('/api/tablero', tableroRoutes);
app.use('/api/planilla', planillaRoutes);
// Pública (sin sesión) — la escanea el cliente del comercio desde el QR
// impreso, ver routes/pagoPublico.js.
app.use('/api/pago-publico', pagoPublicoRoutes);

// panel-central: su API vive en /panel-api (no /api, para no chocar con la
// de este CRM) y su login/base de datos son completamente independientes
// (correo+contraseña propios, ver PANEL_JWT_SECRET) — solo comparte el
// dominio con este despliegue.
if (panelCentralDisponible) {
  app.use('/panel-api/auth', panelAuthRoutes);
  app.use('/panel-api/companies', panelCompanyRoutes);

  const panelFrontendDist = path.join(PANEL_CENTRAL_DIR, 'frontend', 'dist');
  if (fs.existsSync(panelFrontendDist)) {
    app.use('/panel', express.static(panelFrontendDist));
    app.get('/panel/*', (req, res) => res.sendFile(path.join(panelFrontendDist, 'index.html')));
  }
}

// Si existe el build del frontend (frontend/dist), lo servimos desde el mismo
// servidor. Asi el despliegue queda como un unico servicio (una sola URL).
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/panel')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// Manejador de errores generico
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// Si la instalación base ya tiene RUC configurado (Configuración > Datos de
// la empresa), la da de alta en el registro de la plataforma como un
// cliente más — para instalaciones que ya guardaron sus datos antes de que
// existiera esta función, sin que el dueño tenga que volver a guardar nada
// (ver tenantRegistry.js:adoptarInstanciaBase).
const empresaBase = db.prepare('SELECT ruc, razon_social, nombre_comercial FROM empresa_config WHERE id = 1').get();
if (empresaBase?.ruc) {
  tenantRegistry.adoptarInstanciaBase({
    ruc: empresaBase.ruc,
    razon_social: empresaBase.nombre_comercial || empresaBase.razon_social,
  });
}

app.listen(PORT, () => {
  console.log(`CRM Facturacion backend escuchando en puerto ${PORT}`);
});

// Cobro recurrente de suscripciones a la plataforma (empresas con tarjeta
// guardada y costo mensual asignado, ver routes/suscripcion.js). Corre cada
// 6 horas — de sobra para que ningún cobro vencido espere más de eso, sin
// necesitar un cron externo. Si Izipay no está configurado, no hace nada
// (ver utils/izipay.js).
const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  procesarCobrosVencidos().catch((err) => console.error('Error procesando cobros de suscripción:', err));
}, SEIS_HORAS_MS);
procesarCobrosVencidos().catch((err) => console.error('Error procesando cobros de suscripción:', err));

// Respaldo automático de CADA empresa de esta instancia (la del despliegue
// original + cada una que se auto-registró desde "Registrar mi empresa" —
// ver tenantRegistry.listTodos()) — una vez al arrancar y luego cada 24
// horas. Se guarda en el mismo disco persistente (DATA_DIR/backups),
// conservando los últimos 7 por empresa (ver utils/backup.js, que nombra
// cada respaldo con el mismo identificador que ya distingue a esa empresa).
// Antes esto solo respaldaba la base por defecto (`db` fuera de una
// petición cae siempre ahí) — cualquier empresa auto-registrada se quedaba
// sin respaldo automático propio. Cada empresa se respalda por separado
// (try/catch individual) para que si una falla no impida el respaldo de
// las demás. Gerencia puede además crear uno al instante y descargar
// cualquiera de los suyos desde Configuración.
async function respaldarTodasLasEmpresas() {
  const tenants = tenantRegistry.listTodos();
  for (const tenant of tenants) {
    try {
      const tenantDb = db.openTenantDb(tenant.db_file);
      await backup.crearRespaldo(tenantDb);
    } catch (err) {
      console.error(`Error en respaldo automático de ${tenant.ruc}:`, err);
    }
  }
  // Antes de que la instalación base tenga su RUC configurado (ver
  // adoptarInstanciaBase más arriba), todavía no aparece en
  // tenantRegistry.listTodos() — se respalda igual "a mano" para que una
  // instancia recién desplegada nunca se quede sin respaldo automático.
  const yaIncluida = tenants.some((t) => t.db_file === db.DEFAULT_DB_PATH);
  if (!yaIncluida) {
    try {
      await backup.crearRespaldo(db.openTenantDb(db.DEFAULT_DB_PATH));
    } catch (err) {
      console.error('Error en respaldo automático de la instalación base:', err);
    }
  }
}
const UN_DIA_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  respaldarTodasLasEmpresas();
}, UN_DIA_MS);
respaldarTodasLasEmpresas();
