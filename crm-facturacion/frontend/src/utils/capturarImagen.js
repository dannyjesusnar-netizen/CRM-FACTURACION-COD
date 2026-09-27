// Convierte un panel del DOM en una imagen PNG: primero intenta copiarla
// directo al portapapeles (para pegarla con Ctrl+V en WhatsApp Web); si el
// navegador no lo soporta, la descarga como archivo. Mismo mecanismo
// reutilizado por los paneles del Dashboard, Mi Cierre de Caja y las
// constancias de movimiento, para que capturar cualquier panel se sienta
// igual en todo el sistema.
export async function capturarPanelComoImagen(ref, nombreArchivo, toast, opciones = {}) {
  if (!ref.current) return;
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(ref.current, {
      scale: 2,
      logging: false,
      ignoreElements: opciones.ignoreElements,
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('sin blob');

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
        toast.success(opciones.mensajeCopiado || 'Imagen copiada — pégala directo en WhatsApp con Ctrl+V (o Cmd+V).');
        return;
      } catch {
        // El navegador no dejó copiar al portapapeles (falta de permiso o
        // sin soporte) — sigue al respaldo de descarga.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(opciones.mensajeDescargado || 'Imagen descargada — ya puedes enviarla por WhatsApp.');
  } catch {
    toast.error(opciones.mensajeError || 'No se pudo generar la imagen de este panel.');
  }
}
