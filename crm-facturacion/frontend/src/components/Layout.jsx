import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import SedeSwitcher from './SedeSwitcher';
import FloatingShapes from './FloatingShapes';
import FloatingIcons from './FloatingIcons';
import OdinWidget from './OdinWidget';
import {
  TrendingUp, ShoppingCart, Bike, Wallet, Users, ClipboardList, FileText,
  Moon, Sun, Settings, ChevronDown, Phone, FileSignature, Lock, BarChart3, LogOut,
  CreditCard, Smartphone,
} from 'lucide-react';
import { canInstallPwa, isIosDevice, isRunningStandalone, promptPwaInstall, subscribePwaInstall } from '../utils/pwaInstall';

// Fondo decorativo compartido por toda la app (misma línea gráfica del
// login/menú): formas simples + iconos de negocio, flotando muy tenue
// detrás del contenido de cada pantalla.
const APP_SHAPES = [
  { type: 'dot', top: '5%', left: '3%', size: 11, color: '#fbbf24', delay: '0s' },
  { type: 'plus', top: '9%', left: '96%', size: 15, color: '#6366f1', delay: '0.4s' },
  { type: 'dot', top: '14%', left: '2%', size: 7, color: '#6366f1', delay: '0.5s' },
  { type: 'dot', top: '18%', left: '94%', size: 6, color: '#f472b6', delay: '0.65s' },
  { type: 'square', top: '22%', left: '1%', size: 12, color: '#f472b6', delay: '0.8s' },
  { type: 'square', top: '28%', left: '99%', size: 9, color: '#22c55e', delay: '1.05s' },
  { type: 'plus', top: '30%', left: '3%', size: 12, color: '#fbbf24', delay: '1.3s' },
  { type: 'dot', top: '35%', left: '98%', size: 9, color: '#22c55e', delay: '0.3s' },
  { type: 'dot', top: '44%', left: '1%', size: 6, color: '#22c55e', delay: '0.15s' },
  { type: 'dot', top: '48%', left: '96%', size: 7, color: '#fbbf24', delay: '0.85s' },
  { type: 'plus', top: '52%', left: '2%', size: 13, color: '#22c55e', delay: '1.1s' },
  { type: 'square', top: '60%', left: '4%', size: 10, color: '#6366f1', delay: '0.95s' },
  { type: 'square', top: '64%', left: '97%', size: 11, color: '#fbbf24', delay: '0.6s' },
  { type: 'plus', top: '72%', left: '98%', size: 12, color: '#f472b6', delay: '0.35s' },
  { type: 'dot', top: '70%', left: '2%', size: 7, color: '#fbbf24', delay: '0.45s' },
  { type: 'dot', top: '78%', left: '4%', size: 8, color: '#f472b6', delay: '0.9s' },
  { type: 'dot', top: '82%', left: '94%', size: 6, color: '#6366f1', delay: '1.15s' },
  { type: 'plus', top: '88%', left: '95%', size: 14, color: '#6366f1', delay: '0.2s' },
  { type: 'dot', top: '92%', left: '15%', size: 9, color: '#6366f1', delay: '0.7s' },
  { type: 'dot', top: '94%', left: '82%', size: 8, color: '#f472b6', delay: '0.55s' },
];
const APP_ICONS = [
  { type: 'computer', top: '14%', left: '6%', size: 30, delay: '0.1s' },
  { type: 'calculator', top: '18%', left: '92%', size: 26, delay: '0.5s' },
  { type: 'truck', top: '46%', left: '95%', size: 34, delay: '0.75s' },
  { type: 'phone', top: '58%', left: '94%', size: 24, delay: '0.6s' },
  { type: 'dollar', top: '70%', left: '3%', size: 26, delay: '0.35s' },
  { type: 'soles', top: '82%', left: '92%', size: 26, delay: '1s' },
  { type: 'dollar', top: '95%', left: '7%', size: 20, delay: '1.15s' },
];

const SUBNAV_ITEMS = [
  { to: '/ventas', label: 'Ventas', Icon: TrendingUp, active: true, modulo: 'ventas' },
  { to: '/compras', label: 'Compras', Icon: ShoppingCart, active: true, modulo: 'compras' },
  { to: '/productos', label: 'Inventario', Icon: Bike, active: true, modulo: 'inventario' },
  { to: '/caja', label: 'Caja y bancos', Icon: Wallet, active: true, modulo: 'caja' },
  { to: '/clientes', label: 'Personas', Icon: Users, active: true, modulo: 'clientes' },
  { to: '/planilla', label: 'Planillas', Icon: ClipboardList, active: true, modulo: 'caja' },
  { to: '/reportes', label: 'Reportes', Icon: FileText, active: true, modulo: 'reportes' },
  { to: '/configuracion', label: 'Configuración', Icon: Settings, active: true },
];

export default function Layout() {
  const { user, logout, sucursal, empresa } = useAuth();
  const toast = useToast();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [pwaReady, setPwaReady] = useState(canInstallPwa());
  const [showInstalarModal, setShowInstalarModal] = useState(false);

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => subscribePwaInstall(() => setPwaReady(canInstallPwa())), []);

  async function handleInstalarApp() {
    setMenuOpen(false);
    if (pwaReady) {
      const choice = await promptPwaInstall();
      if (choice?.outcome === 'accepted') toast.success('¡Listo! QORIA quedó en tu pantalla de inicio.');
      return;
    }
    setShowInstalarModal(true);
  }

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
          <span className="brand-mark">QORIA</span>
          <span className="brand-suffix">Facturación</span>
        </div>
        <div className="topbar-company">
          {empresa ? `${(empresa.nombre_comercial || empresa.razon_social).toUpperCase()}${sucursal ? ` — ${sucursal.nombre.toUpperCase()}` : ''}` : ''}
        </div>
        <div className="topbar-actions">
          <SedeSwitcher />
          <button
            type="button"
            className="icon-btn"
            title={isDark ? 'Modo claro' : 'Modo oscuro'}
            onClick={toggleTheme}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <div className="user-menu" ref={menuRef} onClick={() => setMenuOpen((v) => !v)}>
            <span className="user-name">{(user?.role || 'GERENCIA').toUpperCase()}</span>
            <ChevronDown size={14} className={'caret-icon' + (menuOpen ? ' open' : '')} />
            <div className={'user-dropdown' + (menuOpen ? ' open' : '')}>
              <div className="user-dropdown-item" onClick={() => toast.info('Soporte: escríbenos y te ayudamos (próximamente).')}>
                <Phone size={15} className="dropdown-icon" /> Soporte
              </div>
              <div className="user-dropdown-item" onClick={() => toast.info('Términos y condiciones (próximamente).')}>
                <FileSignature size={15} className="dropdown-icon" /> Términos y condiciones
              </div>
              <div className="user-dropdown-item" onClick={() => navigate('/cambiar-contrasena')}>
                <Lock size={15} className="dropdown-icon" /> Cambiar contraseña
              </div>
              {user?.role !== 'gerencia' && !isRunningStandalone() && (
                <div className="user-dropdown-item" onClick={handleInstalarApp}>
                  <Smartphone size={15} className="dropdown-icon" /> Instalar app en tu celular
                </div>
              )}
              {user?.role === 'gerencia' && (
                <div className="user-dropdown-item" onClick={() => navigate('/mis-pagos')}>
                  <CreditCard size={15} className="dropdown-icon" /> Mis pagos
                </div>
              )}
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

      <div className="app-body">
        <nav className="sidenav">
          {SUBNAV_ITEMS.filter((item) => !item.modulo || user?.permisos?.[item.modulo] !== false).map((item) => {
            const isActive = item.to && location.pathname === item.to;
            return (
              <div
                key={item.label}
                className={'sidenav-item' + (isActive ? ' active' : '') + (!item.active ? ' disabled' : '')}
                title={item.active ? item.label : `${item.label} (próximamente)`}
                onClick={() => handleSubnavClick(item)}
              >
                <item.Icon size={17} className="sidenav-icon" />
                <span>{item.label}</span>
                {!item.active && <span className="sidenav-soon-dot" />}
              </div>
            );
          })}
        </nav>

        <main className="content">
          <div className="app-bg-decor">
            <FloatingShapes shapes={APP_SHAPES} />
            <FloatingIcons icons={APP_ICONS} />
          </div>
          <div className="content-wide content-body">
            <Outlet />
          </div>
        </main>
      </div>

      <OdinWidget />

      {showInstalarModal && (
        <div className="modal-overlay" onClick={() => setShowInstalarModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Instalar QORIA en tu celular</h2>
            {isIosDevice() ? (
              <ol style={{ paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
                <li>Abre esta página en Safari (no en Chrome).</li>
                <li>Toca el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba).</li>
                <li>Elige <strong>"Agregar a pantalla de inicio"</strong> y confirma.</li>
              </ol>
            ) : (
              <ol style={{ paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
                <li>Toca el menú de tu navegador (los tres puntos ⋮).</li>
                <li>Elige <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong>.</li>
                <li>Confirma para que quede el ícono de QORIA en tu celular.</li>
              </ol>
            )}
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
              Así podrás abrir QORIA como una app, sin escribir la dirección cada vez.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => setShowInstalarModal(false)}>Entendido</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
