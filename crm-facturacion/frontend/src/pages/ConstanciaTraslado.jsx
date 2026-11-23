import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Camera } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { capturarPanelComoImagen } from '../utils/capturarImagen';

function fechaHoraLegible(fecha) {
  return new Date(fecha).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Una fila del comprobante: producto + cantidad trasladada, con el lote (si
// lo hay) como nota chica debajo — mismo criterio que ConstanciaMovimiento.
function FilaItem({ it }) {
  return (
    <div style={{ padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
      <div className="mi-cierre-row" style={{ padding: 0, border: 'none' }}>
        <span>{it.codigo ? `${it.codigo} — ${it.nombre}` : it.nombre}</span>
        <strong>{it.cantidad} {it.unidad || ''}</strong>
      </div>
      {it.codigo_lote && (
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>Lote {it.codigo_lote}</p>
      )}
    </div>
  );
}

// Constancia de Traslado entre sedes, con el mismo diseño de recibo (verde de
// Organic, con logo) que Mi Cierre de Caja / Constancia de Movimiento — se
// genera al vuelo con el traslado recién creado o aprobado (no es un
// documento nuevo guardado en el servidor, es un comprobante para
// capturar/imprimir en el momento, a pedido — ver routes/traslados.js, que
// ya deja el movimiento en el Kardex de origen y destino).
export default function ConstanciaTraslado() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { empresa } = useAuth();
  const panelRef = useRef(null);
  const [zoom, setZoom] = useState(1);

  const traslado = location.state?.traslado || null;

  function acercar() {
    setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 100) / 100));
  }
  function alejar() {
    setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 100) / 100));
  }

  if (!traslado) {
    return (
      <div>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-link" title="Volver a Traslados" onClick={() => navigate('/traslados')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <ArrowLeft size={20} />
          </button>
          CONSTANCIA DE TRASLADO
        </h1>
        <div className="panel">
          <p>No hay una constancia para mostrar. Se genera automáticamente justo después de registrar o aprobar un traslado.</p>
          <button className="btn-secondary" onClick={() => navigate('/traslados')}>Ir a Traslados</button>
        </div>
      </div>
    );
  }

  const color = empresa?.color_tablero_ventas || '#16a34a';

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Traslados" onClick={() => navigate('/traslados')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CONSTANCIA DE TRASLADO
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8, marginBottom: 16 }}>
        Comprobante del traslado que acaba de moverse — captúralo para compartirlo o guardarlo.
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
            onClick={() => capturarPanelComoImagen(panelRef, 'constancia-traslado.png', toast, {
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
          <button type="button" className="btn-secondary" onClick={() => navigate('/traslados')}>
            Volver a Traslados
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
            <p className="mi-cierre-receipt-titulo">Constancia de Traslado #{traslado.codigo}</p>
            <div className="mi-cierre-receipt-meta">
              <strong>{traslado.sucursal_origen_nombre} → {traslado.sucursal_destino_nombre}</strong>
              {fechaHoraLegible(traslado.created_at)} · Emisor: {traslado.emisor_nombre || '—'}
              {traslado.aprobador_nombre && <> · Aprobó: {traslado.aprobador_nombre}</>}
            </div>

            <p className="mi-cierre-section-title" style={{ color }}>Detalle</p>
            {(traslado.items || []).map((it) => <FilaItem key={it.id} it={it} />)}

            {traslado.observaciones && (
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 8 }}>Obs: {traslado.observaciones}</p>
            )}

            <p className="mi-cierre-receipt-footer">Generado por QORIA</p>
          </div>
        </div>
      </div>
    </div>
  );
}
