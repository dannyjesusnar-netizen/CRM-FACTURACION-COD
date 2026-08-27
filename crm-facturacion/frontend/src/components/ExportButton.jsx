import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileSpreadsheet, FileText } from 'lucide-react';

// Botón "Exportar" reutilizable: en vez de descargar directo un formato
// fijo (antes siempre CSV), despliega un menú para elegir Excel o CSV.
// Cada pantalla sigue armando sus propias columnas/filas — solo cambia
// cómo se entrega el archivo al final (ver utils/excelImport.js).
export default function ExportButton({ onExport, className = 'btn-export', label = 'Exportar' }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function elegir(formato) {
    setOpen(false);
    onExport(formato);
  }

  return (
    <div className="export-btn-wrap" ref={boxRef}>
      <button type="button" className={className} onClick={() => setOpen((v) => !v)}>
        {label} <ChevronDown size={14} style={{ marginLeft: 4, verticalAlign: 'text-bottom' }} />
      </button>
      {open && (
        <div className="export-btn-menu">
          <button type="button" className="export-btn-menu-item" onClick={() => elegir('excel')}>
            <FileSpreadsheet size={14} /> Excel (.xlsx)
          </button>
          <button type="button" className="export-btn-menu-item" onClick={() => elegir('csv')}>
            <FileText size={14} /> CSV
          </button>
        </div>
      )}
    </div>
  );
}
