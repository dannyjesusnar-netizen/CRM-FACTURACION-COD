import api from '../api';

// Al emitir un comprobante (boleta/factura/nota de crédito/nota de venta
// interna) se abre su PDF y se manda directo a imprimir, en vez de dejar
// que el vendedor tenga que ir a buscarlo después para imprimirlo a mano.
//
// `ventana` debe venir de un window.open('', '_blank') hecho ANTES de
// cualquier await en el flujo de emisión (mismo gesto del click) — recién
// acá, una vez que ya se tiene el id del comprobante creado, se la navega
// al PDF real. Abrirla tarde (después de un await) hace que el navegador la
// bloquee como popup.
export async function imprimirComprobante(ventana, id, origen = 'invoice') {
  if (!ventana) return;
  const base = origen === 'nota_venta' ? '/notas-venta' : '/invoices';
  try {
    const res = await api.get(`${base}/${id}/pdf`, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    ventana.location.href = blobUrl;
    // "onload" no siempre dispara para una navegación a un PDF por blob URL
    // (depende del visor nativo de cada navegador) — por eso hay un
    // respaldo por tiempo además del onload, con una bandera para no
    // imprimir dos veces si ambos terminan disparando. Si ninguno logra
    // abrir el diálogo, el comprobante igual queda abierto en la pestaña
    // para imprimirlo a mano.
    let impreso = false;
    const intentarImprimir = () => {
      if (impreso) return;
      impreso = true;
      try { ventana.focus(); ventana.print(); } catch { /* el usuario puede imprimir desde la pestaña */ }
    };
    ventana.onload = intentarImprimir;
    setTimeout(() => { if (!ventana.closed) intentarImprimir(); }, 1200);
  } catch {
    ventana.close();
  }
}
