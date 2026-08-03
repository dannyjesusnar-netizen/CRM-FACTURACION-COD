const PDFDocument = require('pdfkit');

const TIPO_LABEL = {
  factura: 'FACTURA ELECTRONICA',
  boleta: 'BOLETA DE VENTA ELECTRONICA',
  nota_credito: 'NOTA DE CREDITO ELECTRONICA',
};

function money(n, moneda) {
  const symbol = moneda === 'USD' ? '$' : 'S/';
  return `${symbol} ${Number(n).toFixed(2)}`;
}

function buildInvoicePdf(invoice, items) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const esReal = invoice.modo_emision === 'real' && invoice.sunat_estado === 'aceptado';

  // Encabezado
  doc.fontSize(16).fillColor('#0f4c81').text('CRM Facturacion', 40, 40);
  if (esReal) {
    doc.fontSize(9).fillColor('#0ca30c').text(`Comprobante electronico aceptado por SUNAT — Hash: ${invoice.sunat_hash || '-'}`, 40, 60);
  } else {
    doc.fontSize(9).fillColor('#666').text('Documento generado en modo SIMULADO (sin validez tributaria real)', 40, 60);
  }

  doc.roundedRect(380, 35, 175, 60, 4).stroke('#0f4c81');
  doc.fontSize(11).fillColor('#0f4c81').text(TIPO_LABEL[invoice.tipo_comprobante] || invoice.tipo_comprobante, 388, 42, { width: 160 });
  doc.fontSize(13).fillColor('#000').text(`${invoice.serie} - ${String(invoice.numero).padStart(6, '0')}`, 388, 68, { width: 160 });

  doc.moveDown(3);
  doc.fillColor('#000').fontSize(10);
  const infoTop = 115;
  doc.text(`Fecha de emision: ${invoice.fecha_emision}`, 40, infoTop);
  doc.text(`Moneda: ${invoice.moneda}`, 40, infoTop + 15);
  doc.text(`Estado: ${invoice.estado.toUpperCase()}`, 40, infoTop + 30);

  doc.text(`Cliente: ${invoice.cliente_nombre}`, 300, infoTop);
  doc.text(`${invoice.cliente_tipo_documento}: ${invoice.cliente_documento}`, 300, infoTop + 15);
  if (invoice.cliente_direccion) {
    doc.text(`Direccion: ${invoice.cliente_direccion}`, 300, infoTop + 30, { width: 260 });
  }

  // Tabla de items
  let y = infoTop + 60;
  doc.moveTo(40, y).lineTo(555, y).stroke('#ccc');
  y += 8;
  doc.fontSize(9).fillColor('#0f4c81');
  doc.text('Descripcion', 40, y, { width: 250 });
  doc.text('Cant.', 300, y, { width: 50, align: 'right' });
  doc.text('P. Unit.', 360, y, { width: 80, align: 'right' });
  doc.text('Subtotal', 450, y, { width: 100, align: 'right' });
  y += 14;
  doc.moveTo(40, y).lineTo(555, y).stroke('#ccc');
  y += 6;

  doc.fillColor('#000');
  items.forEach((it) => {
    doc.fontSize(9).text(it.descripcion, 40, y, { width: 250 });
    doc.text(String(it.cantidad), 300, y, { width: 50, align: 'right' });
    doc.text(money(it.precio_unitario, invoice.moneda), 360, y, { width: 80, align: 'right' });
    doc.text(money(it.subtotal, invoice.moneda), 450, y, { width: 100, align: 'right' });
    y += 18;
  });

  y += 6;
  doc.moveTo(350, y).lineTo(555, y).stroke('#ccc');
  y += 8;
  doc.fontSize(10);
  doc.text('Subtotal (sin IGV):', 350, y, { width: 130, align: 'left' });
  doc.text(money(invoice.subtotal, invoice.moneda), 450, y, { width: 100, align: 'right' });
  y += 16;
  doc.text('IGV (18%):', 350, y, { width: 130, align: 'left' });
  doc.text(money(invoice.igv, invoice.moneda), 450, y, { width: 100, align: 'right' });
  y += 16;
  doc.fontSize(12).fillColor('#0f4c81');
  doc.text('TOTAL:', 350, y, { width: 130, align: 'left' });
  doc.text(money(invoice.total, invoice.moneda), 450, y, { width: 100, align: 'right' });

  if (invoice.observaciones) {
    y += 40;
    doc.fontSize(9).fillColor('#444').text(`Observaciones: ${invoice.observaciones}`, 40, y, { width: 500 });
  }

  if (esReal) {
    doc.fontSize(8).fillColor('#0ca30c').text(
      'Representacion impresa de un comprobante electronico aceptado por SUNAT. Consulta el CDR/XML oficial en el enlace del OSE.',
      40, 760, { width: 515, align: 'center' }
    );
  } else {
    doc.fontSize(8).fillColor('#999').text(
      invoice.modo_emision === 'real'
        ? `Este comprobante fue enviado a SUNAT pero no fue aceptado (estado: ${invoice.sunat_estado || 'desconocido'}). No tiene validez tributaria. ${invoice.sunat_mensaje || ''}`
        : 'Este comprobante fue generado por un sistema en modo simulado, sin conexion real a SUNAT. No tiene validez tributaria.',
      40, 760, { width: 515, align: 'center' }
    );
  }

  return doc;
}

module.exports = { buildInvoicePdf };
