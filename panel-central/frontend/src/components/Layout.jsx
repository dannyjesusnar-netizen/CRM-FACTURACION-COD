import { Outlet, useNavigate } from 'react-router-dom';
import { LogOut, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand" onClick={() => navigate('/empresas')}>
          <span className="brand-mark">Panel</span>
          <span className="brand-suffix">Central</span>
        </div>
        <div className="topbar-company">{admin?.full_name || admin?.email}</div>
        <div className="topbar-actions">
          <button type="button" className="icon-btn" title="Cambiar contraseña" onClick={() => navigate('/cambiar-contrasena')}>
            <KeyRound size={17} />
          </button>
          <button type="button" className="icon-btn" title="Cerrar sesión" onClick={handleLogout}>
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <main className="content content-wide">
        <Outlet />
      </main>
    </div>
  );
}
