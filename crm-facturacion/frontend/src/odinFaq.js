// Respuestas automáticas de ODIN a preguntas frecuentes de vendedores.
// Reglas fijas por palabras clave, sin IA de por medio (cero costo por
// mensaje) — si nada calza, el mensaje se manda a soporte como hasta ahora
// (ver OdinWidget.jsx).
const FAQ = [
  {
    palabras: ['anular boleta', 'anular factura', 'anular comprobante', 'como anulo'],
    respuesta:
      'Depende del estado del comprobante:\n' +
      '• Si todavía está "Pendiente" (recién emitido, sin confirmar por SUNAT) → en Nubefact usa el enlace "Anular" (Comunicación de Baja).\n' +
      '• Si ya está "Aceptado" por SUNAT → no se puede borrar, hay que emitir una Nota de Crédito desde Ventas → Nota de Crédito.',
  },
  {
    palabras: ['nota de credito', 'nota de crédito'],
    respuesta:
      'La Nota de Crédito se usa para anular o corregir un comprobante YA aceptado por SUNAT. Ve a Ventas → Nota de Crédito, indica el comprobante que modifica (serie y número) y el motivo.',
  },
  {
    palabras: ['traslado', 'guia de remision', 'guía de remisión'],
    respuesta: 'Para mover mercadería entre sedes, usa Guía de Remitente (menú de la izquierda) — indica sede de origen, destino y los productos a trasladar.',
  },
  {
    palabras: ['nueva venta', 'registrar venta', 'como vendo'],
    respuesta: 'Para registrar una venta ve a "Registrar Venta" en el menú — elige el cliente, agrega los productos y confirma el tipo de comprobante (boleta, factura o nota de venta interna).',
  },
  {
    palabras: ['cotizacion', 'cotización'],
    respuesta: 'Las cotizaciones se registran en "Registro de Cotización". Cuando el cliente confirma, se convierte en venta desde la misma pantalla sin tener que volver a cargar los productos.',
  },
  {
    palabras: ['cierre de caja', 'cuadre de caja', 'apertura de caja'],
    respuesta: 'La apertura y cierre de caja está en el módulo de Caja — registra el saldo inicial al abrir el día, y al cerrar compara el efectivo contado contra lo que el sistema calculó por tus ventas del día.',
  },
  {
    palabras: ['pendiente', 'rechazado', 'no aceptado', 'sunat'],
    respuesta:
      '"Pendiente" es normal el mismo día que emites una boleta — SUNAT confirma boletas recién al día siguiente con el resumen diario, el comprobante ya es válido mientras tanto.\n' +
      'Si un comprobante queda "Rechazado" o en "Error", revísalo con Gerencia — suele ser un dato del cliente incompleto o mal formado.',
  },
  {
    palabras: ['stock de', 'queda de', 'cuanto stock', 'cuánto stock', 'hay stock'],
    // Este caso lo maneja OdinWidget.jsx aparte (consulta en vivo a la base
    // de datos) — esta entrada solo evita que caiga en el flujo genérico de
    // soporte si por algún motivo no se detecta como consulta de stock.
    respuesta: 'Escribe "stock de [nombre del producto]" y te digo cuánto queda en tu sede.',
  },
];

// Devuelve la respuesta de la primera regla cuyo texto aparece en el
// mensaje (comparación simple, sin distinguir mayúsculas/tildes exactas).
export function buscarRespuestaFaq(mensaje) {
  const texto = mensaje.toLowerCase();
  const entrada = FAQ.find((f) => f.palabras.some((p) => texto.includes(p)));
  return entrada ? entrada.respuesta : null;
}

// Detecta patrones tipo "stock de X" / "cuanto stock queda de X" y extrae el
// nombre del producto a buscar. Devuelve null si el mensaje no parece una
// consulta de stock.
export function detectarConsultaStock(mensaje) {
  const texto = mensaje.toLowerCase().trim();
  const patrones = [
    /stock de (.+)/,
    /cuanto stock (?:queda )?de (.+)/,
    /cu[aá]nto stock (?:queda )?de (.+)/,
    /queda(?:n)? (?:de )?(.+)\??$/,
  ];
  for (const patron of patrones) {
    const m = texto.match(patron);
    if (m && m[1] && m[1].trim().length >= 2) {
      return m[1].trim().replace(/[?¿.]/g, '');
    }
  }
  return null;
}
