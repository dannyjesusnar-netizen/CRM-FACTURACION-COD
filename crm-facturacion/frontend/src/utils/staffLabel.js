// Etiqueta legible para un empleado del selector "Atribuir venta a" (ver
// GET /api/invoices/entrenadores) — usado en RegistroVenta.jsx,
// RegistroNotaVenta.jsx e Invoices.jsx.
export function labelStaff(e) {
  if (e.role === 'gerencia') return 'Gerencia';
  if (e.categoria_staff === 'trainer') return 'Trainer';
  if (e.categoria_staff === 'supervisor') return 'Supervisor';
  return 'Vendedor';
}
