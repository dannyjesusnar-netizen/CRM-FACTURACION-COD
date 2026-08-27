// Utilidades compartidas para que las pantallas de carga masiva (Productos,
// Operativos, Movimientos) acepten tanto CSV como Excel (.xlsx/.xls), sin
// tener que reescribir cada parser existente (parseCsvProductos, etc.) —
// un archivo Excel simplemente se convierte a texto CSV equivalente antes
// de entrar al mismo parser de siempre.
//
// exceljs se importa de forma dinámica (import() en vez de import estático)
// para que su código (~250KB gzip) solo se descargue cuando el usuario
// realmente abre un modal de carga masiva o pide una plantilla en Excel —
// no en cada carga de página.

function esArchivoExcel(file) {
  return /\.xlsx?$/i.test(file.name || '');
}

function valorCeldaComoTexto(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) {
    // yyyy-mm-dd — formato que ya esperan los parsers existentes (p.ej. fecha_vencimiento).
    return valor.toISOString().slice(0, 10);
  }
  if (typeof valor === 'object') {
    if (typeof valor.text === 'string') return valor.text; // rich text
    if (valor.result !== undefined) return String(valor.result); // fórmula
    if (valor.hyperlink) return String(valor.text || valor.hyperlink);
    return '';
  }
  return String(valor);
}

function celdaComoCsv(valor) {
  const texto = valorCeldaComoTexto(valor);
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// Lee un File (CSV o Excel) y devuelve el texto en formato CSV, listo para
// pasarlo tal cual a cualquiera de los parsers CSV ya existentes en cada
// pantalla.
export async function leerArchivoComoTextoCsv(file) {
  if (!esArchivoExcel(file)) {
    return await file.text();
  }
  const ExcelJS = (await import('exceljs')).default;
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const hoja = workbook.worksheets[0];
  if (!hoja) return '';
  const lineas = [];
  hoja.eachRow({ includeEmpty: false }, (fila) => {
    const valores = fila.values.slice(1); // ExcelJS: índice 0 siempre vacío
    lineas.push(valores.map(celdaComoCsv).join(','));
  });
  return lineas.join('\n');
}

// Genera y descarga un archivo .xlsx real (se abre nativo en Excel) con una
// fila de encabezados en negrita y una o más filas de ejemplo — misma
// información que ya usa cada botón "Descargar plantilla (CSV)".
export async function descargarComoExcel(filename, headers, filasEjemplo) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet('Plantilla');
  hoja.addRow(headers);
  hoja.getRow(1).font = { bold: true };
  filasEjemplo.forEach((fila) => hoja.addRow(fila));
  hoja.columns.forEach((col) => { col.width = 20; });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Descarga un CSV clásico (con BOM para que Excel reconozca los acentos) —
// misma forma que ya armaba a mano cada pantalla con botón "Exportar".
function descargarComoCsv(filename, headers, filas) {
  const csv = [headers, ...filas].map((fila) => fila.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Punto único para las pantallas con botón "Exportar": genera el archivo en
// el formato que haya elegido el usuario (ver componentes/ExportButton),
// reutilizando las mismas columnas/filas que cada pantalla ya arma.
export async function exportarTabla(filenameBase, headers, filas, formato) {
  if (formato === 'excel') {
    await descargarComoExcel(`${filenameBase}.xlsx`, headers, filas);
  } else {
    descargarComoCsv(`${filenameBase}.csv`, headers, filas);
  }
}
