require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/companies');

const app = express();
const PORT = process.env.PORT || 4100;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'panel-central-backend' }));

// Mismos paths que cuando se sirve integrado dentro de crm-facturacion (ver
// crm-facturacion/backend/server.js) — así el frontend (compilado con
// base: '/panel/' y llamando a /panel-api) funciona igual acá en desarrollo
// standalone que integrado en producción.
app.use('/panel-api/auth', authRoutes);
app.use('/panel-api/companies', companyRoutes);

// Si existe el build del frontend (frontend/dist), lo servimos desde el
// mismo servidor, bajo /panel — igual que queda integrado en crm-facturacion.
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use('/panel', express.static(frontendDist));
  app.get('/panel/*', (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  app.get('/', (req, res) => res.redirect('/panel'));
}

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
  console.log(`Panel central backend escuchando en puerto ${PORT}`);
});
