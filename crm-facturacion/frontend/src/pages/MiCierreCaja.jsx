import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import api from '../api';
import { hoyPeru } from '../utils/fechas';

function todayStr() {
  return hoyPeru();
}

function money(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

// Cierre de caja personal: cada vendedor/cajero ve SOLO lo suyo (el backend
// ya fuerza empleado_id = quien está logueado para cualquiera que no sea
// Gerencia/Supervisor — ver GET /reports/cierre-caja), así que acá no hay
// selector de empleado. Pensada para capturar pantalla al cerrar turno: el
// zoom (transform: scale) permite achicar todo el reporte para que quepa
// en una sola captura sin tener que hacer scroll ni recortar varias fotos.
export default function MiCierreCaja() {
  const navigate = useNavigate();
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

      <div className="filter-panel" style={{ marginBottom: 12 }}>
        <div className="filter-field">
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Zoom (para capturar pantalla)</label>
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
      </div>

      {loading ? (
        <div className="panel"><span className="spinner" /> Cargando cierre de caja...</div>
      ) : error ? (
        <div className="panel"><p className="form-error">{error}</p></div>
      ) : cierre && (
        <div style={{ overflow: 'auto' }}>
          <div className="panel" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: zoom < 1 ? `${100 / zoom}%` : 'auto' }}>
            <h4 style={{ marginTop: 0, marginBottom: 8 }}>Efectivo</h4>
            {cierre.efectivo ? (
              <table className="data-table compact">
                <tbody>
                  <tr><td>Saldo inicial</td><td style={{ textAlign: 'right' }}>{money(cierre.efectivo.saldo_inicial)}</td></tr>
                  <tr><td>Ingresos</td><td style={{ textAlign: 'right' }}>{money(cierre.efectivo.ingresos.total)}</td></tr>
                  <tr><td>Egresos</td><td style={{ textAlign: 'right' }}>{money(cierre.efectivo.egresos.total)}</td></tr>
                  <tr className="totals-footer"><td>Saldo final</td><td style={{ textAlign: 'right' }}>{money(cierre.efectivo.saldo_final)}</td></tr>
                </tbody>
              </table>
            ) : <p className="empty-row">El método Efectivo no está activo.</p>}

            <h4 style={{ marginTop: 24, marginBottom: 8 }}>🧾 Abonados</h4>
            {cierre.abonados ? (
              <table className="data-table compact">
                <tbody>
                  <tr><td>Cantidad de ventas abonado</td><td style={{ textAlign: 'right' }}>{cierre.abonados.cantidad}</td></tr>
                  <tr className="totals-footer"><td>Total vendido a crédito</td><td style={{ textAlign: 'right' }}>{money(cierre.abonados.ingresos.total)}</td></tr>
                </tbody>
              </table>
            ) : <p className="empty-row">Sin ventas abonado en la fecha seleccionada.</p>}

            <h4 style={{ marginTop: 24, marginBottom: 8 }}>Ventas por Documento</h4>
            <table className="data-table">
              <thead>
                <tr><th>Documento</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Total</th></tr>
              </thead>
              <tbody>
                {cierre.ventas_por_documento.map((d) => (
                  <tr key={d.doc}>
                    <td>{d.label}</td>
                    <td style={{ textAlign: 'right' }}>{d.cantidad}</td>
                    <td style={{ textAlign: 'right' }}>{money(d.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="totals-footer">
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{cierre.ventas_por_documento.reduce((s, d) => s + d.cantidad, 0)}</td>
                  <td style={{ textAlign: 'right' }}>{money(cierre.ventas_por_documento.reduce((s, d) => s + d.total, 0))}</td>
                </tr>
              </tfoot>
            </table>

            <h4 style={{ marginTop: 24, marginBottom: 8 }}>Ventas por Forma de Pago</h4>
            <table className="data-table">
              <thead>
                <tr><th>Forma de pago</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Total</th></tr>
              </thead>
              <tbody>
                {cierre.ventas_por_forma_pago.map((f) => (
                  <tr key={f.forma_pago}>
                    <td>{f.label}</td>
                    <td style={{ textAlign: 'right' }}>{f.cantidad}</td>
                    <td style={{ textAlign: 'right' }}>{money(f.total)}</td>
                  </tr>
                ))}
                {cierre.ventas_por_forma_pago.length === 0 && (
                  <tr><td colSpan={3} className="empty-row">Sin ventas en la fecha seleccionada.</td></tr>
                )}
              </tbody>
            </table>

            <h4 style={{ marginTop: 24, marginBottom: 8 }}>Resultado del Día</h4>
            <table className="data-table compact">
              <tbody>
                <tr><td>Total de ventas bruto</td><td style={{ textAlign: 'right' }}>{money(cierre.turno.bruto)}</td></tr>
                <tr><td>Descuento</td><td style={{ textAlign: 'right' }}>-{money(cierre.turno.descuento)}</td></tr>
                <tr><td>Devoluciones</td><td style={{ textAlign: 'right' }}>-{money(cierre.turno.devoluciones)}</td></tr>
                <tr><td>Anulaciones</td><td style={{ textAlign: 'right' }}>-{money(cierre.turno.anulaciones)}</td></tr>
                <tr className="totals-footer"><td>Total de ventas neto</td><td style={{ textAlign: 'right' }}>{money(cierre.turno.neto)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
