import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Receipt, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const PLANES = [
  {
    id: 'basico',
    nombre: 'Plan Básico',
    precio: 59.90,
    resumen: 'Para negocios que solo necesitan facturar.',
    features: ['Facturación completa'],
  },
  {
    id: 'control',
    nombre: 'Plan Control',
    precio: 129.90,
    resumen: 'Para negocios que quieren controlar todo su equipo.',
    features: [
      'Facturación',
      'Inventario',
      'Dashboard',
      'Vendedores',
      'Creación de hasta 8 vendedores',
      'Soporte todos los días',
    ],
  },
  {
    id: 'premium',
    nombre: 'Plan Premium',
    precio: 199.90,
    destacado: true,
    resumen: 'Para negocios que quieren crecer sin límites.',
    features: [
      'Facturación',
      'Inventario',
      'Dashboard',
      'Vendedores',
      'Creación de hasta 8 sedes',
      'Creación de hasta 16 vendedores',
      'Soporte todos los días',
      'Integración de IA',
    ],
  },
];

export default function Planes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  function handleSuscribirme() {
    if (!user) {
      toast.info('Inicia sesión para suscribirte a un plan.');
      navigate('/login');
      return;
    }
    if (user.role !== 'gerencia') {
      toast.info('Solo Gerencia puede gestionar la suscripción de la empresa.');
      return;
    }
    navigate('/mis-pagos');
  }

  return (
    <div className="planes-page">
      <div className="planes-header">
        <div className="login-brand" style={{ justifyContent: 'center' }}>
          <Receipt size={20} />
          <span className="brand-mark">QORIA</span>
          <span className="brand-suffix">Facturación</span>
        </div>
        <h1>Planes</h1>
        <p>Elige el plan que se ajuste al tamaño de tu negocio. Puedes cambiar de plan cuando quieras.</p>
      </div>

      <div className="planes-grid">
        {PLANES.map((plan) => (
          <div key={plan.id} className={'plan-card' + (plan.destacado ? ' destacado' : '')}>
            {plan.destacado && <span className="plan-badge"><Sparkles size={12} /> Más completo</span>}
            <h2 className="plan-nombre">{plan.nombre}</h2>
            <p className="plan-resumen">{plan.resumen}</p>
            <p className="plan-precio">S/ {plan.precio.toFixed(2)} <small>/mes</small></p>
            <ul className="plan-features">
              {plan.features.map((f) => (
                <li key={f}><Check size={15} /> {f}</li>
              ))}
            </ul>
            <button type="button" className="btn-primary plan-subscribe-btn" onClick={handleSuscribirme}>
              SUSCRIBIRME
            </button>
          </div>
        ))}
      </div>

      <p className="login-hint">
        <Link to={user ? '/menu' : '/login'} className="btn-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ArrowLeft size={14} /> {user ? 'Volver al menú' : 'Volver al inicio de sesión'}
        </Link>
      </p>
    </div>
  );
}
