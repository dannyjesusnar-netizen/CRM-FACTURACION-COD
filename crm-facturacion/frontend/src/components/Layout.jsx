import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import {
  TrendingUp, ShoppingCart, Bike, Wallet, Users, Calculator, ClipboardList, FileText,
  Moon, Sun, Settings, ChevronDown, Phone, FileSignature, Lock, Video, BarChart3, LogOut, UsersRound,
} from 'lucide-react';

const SUBNAV_ITEMS = [
  { to: '/ventas', label: 'Ventas', Icon: TrendingUp, active: true },
  { to: '/compras', label: 'Compras', Icon: ShoppingCart, active: true },
  { to: '/productos', label: 'Inventario', Icon: Bike, active: true },
  { to: '/caja', label: 'Caja y bancos', Icon: Wallet, active: true },
  { to: '/clientes', label: 'Personas', Icon: Users, active: true },
  { to: null, label: 'Contabilidad', Icon: Calculator, active: false },
  { to: null, label: 'Planillas', Icon: ClipboardList, active: false },
  { to: '/reportes', label: 'Reportes', Icon: FileText, active: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function handleSubnavClick(item) {
    if (item.active && item.to) {
      navigate(item.to);
    } else {
      toast.info(`${item.label} estará disponible próximamente.`);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand" onClick={() => navigate('/menu')}>
          <span className="brand-mark">CRM</span>
          <span className="brand-suffix">Facturación</span>
        </div>
        <div className="topbar-company">MI EMPRESA S.A.C. &mdash; SEDE PRINCIPAL</div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            title={isDark ? 'Modo claro' : 'Modo oscuro'}
            onClick={toggleTheme}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button type="button" className="icon-btn" title="Configuración" onClick={() => navigate('/menu')}>
            <Settings size={17} />
          </button>
          <div className="user-menu" ref={menuRef} onClick={() => setMenuOpen((v) => !v)}>
            <span className="user-name">{(user?.role || 'GERENCIA').toUpperCase()}</span>
            <ChevronDown size={14} className={'caret-icon' + (menuOpen ? ' open' : '')} />
            <div className={'user-dropdown' + (menuOpen ? ' open' : '')}>
              <div className="user-dropdown-item" onClick={() => toast.info('Próximamente podrás cambiar entre varias cuentas.')}>
                <UsersRound size={15} className="dropdown-icon" /> Mostrar todas las cuentas
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Soporte: escríbenos y te ayudamos (próximamente).')}>
                <Phone size={15} className="dropdown-icon" /> Soporte
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Términos y condiciones (próximamente).')}>
                <FileSignature size={15} className="dropdown-icon" /> Términos y condiciones
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Cambio de contraseña disponible próximamente.')}>
                <Lock size={15} className="dropdown-icon" /> Cambiar contraseña
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Capacitación en línea disponible próximamente.')}>
                <Video size={15} className="dropdown-icon" /> Capacitación en línea
              </div>
              <div className="user-dropdown-item" onClick={() => navigate('/dashboard')}>
                <BarChart3 size={15} className="dropdown-icon" /> Dashboard
              </div>
              <div className="user-dropdown-divider" />
              <div className="user-dropdown-item danger" onClick={handleLogout}>
                <LogOut size={15} className="dropdown-icon" /> CERRAR SESIÓN
              </div>
            </div>
          </div>
        </div>
      </header>

      <nav className="subnav">
        {SUBNAV_ITEMS.map((item) => {
          const isActive = item.to && location.pathname === item.to;
          return (
            <div
              key={item.label}
              className={'subnav-item' + (isActive ? ' active' : '') + (!item.active ? ' disabled' : '')}
              title={item.active ? item.label : `${item.label} (próximamente)`}
              onClick={() => handleSubnavClick(item)}
            >
              <item.Icon size={16} className="subnav-icon" />
              <span>{item.label}</span>
              {!item.active && <span className="subnav-soon-dot" />}
            </div>
          );
        })}
      </nav>

      <main className="content content-wide">
        <Outlet />
      </main>
    </div>
  );
}
