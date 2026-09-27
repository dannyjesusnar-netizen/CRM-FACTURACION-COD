import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Camera } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { capturarPanelComoImagen } from '../utils/capturarImagen';

function fechaHoraLegible() {
  return new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function cantidadLegible(f) {
  const signo = f.cantidad > 0 ? '+' : '';
  return `${signo}${f.cantidad} ${f.unidad || ''}`.trim();
}

// Una fila del comprobante: producto + cantidad, con el lote y el
// motivo/proveedor (si los hay) como una nota chica debajo — igual que una
// línea de boleta con su detalle.
function FilaMovimiento({ f }) {
  const notas = [];
  const lote = f.codigo_lote || f.lote_codigo;
  if (lote) notas.push(`Lote ${lote}`);
  if (f.proveedor_nombre) notas.push(f.proveedor_nombre);
  if (f.motivo) notas.push(f.motivo);
  return (
    <div style={{ padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
      <div className="mi-cierre-row" style={{ padding: 0, border: 'none' }}>
        <span>{f.codigo ? `${f.codigo} — ${f.producto_nombre}` : f.producto_nombre}</span>
        <strong>{cantidadLegible(f)}</strong>
      </div>
      {notas.length > 0 && (
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>{notas.join(' · ')}</p>
      )}
    </div>
  );
}

// Constancia de ingreso/salida de almacén, con el mismo diseño de recibo
// (verde de Organic, con logo) que Mi Cierre de Caja — se genera al vuelo
// con las filas que se acaban de registrar en "Registrar Movimiento" (no
// queda guardada en el servidor como documento propio, es un comprobante
// para capturar/imprimir en el momento).
export default function ConstanciaMovimiento() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user, empresa } = useAuth();
  const panelRef = useRef(null);
  const [zoom, setZoom] = useState(1);

  const filas = location.state?.filas || [];

  function acercar() {
    setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 100) / 100));
  }
  function alejar() {
    setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 100) / 100));
  }

  if (filas.length === 0) {
    return (
      <div>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-link" title="Volver a Movimientos" onClick={() => navigate('/movimientos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <ArrowLeft size={20} />
          </button>
          CONSTANCIA DE MOVIMIENTO
        </h1>
        <div className="panel">
          <p>No hay una constancia para mostrar. Se genera automáticamente justo después de registrar un movimiento.</p>
          <button className="btn-secondary" onClick={() => navigate('/movimientos/registrar')}>Ir a Registrar Movimiento</button>
        </div>
      </div>
    );
  }

  const hayIngresos = filas.some((f) => f.cantidad > 0);
  const haySalidas = filas.some((f) => f.cantidad < 0);
  const titulo = hayIngresos && haySalidas
    ? 'Constancia de Movimiento de Almacén'
    : hayIngresos ? 'Constancia de Ingreso' : 'Constancia de Salida';

  const color = empresa?.color_tablero_ventas || '#16a34a';

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Movimientos" onClick={() => navigate('/movimientos')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        {titulo.toUpperCase()}
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8, marginBottom: 16 }}>
        Comprobante del movimiento que acabas de registrar — captúralo para compartirlo o guardarlo.
      </p>

      <div className="filter-panel" style={{ marginBottom: 16 }}>
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
            onClick={() => capturarPanelComoImagen(panelRef, 'constancia-movimiento.png', toast, {
              mensajeCopiado: 'Constancia copiada — pégala directo en WhatsApp con Ctrl+V (o Cmd+V).',
              mensajeDescargado: 'Constancia descargada — ya puedes enviarla por WhatsApp.',
              mensajeError: 'No se pudo generar la captura.',
            })}
          >
            <Camera size={16} /> Capturar
          </button>
        </div>
        <div className="filter-field">
          <label>&nbsp;</label>
          <button type="button" className="btn-secondary" onClick={() => navigate('/movimientos/registrar')}>
            Registrar otro movimiento
          </button>
        </div>
      </div>

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
            <p className="mi-cierre-receipt-titulo">{titulo}</p>
            <div className="mi-cierre-receipt-meta">
              <strong>{user?.full_name}</strong>
              {fechaHoraLegible()} · {user?.sucursal_nombre || ''}
            </div>

            <p className="mi-cierre-section-title" style={{ color }}>Detalle</p>
            {filas.map((f) => <FilaMovimiento key={f.id} f={f} />)}

            <p className="mi-cierre-receipt-footer">Generado por QORIA</p>
          </div>
        </div>
      </div>
    </div>
  );
}
