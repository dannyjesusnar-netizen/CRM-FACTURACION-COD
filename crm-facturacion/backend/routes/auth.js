const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const tenantRegistry = require('../tenantRegistry');
const { resolveTenantDb } = require('../utils/tenant');
const { consultarRuc } = require('../utils/rucLookup');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { passwordError } = require('../utils/password');
const { permisosDeUsuario, esGerenciaOSupervisor, puedeVerTableroVentas } = require('../utils/permisos');

const router = express.Router();

function emitirToken(res, user, ruc) {
  const token = jwt.sign(
    { id: user.id, username: user.username, full_name: user.full_name, role: user.role, ruc },
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
      // Ver el Tablero de Ventas: config-driven, ver Configuración → Roles →
      // Inicio → "Tablero de Ventas" (puedeVerTableroVentas). Reatribuir una
      // venta a otro Trainer/Supervisor desde Facturas es un permiso aparte,
      // que sigue reservado a Gerencia/Supervisor sin pasar por ese toggle.
      puede_ver_tablero: puedeVerTableroVentas(user),
      puede_reatribuir_venta: esGerenciaOSupervisor(user),
    }
  });
}

router.post('/login', (req, res) => {
  const { ruc, dni, password } = req.body || {};
  if (!dni || !password) {
    return res.status(400).json({ error: 'DNI y contraseña son requeridos.' });
  }
  if (ruc) return loginConRuc(req, res, ruc, dni, password);
  return loginSoloConDni(req, res, dni, password);
});

// Login clásico (RUC ya conocido): identifica una única empresa candidata
// directamente. Hoy el frontend lo usa solo para desambiguar cuando el mismo
// DNI+contraseña son válidos en más de una empresa (ver loginSoloConDni) —
// se mantiene igual que siempre para no cambiar ese comportamiento.
function loginConRuc(req, res, ruc, dni, password) {
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
  // Suspensión manual del dueño de la plataforma (ej. falta de pago) — a
  // diferencia de "rechazado", puede reactivarse en cualquier momento desde
  // panel-central sin perder la aprobación ni el historial.
  if (tenant && tenant.estado === 'aprobado' && !tenant.activo) {
    return res.status(403).json({ error: 'Tu empresa fue suspendida temporalmente. Contacta al soporte de la plataforma.' });
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
    if (!user.puede_iniciar_sesion) {
      return res.status(403).json({ error: 'Este perfil es un registro operativo (Trainer/Supervisor) sin acceso al sistema.' });
    }
    emitirToken(res, user, tenant ? ruc : null);
  });
}

// Login simplificado: la persona solo escribe su DNI y su contraseña, sin
// necesitar saber el RUC de su empresa. Como cada empresa vive en su propia
// base de datos aislada, hay que recorrer las empresas conocidas buscando en
// cuál existe ese DNI con esa contraseña — las conexiones quedan en caché
// (ver db.js openTenantDb) así que a partir del segundo intento es rápido.
function loginSoloConDni(req, res, dni, password) {
  const tenants = tenantRegistry.listTodos();
  // Antes de que la instalación base de este despliegue se registre a sí
  // misma (tenantRegistry.adoptarInstanciaBase, corre al arrancar el
  // servidor), sus usuarios todavía no aparecen en el registro — se agrega
  // como candidato aparte para no dejarlos sin poder entrar en ese primer
  // momento.
  const candidatos = tenants.some((t) => t.es_instalacion_base) ? tenants : [...tenants, null];

  const coincidencias = [];
  for (const tenant of candidatos) {
    const ruc = tenant ? tenant.ruc : null;
    // pendiente/rechazado: resolveTenantDb no los abre (solo entrega bases de
    // empresas aprobadas), pero igual buscamos ahí para poder devolver el
    // mensaje específico si de verdad hay una coincidencia de credenciales.
    const tenantDb = (tenant && tenant.estado !== 'aprobado')
      ? db.openTenantDb(tenant.db_file)
      : resolveTenantDb(ruc);
    if (!tenantDb) continue;

    const encontrado = db.runWithDb(tenantDb, () => {
      const user = db.prepare('SELECT * FROM users WHERE dni = ?').get(dni);
      if (!user || !user.puede_iniciar_sesion || !bcrypt.compareSync(password, user.password_hash)) return null;
      return user;
    });
    if (encontrado) coincidencias.push({ tenant, ruc, user: encontrado });
  }

  if (coincidencias.length === 0) {
    return res.status(401).json({ error: 'DNI o contraseña incorrectos.' });
  }
  if (coincidencias.length > 1) {
    // Mismo DNI+contraseña válidos en más de una empresa (una persona puede
    // trabajar en varias) — no hay forma de saber cuál sin preguntar.
    return res.status(409).json({
      ambiguo: true,
      error: 'Tu DNI está registrado en más de una empresa. Elige con cuál quieres ingresar.',
      empresas: coincidencias.map((c) => ({ ruc: c.ruc, nombre: c.tenant?.razon_social || 'Empresa' })),
    });
  }

  const { tenant, ruc, user } = coincidencias[0];
  if (tenant && tenant.estado === 'pendiente') {
    return res.status(403).json({ error: 'Tu empresa está registrada pero aún no fue aprobada. Te avisaremos apenas esté activa.' });
  }
  if (tenant && tenant.estado === 'rechazado') {
    return res.status(401).json({ error: 'DNI o contraseña incorrectos.' });
  }
  if (tenant && tenant.estado === 'aprobado' && !tenant.activo) {
    return res.status(403).json({ error: 'Tu empresa fue suspendida temporalmente. Contacta al soporte de la plataforma.' });
  }
  if (!user.activo) {
    return res.status(403).json({ error: 'Esta cuenta está desactivada. Contacta a un administrador.' });
  }
  db.runWithDb(resolveTenantDb(ruc), () => emitirToken(res, user, tenant ? ruc : null));
}

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
