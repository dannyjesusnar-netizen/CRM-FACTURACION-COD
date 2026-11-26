const nodemailer = require('nodemailer');
const db = require('../db');
const { buildInvoicePdf } = require('./pdf');

// Notificación por correo al cliente cuando se emite una boleta/factura —
// pedido explícito de Danny. Usa Gmail con contraseña de aplicación (no
// Resend/SendGrid: no hay dominio propio verificado todavía) vía
// EMAIL_USER/EMAIL_PASS. Si esas variables no están puestas (dev local,
// u otro entorno), o el cliente no tiene correo registrado, simplemente no
// manda nada — nunca debe hacer fallar el registro de la venta.
let transporter = null;
function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
}

function pdfDocToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// enviarComprobanteCliente(invoiceId, sucursalId) — se llama después de
// responder al cliente HTTP (fire-and-forget, nunca con await en la
// emisión), por eso vuelve a leer todo de la base por su cuenta en vez de
// recibir los objetos ya armados: mismo criterio de joins que
// GET /invoices/:id/pdf, para que el PDF adjunto salga igual al que se
// descarga desde Ventas.
async function enviarComprobanteCliente(invoiceId, sucursalId) {
  const transport = getTransporter();
  if (!transport) return;

  const invoice = db.prepare(
    `SELECT i.*, c.nombre AS cliente_nombre, c.numero_documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento, c.direccion AS cliente_direccion,
            c.telefono AS cliente_telefono, c.referencia AS cliente_referencia, c.contacto AS cliente_contacto,
            c.email AS cliente_email,
            u.full_name AS vendedor_nombre, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion
     FROM invoices i
     JOIN clients c ON c.id = i.client_id
     LEFT JOIN users u ON u.id = i.created_by
     LEFT JOIN sucursales s ON s.id = i.sucursal_id
     WHERE i.id = ? AND i.sucursal_id = ?`
  ).get(invoiceId, sucursalId);
  if (!invoice) return;
  if (!['boleta', 'factura'].includes(invoice.tipo_comprobante)) return;
  if (!invoice.cliente_email) return;

  try {
    const items = db.prepare(
      `SELECT ii.*, p.codigo AS codigo, p.unidad AS unidad FROM invoice_items ii
       LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ?`
    ).all(invoiceId);
    const cobros = invoice.forma_pago === 'abonado'
      ? db.prepare('SELECT * FROM cobros WHERE invoice_id = ? ORDER BY id ASC').all(invoiceId)
      : [];

    const doc = await buildInvoicePdf(invoice, items, cobros);
    const pdfBuffer = await pdfDocToBuffer(doc);

    const empresa = db.prepare('SELECT nombre_comercial, razon_social FROM empresa_config WHERE id = 1').get();
    const nombreEmpresa = empresa?.nombre_comercial || empresa?.razon_social || 'tu tienda';
    const tipoLabel = invoice.tipo_comprobante === 'factura' ? 'Factura' : 'Boleta';
    const numeroDoc = `${invoice.serie}-${String(invoice.numero).padStart(6, '0')}`;

    await transport.sendMail({
      from: `"${nombreEmpresa}" <${process.env.EMAIL_USER}>`,
      to: invoice.cliente_email,
      subject: `${tipoLabel} electrónica ${numeroDoc} — ${nombreEmpresa}`,
      text: `Hola ${invoice.cliente_nombre},\n\n`
        + `Adjuntamos tu ${tipoLabel.toLowerCase()} electrónica ${numeroDoc} por un total de S/ ${Number(invoice.total).toFixed(2)}.\n\n`
        + `Gracias por tu compra.\n${nombreEmpresa}`,
      attachments: [{ filename: `${numeroDoc}.pdf`, content: pdfBuffer }],
    });
  } catch (err) {
    // Nunca debe tumbar la venta — ya se respondió al cliente HTTP antes de
    // llegar acá. Solo se deja constancia en el log del servidor.
    console.error(`No se pudo enviar el correo de ${invoice.tipo_comprobante} ${invoiceId} a ${invoice.cliente_email}:`, err.message);
  }
}

module.exports = { enviarComprobanteCliente };
