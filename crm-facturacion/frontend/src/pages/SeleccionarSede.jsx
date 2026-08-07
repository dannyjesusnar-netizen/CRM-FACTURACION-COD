import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import FloatingShapes from '../components/FloatingShapes';

const ROLE_LABEL = { gerencia: 'Administrador', vendedor: 'Vendedor' };

const SEDE_SHAPES = [
  { type: 'dot', top: '8%', left: '12%', size: 14, color: '#fbbf24', delay: '0s' },
  { type: 'plus', top: '15%', left: '85%', size: 16, color: '#ffffff', delay: '0.5s' },
  { type: 'square', top: '28%', left: '6%', size: 14, color: '#f472b6', delay: '0.9s' },
  { type: 'dot', top: '18%', left: '48%', size: 8, color: '#ffffff', delay: '0.3s' },
  { type: 'plus', top: '42%', left: '93%', size: 14, color: '#86efac', delay: '1.1s' },
  { type: 'square', top: '62%', left: '4%', size: 12, color: '#ffffff', delay: '0.4s' },
  { type: 'dot', top: '70%', left: '91%', size: 10, color: '#fbbf24', delay: '0.7s' },
  { type: 'plus', top: '84%', left: '18%', size: 16, color: '#f472b6', delay: '0.2s' },
  { type: 'dot', top: '90%', left: '56%', size: 9, color: '#86efac', delay: '1s' },
  { type: 'dot', top: '6%', left: '70%', size: 10, color: '#f472b6', delay: '0.6s' },
  { type: 'plus', top: '93%', left: '82%', size: 14, color: '#ffffff', delay: '0.85s' },
];

export default function SeleccionarSede() {
  const { user, setSucursal } = useAuth();
  const navigate = useNavigate();
  const [sucursales, setSucursales] = useState(null);

  useEffect(() => {
    api.get('/sucursales').then((res) => {
      // Si solo hay una sede activa, no tiene sentido pedir que la elijan.
      if (res.data.length <= 1) {
        const unica = res.data[0];
        if (unica) {
          setSucursal(unica.id, unica.nombre);
          navigate('/menu', { replace: true });
          return;
        }
      }
      setSucursales(res.data);
    });
  }, []);

  function elegir(s) {
    setSucursal(s.id, s.nombre);
    navigate('/menu');
  }

  if (!sucursales) return null;

  return (
    <div className="login-page">
      <FloatingShapes shapes={SEDE_SHAPES} />
      <div className="login-card" style={{ maxWidth: 420 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 20 }}>Selecciona un negocio</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sucursales.map((s) => (
            <div
              key={s.id}
              onClick={() => elegir(s)}
              role="button"
              tabIndex={0}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Building2 size={18} style={{ opacity: 0.6 }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 600 }}>
                    {ROLE_LABEL[user?.role] || user?.role}
                  </div>
                  <div style={{ fontWeight: 700 }}>{s.nombre}</div>
                </div>
              </div>
              <ArrowRight size={18} style={{ opacity: 0.5 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
