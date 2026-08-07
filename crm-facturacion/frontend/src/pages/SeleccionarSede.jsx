import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import FloatingShapes from '../components/FloatingShapes';

const ROLE_LABEL = { gerencia: 'Administrador', vendedor: 'Vendedor' };

const SEDE_SHAPES = [
  { type: 'dot', top: '8%', left: '12%', size: 14, color: '#fbbf24', delay: '0s' },
  { type: 'plus', top: '15%', left: '85%', size: 16, color: '#6366f1', delay: '0.5s' },
  { type: 'square', top: '28%', left: '6%', size: 14, color: '#f472b6', delay: '0.9s' },
  { type: 'dot', top: '18%', left: '48%', size: 8, color: '#6366f1', delay: '0.3s' },
  { type: 'plus', top: '42%', left: '93%', size: 14, color: '#22c55e', delay: '1.1s' },
  { type: 'square', top: '62%', left: '4%', size: 12, color: '#6366f1', delay: '0.4s' },
  { type: 'dot', top: '70%', left: '91%', size: 10, color: '#fbbf24', delay: '0.7s' },
  { type: 'plus', top: '84%', left: '18%', size: 16, color: '#f472b6', delay: '0.2s' },
  { type: 'dot', top: '90%', left: '56%', size: 9, color: '#22c55e', delay: '1s' },
  { type: 'dot', top: '6%', left: '70%', size: 10, color: '#f472b6', delay: '0.6s' },
  { type: 'plus', top: '93%', left: '82%', size: 14, color: '#6366f1', delay: '0.85s' },
];

const SEDE_ICONS = [
  { type: 'computer', top: '9%', left: '28%', size: 38, delay: '0.15s' },
  { type: 'calculator', top: '11%', left: '66%', size: 34, delay: '0.55s' },
  { type: 'truck', top: '52%', left: '6%', size: 42, delay: '0.75s' },
  { type: 'dollar', top: '80%', left: '30%', size: 34, delay: '0.35s' },
  { type: 'soles', top: '32%', left: '90%', size: 34, delay: '1s' },
  { type: 'phone', top: '78%', left: '80%', size: 30, delay: '0.05s' },
];

function SedeIcon({ type }) {
  switch (type) {
    case 'computer':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <rect x="4" y="6" width="32" height="22" rx="4" fill="#ffffff" stroke="#c7c9f4" strokeWidth="2" />
          <rect x="9" y="11" width="12" height="12" rx="2" fill="#a5b4fc" />
          <rect x="23" y="11" width="4" height="12" rx="1" fill="#6366f1" />
          <rect x="29" y="15" width="4" height="8" rx="1" fill="#fbbf24" />
          <rect x="15" y="28" width="10" height="4" fill="#c7c9f4" />
          <rect x="10" y="32" width="20" height="3" rx="1.5" fill="#c7c9f4" />
        </svg>
      );
    case 'calculator':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <rect x="6" y="4" width="28" height="34" rx="5" fill="#334155" />
          <rect x="10" y="9" width="20" height="9" rx="2" fill="#86efac" />
          <rect x="10" y="22" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="17.5" y="22" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="25" y="22" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="10" y="29" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="17.5" y="29" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="25" y="29" width="5" height="5" rx="1" fill="#fbbf24" />
        </svg>
      );
    case 'truck':
      return (
        <svg viewBox="0 0 40 24" width="100%" height="60%">
          <rect x="2" y="4" width="20" height="14" rx="2" fill="#6366f1" />
          <path d="M22 4h10l6 8v6H22z" fill="#a5b4fc" />
          <rect x="26" y="8" width="6" height="5" rx="1" fill="#eef0fd" />
          <circle cx="10" cy="20" r="4" fill="#334155" />
          <circle cx="30" cy="20" r="4" fill="#334155" />
          <circle cx="10" cy="20" r="1.6" fill="#c7c9f4" />
          <circle cx="30" cy="20" r="1.6" fill="#c7c9f4" />
        </svg>
      );
    case 'dollar':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <circle cx="20" cy="20" r="18" fill="#22c55e" />
          <text x="20" y="28" textAnchor="middle" fontSize="20" fontWeight="800" fill="#ffffff" fontFamily="Arial, sans-serif">$</text>
        </svg>
      );
    case 'soles':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <circle cx="20" cy="20" r="18" fill="#6366f1" />
          <text x="20" y="26" textAnchor="middle" fontSize="15" fontWeight="800" fill="#ffffff" fontFamily="Arial, sans-serif">S/</text>
        </svg>
      );
    case 'phone':
      return (
        <svg viewBox="0 0 26 40" width="100%" height="100%">
          <rect x="2" y="2" width="22" height="36" rx="6" fill="#ffffff" stroke="#c7c9f4" strokeWidth="2" />
          <rect x="6" y="7" width="14" height="22" rx="2" fill="#eef0fd" />
          <circle cx="13" cy="33" r="1.6" fill="#c7c9f4" />
        </svg>
      );
    default:
      return null;
  }
}

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
    <div className="sede-page">
      <FloatingShapes shapes={SEDE_SHAPES} />
      {SEDE_ICONS.map((ic, i) => (
        <div
          key={i}
          className="sede-float-icon"
          style={{ top: ic.top, left: ic.left, width: ic.size, height: ic.size, animationDelay: ic.delay }}
        >
          <SedeIcon type={ic.type} />
        </div>
      ))}
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
