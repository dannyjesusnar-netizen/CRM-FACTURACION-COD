import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Receipt, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import FloatingShapes from '../components/FloatingShapes';

function LoginIllustration() {
  return (
    <svg viewBox="0 0 400 340" width="98%" style={{ maxWidth: 480 }}>
      <ellipse cx="200" cy="300" rx="150" ry="16" fill="#d9dcf7" />

      {/* orbita punteada */}
      <ellipse cx="195" cy="150" rx="130" ry="105" fill="none" stroke="#c7c9f4" strokeWidth="1.5" strokeDasharray="4 7" opacity="0.6" />

      {/* computadora central */}
      <g transform="translate(195 150)">
        <rect x="-55" y="-42" width="110" height="76" rx="10" fill="#ffffff" stroke="#c7c9f4" strokeWidth="2" />
        <rect x="-43" y="-30" width="86" height="52" rx="5" fill="#eef0fd" />
        <rect x="-43" y="-30" width="34" height="52" rx="4" fill="#a5b4fc" />
        <rect x="-5" y="-8" width="12" height="30" rx="3" fill="#6366f1" />
        <rect x="11" y="-18" width="12" height="40" rx="3" fill="#fbbf24" />
        <rect x="-15" y="46" width="30" height="9" fill="#c7c9f4" />
        <rect x="-38" y="55" width="76" height="9" rx="4" fill="#c7c9f4" />
      </g>

      {/* laptop, calculadora, signos, celular (terminal) y camión con
          persona, orbitando en movimiento continuo alrededor de la
          computadora central — cada uno gira en sentido contrario al grupo
          para quedar siempre derecho (nunca de cabeza) mientras da la vuelta. */}
      <g>
        <animateTransform attributeName="transform" type="rotate" from="0 195 150" to="360 195 150" dur="22s" repeatCount="indefinite" />

        <g transform="translate(195 45)">
          <g>
            <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="22s" repeatCount="indefinite" />
            <rect x="-16" y="-14" width="32" height="22" rx="2" fill="#ffffff" stroke="#c7c9f4" strokeWidth="1.5" />
            <rect x="-12" y="-10" width="24" height="14" rx="1.5" fill="#a5b4fc" />
            <path d="M-20 8 L20 8 L24 14 L-24 14 Z" fill="#6366f1" />
          </g>
        </g>

        <g transform="translate(297 85)">
          <g>
            <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="22s" repeatCount="indefinite" />
            <circle r="19" fill="#22c55e" />
            <text x="0" y="7" textAnchor="middle" fontSize="20" fontWeight="800" fill="#ffffff" fontFamily="Arial, sans-serif">$</text>
          </g>
        </g>

        <g transform="translate(68 173)">
          <g>
            <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="22s" repeatCount="indefinite" />
            <rect x="-16" y="-20" width="32" height="40" rx="4" fill="#334155" />
            <rect x="-12" y="-16" width="24" height="10" rx="2" fill="#86efac" />
            <rect x="-12" y="-2" width="6" height="6" rx="1" fill="#64748b" />
            <rect x="-3" y="-2" width="6" height="6" rx="1" fill="#64748b" />
            <rect x="6" y="-2" width="6" height="6" rx="1" fill="#64748b" />
            <rect x="-12" y="7" width="6" height="6" rx="1" fill="#64748b" />
            <rect x="-3" y="7" width="6" height="6" rx="1" fill="#64748b" />
            <rect x="6" y="7" width="6" height="6" rx="1" fill="#64748b" />
            <rect x="-12" y="16" width="24" height="6" rx="1" fill="#fbbf24" />
          </g>
        </g>

        <g transform="translate(93 85)">
          <g>
            <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="22s" repeatCount="indefinite" />
            <circle r="19" fill="#6366f1" />
            <text x="0" y="6" textAnchor="middle" fontSize="15" fontWeight="800" fill="#ffffff" fontFamily="Arial, sans-serif">S/</text>
          </g>
        </g>

        {/* terminal / celular */}
        <g transform="translate(322 173)">
          <g>
            <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="22s" repeatCount="indefinite" />
            <rect x="-16" y="-27" width="12" height="8" rx="1.5" fill="#fbbf24" />
            <rect x="-16" y="-20" width="32" height="40" rx="5" fill="#ffffff" stroke="#c7c9f4" strokeWidth="1.5" />
            <rect x="-11" y="-15" width="22" height="12" rx="2" fill="#6366f1" />
            <rect x="-11" y="0" width="6" height="6" rx="1" fill="#c7c9f4" />
            <rect x="-2" y="0" width="6" height="6" rx="1" fill="#c7c9f4" />
            <rect x="7" y="0" width="6" height="6" rx="1" fill="#c7c9f4" />
            <rect x="-11" y="9" width="6" height="6" rx="1" fill="#c7c9f4" />
            <rect x="-2" y="9" width="6" height="6" rx="1" fill="#c7c9f4" />
            <rect x="7" y="9" width="6" height="6" rx="1" fill="#c7c9f4" />
          </g>
        </g>

        {/* camion */}
        <g transform="translate(251 245)">
          <g>
            <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="22s" repeatCount="indefinite" />
            <rect x="-24" y="-10" width="30" height="18" rx="2" fill="#6366f1" />
            <path d="M6 -10 h14 l8 10 v8 h-22 z" fill="#a5b4fc" />
            <rect x="10" y="-6" width="8" height="6" rx="1" fill="#eef0fd" />
            <circle cx="-14" cy="10" r="5" fill="#334155" />
            <circle cx="14" cy="10" r="5" fill="#334155" />
            <circle cx="-14" cy="10" r="2" fill="#c7c9f4" />
            <circle cx="14" cy="10" r="2" fill="#c7c9f4" />
          </g>
        </g>

        {/* personita trabajando */}
        <g transform="translate(139 245) scale(0.42)">
          <g>
            <animateTransform attributeName="transform" type="rotate" from="360 0 0" to="0 0 0" dur="22s" repeatCount="indefinite" />
            <ellipse cx="0" cy="78" rx="30" ry="7" fill="#c7c9f4" opacity="0.5" />
            <rect x="-15" y="24" width="10" height="46" rx="5" fill="#475569" />
            <rect x="5" y="24" width="10" height="46" rx="5" fill="#334155" />
            <path d="M-23 -20 Q0 -32 23 -20 L19 26 Q0 34 -19 26 Z" fill="#f59e0b" />
            <circle cx="0" cy="-38" r="16" fill="#f4b183" />
            <path d="M-16 -42 Q-14 -58 0 -58 Q16 -58 16 -42 Q7 -51 0 -49 Q-9 -51 -16 -42 Z" fill="#3f3f46" />
          </g>
        </g>
      </g>

    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [ruc, setRuc] = useState('');
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(ruc, dni, password);
      navigate('/menu');
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
          <Receipt size={18} />
          <span>QORIA <span className="brand-suffix">Facturación</span></span>
        </div>
        <Link to="/planes" className="auth-planes-btn">
          <Sparkles size={14} /> PLANES
        </Link>
        <LoginIllustration />
      </div>

      <div className="auth-form-panel">
        <div className="auth-form-card">
          <h1 className="auth-form-title">Ingresar</h1>
          <p className="auth-form-subtitle">Bienvenido de nuevo — ingresa tus datos para continuar.</p>
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label>RUC</label>
              <input value={ruc} onChange={(e) => setRuc(e.target.value)} maxLength={11} autoFocus />
            </div>
            <div className="auth-field">
              <label>DNI</label>
              <input value={dni} onChange={(e) => setDni(e.target.value)} maxLength={8} />
            </div>
            <div className="auth-field auth-field-password">
              <label>Contraseña</label>
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1} aria-label="Mostrar contraseña">
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <div className="auth-forgot">
              <button type="button" onClick={() => toast.info('Escríbenos a soporte para restablecer tu contraseña.')}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            {error && <div className="form-error">{error}</div>}
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
          <p className="auth-form-footer">
            ¿Tu empresa todavía no tiene cuenta? <Link to="/registro">Regístrala aquí</Link>
          </p>
          <p className="auth-form-footer" style={{ marginTop: 6 }}>
            <Link to="/privacidad">Privacidad</Link> · <Link to="/terminos">Términos</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
