import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Camera } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { hoyPeru } from '../utils/fechas';
import { useToast } from '../context/ToastContext';
import { capturarPanelComoImagen } from '../utils/capturarImagen';

function todayStr() {
  return hoyPeru();
}

function money(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

function fechaLegible(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Mismo mecanismo que Dashboard.jsx (ver utils/capturarImagen.js), con los
// mensajes propios de este panel.
async function capturarComoImagen(ref, toast) {
  await capturarPanelComoImagen(ref, 'mi-cierre-caja.png', toast, {
    mensajeCopiado: 'Captura copiada — pégala directo en WhatsApp con Ctrl+V (o Cmd+V).',
    mensajeDescargado: 'Captura descargada — ya puedes enviarla por WhatsApp.',
    mensajeError: 'No se pudo generar la captura.',
  });
}

// Una fila simple "etiqueta ... valor", como una línea de boleta — en vez de
// una tabla con bordes, para que el conjunto se sienta como un recibo real.
function Fila({ label, valor, total }) {
  return (
    <div className={'mi-cierre-row' + (total ? ' total' : '')}>
      <span>{label}</span>
      <strong>{valor}</strong>
    </div>
  );
}

// Cierre de caja personal, con formato de recibo (como una boleta simple):
// cada vendedor/cajero ve SOLO lo suyo (el backend ya fuerza empleado_id =
// quien está logueado para cualquiera que no sea Gerencia/Supervisor — ver
// GET /reports/cierre-caja), así que acá no hay selector de empleado. Usa
// el color y el logo de la empresa (Configuración → Empresa /
// color_tablero_ventas) para que se sienta parte de la marca. El botón de
// cámara (html2canvas) y el zoom manual sirven para capturar todo de un
// vistazo al cerrar turno.
export default function MiCierreCaja() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, empresa } = useAuth();
  const panelRef = useRef(null);
  const [fecha, setFecha] = useState(todayStr());
  const [cierre, setCierre] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/reports/cierre-caja', { params: { fecha } })
      .then((res) => setCierre(res.data))
      .catch((err) => setError(err.response?.data?.error || 'No se pudo cargar el cierre de caja.'))
      .finally(() => setLoading(false));
  }, [fecha]);

  function acercar() {
    setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 100) / 100));
  }
  function alejar() {
    setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 100) / 100));
  }

  const color = empresa?.color_tablero_ventas || '#16a34a';
  const totalDocumentos = cierre?.ventas_por_documento.reduce((s, d) => s + d.cantidad, 0) ?? 0;
  const totalDocumentosMonto = cierre?.ventas_por_documento.reduce((s, d) => s + d.total, 0) ?? 0;

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Caja y Bancos" onClick={() => navigate('/caja')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        MI CIERRE DE CAJA
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8, marginBottom: 16 }}>
        Solo tus propias ventas y movimientos del día — no los de otros empleados de la sede.
      </p>

      <div className="filter-panel" style={{ marginBottom: 16 }}>
        <div className="filter-field">
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Zoom</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn-secondary" onClick={alejar} title="Alejar">
              <ZoomOut size={16} />
            </button>
            <button type="button" className="btn-secondary" onClick={() => setZoom(1)} title="Restablecer zoom">
              <RotateCcw size={16} />
            </button>
            <button type="button" className="btn-secondary" onClick={acercar} title="Acercar">
              <ZoomIn size={16} />
            </button>
            <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--ink-muted)' }}>{Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <div className="filter-field">
          <label>&nbsp;</label>
          <button
            type="button"
            className="btn-primary"
            style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', background: color, borderColor: color }}
            onClick={() => capturarComoImagen(panelRef, toast)}
          >
            <Camera size={16} /> Capturar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="panel"><span className="spinner" /> Cargando cierre de caja...</div>
      ) : error ? (
        <div className="panel"><p className="form-error">{error}</p></div>
      ) : cierre && (
        <div style={{ overflow: 'auto' }}>
          <div
            ref={panelRef}
            className="mi-cierre-receipt"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', width: zoom < 1 ? `${100 / zoom}%` : 'auto' }}
          >
            <div className="mi-cierre-receipt-header" style={{ background: color }}>
              {empresa?.logo_data_url && (
                <img src={empresa.logo_data_url} alt="Logo" className="mi-cierre-receipt-logo" />
              )}
              <div className="mi-cierre-receipt-empresa">{empresa?.nombre_comercial || empresa?.razon_social || 'QORIA'}</div>
            </div>

            <div className="mi-cierre-receipt-body">
              <p className="mi-cierre-receipt-titulo">Cierre de Caja</p>
              <div className="mi-cierre-receipt-meta">
                <strong>{user?.full_name}</strong>
                {fechaLegible(fecha)} · {user?.sucursal_nombre || ''}
              </div>

              <p className="mi-cierre-section-title" style={{ color }}>Efectivo</p>
              {cierre.efectivo ? (
                <>
                  <Fila label="Saldo inicial" valor={money(cierre.efectivo.saldo_inicial)} />
                  <Fila label="Ingresos" valor={money(cierre.efectivo.ingresos.total)} />
                  <Fila label="Egresos" valor={`-${money(cierre.efectivo.egresos.total)}`} />
                  <Fila label="Saldo final" valor={money(cierre.efectivo.saldo_final)} total />
                </>
              ) : <p className="mi-cierre-empty">El método Efectivo no está activo.</p>}

              <p className="mi-cierre-section-title" style={{ color }}>🧾 Abonados (crédito)</p>
              {cierre.abonados ? (
                <Fila label={`Vendido a crédito (${cierre.abonados.cantidad})`} valor={money(cierre.abonados.ingresos.total)} total />
              ) : <p className="mi-cierre-empty">Sin ventas abonado en la fecha seleccionada.</p>}

              <p className="mi-cierre-section-title" style={{ color }}>Ventas por Documento</p>
              {cierre.ventas_por_documento.map((d) => (
                <Fila key={d.doc} label={`${d.label} (${d.cantidad})`} valor={money(d.total)} />
              ))}
              <Fila label={`Total (${totalDocumentos})`} valor={money(totalDocumentosMonto)} total />

              <p className="mi-cierre-section-title" style={{ color }}>Ventas por Forma de Pago</p>
              {cierre.ventas_por_forma_pago.map((f) => (
                <Fila key={f.forma_pago} label={`${f.label} (${f.cantidad})`} valor={money(f.total)} />
              ))}
              {cierre.ventas_por_forma_pago.length === 0 && (
                <p className="mi-cierre-empty">Sin ventas en la fecha seleccionada.</p>
              )}

              <p className="mi-cierre-section-title" style={{ color }}>Resultado del Día</p>
              <Fila label="Total de ventas bruto" valor={money(cierre.turno.bruto)} />
              <Fila label="Descuento" valor={`-${money(cierre.turno.descuento)}`} />
              <Fila label="Devoluciones" valor={`-${money(cierre.turno.devoluciones)}`} />
              <Fila label="Anulaciones" valor={`-${money(cierre.turno.anulaciones)}`} />
              <Fila label="Total neto" valor={money(cierre.turno.neto)} total />

              <p className="mi-cierre-receipt-footer">Generado por QORIA</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
