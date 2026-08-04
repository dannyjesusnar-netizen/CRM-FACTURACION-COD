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

app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);

// Si existe el build del frontend (frontend/dist), lo servimos desde el
// mismo servidor, igual que crm-facturacion, para quedar como un unico
// servicio (una sola URL) en Render.
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
  console.log(`Panel central backend escuchando en puerto ${PORT}`);
});
