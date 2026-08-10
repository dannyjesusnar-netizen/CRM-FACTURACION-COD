import { useState } from 'react';
import { QrCode } from 'lucide-react';
import { useToast } from '../context/ToastContext';

// Botón + modal para mostrarle al cliente el QR (o link) de pago del método
// elegido — se usa en el cobro de una venta y en el registro de un cobro de
// una cuenta por cobrar. Solo aparece si el método tiene QR o link cargado
// desde Configuración -> Métodos de pago.
export default function MetodoPagoQr({ metodo, monto }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  if (!metodo || (!metodo.qr_data_url && !metodo.link_pago)) return null;

  function copiarLink() {
    navigator.clipboard.writeText(metodo.link_pago).then(
      () => toast.success('Link copiado.'),
      () => toast.error('No se pudo copiar el link.')
    );
  }

  return (
    <>
      <button type="button" className="btn-link" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <QrCode size={15} /> Mostrar QR / link de {metodo.nombre}
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 340, textAlign: 'center' }}>
            <h2>{metodo.icono} {metodo.nombre}</h2>
            {monto > 0 && (
              <p style={{ fontSize: 15, fontWeight: 700, marginTop: -8 }}>Monto a cobrar: S/ {Number(monto).toFixed(2)}</p>
            )}
            {metodo.qr_data_url && (
              <img src={metodo.qr_data_url} alt={`QR de ${metodo.nombre}`} style={{ width: '100%', maxWidth: 260, borderRadius: 8, margin: '0 auto' }} />
            )}
            {metodo.link_pago && (
              <div style={{ marginTop: metodo.qr_data_url ? 16 : 0 }}>
                <p style={{ fontSize: 12, color: 'var(--ink-muted)', wordBreak: 'break-all' }}>{metodo.link_pago}</p>
                <button type="button" className="btn-secondary" onClick={copiarLink}>Copiar link</button>
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 14 }}>
              Muestra esta pantalla al cliente para que escanee el QR o abra el link con su app.
            </p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Listo</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
