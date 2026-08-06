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

// Si existe el build del frontend (frontend/dist), lo servimos desde el mismo
// servidor. Asi el despliegue queda como un unico servicio (una sola URL).
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
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
