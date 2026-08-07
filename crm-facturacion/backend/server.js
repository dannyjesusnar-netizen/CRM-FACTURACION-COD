require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const productRoutes = require('./routes/products');
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
const cotizacionRoutes = require('./routes/cotizaciones');
const guiaRoutes = require('./routes/guias');
const empresaRoutes = require('./routes/empresa');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const platformRoutes = require('./routes/platform');
const metodoPagoRoutes = require('./routes/metodosPago');
const serieRoutes = require('./routes/series');

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

app.use(cors());
// Limite mayor al default (100kb) para permitir subir el logo de la empresa
// como data URL en el mismo PUT /api/empresa.
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'crm-facturacion-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/products', productRoutes);
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
app.use('/api/cotizaciones', cotizacionRoutes);
app.use('/api/guias', guiaRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/metodos-pago', metodoPagoRoutes);
app.use('/api/series', serieRoutes);

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

app.listen(PORT, () => {
  console.log(`CRM Facturacion backend escuchando en puerto ${PORT}`);
});
