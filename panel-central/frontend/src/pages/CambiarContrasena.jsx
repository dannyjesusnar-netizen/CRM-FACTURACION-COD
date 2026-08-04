import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Check } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

const REQUISITOS = [
  { key: 'len', label: 'Al menos 8 caracteres', test: (v) => v.length >= 8 },
  { key: 'mayus_minus', label: 'Una letra mayúscula y una minúscula', test: (v) => /[A-Z]/.test(v) && /[a-z]/.test(v) },
  { key: 'num_especial', label: 'Un número y un carácter especial (*, @, #, $, etc.)', test: (v) => /[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v) },
];

function PasswordField({ label, value, onChange, show, onToggleShow }) {
  return (
    <>
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          required
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          style={{ paddingRight: 38 }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="icon-link"
          title={show ? 'Ocultar' : 'Mostrar'}
          style={{ position: 'absolute', right: 10, top: 8, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </>
  );
}

export default function CambiarContrasena() {
  const navigate = useNavigate();
  const toast = useToast();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [showActual, setShowActual] = useState(false);
  const [showNueva, setShowNueva] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const requisitosOk = REQUISITOS.every((r) => r.test(nueva));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (nueva !== confirmar) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!requisitosOk) {
      setError('La nueva contraseña no cumple los requisitos mínimos.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/auth/password', { current_password: actual, new_password: nueva });
      toast.success('Contraseña actualizada correctamente.');
      navigate('/empresas');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo cambiar la contraseña.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver" onClick={() => navigate('/empresas')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CAMBIAR CONTRASEÑA
      </h1>

      <div className="panel" style={{ maxWidth: 460 }}>
        <form onSubmit={handleSubmit}>
          <PasswordField label="Contraseña actual" value={actual} onChange={(e) => setActual(e.target.value)} show={showActual} onToggleShow={() => setShowActual((v) => !v)} />
          <PasswordField label="Nueva contraseña" value={nueva} onChange={(e) => setNueva(e.target.value)} show={showNueva} onToggleShow={() => setShowNueva((v) => !v)} />
          <PasswordField label="Confirmar contraseña" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} show={showConfirmar} onToggleShow={() => setShowConfirmar((v) => !v)} />

          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Recomendación para una contraseña segura</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {REQUISITOS.map((r) => {
                const ok = r.test(nueva);
                return (
                  <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: ok ? 'var(--good)' : 'var(--ink-muted)' }}>
                    <Check size={14} style={{ opacity: ok ? 1 : 0.3, flexShrink: 0 }} />
                    {r.label}
                  </li>
                );
              })}
            </ul>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => navigate('/empresas')}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
