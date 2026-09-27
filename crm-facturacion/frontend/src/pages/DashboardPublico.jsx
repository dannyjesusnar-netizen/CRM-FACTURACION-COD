import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function money(n) {
  return `S/ ${Number(n || 0).toFixed(2)}`;
}

// Una tabla "categoría, cantidad, venta, %" — mismo formato que usan Total
// por Marca/Línea/Producto acá y en el Dashboard interno.
function TablaConPorcentaje({ titulo, color, columnaEtiqueta, filas, getEtiqueta, getKey }) {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-banda" style={{ background: color }}>
        <h3>{titulo}</h3>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>{columnaEtiqueta}</th><th>Cantidad</th><th>Venta</th><th>%</th></tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={getKey(f)}>
              <td>{getEtiqueta(f)}</td>
              <td>{f.cantidad}</td>
              <td>{money(f.venta)}</td>
              <td>{f.porcentaje.toFixed(2)}%</td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr><td colSpan={4} className="empty-row">Sin ventas registradas en este período.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Página pública (sin login) del link "Compartir dashboard" del Tablero de
// Ventas — ver routes/dashboardPublico.js. Muestra todos los totales
// agregados (sede, marca, línea, producto) y deja elegir año/mes/sede, pero
// nunca nombres de empleados (Ranking Personal sigue siendo interno).
export default function DashboardPublico() {
  const { ruc, token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [datos, setDatos] = useState(null);
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [sucursalId, setSucursalId] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/dashboard-publico/${ruc}/${token}`, { params: { anio, mes, sucursal_id: sucursalId || undefined } })
      .then((res) => setDatos(res.data))
      .catch((err) => setError(err.response?.data?.error || 'No se pudo cargar este dashboard.'))
      .finally(() => setLoading(false));
  }, [ruc, token, anio, mes, sucursalId]);

  if (loading && !datos) {
    return (
      <div className="pago-publico-page">
        <div className="pago-publico-card" style={{ maxWidth: 420 }}>
          <p>Cargando…</p>
        </div>
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div className="pago-publico-page">
        <div className="pago-publico-card" style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 18 }}>😕 {error || 'No se pudo cargar este dashboard.'}</h1>
        </div>
      </div>
    );
  }

  const color = datos.empresa.color || '#16a34a';

  return (
    <div className="pago-publico-page" style={{ alignItems: 'flex-start' }}>
      <div className="pago-publico-card" style={{ maxWidth: 680, textAlign: 'left' }}>
        {datos.empresa.logo_data_url && (
          <img src={datos.empresa.logo_data_url} alt="Logo" className="pago-publico-logo" style={{ margin: '0 0 12px' }} />
        )}
        <p className="pago-publico-eyebrow">Dashboard de ventas · {datos.alcance}</p>
        <h1 style={{ marginBottom: 12 }}>{datos.empresa.nombre}</h1>

        <div className="filter-panel" style={{ margin: '0 0 16px' }}>
          <div className="filter-field">
            <label>Año</label>
            <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ width: 100 }} />
          </div>
          <div className="filter-field">
            <label>Mes</label>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.map((nombre, idx) => (
                <option key={idx} value={idx + 1}>{nombre}</option>
              ))}
            </select>
          </div>
          {datos.puede_cambiar_sede && (
            <div className="filter-field">
              <label>Sede</label>
              <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                <option value="">Todas las sedes</option>
                {datos.sedes_disponibles.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-banda" style={{ background: color }}>
            <h3>Ventas por sede — {MESES[mes - 1]} {anio}</h3>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Sede</th><th>Venta</th><th>Meta</th><th>%</th></tr>
            </thead>
            <tbody>
              {datos.sedes.map((s) => (
                <tr key={s.sede}>
                  <td>{s.sede}</td>
                  <td>{money(s.venta)}</td>
                  <td>{s.meta > 0 ? money(s.meta) : '—'}</td>
                  <td>{s.porcentaje !== null ? `${s.porcentaje.toFixed(2)}%` : '—'}</td>
                </tr>
              ))}
              {datos.sedes.length === 0 && (
                <tr><td colSpan={4} className="empty-row">Sin ventas registradas en este período.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td>{money(datos.total.venta)}</td>
                <td>{datos.total.meta > 0 ? money(datos.total.meta) : '—'}</td>
                <td>{datos.total.porcentaje !== null ? `${datos.total.porcentaje.toFixed(2)}%` : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <TablaConPorcentaje
          titulo="Ventas por marca"
          color={color}
          columnaEtiqueta="Marca"
          filas={datos.marca}
          getEtiqueta={(m) => m.marca}
          getKey={(m) => m.marca}
        />

        <TablaConPorcentaje
          titulo="Ventas por línea"
          color={color}
          columnaEtiqueta="Línea"
          filas={datos.lineas}
          getEtiqueta={(l) => l.label}
          getKey={(l) => l.linea}
        />

        <TablaConPorcentaje
          titulo="Ventas por producto"
          color={color}
          columnaEtiqueta="Categoría"
          filas={datos.productos}
          getEtiqueta={(p) => p.categoria}
          getKey={(p) => p.categoria}
        />

        <p style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 16, textAlign: 'center' }}>
          Generado por QORIA — vista pública de solo lectura.
        </p>
      </div>
    </div>
  );
}
