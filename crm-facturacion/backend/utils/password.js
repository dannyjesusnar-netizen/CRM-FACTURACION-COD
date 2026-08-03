function passwordError(password) {
  if (!password || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Z]/.test(password)) return 'La contraseña debe incluir al menos una letra mayúscula.';
  if (!/[a-z]/.test(password)) return 'La contraseña debe incluir al menos una letra minúscula.';
  if (!/[0-9]/.test(password)) return 'La contraseña debe incluir al menos un número.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'La contraseña debe incluir al menos un carácter especial (*, @, #, $, etc.).';
  return null;
}

module.exports = { passwordError };
