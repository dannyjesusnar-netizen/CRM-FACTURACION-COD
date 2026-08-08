import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

const initialForm = {
  ruc: '', razon_social: '', nombre_comercial: '', direccion_fiscal: '', telefono: '', email: '',
  nombres: '', apellidos: '', dni: '', password: '', password_confirm: '', acepta_terminos: false,
};

export default function RegistroEmpresa() {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  function set(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.password_confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!form.acepta_terminos) {
      setError('Debes aceptar los Términos de Servicio y la Política de Privacidad para continuar.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/register', {
        ruc: form.ruc, razon_social: form.razon_social, nombre_comercial: form.nombre_comercial,
        direccion_fiscal: form.direccion_fiscal, telefono: form.telefono, email: form.email,
        nombres: form.nombres, apellidos: form.apellidos, dni: form.dni, password: form.password,
        acepta_terminos: form.acepta_terminos,
      });
      setEnviado(true);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar la empresa.');
    } finally {
      setLoading(false);
    }
  }

  if (enviado) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-brand">
            <span className="brand-mark">QORIA</span>
            <span className="brand-suffix">Facturación</span>
          </div>
          <p className="login-subtitle">Registro recibido</p>
          <p>
            Tu empresa <strong>{form.razon_social}</strong> quedó registrada con RUC {form.ruc}.
            Te avisaremos apenas quede aprobada — recién ahí podrás iniciar sesión con el DNI
            y la contraseña que registraste.
          </p>
          <Link to="/login" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Volver a Ingresar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ width: 480 }}>
        <div className="login-brand">
          <span className="brand-mark">QORIA</span>
          <span className="brand-suffix">Facturación</span>
        </div>
        <p className="login-subtitle">Registrar mi empresa</p>
        <form onSubmit={handleSubmit}>
          <label>Razón social</label>
          <input value={form.razon_social} onChange={set('razon_social')} required autoFocus />
          <div className="form-row">
            <div>
              <label>RUC</label>
              <input value={form.ruc} onChange={set('ruc')} maxLength={11} required />
            </div>
            <div>
              <label>Nombre comercial</label>
              <input value={form.nombre_comercial} onChange={set('nombre_comercial')} placeholder="Si es distinto a la razón social" />
            </div>
          </div>
          <label>Dirección fiscal</label>
          <input value={form.direccion_fiscal} onChange={set('direccion_fiscal')} />
          <div className="form-row">
            <div>
              <label>Teléfono</label>
              <input value={form.telefono} onChange={set('telefono')} />
            </div>
            <div>
              <label>Email de la empresa</label>
              <input type="email" value={form.email} onChange={set('email')} />
            </div>
          </div>

          <p className="login-subtitle" style={{ marginTop: 22, marginBottom: 6 }}>Tu cuenta Gerencia</p>
          <div className="form-row">
            <div>
              <label>Nombres</label>
              <input value={form.nombres} onChange={set('nombres')} required />
            </div>
            <div>
              <label>Apellidos</label>
              <input value={form.apellidos} onChange={set('apellidos')} required />
            </div>
          </div>
          <label>DNI</label>
          <input value={form.dni} onChange={set('dni')} maxLength={8} required />
          <div className="form-row">
            <div>
              <label>Contraseña</label>
              <input type="password" value={form.password} onChange={set('password')} required />
            </div>
            <div>
              <label>Repetir contraseña</label>
              <input type="password" value={form.password_confirm} onChange={set('password_confirm')} required />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 18, fontWeight: 400 }}>
            <input
              type="checkbox"
              style={{ width: 'auto', marginTop: 3 }}
              checked={form.acepta_terminos}
              onChange={(e) => setForm({ ...form, acepta_terminos: e.target.checked })}
            />
            <span>
              Acepto los <Link to="/terminos" target="_blank" className="btn-link">Términos de Servicio</Link> y la{' '}
              <Link to="/privacidad" target="_blank" className="btn-link">Política de Privacidad</Link>.
            </span>
          </label>

          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Registrando...' : 'Registrar mi empresa'}
          </button>
        </form>
        <p className="login-hint">
          ¿Ya tienes cuenta? <Link to="/login" className="btn-link">Ingresa aquí</Link>
        </p>
      </div>
    </div>
  );
}
