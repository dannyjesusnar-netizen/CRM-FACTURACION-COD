const PDFDocument = require('pdfkit');
const db = require('../db');

const TIPO_LABEL = {
  factura: 'FACTURA ELECTRONICA',
  boleta: 'BOLETA DE VENTA ELECTRONICA',
  nota_credito: 'NOTA DE CREDITO ELECTRONICA',
};

const COLOR_ACENTO_DEFAULT = '#0f4c81';

function money(n, moneda) {
  const symbol = moneda === 'USD' ? '$' : 'S/';
  return `${symbol} ${Number(n).toFixed(2)}`;
}

// logo_data_url viene como "data:image/png;base64,AAAA..." (o jpeg). pdfkit
// necesita un Buffer, no el data URL en sí.
function logoBuffer(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
}

function buildInvoicePdf(invoice, items) {
  const empresa = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get() || {};
  const acento = /^#[0-9a-fA-F]{6}$/.test(empresa.color_acento || '') ? empresa.color_acento : COLOR_ACENTO_DEFAULT;
  const mostrarLogo = empresa.mostrar_logo_pdf !== 0 && !!empresa.logo_data_url;
  const mostrarContacto = empresa.mostrar_datos_contacto_pdf !== 0;
  const logo = mostrarLogo ? logoBuffer(empresa.logo_data_url) : null;

  if (empresa.tamano_pdf === 'ticket_80mm') {
    return buildTicketPdf(invoice, items, empresa, acento, mostrarContacto, logo);
  }
  return buildA4Pdf(invoice, items, empresa, acento, mostrarContacto, logo);
}

function buildA4Pdf(invoice, items, empresa, acento, mostrarContacto, logo) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const esReal = invoice.modo_emision === 'real' && invoice.sunat_estado === 'aceptado';

  // Encabezado
  let textX = 40;
  if (logo) {
    try { doc.image(logo, 40, 38, { fit: [55, 55] }); textX = 105; } catch { /* logo corrupto, se ignora */ }
  }
  doc.fontSize(16).fillColor(acento).text(empresa.razon_social || 'CRM Facturacion', textX, 40, { width: 320 - (textX - 40) });
  doc.fontSize(9).fillColor('#333');
  let headY = 60;
  if (empresa.ruc) { doc.text(`RUC: ${empresa.ruc}`, textX, headY); headY += 13; }
  if (empresa.direccion_fiscal) { doc.text(empresa.direccion_fiscal, textX, headY, { width: 320 - (textX - 40) }); headY += 13; }
  if (mostrarContacto && (empresa.telefono || empresa.email)) {
    doc.text([empresa.telefono, empresa.email].filter(Boolean).join(' — '), textX, headY, { width: 320 - (textX - 40) });
    headY += 13;
  }
  if (esReal) {
    doc.fontSize(9).fillColor('#0ca30c').text(`Comprobante electronico aceptado por SUNAT — Hash: ${invoice.sunat_hash || '-'}`, 40, headY);
  } else {
    doc.fontSize(9).fillColor('#666').text('Documento generado en modo SIMULADO (sin validez tributaria real)', 40, headY);
  }

  doc.roundedRect(380, 35, 175, 60, 4).stroke(acento);
  doc.fontSize(11).fillColor(acento).text(TIPO_LABEL[invoice.tipo_comprobante] || invoice.tipo_comprobante, 388, 42, { width: 160 });
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
  doc.fontSize(9).fillColor(acento);
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
  doc.fontSize(12).fillColor(acento);
  doc.text('TOTAL:', 350, y, { width: 130, align: 'left' });
  doc.text(money(invoice.total, invoice.moneda), 450, y, { width: 100, align: 'right' });

  if (invoice.observaciones) {
    y += 40;
    doc.fontSize(9).fillColor('#444').text(`Observaciones: ${invoice.observaciones}`, 40, y, { width: 500 });
  }

  if (empresa.terminos_condiciones_pdf) {
    doc.fontSize(8).fillColor('#555').text(empresa.terminos_condiciones_pdf, 40, 725, { width: 515, align: 'center' });
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

// Formato ticket/recibo angosto (rollo térmico de 80mm), pensado para
// impresoras de punto de venta. Al no tener el alto fijo de una hoja A4, se
// estima según la cantidad de items para no dejar espacio de más ni cortar
// contenido.
function buildTicketPdf(invoice, items, empresa, acento, mostrarContacto, logo) {
  const width = 227; // 80mm
  const margin = 10;
  const contentWidth = width - margin * 2;
  const estimatedHeight = 260 + items.length * 24 + (empresa.terminos_condiciones_pdf ? 40 : 0) + (invoice.observaciones ? 30 : 0) + (logo ? 60 : 0);
  const doc = new PDFDocument({ margin, size: [width, estimatedHeight] });
  const esReal = invoice.modo_emision === 'real' && invoice.sunat_estado === 'aceptado';

  let y = margin;
  if (logo) {
    try { doc.image(logo, (width - 50) / 2, y, { fit: [50, 50] }); y += 56; } catch { /* logo corrupto, se ignora */ }
  }
  doc.fontSize(11).fillColor(acento).text(empresa.razon_social || 'CRM Facturacion', margin, y, { width: contentWidth, align: 'center' });
  y += 16;
  doc.fontSize(7).fillColor('#333');
  if (empresa.ruc) { doc.text(`RUC: ${empresa.ruc}`, margin, y, { width: contentWidth, align: 'center' }); y += 10; }
  if (empresa.direccion_fiscal) { doc.text(empresa.direccion_fiscal, margin, y, { width: contentWidth, align: 'center' }); y += 10; }
  if (mostrarContacto && (empresa.telefono || empresa.email)) {
    doc.text([empresa.telefono, empresa.email].filter(Boolean).join(' / '), margin, y, { width: contentWidth, align: 'center' });
    y += 10;
  }
  y += 4;
  doc.moveTo(margin, y).lineTo(width - margin, y).stroke('#000');
  y += 8;

  doc.fontSize(9).fillColor(acento).text(TIPO_LABEL[invoice.tipo_comprobante] || invoice.tipo_comprobante, margin, y, { width: contentWidth, align: 'center' });
  y += 12;
  doc.fontSize(10).fillColor('#000').text(`${invoice.serie}-${String(invoice.numero).padStart(6, '0')}`, margin, y, { width: contentWidth, align: 'center' });
  y += 16;

  doc.fontSize(7).fillColor('#000');
  doc.text(`Fecha: ${invoice.fecha_emision}`, margin, y); y += 10;
  doc.text(`Cliente: ${invoice.cliente_nombre}`, margin, y, { width: contentWidth }); y += 10;
  doc.text(`${invoice.cliente_tipo_documento}: ${invoice.cliente_documento}`, margin, y); y += 12;

  doc.moveTo(margin, y).lineTo(width - margin, y).stroke('#000');
  y += 8;

  items.forEach((it) => {
    doc.fontSize(7).fillColor('#000').text(it.descripcion, margin, y, { width: contentWidth });
    y += 9;
    doc.text(`${it.cantidad} x ${money(it.precio_unitario, invoice.moneda)}`, margin, y, { width: contentWidth - 70 });
    doc.text(money(it.subtotal, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
    y += 13;
  });

  doc.moveTo(margin, y).lineTo(width - margin, y).stroke('#000');
  y += 8;
  doc.fontSize(7);
  doc.text('Subtotal:', margin, y, { width: contentWidth - 60 });
  doc.text(money(invoice.subtotal, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
  y += 10;
  doc.text('IGV (18%):', margin, y, { width: contentWidth - 60 });
  doc.text(money(invoice.igv, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
  y += 10;
  doc.fontSize(9).fillColor(acento);
  doc.text('TOTAL:', margin, y, { width: contentWidth - 60 });
  doc.text(money(invoice.total, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
  y += 16;

  if (invoice.observaciones) {
    doc.fontSize(6).fillColor('#444').text(invoice.observaciones, margin, y, { width: contentWidth, align: 'center' });
    y += 20;
  }
  if (empresa.terminos_condiciones_pdf) {
    doc.fontSize(6).fillColor('#555').text(empresa.terminos_condiciones_pdf, margin, y, { width: contentWidth, align: 'center' });
    y += 24;
  }

  doc.fontSize(6).fillColor(esReal ? '#0ca30c' : '#999').text(
    esReal
      ? 'Comprobante electronico aceptado por SUNAT.'
      : 'Documento en modo simulado, sin validez tributaria.',
    margin, y, { width: contentWidth, align: 'center' }
  );

  return doc;
}

module.exports = { buildInvoicePdf };
