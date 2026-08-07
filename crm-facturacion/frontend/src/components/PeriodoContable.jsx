import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function anios() {
  const actual = new Date().getFullYear();
  const list = [];
  for (let a = actual + 1; a >= actual - 4; a--) list.push(a);
  return list;
}

// Selector de "periodo contable" (mes + año) — al aceptar, entrega el
// primer y último día de ese mes para usarlos como rango Desde/Hasta.
export default function PeriodoContable({ mes, anio, onChange }) {
  const [open, setOpen] = useState(false);
  const [mesSel, setMesSel] = useState(mes);
  const [anioSel, setAnioSel] = useState(anio);

  function abrir() {
    setMesSel(mes);
    setAnioSel(anio);
    setOpen(true);
  }

  function aceptar() {
    const desde = `${anioSel}-${String(mesSel).padStart(2, '0')}-01`;
    const ultimoDia = new Date(anioSel, mesSel, 0).getDate();
    const hasta = `${anioSel}-${String(mesSel).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    onChange({ mes: mesSel, anio: anioSel, desde, hasta });
    setOpen(false);
  }

  return (
    <div className="periodo-contable">
      <span className="periodo-label">Periodo</span>
      <button type="button" className="periodo-pill" onClick={abrir}>
        {MESES[mes - 1].toUpperCase()} <ChevronDown size={13} />
      </button>
      <button type="button" className="periodo-pill" onClick={abrir}>
        {anio} <ChevronDown size={13} />
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <h2>Periodo Contable</h2>
            <div className="periodo-modal-row">
              <select value={mesSel} onChange={(e) => setMesSel(Number(e.target.value))}>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select value={anioSel} onChange={(e) => setAnioSel(Number(e.target.value))}>
                {anios().map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={aceptar}>Aceptar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
