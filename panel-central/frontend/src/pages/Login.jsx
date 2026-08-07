import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import FloatingShapes from '../components/FloatingShapes';

function LoginIllustration() {
  return (
    <svg viewBox="0 0 400 340" width="88%" style={{ maxWidth: 380 }}>
      <ellipse cx="200" cy="300" rx="150" ry="16" fill="#d9dcf7" />
      <g transform="translate(46 60)">
        <path d="M0 90 C -6 55 10 28 30 10" stroke="#86efac" strokeWidth="6" fill="none" strokeLinecap="round" />
        <ellipse cx="6" cy="46" rx="16" ry="9" fill="#86efac" transform="rotate(-30 6 46)" />
        <ellipse cx="24" cy="20" rx="14" ry="8" fill="#4ade80" transform="rotate(-10 24 20)" />
      </g>
      <rect x="70" y="46" width="210" height="146" rx="14" fill="#ffffff" stroke="#c7c9f4" strokeWidth="2" />
      <rect x="86" y="62" width="120" height="10" rx="5" fill="#c7c9f4" />
      <rect x="86" y="82" width="178" height="14" rx="7" fill="#e0e2fb" />
      <rect x="86" y="104" width="70" height="60" rx="6" fill="#eef0fd" />
      <rect x="164" y="104" width="24" height="60" rx="4" fill="#a5b4fc" />
      <rect x="194" y="126" width="24" height="38" rx="4" fill="#6366f1" />
      <rect x="224" y="114" width="24" height="50" rx="4" fill="#fbbf24" />
      <rect x="180" y="184" width="20" height="18" fill="#c7c9f4" />
      <rect x="150" y="200" width="80" height="10" rx="5" fill="#c7c9f4" />
      <rect x="248" y="150" width="86" height="146" rx="18" fill="#ffffff" stroke="#c7c9f4" strokeWidth="2" />
      <rect x="262" y="166" width="58" height="94" rx="6" fill="#eef0fd" />
      <circle cx="291" cy="213" r="22" fill="#6366f1" />
      <path d="M281 213 l7 7 15 -15" stroke="#ffffff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="291" cy="280" r="5" fill="#c7c9f4" />
      {/* personita trabajando, de pie frente al monitor */}
      <g transform="translate(160 178) scale(0.78)">
        <ellipse cx="45" cy="150" rx="32" ry="7" fill="#c7c9f4" opacity="0.5" />
        <rect x="30" y="95" width="10" height="50" rx="5" fill="#475569" />
        <rect x="48" y="95" width="10" height="50" rx="5" fill="#334155" />
        <rect x="26" y="142" width="18" height="8" rx="4" fill="#1e293b" />
        <rect x="46" y="142" width="18" height="8" rx="4" fill="#1e293b" />
        <path d="M22 55 Q45 42 68 55 L64 100 Q45 108 26 100 Z" fill="#f59e0b" />
        <path d="M26 62 Q14 75 18 92" stroke="#f59e0b" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d="M64 62 Q80 68 82 84" stroke="#f59e0b" strokeWidth="9" fill="none" strokeLinecap="round" />
        <rect x="76" y="80" width="20" height="26" rx="4" fill="#ffffff" stroke="#c7c9f4" strokeWidth="1.5" />
        <rect x="80" y="86" width="12" height="3" rx="1.5" fill="#c7c9f4" />
        <rect x="80" y="92" width="12" height="3" rx="1.5" fill="#c7c9f4" />
        <rect x="40" y="36" width="10" height="12" fill="#f4b183" />
        <circle cx="45" cy="26" r="15" fill="#f4b183" />
        <path d="M29 22 Q31 6 45 6 Q61 6 61 22 Q52 13 45 15 Q36 13 29 22 Z" fill="#3f3f46" />
      </g>
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/empresas');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-split">
      <div className="auth-illustration">
        <div className="auth-blob-a" />
        <div className="auth-blob-b" />
        <FloatingShapes />
        <div className="auth-illustration-brand">
          <ShieldCheck size={18} />
          <span>Panel <span className="brand-suffix">Central</span></span>
        </div>
        <LoginIllustration />
      </div>

      <div className="auth-form-panel">
        <div className="auth-form-card">
          <h1 className="auth-form-title">Ingresar</h1>
          <p className="auth-form-subtitle">Administración de cuentas de tus empresas clientas.</p>
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label>Correo</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="auth-field auth-field-password">
              <label>Contraseña</label>
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1} aria-label="Mostrar contraseña">
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <div className="auth-forgot">
              <button type="button" onClick={() => toast.info('Contacta al dueño de la plataforma para restablecer tu contraseña.')}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
