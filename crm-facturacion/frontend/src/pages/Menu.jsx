import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import FloatingShapes from '../components/FloatingShapes';
import FloatingIcons from '../components/FloatingIcons';
import {
  Receipt, Users, Package, LayoutDashboard, LineChart,
  ShoppingCart, Wallet, Repeat, BookOpen, Briefcase, Clock, Settings, QrCode,
} from 'lucide-react';

const MENU_SHAPES = [
  { type: 'dot', top: '6%', left: '4%', size: 12, color: '#a855f7', delay: '0s' },
  { type: 'plus', top: '10%', left: '94%', size: 16, color: '#38bdf8', delay: '0.4s' },
  { type: 'square', top: '30%', left: '2%', size: 14, color: '#facc15', delay: '0.8s' },
  { type: 'dot', top: '48%', left: '97%', size: 10, color: '#f43f5e', delay: '1.1s' },
  { type: 'plus', top: '78%', left: '1%', size: 14, color: '#10b981', delay: '0.2s' },
  { type: 'square', top: '88%', left: '95%', size: 12, color: '#a855f7', delay: '0.6s' },
];

const MENU_ICONS = [
  { type: 'computer', top: '15%', left: '8%', size: 34, delay: '0.15s' },
  { type: 'calculator', top: '15%', left: '89%', size: 30, delay: '0.55s' },
  { type: 'truck', top: '58%', left: '1%', size: 38, delay: '0.75s' },
  { type: 'dollar', top: '68%', left: '96%', size: 30, delay: '0.35s' },
  { type: 'soles', top: '92%', left: '10%', size: 30, delay: '1s' },
  { type: 'phone', top: '92%', left: '88%', size: 26, delay: '0.05s' },
];

const ACTIVE_MODULES = [
  { to: '/qr-unico', label: 'QR Único', Icon: QrCode, desc: 'Genera un QR único con tu Yape y Plin, e imprime tu cartel' },
  { to: '/ventas', label: 'Ventas', Icon: Receipt, desc: 'Emitir facturas, boletas y notas', modulo: 'ventas' },
  { to: '/compras', label: 'Compras', Icon: ShoppingCart, desc: 'Registrar compras a proveedores', modulo: 'compras' },
  { to: '/clientes', label: 'Clientes', Icon: Users, desc: 'Gestión de clientes', modulo: 'clientes' },
  { to: '/productos', label: 'Inventario', Icon: Package, desc: 'Productos, stock y movimientos', modulo: 'inventario' },
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard, desc: 'Indicadores generales', modulo: 'dashboard' },
  { to: '/reportes', label: 'Reportes', Icon: LineChart, desc: 'Reportes de ventas', modulo: 'reportes' },
];

const COMING_SOON = [
  { label: 'Finanzas', Icon: Wallet },
  { label: 'Conciliación', Icon: Repeat },
  { label: 'Contabilidad', Icon: BookOpen },
  { label: 'Planillas', Icon: Briefcase },
  { label: 'Asistencias', Icon: Clock },
  { label: 'Configuración', Icon: Settings },
];

export default function Menu() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const modulosVisibles = ACTIVE_MODULES.filter((m) => user?.permisos?.[m.modulo] !== false);

  return (
    <div className="menu-page">
      <FloatingShapes shapes={MENU_SHAPES} />
      <FloatingIcons icons={MENU_ICONS} />
      <h1 className="menu-title">MENÚ PRINCIPAL</h1>

      <div className="menu-grid">
        {modulosVisibles.map((m) => (
          <div
            key={m.to}
            className="menu-tile"
            onClick={() => navigate(m.to)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(m.to)}
            role="button"
            tabIndex={0}
          >
            <div className="menu-tile-icon"><m.Icon size={30} strokeWidth={1.7} /></div>
            <div className="menu-tile-label">{m.label}</div>
            <div className="menu-tile-desc">{m.desc}</div>
          </div>
        ))}
        {COMING_SOON.map((m) => (
          <div
            key={m.label}
            className="menu-tile disabled"
            title="Próximamente"
            role="button"
            tabIndex={0}
            onClick={() => toast.info(`${m.label} estará disponible próximamente.`)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toast.info(`${m.label} estará disponible próximamente.`)}
          >
            <div className="menu-tile-icon"><m.Icon size={30} strokeWidth={1.7} /></div>
            <div className="menu-tile-label">{m.label}</div>
            <span className="badge-soon">PRÓXIMAMENTE</span>
          </div>
        ))}
      </div>
    </div>
  );
}
