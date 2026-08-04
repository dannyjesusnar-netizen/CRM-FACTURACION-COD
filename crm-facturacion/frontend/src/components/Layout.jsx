import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import api from '../api';
import {
  TrendingUp, ShoppingCart, Bike, Wallet, Users, Calculator, ClipboardList, FileText,
  Moon, Sun, Settings, ChevronDown, Phone, FileSignature, Lock, Video, BarChart3, LogOut, UsersRound,
  Building2,
} from 'lucide-react';

const SUBNAV_ITEMS = [
  { to: '/ventas', label: 'Ventas', Icon: TrendingUp, active: true, modulo: 'ventas' },
  { to: '/compras', label: 'Compras', Icon: ShoppingCart, active: true, modulo: 'compras' },
  { to: '/productos', label: 'Inventario', Icon: Bike, active: true, modulo: 'inventario' },
  { to: '/caja', label: 'Caja y bancos', Icon: Wallet, active: true, modulo: 'caja' },
  { to: '/clientes', label: 'Personas', Icon: Users, active: true, modulo: 'clientes' },
  { to: null, label: 'Contabilidad', Icon: Calculator, active: false },
  { to: null, label: 'Planillas', Icon: ClipboardList, active: false },
  { to: '/reportes', label: 'Reportes', Icon: FileText, active: true, modulo: 'reportes' },
];

export default function Layout() {
  const { user, logout, sucursal } = useAuth();
  const toast = useToast();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [empresa, setEmpresa] = useState(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    api.get('/empresa').then((res) => setEmpresa(res.data)).catch(() => {});
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
        <div className="topbar-company">
          {empresa ? `${(empresa.nombre_comercial || empresa.razon_social).toUpperCase()}${sucursal ? ` — ${sucursal.nombre.toUpperCase()}` : ''}` : ''}
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            title={isDark ? 'Modo claro' : 'Modo oscuro'}
            onClick={toggleTheme}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button type="button" className="icon-btn" title="Configuración" onClick={() => navigate('/configuracion')}>
            <Settings size={17} />
          </button>
          <div className="user-menu" ref={menuRef} onClick={() => setMenuOpen((v) => !v)}>
            <span className="user-name">{(user?.role || 'GERENCIA').toUpperCase()}</span>
            <ChevronDown size={14} className={'caret-icon' + (menuOpen ? ' open' : '')} />
            <div className={'user-dropdown' + (menuOpen ? ' open' : '')}>
              {!user?.sucursal_id && (
                <div className="user-dropdown-item" onClick={() => navigate('/seleccionar-sede')}>
                  <Building2 size={15} className="dropdown-icon" /> Cambiar de sede
                </div>
              )}
              <div className="user-dropdown-item" onClick={() => toast.info('Próximamente podrás cambiar entre varias cuentas.')}>
                <UsersRound size={15} className="dropdown-icon" /> Mostrar todas las cuentas
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Soporte: escríbenos y te ayudamos (próximamente).')}>
                <Phone size={15} className="dropdown-icon" /> Soporte
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Términos y condiciones (próximamente).')}>
                <FileSignature size={15} className="dropdown-icon" /> Términos y condiciones
              </div>
              <div className="user-dropdown-item" onClick={() => navigate('/cambiar-contrasena')}>
                <Lock size={15} className="dropdown-icon" /> Cambiar contraseña
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Capacitación en línea disponible próximamente.')}>
                <Video size={15} className="dropdown-icon" /> Capacitación en línea
              </div>
              {user?.permisos?.dashboard !== false && (
                <div className="user-dropdown-item" onClick={() => navigate('/dashboard')}>
                  <BarChart3 size={15} className="dropdown-icon" /> Dashboard
                </div>
              )}
              <div className="user-dropdown-divider" />
              <div className="user-dropdown-item danger" onClick={handleLogout}>
                <LogOut size={15} className="dropdown-icon" /> CERRAR SESIÓN
              </div>
            </div>
          </div>
        </div>
      </header>

      <nav className="subnav">
        {SUBNAV_ITEMS.filter((item) => !item.modulo || user?.permisos?.[item.modulo] !== false).map((item) => {
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
