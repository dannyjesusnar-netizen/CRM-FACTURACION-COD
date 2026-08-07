const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { resolveTenantDb } = require('../utils/tenant');
const { consultarRuc } = require('../utils/rucLookup');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { passwordError } = require('../utils/password');
const { permisosDeUsuario } = require('../utils/permisos');

const router = express.Router();

router.post('/login', (req, res) => {
  const { ruc, dni, password } = req.body || {};
  if (!ruc || !dni || !password) {
    return res.status(400).json({ error: 'RUC, DNI y contraseña son requeridos.' });
  }

  // Si el RUC corresponde a una empresa que se registró desde "Registrar mi
  // empresa" (ver POST /register), su acceso depende de que ya haya sido
  // aprobada — antes de eso ni siquiera llegamos a validar el DNI/contraseña.
  const tenant = tenantRegistry.findTenant(ruc);
  if (tenant && tenant.estado === 'pendiente') {
    return res.status(403).json({ error: 'Tu empresa está registrada pero aún no fue aprobada. Te avisaremos apenas esté activa.' });
  }
  if (tenant && tenant.estado === 'rechazado') {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }

  const tenantDb = resolveTenantDb(ruc);

  db.runWithDb(tenantDb, () => {
    // Si aun no configuro su RUC (primer ingreso tras desplegar la instancia
    // original), no bloqueamos por RUC para no dejar a Gerencia sin forma de
    // entrar y configurarlo.
    if (!tenant) {
      const empresa = db.prepare('SELECT ruc FROM empresa_config WHERE id = 1').get();
      if (empresa && empresa.ruc && empresa.ruc !== ruc) {
        return res.status(401).json({ error: 'Credenciales incorrectas.' });
      }
    }
    const user = db.prepare('SELECT * FROM users WHERE dni = ?').get(dni);
    if (!user) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }
    if (!user.activo) {
      return res.status(403).json({ error: 'Esta cuenta está desactivada. Contacta a un administrador.' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, full_name: user.full_name, role: user.role, ruc: tenant ? ruc : null },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    const sucursalFija = user.sucursal_id
      ? db.prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(user.sucursal_id)
      : null;
    res.json({
      token,
      user: {
        id: user.id, username: user.username, full_name: user.full_name, role: user.role, dni: user.dni,
        sucursal_id: sucursalFija?.id || null, sucursal_nombre: sucursalFija?.nombre || null,
        custom_role_id: user.custom_role_id || null,
        permisos: permisosDeUsuario(user),
      }
    });
  });
});

// POST /api/auth/register — alta de una empresa nueva en este mismo
// despliegue, sin necesitar un servidor aparte. Crea su base de datos propia
// (aislada del resto) y su primera cuenta Gerencia, pero queda "pendiente"
// hasta que el dueño del producto la apruebe (ver /api/platform) — no se
// puede iniciar sesión todavía con ella.
router.post('/register', async (req, res) => {
  const {
    ruc, razon_social, nombre_comercial, direccion_fiscal, telefono, email,
    nombres, apellidos, dni, password, acepta_terminos,
  } = req.body || {};

  if (!ruc || !razon_social || !nombres || !apellidos || !dni || !password) {
    return res.status(400).json({ error: 'RUC, razón social, nombres, apellidos, DNI y contraseña son requeridos.' });
  }
  if (!acepta_terminos) {
    return res.status(400).json({ error: 'Debes aceptar los Términos de Servicio y la Política de Privacidad.' });
  }
  if (!/^\d{11}$/.test(ruc)) {
    return res.status(400).json({ error: 'El RUC debe tener 11 dígitos.' });
  }
  if (!/^\d{8}$/.test(dni)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos.' });
  }
  const pwdErr = passwordError(password);
  if (pwdErr) {
    return res.status(400).json({ error: pwdErr });
  }

  // Verificación real contra SUNAT (mejor esfuerzo, vía un proveedor externo
  // — ver utils/rucLookup.js). Sin RUC_LOOKUP_TOKEN configurado o si el
  // servicio no responde, esto no bloquea el registro; solo se rechaza
  // cuando hay una respuesta clara de que el RUC no existe o está inactivo.
  const rucInfo = await consultarRuc(ruc);
  if (rucInfo.verificado) {
    if (!rucInfo.existe) {
      return res.status(400).json({ error: 'Ese RUC no existe en SUNAT.' });
    }
    if (rucInfo.estado && rucInfo.estado.toUpperCase() !== 'ACTIVO') {
      return res.status(400).json({ error: `Ese RUC figura como "${rucInfo.estado}" en SUNAT — no se puede registrar.` });
    }
  }

  if (tenantRegistry.findTenant(ruc)) {
    return res.status(400).json({ error: 'Ese RUC ya está registrado.' });
  }
  // La empresa original de este despliegue (la que no pasó por este
  // registro) también podría tener ya ese RUC configurado.
  const empresaOriginal = db.openTenantDb(db.DEFAULT_DB_PATH).prepare('SELECT ruc FROM empresa_config WHERE id = 1').get();
  if (empresaOriginal && empresaOriginal.ruc === ruc) {
    return res.status(400).json({ error: 'Ese RUC ya está registrado.' });
  }

  const tenant = tenantRegistry.crearTenant({ ruc, razon_social });
  db.openTenantDb(tenant.db_file, {
    demo: false,
    empresa: { razon_social, ruc, nombre_comercial, direccion_fiscal, telefono, email },
    primerUsuario: {
      username: dni,
      password_hash: bcrypt.hashSync(password, 10),
      full_name: `${nombres} ${apellidos}`.trim(),
      dni,
      nombres,
      apellidos,
      email,
    },
  });

  res.status(201).json({
    ok: true,
    mensaje: 'Registro recibido. Tu empresa quedará activa apenas sea aprobada.',
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put('/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Contraseña actual y nueva contraseña son requeridas.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
  }
  const pwdErr = passwordError(new_password);
  if (pwdErr) {
    return res.status(400).json({ error: pwdErr });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ ok: true });
});

module.exports = router;
