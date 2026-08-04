import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [ruc, setRuc] = useState('');
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">CRM</span>
          <span className="brand-suffix">Facturación</span>
        </div>
        <p className="login-subtitle">Ingresa a tu cuenta</p>
        <form onSubmit={handleSubmit}>
          <label>RUC</label>
          <input value={ruc} onChange={(e) => setRuc(e.target.value)} maxLength={11} autoFocus />
          <label>DNI</label>
          <input value={dni} onChange={(e) => setDni(e.target.value)} maxLength={8} />
          <label>Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
