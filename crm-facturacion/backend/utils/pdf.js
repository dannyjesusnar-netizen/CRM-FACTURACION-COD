const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const db = require('../db');
const { montoEnLetras } = require('./numeroALetras');

const TIPO_LABEL = {
  factura: 'FACTURA ELECTRONICA',
  boleta: 'BOLETA DE VENTA ELECTRONICA',
  nota_credito: 'NOTA DE CREDITO ELECTRONICA',
  cotizacion: 'COTIZACION',
};

const COLOR_ACENTO_DEFAULT = '#0f4c81';

function money(n, moneda) {
  const symbol = moneda === 'USD' ? '$' : 'S/';
  return `${symbol} ${Number(n).toFixed(2)}`;
}

function monedaLabel(moneda) {
  return moneda === 'USD' ? 'DOLARES' : 'SOLES';
}

// La tasa de IGV es configurable y puede haber cambiado desde que se emitió
// este comprobante — por eso el % mostrado se calcula del propio igv/subtotal
// del documento (lo real que se cobró), no de la tasa actual de la empresa.
function igvLabel(invoice, empresa) {
  const subtotal = Number(invoice.subtotal);
  const tasa = subtotal > 0 ? Number(invoice.igv) / subtotal : Number(empresa?.igv_rate) || 0.18;
  return `IGV (${Math.round(tasa * 100)}%):`;
}

function formaPagoLabel(codigo) {
  if (!codigo) return 'EFECTIVO';
  if (codigo === 'abonado') return 'CREDITO';
  if (codigo === 'mixto') return 'PAGO MIXTO';
  const metodo = db.prepare('SELECT nombre FROM metodos_pago WHERE codigo = ?').get(codigo);
  return (metodo?.nombre || codigo).toUpperCase();
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

// Texto representativo del comprobante para el QR. Si SUNAT ya devolvió un
// enlace de consulta real, se usa ese; si no, un resumen local (no es el
// formato oficial de SUNAT, solo una referencia legible al escanear).
async function qrBuffer(invoice, empresa) {
  const esReal = invoice.modo_emision === 'real' && invoice.sunat_estado === 'aceptado';
  const contenido = esReal && invoice.sunat_pdf_url
    ? invoice.sunat_pdf_url
    : [
      empresa.ruc || '', invoice.tipo_comprobante, invoice.serie, invoice.numero,
      invoice.fecha_emision, invoice.moneda, Number(invoice.total).toFixed(2),
      invoice.cliente_tipo_documento || '', invoice.cliente_documento || '',
    ].join('|');
  try {
    return await QRCode.toBuffer(contenido, { type: 'png', margin: 1, width: 200 });
  } catch {
    return null;
  }
}

// Calcula cómo dibujar el logo según su propia forma, en vez de forzarlo
// siempre a un círculo: un logo cuadrado/circular (isotipo tipo insignia,
// como el del ejemplo) se recorta en círculo y rellena la caja completa;
// uno rectangular (isotipo + texto, banner horizontal, etc.) se muestra
// completo — sin recortar ni deformar — centrado dentro de su caja.
function logoLayout(doc, logo, x, y, maxW, maxH, opts = {}) {
  let img;
  try {
    img = doc.openImage(logo);
  } catch {
    return null;
  }
  if (!img.width || !img.height) return null;
  const aspecto = img.width / img.height;
  const esCasiCuadrado = aspecto > 0.8 && aspecto < 1.25;

  if (esCasiCuadrado) {
    const size = Math.min(maxW, maxH);
    const drawX = opts.align === 'center' ? x + (maxW - size) / 2 : x;
    return {
      anchoOcupado: size,
      dibujar: () => {
        doc.save();
        doc.circle(drawX + size / 2, y + size / 2, size / 2).clip();
        doc.image(logo, drawX, y, { cover: [size, size], align: 'center', valign: 'center' });
        doc.restore();
      },
    };
  }

  let w = maxW;
  let h = w / aspecto;
  if (h > maxH) { h = maxH; w = h * aspecto; }
  const drawY = y + (maxH - h) / 2;
  const drawX = opts.align === 'center' ? x + (maxW - w) / 2 : x;
  return {
    anchoOcupado: w,
    dibujar: () => doc.image(logo, drawX, drawY, { width: w, height: h }),
  };
}

// Fila "● Etiqueta: valor" — sin fuente de iconos disponible en pdfkit, se
// usa un punto de color como marcador visual en vez de un pictograma real.
function bulletRow(doc, x, y, width, label, valor, acento) {
  doc.circle(x + 3, y + 4, 3).fill(acento);
  doc.fillColor('#333').font('Helvetica-Bold').fontSize(8).text(`${label}:`, x + 12, y, { continued: false, width: 70 });
  doc.font('Helvetica').fillColor('#000').fontSize(8.5).text(valor || '—', x + 12, y + 11, { width: width - 12 });
}

async function buildInvoicePdf(invoice, items, cobros) {
  const empresa = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get() || {};
  const acento = /^#[0-9a-fA-F]{6}$/.test(empresa.color_acento || '') ? empresa.color_acento : COLOR_ACENTO_DEFAULT;
  const mostrarLogo = empresa.mostrar_logo_pdf !== 0 && !!empresa.logo_data_url;
  const logo = mostrarLogo ? logoBuffer(empresa.logo_data_url) : null;
  const qr = await qrBuffer(invoice, empresa);

  if (empresa.tamano_pdf === 'ticket_80mm') {
    return buildTicketPdf(invoice, items, empresa, acento, logo, qr, cobros);
  }
  return buildA4Pdf(invoice, items, empresa, acento, logo, qr, cobros);
}

function buildA4Pdf(invoice, items, empresa, acento, logo, qr, cobros) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const esReal = invoice.modo_emision === 'real' && invoice.sunat_estado === 'aceptado';
  const esAbonado = invoice.forma_pago === 'abonado';
  const esMixto = invoice.forma_pago === 'mixto';

  // ---------- Encabezado: logo + empresa + recuadro de comprobante ----------
  let textX = 40;
  if (logo) {
    const layout = logoLayout(doc, logo, 40, 40, 130, 64);
    if (layout) {
      try {
        layout.dibujar();
        textX = 40 + layout.anchoOcupado + 14;
      } catch { /* logo corrupto, se ignora */ }
    }
  }
  const nombreWidth = Math.max(150, 375 - textX);
  const infoWidth = Math.max(140, 380 - (textX + 10));
  const nombreEmpresa = empresa.razon_social || 'CRM Facturacion';
  doc.font('Helvetica-Bold').fontSize(17).fillColor(acento).text(nombreEmpresa, textX, 44, { width: nombreWidth });

  // El nombre puede envolver a 2 líneas si el logo es ancho y deja poco
  // espacio de texto — el resto del bloque (dirección, contacto...) debe
  // empezar debajo de esa altura real, no de una posición fija.
  let infoY = 44 + doc.heightOfString(nombreEmpresa, { width: nombreWidth }) + 6;
  doc.font('Helvetica').fontSize(7.5).fillColor('#444');
  if (empresa.direccion_fiscal) {
    doc.circle(textX + 3, infoY + 3, 2.5).fill(acento).fillColor('#444');
    doc.text(empresa.direccion_fiscal, textX + 10, infoY, { width: infoWidth });
    infoY += doc.heightOfString(empresa.direccion_fiscal, { width: infoWidth }) + 3;
  }
  const contactoLinea = [empresa.email ? `Email: ${empresa.email}` : null, empresa.telefono ? `Cel: ${empresa.telefono}` : null].filter(Boolean).join('   ');
  if (contactoLinea) {
    doc.circle(textX + 3, infoY + 3, 2.5).fill(acento).fillColor('#444');
    doc.text(contactoLinea, textX + 10, infoY, { width: infoWidth });
    infoY += 12;
  }
  if (invoice.sucursal_direccion && invoice.sucursal_direccion !== empresa.direccion_fiscal) {
    doc.circle(textX + 3, infoY + 3, 2.5).fill(acento).fillColor('#444');
    doc.text(`Sede ${invoice.sucursal_nombre || ''}: ${invoice.sucursal_direccion}`, textX + 10, infoY, { width: infoWidth });
    infoY += doc.heightOfString(`Sede ${invoice.sucursal_nombre || ''}: ${invoice.sucursal_direccion}`, { width: infoWidth }) + 3;
  }

  doc.roundedRect(390, 38, 165, 78, 5).stroke(acento);
  doc.font('Helvetica').fontSize(9).fillColor('#000').text(`RUC: ${empresa.ruc || '-'}`, 398, 46, { width: 150, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(acento).text(TIPO_LABEL[invoice.tipo_comprobante] || invoice.tipo_comprobante, 398, 61, { width: 150, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(`${invoice.serie}-${String(invoice.numero).padStart(3, '0')}`, 398, 90, { width: 150, align: 'center' });

  // El aviso SUNAT/simulado va debajo de lo más alto entre el bloque de
  // datos de la empresa (infoY, variable según el logo) y el recuadro de
  // RUC/tipo/serie (que termina en y=116) — nunca a una y fija.
  const avisoY = Math.max(infoY, 116);
  if (esReal) {
    doc.fontSize(7).fillColor('#0ca30c').text(`Aceptado por SUNAT — Hash: ${invoice.sunat_hash || '-'}`, 40, avisoY, { width: 515 });
  } else {
    doc.fontSize(7).fillColor('#999').text('Documento generado en modo SIMULADO (sin validez tributaria real)', 40, avisoY, { width: 515 });
  }

  // ---------- Panel de cliente / comprobante ----------
  const panelTop = Math.max(132, avisoY + 14);
  const panelHeight = 145;
  doc.roundedRect(40, panelTop, 515, panelHeight, 6).stroke('#ddd');

  const leftX = 52;
  const rightX = 310;
  let ly = panelTop + 12;
  bulletRow(doc, leftX, ly, 240, 'Cliente', invoice.cliente_nombre, acento);
  bulletRow(doc, rightX, ly, 200, 'RUC/DNI', invoice.cliente_documento, acento);
  ly += 26;
  bulletRow(doc, leftX, ly, 240, 'Direccion', invoice.cliente_direccion, acento);
  bulletRow(doc, rightX, ly, 200, 'Fecha', invoice.fecha_emision, acento);
  ly += 26;
  bulletRow(doc, leftX, ly, 240, 'Referencia', invoice.cliente_referencia, acento);
  bulletRow(doc, rightX, ly, 200, 'Celular', invoice.cliente_telefono, acento);
  ly += 26;
  bulletRow(doc, leftX, ly, 240, 'Contacto', invoice.cliente_contacto, acento);
  bulletRow(doc, rightX, ly, 200, 'Moneda', monedaLabel(invoice.moneda), acento);
  ly += 26;
  bulletRow(doc, leftX, ly, 240, 'Forma de Pago', formaPagoLabel(invoice.forma_pago), acento);
  bulletRow(doc, rightX, ly, 200, 'Vendedor', invoice.vendedor_nombre, acento);

  // ---------- Tabla de items ----------
  let y = panelTop + panelHeight + 14;
  const cols = [
    { key: 'item', label: 'ITEM', x: 40, w: 25, align: 'center' },
    { key: 'cant', label: 'CANT.', x: 65, w: 35, align: 'right' },
    { key: 'um', label: 'U.M.', x: 100, w: 40, align: 'center' },
    { key: 'codigo', label: 'CODIGO', x: 140, w: 60, align: 'left' },
    { key: 'desc', label: 'DESCRIPCION', x: 200, w: 170, align: 'left' },
    { key: 'pu', label: 'P.U.', x: 370, w: 60, align: 'right' },
    { key: 'dsc', label: 'DESC', x: 430, w: 45, align: 'right' },
    { key: 'imp', label: 'IMPORTE', x: 475, w: 80, align: 'right' },
  ];
  doc.rect(40, y, 515, 18).fill(acento);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff');
  cols.forEach((c) => doc.text(c.label, c.x + 3, y + 5, { width: c.w - 6, align: c.align }));
  y += 18;

  doc.font('Helvetica').fontSize(8).fillColor('#000');
  items.forEach((it, idx) => {
    const rowStartY = y;
    const descHeight = doc.heightOfString(it.descripcion || '', { width: cols[4].w - 6 });
    const rowHeight = Math.max(16, descHeight + 6);
    if (idx % 2 === 1) doc.rect(40, rowStartY, 515, rowHeight).fill('#f7f9fb').fillColor('#000');
    doc.fillColor('#000');
    doc.text(String(idx + 1), cols[0].x + 3, rowStartY + 4, { width: cols[0].w - 6, align: cols[0].align });
    doc.text(String(it.cantidad), cols[1].x + 3, rowStartY + 4, { width: cols[1].w - 6, align: cols[1].align });
    doc.text(it.unidad || 'NIU', cols[2].x + 3, rowStartY + 4, { width: cols[2].w - 6, align: cols[2].align });
    doc.text(it.codigo || '-', cols[3].x + 3, rowStartY + 4, { width: cols[3].w - 6, align: cols[3].align });
    doc.text(it.descripcion || '', cols[4].x + 3, rowStartY + 4, { width: cols[4].w - 6, align: cols[4].align });
    doc.text(money(it.precio_unitario, invoice.moneda), cols[5].x + 3, rowStartY + 4, { width: cols[5].w - 6, align: cols[5].align });
    doc.text(it.descuento_pct ? `${it.descuento_pct}%` : '-', cols[6].x + 3, rowStartY + 4, { width: cols[6].w - 6, align: cols[6].align });
    doc.text(money(it.subtotal, invoice.moneda), cols[7].x + 3, rowStartY + 4, { width: cols[7].w - 6, align: cols[7].align });
    y = rowStartY + rowHeight;
  });
  doc.moveTo(40, y).lineTo(555, y).stroke('#ddd');
  y += 10;

  // ---------- Totales + monto en letras ----------
  const totalsBoxY = y;
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  doc.text('Op. gravada:', 350, totalsBoxY, { width: 120, align: 'left' });
  doc.text(money(invoice.subtotal, invoice.moneda), 475, totalsBoxY, { width: 80, align: 'right' });
  doc.text(igvLabel(invoice, empresa), 350, totalsBoxY + 15, { width: 120, align: 'left' });
  doc.text(money(invoice.igv, invoice.moneda), 475, totalsBoxY + 15, { width: 80, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(acento);
  doc.text('TOTAL:', 350, totalsBoxY + 33, { width: 120, align: 'left' });
  doc.text(money(invoice.total, invoice.moneda), 475, totalsBoxY + 33, { width: 80, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#333');
  doc.text(montoEnLetras(invoice.total, invoice.moneda), 40, totalsBoxY + 8, { width: 290 });

  y = totalsBoxY + 56;

  // ---------- Crédito (ventas "abonado") o desglose (pago "mixto") ----------
  if (esAbonado || esMixto) {
    const boxH = 90;
    doc.roundedRect(40, y, 250, boxH, 5).stroke('#ddd');
    if (esAbonado) {
      const saldo = Math.max(0, Number(invoice.total) - Number(invoice.monto_pagado || 0));
      doc.font('Helvetica-Bold').fontSize(9).fillColor(acento).text('Informacion del credito', 50, y + 10);
      doc.font('Helvetica').fontSize(8.5).fillColor('#000');
      doc.text(`Monto abonado: ${money(invoice.monto_pagado || 0, invoice.moneda)}`, 50, y + 28);
      doc.font('Helvetica-Bold').text(`Saldo pendiente: ${money(saldo, invoice.moneda)}`, 50, y + 44);
      doc.font('Helvetica').text(saldo > 0.005 ? 'Pendiente de pago.' : 'Totalmente cancelado.', 50, y + 62);
    } else {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(acento).text('Informacion del pago', 50, y + 10);
      doc.font('Helvetica').fontSize(8.5).fillColor('#000');
      doc.text(`Pago mixto — ${(cobros || []).length} metodos`, 50, y + 28, { width: 220 });
      doc.font('Helvetica-Bold').text(`Total: ${money(invoice.total, invoice.moneda)}`, 50, y + 44);
      doc.font('Helvetica').text('Totalmente cancelado.', 50, y + 62);
    }

    doc.roundedRect(300, y, 255, boxH, 5).stroke('#ddd');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(acento).text(esAbonado ? 'Abonos registrados' : 'Desglose de pago', 310, y + 10);
    doc.font('Helvetica').fontSize(7.5).fillColor('#000');
    if (cobros && cobros.length) {
      let cy = y + 26;
      cobros.slice(0, 4).forEach((c) => {
        const fechaTxt = esAbonado ? `${(c.created_at || '').slice(0, 10)} — ` : '';
        doc.text(`${fechaTxt}${formaPagoLabel(c.medio)} — ${money(c.monto, invoice.moneda)}`, 310, cy, { width: 235 });
        cy += 12;
      });
    } else {
      doc.fillColor('#999').text('Sin abonos registrados todavia.', 310, y + 26, { width: 235 });
    }
    y += boxH + 14;
  }

  // ---------- Observaciones + QR ----------
  const obsBoxH = 60;
  doc.roundedRect(40, y, qr ? 420 : 515, obsBoxH, 5).stroke('#ddd');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(acento).text('OBSERVACIONES:', 50, y + 8);
  doc.font('Helvetica').fontSize(8).fillColor('#333').text(invoice.observaciones || 'Sin observaciones.', 50, y + 22, { width: (qr ? 420 : 515) - 20 });
  if (qr) {
    try { doc.image(qr, 470, y + 5, { width: 50, height: 50 }); } catch { /* ignore */ }
  }
  y += obsBoxH + 12;

  // ---------- Pie: condiciones + agradecimiento ----------
  if (empresa.terminos_condiciones_pdf) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(acento).text('CONDICIONES DE CAMBIO Y DEVOLUCION', 40, y, { width: 515 });
    y += 12;
    doc.font('Helvetica').fontSize(7.5).fillColor('#555').text(empresa.terminos_condiciones_pdf, 40, y, { width: 515 });
    y += doc.heightOfString(empresa.terminos_condiciones_pdf, { width: 515 }) + 10;
  }

  const barY = y + 8;
  doc.rect(0, barY, 595, 62).fill(acento);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#fff').text('¡Gracias por su preferencia!', 40, barY + 14, { width: 515, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor('#fff').text(empresa.razon_social || '', 40, barY + 32, { width: 515, align: 'center' });
  if (!esReal) {
    doc.fontSize(6.5).fillColor('#fff').text(
      invoice.modo_emision === 'real'
        ? `Enviado a SUNAT pero no aceptado (estado: ${invoice.sunat_estado || 'desconocido'}). No tiene validez tributaria.`
        : 'Documento en modo simulado, sin conexion real a SUNAT. No tiene validez tributaria.',
      40, barY + 46, { width: 515, align: 'center' }
    );
  }

  return doc;
}

// Nota de Venta: documento SIN efectos tributarios (no es un comprobante de
// pago reconocido por SUNAT, no lleva IGV) — a propósito NO reutiliza
// buildA4Pdf/buildTicketPdf (esos están pensados para factura/boleta/nota de
// crédito reales, con hash/QR SUNAT y desglose de IGV) para que este
// documento se vea claramente distinto y nunca pueda confundirse con uno
// fiscal. Layout simple: encabezado de empresa, aviso legal bien visible,
// datos del cliente, tabla de items y un solo TOTAL (sin Op. gravada/IGV).
async function buildNotaVentaPdf(notaVenta, items, empresa) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const acento = /^#[0-9a-fA-F]{6}$/.test(empresa?.color_acento || '') ? empresa.color_acento : COLOR_ACENTO_DEFAULT;
  const mostrarLogo = empresa?.mostrar_logo_pdf !== 0 && !!empresa?.logo_data_url;
  const logo = mostrarLogo ? logoBuffer(empresa.logo_data_url) : null;

  let textX = 40;
  if (logo) {
    const layout = logoLayout(doc, logo, 40, 40, 130, 64);
    if (layout) {
      try {
        layout.dibujar();
        textX = 40 + layout.anchoOcupado + 14;
      } catch { /* logo corrupto, se ignora */ }
    }
  }
  const nombreWidth = Math.max(150, 375 - textX);
  const infoWidth = Math.max(140, 380 - (textX + 10));
  const nombreEmpresa = empresa?.razon_social || 'CRM Facturacion';
  doc.font('Helvetica-Bold').fontSize(17).fillColor(acento).text(nombreEmpresa, textX, 44, { width: nombreWidth });

  let infoY = 44 + doc.heightOfString(nombreEmpresa, { width: nombreWidth }) + 6;
  doc.font('Helvetica').fontSize(7.5).fillColor('#444');
  if (empresa?.direccion_fiscal) {
    doc.circle(textX + 3, infoY + 3, 2.5).fill(acento).fillColor('#444');
    doc.text(empresa.direccion_fiscal, textX + 10, infoY, { width: infoWidth });
    infoY += doc.heightOfString(empresa.direccion_fiscal, { width: infoWidth }) + 3;
  }

  doc.roundedRect(390, 38, 165, 78, 5).stroke(acento);
  doc.font('Helvetica').fontSize(9).fillColor('#000').text(`RUC: ${empresa?.ruc || '-'}`, 398, 46, { width: 150, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(acento).text('NOTA DE VENTA INTERNA', 398, 61, { width: 150, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(`${notaVenta.serie}-${String(notaVenta.numero).padStart(6, '0')}`, 398, 90, { width: 150, align: 'center' });

  const avisoY = Math.max(infoY, 116);
  doc.fontSize(7).fillColor('#b45309').text(
    'Documento SIN efectos tributarios — no es un comprobante de pago (no válido ante SUNAT, no incluye IGV).',
    40, avisoY, { width: 515 }
  );

  const panelTop = avisoY + 20;
  const panelHeight = 90;
  doc.roundedRect(40, panelTop, 515, panelHeight, 6).stroke('#ddd');
  const leftX = 52;
  const rightX = 310;
  let ly = panelTop + 12;
  bulletRow(doc, leftX, ly, 240, 'Cliente', notaVenta.cliente_nombre, acento);
  bulletRow(doc, rightX, ly, 200, 'RUC/DNI', notaVenta.cliente_documento, acento);
  ly += 26;
  bulletRow(doc, leftX, ly, 240, 'Direccion', notaVenta.cliente_direccion, acento);
  bulletRow(doc, rightX, ly, 200, 'Fecha', notaVenta.fecha_emision, acento);
  ly += 26;
  bulletRow(doc, leftX, ly, 240, 'Forma de Pago', formaPagoLabel(notaVenta.forma_pago), acento);
  bulletRow(doc, rightX, ly, 200, 'Moneda', monedaLabel(notaVenta.moneda), acento);

  let y = panelTop + panelHeight + 14;
  const cols = [
    { key: 'item', label: 'ITEM', x: 40, w: 25, align: 'center' },
    { key: 'cant', label: 'CANT.', x: 65, w: 45, align: 'right' },
    { key: 'desc', label: 'DESCRIPCION', x: 110, w: 260, align: 'left' },
    { key: 'pu', label: 'P.U.', x: 370, w: 65, align: 'right' },
    { key: 'dsc', label: 'DESC', x: 435, w: 40, align: 'right' },
    { key: 'imp', label: 'IMPORTE', x: 475, w: 80, align: 'right' },
  ];
  doc.rect(40, y, 515, 18).fill(acento);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff');
  cols.forEach((c) => doc.text(c.label, c.x + 3, y + 5, { width: c.w - 6, align: c.align }));
  y += 18;

  doc.font('Helvetica').fontSize(8).fillColor('#000');
  items.forEach((it, idx) => {
    const rowStartY = y;
    const descHeight = doc.heightOfString(it.descripcion || '', { width: cols[2].w - 6 });
    const rowHeight = Math.max(16, descHeight + 6);
    if (idx % 2 === 1) doc.rect(40, rowStartY, 515, rowHeight).fill('#f7f9fb').fillColor('#000');
    doc.fillColor('#000');
    doc.text(String(idx + 1), cols[0].x + 3, rowStartY + 4, { width: cols[0].w - 6, align: cols[0].align });
    doc.text(String(it.cantidad), cols[1].x + 3, rowStartY + 4, { width: cols[1].w - 6, align: cols[1].align });
    doc.text(it.descripcion || '', cols[2].x + 3, rowStartY + 4, { width: cols[2].w - 6, align: cols[2].align });
    doc.text(money(it.precio_unitario, notaVenta.moneda), cols[3].x + 3, rowStartY + 4, { width: cols[3].w - 6, align: cols[3].align });
    doc.text(it.descuento_pct ? `${it.descuento_pct}%` : '-', cols[4].x + 3, rowStartY + 4, { width: cols[4].w - 6, align: cols[4].align });
    doc.text(money(it.subtotal, notaVenta.moneda), cols[5].x + 3, rowStartY + 4, { width: cols[5].w - 6, align: cols[5].align });
    y = rowStartY + rowHeight;
  });
  doc.moveTo(40, y).lineTo(555, y).stroke('#ddd');
  y += 10;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(acento);
  doc.text('TOTAL:', 350, y, { width: 120, align: 'left' });
  doc.text(money(notaVenta.total, notaVenta.moneda), 475, y, { width: 80, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#333');
  doc.text(montoEnLetras(notaVenta.total, notaVenta.moneda), 40, y + 3, { width: 290 });
  y += 40;

  const obsBoxH = 50;
  doc.roundedRect(40, y, 515, obsBoxH, 5).stroke('#ddd');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(acento).text('OBSERVACIONES:', 50, y + 8);
  doc.font('Helvetica').fontSize(8).fillColor('#333').text(notaVenta.observaciones || 'Sin observaciones.', 50, y + 22, { width: 495 });
  y += obsBoxH + 12;

  const barY = y + 8;
  doc.rect(0, barY, 595, 50).fill(acento);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#fff').text('¡Gracias por su preferencia!', 40, barY + 12, { width: 515, align: 'center' });
  doc.font('Helvetica').fontSize(6.5).fillColor('#fff').text(
    'Documento sin efectos tributarios — no es un comprobante de pago, no tiene validez ante SUNAT.',
    40, barY + 30, { width: 515, align: 'center' }
  );

  return doc;
}

// Formato ticket/recibo angosto (rollo térmico de 80mm), pensado para
// impresoras de punto de venta. Al no tener el alto fijo de una hoja A4, se
// estima según la cantidad de items para no dejar espacio de más ni cortar
// contenido.
function buildTicketPdf(invoice, items, empresa, acento, logo, qr, cobros) {
  const width = 227; // 80mm
  const margin = 10;
  const contentWidth = width - margin * 2;
  const esAbonado = invoice.forma_pago === 'abonado';
  const esMixto = invoice.forma_pago === 'mixto';
  const estimatedHeight = 420 + items.length * 34
    + (empresa.terminos_condiciones_pdf ? 60 : 0)
    + (invoice.observaciones ? 40 : 0)
    + (logo ? 60 : 0)
    + (qr ? 130 : 0)
    + (invoice.cliente_direccion ? 20 : 0)
    + (invoice.cliente_referencia ? 20 : 0)
    + ((esAbonado || esMixto) ? 90 + (cobros?.length || 0) * 12 : 0);
  const doc = new PDFDocument({ margin, size: [width, estimatedHeight] });
  const esReal = invoice.modo_emision === 'real' && invoice.sunat_estado === 'aceptado';

  // Escribe texto y avanza "y" según el alto real ya envuelto (heightOfString),
  // en vez de un incremento fijo — el ticket es angosto y las direcciones
  // largas se parten en varias líneas, así que un incremento fijo pisaba la
  // línea siguiente.
  function linea(texto, opts = {}) {
    if (!texto) return;
    const textOpts = { width: contentWidth, ...opts };
    doc.text(texto, margin, y, textOpts);
    y += doc.heightOfString(texto, textOpts) + (opts.gap ?? 2);
  }

  let y = margin;
  if (logo) {
    const maxLogoW = contentWidth;
    const maxLogoH = 55;
    const layout = logoLayout(doc, logo, margin, y, maxLogoW, maxLogoH, { align: 'center' });
    if (layout) {
      try { layout.dibujar(); y += maxLogoH + 6; } catch { /* logo corrupto, se ignora */ }
    }
  }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(acento);
  linea(empresa.razon_social || 'CRM Facturacion', { align: 'center', gap: 4 });
  doc.font('Helvetica').fontSize(7).fillColor('#333');
  if (empresa.ruc) linea(`RUC: ${empresa.ruc}`, { align: 'center' });
  if (empresa.direccion_fiscal) linea(empresa.direccion_fiscal, { align: 'center' });
  const contacto = [empresa.telefono, empresa.email].filter(Boolean).join(' / ');
  if (contacto) linea(contacto, { align: 'center' });
  y += 4;
  doc.moveTo(margin, y).lineTo(width - margin, y).stroke('#000');
  y += 8;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(acento);
  linea(TIPO_LABEL[invoice.tipo_comprobante] || invoice.tipo_comprobante, { align: 'center', gap: 4 });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  linea(`${invoice.serie}-${String(invoice.numero).padStart(3, '0')}`, { align: 'center', gap: 6 });

  doc.font('Helvetica').fontSize(7).fillColor('#000');
  const filaTicket = (label, valor) => {
    if (!valor) return;
    linea(`${label}: ${valor}`, { gap: 3 });
  };
  filaTicket('Fecha', invoice.fecha_emision);
  filaTicket('Cliente', invoice.cliente_nombre);
  filaTicket(invoice.cliente_tipo_documento, invoice.cliente_documento);
  filaTicket('Direccion', invoice.cliente_direccion);
  filaTicket('Referencia', invoice.cliente_referencia);
  filaTicket('Contacto', invoice.cliente_contacto);
  filaTicket('F. Pago', formaPagoLabel(invoice.forma_pago));
  filaTicket('Vendedor', invoice.vendedor_nombre);
  y += 2;

  doc.moveTo(margin, y).lineTo(width - margin, y).stroke('#000');
  y += 8;

  items.forEach((it) => {
    doc.fontSize(7).fillColor('#000');
    linea(`${it.descripcion} ${it.codigo ? `(${it.codigo})` : ''}`, { gap: 1 });
    doc.text(`${it.cantidad} ${it.unidad || 'NIU'} x ${money(it.precio_unitario, invoice.moneda)}`, margin, y, { width: contentWidth - 70 });
    doc.text(money(it.subtotal, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
    y += 13;
  });

  doc.moveTo(margin, y).lineTo(width - margin, y).stroke('#000');
  y += 8;
  doc.fontSize(7);
  doc.text('Subtotal:', margin, y, { width: contentWidth - 60 });
  doc.text(money(invoice.subtotal, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
  y += 10;
  doc.text(igvLabel(invoice, empresa), margin, y, { width: contentWidth - 60 });
  doc.text(money(invoice.igv, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
  y += 10;
  doc.fontSize(9).fillColor(acento);
  doc.text('TOTAL:', margin, y, { width: contentWidth - 60 });
  doc.text(money(invoice.total, invoice.moneda), margin, y, { width: contentWidth, align: 'right' });
  y += 14;

  doc.fontSize(6.5).fillColor('#333').text(montoEnLetras(invoice.total, invoice.moneda), margin, y, { width: contentWidth, align: 'center' });
  y += doc.heightOfString(montoEnLetras(invoice.total, invoice.moneda), { width: contentWidth, align: 'center' }) + 8;

  if (esAbonado || esMixto) {
    doc.moveTo(margin, y).lineTo(width - margin, y).stroke('#000');
    y += 8;
    if (esAbonado) {
      const saldo = Math.max(0, Number(invoice.total) - Number(invoice.monto_pagado || 0));
      doc.fontSize(7).fillColor(acento).text('INFORMACION DEL CREDITO', margin, y, { width: contentWidth, align: 'center' });
      y += 10;
      doc.fillColor('#000');
      doc.text(`Abonado: ${money(invoice.monto_pagado || 0, invoice.moneda)}`, margin, y, { width: contentWidth }); y += 10;
      doc.font('Helvetica-Bold').text(`Saldo: ${money(saldo, invoice.moneda)}`, margin, y, { width: contentWidth }); y += 12;
      doc.font('Helvetica');
    } else {
      doc.fontSize(7).fillColor(acento).text('DESGLOSE DE PAGO MIXTO', margin, y, { width: contentWidth, align: 'center' });
      y += 10;
      doc.fillColor('#000');
    }
    if (cobros && cobros.length) {
      cobros.forEach((c) => {
        const fechaTxt = esAbonado ? `${(c.created_at || '').slice(0, 10)} ` : '';
        doc.fontSize(6.5).text(`${fechaTxt}${formaPagoLabel(c.medio)} ${money(c.monto, invoice.moneda)}`, margin, y, { width: contentWidth });
        y += 9;
      });
    }
    y += 4;
  }

  if (invoice.observaciones) {
    doc.fontSize(6).fillColor('#444').text(invoice.observaciones, margin, y, { width: contentWidth, align: 'center' });
    y += doc.heightOfString(invoice.observaciones, { width: contentWidth, align: 'center' }) + 6;
  }
  if (qr) {
    try {
      doc.image(qr, (width - 60) / 2, y, { width: 60, height: 60 });
      y += 66;
    } catch { /* ignore */ }
  }
  if (empresa.terminos_condiciones_pdf) {
    doc.fontSize(6).fillColor('#555').text(empresa.terminos_condiciones_pdf, margin, y, { width: contentWidth, align: 'center' });
    y += doc.heightOfString(empresa.terminos_condiciones_pdf, { width: contentWidth, align: 'center' }) + 6;
  }

  doc.fontSize(6.5).fillColor(esReal ? '#0ca30c' : '#999').text(
    esReal ? 'Comprobante electronico aceptado por SUNAT.' : 'Documento en modo simulado, sin validez tributaria.',
    margin, y, { width: contentWidth, align: 'center' }
  );

  return doc;
}

module.exports = { buildInvoicePdf, buildNotaVentaPdf };
