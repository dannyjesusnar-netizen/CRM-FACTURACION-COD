const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireGerencia } = require('../middleware/auth');
const { passwordError } = require('../utils/password');

const router = express.Router();
router.use(requireAuth);
router.use(requireGerencia);

const ROLES = ['gerencia', 'vendedor'];
// categoria_staff agrupa al empleado en el Tablero de Ventas (Ranking
// Trainers/Vendedores/Supervisores) — no tiene relación con el rol de
// permisos (role/custom_role_id), que sigue controlando el acceso.
const CATEGORIAS_STAFF = ['vendedor', 'trainer', 'supervisor'];
const TURNOS = ['manana', 'tarde'];

function categoriaStaffOrError(categoriaStaff) {
  if (categoriaStaff === undefined) return { value: undefined };
  if (!categoriaStaff) return { value: 'vendedor' };
  if (!CATEGORIAS_STAFF.includes(categoriaStaff)) return { error: 'categoria_staff inválida.' };
  return { value: categoriaStaff };
}

function turnoOrError(turno) {
  if (turno === undefined) return { value: undefined };
  if (!turno) return { value: null };
  if (!TURNOS.includes(turno)) return { error: 'turno inválido. Use manana o tarde.' };
  return { value: turno };
}

function sinPassword(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// GET /api/users?q=&estado=
// Solo empleados con acceso real al sistema (puede_iniciar_sesion = 1) — los
// registros operativos (Trainer/Supervisor sin usuario, ver /operativos) se
// listan aparte para no mezclarlos con la gente que sí inicia sesión.
router.get('/', (req, res) => {
  const { q, estado } = req.query;
  let sql = `SELECT u.*, s.nombre AS sucursal_nombre, r.nombre AS rol_personalizado_nombre
             FROM users u
             LEFT JOIN sucursales s ON s.id = u.sucursal_id
             LEFT JOIN roles r ON r.id = u.custom_role_id
             WHERE u.puede_iniciar_sesion = 1`;
  const params = [];
  if (q) {
    sql += ' AND (u.full_name LIKE ? OR u.nombres LIKE ? OR u.apellidos LIKE ? OR u.username LIKE ? OR u.dni LIKE ? OR u.email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (estado === 'activo') { sql += ' AND u.activo = 1'; }
  if (estado === 'inactivo') { sql += ' AND u.activo = 0'; }
  sql += ' ORDER BY u.nombres ASC, u.full_name ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(sinPassword));
});

function sucursalIdOrError(sucursalId) {
  if (sucursalId === undefined || sucursalId === null || sucursalId === '') return { value: null };
  const suc = db.prepare('SELECT id FROM sucursales WHERE id = ? AND activo = 1').get(Number(sucursalId));
  if (!suc) return { error: 'La sede seleccionada no existe o está desactivada.' };
  return { value: suc.id };
}

function customRoleIdOrError(customRoleId) {
  if (customRoleId === undefined || customRoleId === null || customRoleId === '') return { value: null };
  const role = db.prepare('SELECT id FROM roles WHERE id = ? AND activo = 1').get(Number(customRoleId));
  if (!role) return { error: 'El rol seleccionado no existe o está desactivado.' };
  return { value: role.id };
}

// Contraseña con la que quedan todos los empleados creados por carga masiva
// — nunca viaja en el CSV (sería un archivo con contraseñas en texto plano),
// es la misma predeterminada que usa "Restablecer contraseña" en el frontend.
const PASSWORD_PREDETERMINADA = 'Lima2026*';

// El CSV usa el mismo vocabulario que el selector "Rol" del formulario
// individual (Administrador/Supervisor/Cajero) más cualquier otro rol
// personalizado que Gerencia ya haya creado, referenciado por su nombre
// exacto (no por id, que el usuario del CSV no tiene forma de conocer).
function nivelARolYCustomRole(nivelRaw) {
  const nivel = (nivelRaw || '').toString().trim();
  if (!nivel) return { error: 'nivel es requerido (Administrador, o el nombre exacto de un rol ya creado en Configuración → Roles, ej. Cajero, Supervisor).' };
  if (nivel.toLowerCase() === 'administrador' || nivel.toLowerCase() === 'gerencia') {
    return { role: 'gerencia', customRoleId: null };
  }
  const rol = db.prepare('SELECT id FROM roles WHERE nombre = ? AND activo = 1').get(nivel);
  if (!rol) {
    return { error: `El rol "${nivel}" no existe o está desactivado. Créalo primero en Configuración → Roles, o usa "Administrador".` };
  }
  return { role: 'vendedor', customRoleId: rol.id };
}

function sedeNombreASucursalId(sedeNombre) {
  const nombre = (sedeNombre || '').toString().trim();
  if (!nombre) return { value: null };
  const suc = db.prepare('SELECT id FROM sucursales WHERE nombre = ? AND activo = 1').get(nombre);
  if (!suc) return { error: `La sede "${nombre}" no existe o está desactivada.` };
  return { value: suc.id };
}

// POST /api/users/carga-masiva { rows: [{ dni, nombres, apellidos, username,
// nivel, sede, categoria_staff, turno, telefono, email }] }
// Crea empleados nuevos (por DNI) o actualiza los que ya existen — mismo
// criterio de "crear o actualizar" que products.js. La contraseña de un
// empleado nuevo siempre queda en PASSWORD_PREDETERMINADA; actualizar por
// esta vía nunca toca username ni contraseña de un empleado existente.
router.post('/carga-masiva', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows es requerido y debe tener al menos una fila.' });
  }
  const creados = [];
  const actualizados = [];
  const errores = [];

  for (const r of rows) {
    const dni = (r.dni || '').toString().trim();
    const nombres = (r.nombres || '').toString().trim();
    const apellidos = (r.apellidos || '').toString().trim();
    if (!dni || !nombres || !apellidos) {
      errores.push({ dni: dni || '(vacío)', error: 'dni, nombres y apellidos son requeridos.' });
      continue;
    }
    if (!/^\d{8}$/.test(dni)) {
      errores.push({ dni, error: 'El DNI debe tener 8 dígitos.' });
      continue;
    }
    const nivel = nivelARolYCustomRole(r.nivel);
    if (nivel.error) { errores.push({ dni, error: nivel.error }); continue; }
    const sede = sedeNombreASucursalId(r.sede);
    if (sede.error) { errores.push({ dni, error: sede.error }); continue; }
    const categoriaStaff = categoriaStaffOrError(r.categoria_staff);
    if (categoriaStaff.error) { errores.push({ dni, error: categoriaStaff.error }); continue; }
    const turnoResult = turnoOrError(r.turno);
    if (turnoResult.error) { errores.push({ dni, error: turnoResult.error }); continue; }
    const email = (r.email || '').toString().trim() || null;
    const telefono = (r.telefono || '').toString().trim() || null;
    const fullName = `${nombres} ${apellidos}`.trim();

    const existing = db.prepare('SELECT * FROM users WHERE dni = ?').get(dni);
    try {
      if (existing) {
        db.prepare(
          `UPDATE users SET full_name = ?, nombres = ?, apellidos = ?, email = ?, telefono = ?, role = ?,
           sucursal_id = ?, custom_role_id = ?, categoria_staff = ?, turno = ? WHERE id = ?`
        ).run(
          fullName, nombres, apellidos, email, telefono, nivel.role,
          sede.value, nivel.customRoleId, categoriaStaff.value, turnoResult.value,
          existing.id
        );
        actualizados.push({ dni, nombre: fullName });
      } else {
        const usernameRaw = (r.username || '').toString().trim();
        const username = usernameRaw || dni;
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
          errores.push({ dni, error: `El usuario "${username}" ya está en uso por otro empleado.` });
          continue;
        }
        const info = db.prepare(
          `INSERT INTO users (username, password_hash, full_name, nombres, apellidos, email, telefono, role, dni, activo, sucursal_id, custom_role_id, categoria_staff, turno)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
        ).run(
          username, bcrypt.hashSync(PASSWORD_PREDETERMINADA, 10), fullName, nombres, apellidos, email, telefono,
          nivel.role, dni, sede.value, nivel.customRoleId, categoriaStaff.value, turnoResult.value
        );
        creados.push({ dni, nombre: fullName });
      }
    } catch (err) {
      errores.push({ dni, error: 'No se pudo guardar esta fila.' });
    }
  }

  res.json({ creados, actualizados, errores, password_predeterminada: PASSWORD_PREDETERMINADA });
});

router.post('/', (req, res) => {
  const { username, password, nombres, apellidos, email, telefono, dni, role, sucursal_id, custom_role_id, categoria_staff, turno } = req.body || {};
  if (!username || !password || !nombres || !apellidos || !dni) {
    return res.status(400).json({ error: 'Usuario, contraseña, nombres, apellidos y DNI son requeridos.' });
  }
  if (!/^\d{8}$/.test(dni)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos.' });
  }
  const pwdErr = passwordError(password);
  if (pwdErr) {
    return res.status(400).json({ error: pwdErr });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: 'role inválido. Use gerencia o vendedor.' });
  }
  if (db.prepare('SELECT id FROM users WHERE dni = ?').get(dni)) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese DNI.' });
  }
  const sucursal = sucursalIdOrError(sucursal_id);
  if (sucursal.error) return res.status(400).json({ error: sucursal.error });
  const customRole = customRoleIdOrError(custom_role_id);
  if (customRole.error) return res.status(400).json({ error: customRole.error });
  const categoriaStaff = categoriaStaffOrError(categoria_staff);
  if (categoriaStaff.error) return res.status(400).json({ error: categoriaStaff.error });
  const turnoResult = turnoOrError(turno);
  if (turnoResult.error) return res.status(400).json({ error: turnoResult.error });
  const fullName = `${nombres} ${apellidos}`.trim();
  try {
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, full_name, nombres, apellidos, email, telefono, role, dni, activo, sucursal_id, custom_role_id, categoria_staff, turno)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).run(username, bcrypt.hashSync(password, 10), fullName, nombres, apellidos, email || null, telefono || null, role, dni, sucursal.value, customRole.value, categoriaStaff.value ?? 'vendedor', turnoResult.value ?? null);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(sinPassword(row));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario.' });
    }
    res.status(500).json({ error: 'Error al crear el usuario.' });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const { nombres, apellidos, email, telefono, dni, role, password, sucursal_id, custom_role_id, categoria_staff, turno } = req.body || {};
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'role inválido. Use gerencia o vendedor.' });
  }
  if (dni && !/^\d{8}$/.test(dni)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos.' });
  }
  if (password) {
    const pwdErr = passwordError(password);
    if (pwdErr) return res.status(400).json({ error: pwdErr });
  }
  if (dni && dni !== existing.dni && db.prepare('SELECT id FROM users WHERE dni = ? AND id != ?').get(dni, req.params.id)) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese DNI.' });
  }
  let sucursalId = existing.sucursal_id;
  if (sucursal_id !== undefined) {
    const sucursal = sucursalIdOrError(sucursal_id);
    if (sucursal.error) return res.status(400).json({ error: sucursal.error });
    sucursalId = sucursal.value;
  }
  let customRoleId = existing.custom_role_id;
  if (custom_role_id !== undefined) {
    const customRole = customRoleIdOrError(custom_role_id);
    if (customRole.error) return res.status(400).json({ error: customRole.error });
    customRoleId = customRole.value;
  }
  let categoriaStaffValue = existing.categoria_staff;
  if (categoria_staff !== undefined) {
    const categoriaStaff = categoriaStaffOrError(categoria_staff);
    if (categoriaStaff.error) return res.status(400).json({ error: categoriaStaff.error });
    categoriaStaffValue = categoriaStaff.value;
  }
  let turnoValue = existing.turno;
  if (turno !== undefined) {
    const turnoResult = turnoOrError(turno);
    if (turnoResult.error) return res.status(400).json({ error: turnoResult.error });
    turnoValue = turnoResult.value;
  }
  const nombresFinal = nombres ?? existing.nombres;
  const apellidosFinal = apellidos ?? existing.apellidos;
  const fullName = `${nombresFinal || ''} ${apellidosFinal || ''}`.trim() || existing.full_name;
  db.prepare(
    `UPDATE users SET full_name = ?, nombres = ?, apellidos = ?, email = ?, telefono = ?, dni = ?, role = ?, password_hash = ?, sucursal_id = ?, custom_role_id = ?, categoria_staff = ?, turno = ?
     WHERE id = ?`
  ).run(
    fullName,
    nombresFinal,
    apellidosFinal,
    email !== undefined ? (email || null) : existing.email,
    telefono !== undefined ? (telefono || null) : existing.telefono,
    dni ?? existing.dni,
    role ?? existing.role,
    password ? bcrypt.hashSync(password, 10) : existing.password_hash,
    sucursalId,
    customRoleId,
    categoriaStaffValue,
    turnoValue,
    req.params.id
  );
  res.json(sinPassword(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

// PUT /api/users/:id/estado { activo: true|false }
router.put('/:id/estado', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes activar/desactivar tu propia cuenta.' });
  }
  const { activo } = req.body || {};
  db.prepare('UPDATE users SET activo = ? WHERE id = ?').run(activo ? 1 : 0, req.params.id);
  res.json(sinPassword(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});

// --- Registros operativos (Trainer / Supervisor operativo) ---
// Personas que solo alimentan el Tablero de Ventas (ranking + atribución de
// ventas, ver routes/tablero.js e invoices.atribuido_a) — nunca inician
// sesión ni facturan, así que no necesitan usuario/contraseña reales.
// Reutilizan la misma tabla `users` (así el resto del sistema — ranking,
// selector "Atribuir venta a", cálculo de meta por headcount — no necesita
// ningún cambio: ya filtra por categoria_staff/activo), pero quedan
// marcados con puede_iniciar_sesion = 0 y bloqueados en el login.
const CATEGORIAS_OPERATIVO = ['trainer', 'supervisor'];

function generarUsernameOperativo(dni) {
  let candidato = `op_${dni}`;
  let intento = 0;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(candidato)) {
    intento += 1;
    candidato = `op_${dni}_${intento}`;
  }
  return candidato;
}

function passwordHashAleatorio() {
  return bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
}

// GET /api/users/operativos?q=&estado=
router.get('/operativos', (req, res) => {
  const { q, estado } = req.query;
  let sql = `SELECT u.*, s.nombre AS sucursal_nombre
             FROM users u
             LEFT JOIN sucursales s ON s.id = u.sucursal_id
             WHERE u.puede_iniciar_sesion = 0`;
  const params = [];
  if (q) {
    sql += ' AND (u.full_name LIKE ? OR u.nombres LIKE ? OR u.apellidos LIKE ? OR u.dni LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (estado === 'activo') { sql += ' AND u.activo = 1'; }
  if (estado === 'inactivo') { sql += ' AND u.activo = 0'; }
  sql += ' ORDER BY u.nombres ASC, u.full_name ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(sinPassword));
});

// POST /api/users/operativos { nombres, apellidos, dni, categoria_staff, sucursal_id, turno }
router.post('/operativos', (req, res) => {
  const { nombres, apellidos, dni, categoria_staff, sucursal_id, turno } = req.body || {};
  if (!nombres || !apellidos || !dni) {
    return res.status(400).json({ error: 'Nombres, apellidos y DNI son requeridos.' });
  }
  if (!/^\d{8}$/.test(dni)) {
    return res.status(400).json({ error: 'El DNI debe tener 8 dígitos.' });
  }
  if (!CATEGORIAS_OPERATIVO.includes(categoria_staff)) {
    return res.status(400).json({ error: 'categoria_staff inválida. Use trainer o supervisor.' });
  }
  if (db.prepare('SELECT id FROM users WHERE dni = ?').get(dni)) {
    return res.status(409).json({ error: 'Ya existe un empleado (con o sin acceso al sistema) con ese DNI.' });
  }
  const sucursal = sucursalIdOrError(sucursal_id);
  if (sucursal.error) return res.status(400).json({ error: sucursal.error });
  const turnoResult = turnoOrError(turno);
  if (turnoResult.error) return res.status(400).json({ error: turnoResult.error });

  const fullName = `${nombres} ${apellidos}`.trim();
  const info = db.prepare(
    `INSERT INTO users (username, password_hash, full_name, nombres, apellidos, role, dni, activo, sucursal_id, categoria_staff, turno, puede_iniciar_sesion)
     VALUES (?, ?, ?, ?, ?, 'vendedor', ?, 1, ?, ?, ?, 0)`
  ).run(generarUsernameOperativo(dni), passwordHashAleatorio(), fullName, nombres, apellidos, dni, sucursal.value, categoria_staff, turnoResult.value ?? null);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(sinPassword(row));
});

// POST /api/users/operativos/carga-masiva { rows: [{ dni, nombres, apellidos,
// categoria_staff, sede, turno }] } — crea o actualiza registros operativos
// por DNI. Si el DNI ya pertenece a un empleado CON acceso al sistema, la
// fila cae en error en vez de degradarlo silenciosamente a "sin acceso".
router.post('/operativos/carga-masiva', (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows es requerido y debe tener al menos una fila.' });
  }
  const creados = [];
  const actualizados = [];
  const errores = [];

  for (const r of rows) {
    const dni = (r.dni || '').toString().trim();
    const nombres = (r.nombres || '').toString().trim();
    const apellidos = (r.apellidos || '').toString().trim();
    if (!dni || !nombres || !apellidos) {
      errores.push({ dni: dni || '(vacío)', error: 'dni, nombres y apellidos son requeridos.' });
      continue;
    }
    if (!/^\d{8}$/.test(dni)) {
      errores.push({ dni, error: 'El DNI debe tener 8 dígitos.' });
      continue;
    }
    const categoriaStaff = (r.categoria_staff || '').toString().trim();
    if (!CATEGORIAS_OPERATIVO.includes(categoriaStaff)) {
      errores.push({ dni, error: 'categoria_staff inválida. Use trainer o supervisor.' });
      continue;
    }
    const sede = sedeNombreASucursalId(r.sede);
    if (sede.error) { errores.push({ dni, error: sede.error }); continue; }
    const turnoResult = turnoOrError(r.turno);
    if (turnoResult.error) { errores.push({ dni, error: turnoResult.error }); continue; }
    const fullName = `${nombres} ${apellidos}`.trim();

    const existing = db.prepare('SELECT * FROM users WHERE dni = ?').get(dni);
    if (existing && existing.puede_iniciar_sesion) {
      errores.push({ dni, error: 'Ese DNI ya pertenece a un empleado con acceso al sistema — edítalo desde Empleados, no desde esta carga.' });
      continue;
    }
    try {
      if (existing) {
        db.prepare(
          `UPDATE users SET full_name = ?, nombres = ?, apellidos = ?, sucursal_id = ?, categoria_staff = ?, turno = ? WHERE id = ?`
        ).run(fullName, nombres, apellidos, sede.value, categoriaStaff, turnoResult.value, existing.id);
        actualizados.push({ dni, nombre: fullName });
      } else {
        db.prepare(
          `INSERT INTO users (username, password_hash, full_name, nombres, apellidos, role, dni, activo, sucursal_id, categoria_staff, turno, puede_iniciar_sesion)
           VALUES (?, ?, ?, ?, ?, 'vendedor', ?, 1, ?, ?, ?, 0)`
        ).run(generarUsernameOperativo(dni), passwordHashAleatorio(), fullName, nombres, apellidos, dni, sede.value, categoriaStaff, turnoResult.value);
        creados.push({ dni, nombre: fullName });
      }
    } catch (err) {
      errores.push({ dni, error: 'No se pudo guardar esta fila.' });
    }
  }

  res.json({ creados, actualizados, errores });
});

module.exports = router;
