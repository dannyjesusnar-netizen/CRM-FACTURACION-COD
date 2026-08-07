// Ventana de confirmación genérica para acciones que emiten un documento
// o generan un movimiento (Guía, Nota de crédito, etc.) — evita que un
// clic accidental dispare la acción sin que la persona la confirme.
export default function ConfirmDialog({
  open, title = '¿Seguro que quieres realizar esta acción?', message, confirmLabel = 'Sí', cancelLabel = 'No',
  loading = false, onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {message && <p style={{ color: 'var(--ink-secondary)', fontSize: 13.5, marginTop: 10 }}>{message}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
          <button type="button" className="btn-primary" style={{ background: 'var(--good)', borderColor: 'var(--good)' }}
            onClick={onConfirm} disabled={loading}>
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
