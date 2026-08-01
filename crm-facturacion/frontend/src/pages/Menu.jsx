import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import {
  Receipt, Users, Package, LayoutDashboard, LineChart,
  ShoppingCart, Wallet, Repeat, BookOpen, Briefcase, Clock, Settings,
} from 'lucide-react';

const ACTIVE_MODULES = [
  { to: '/ventas', label: 'Ventas', Icon: Receipt, desc: 'Emitir facturas, boletas y notas' },
  { to: '/compras', label: 'Compras', Icon: ShoppingCart, desc: 'Registrar compras a proveedores' },
  { to: '/clientes', label: 'Clientes', Icon: Users, desc: 'Gestión de clientes' },
  { to: '/productos', label: 'Inventario', Icon: Package, desc: 'Productos, stock y movimientos' },
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard, desc: 'Indicadores generales' },
  { to: '/reportes', label: 'Reportes', Icon: LineChart, desc: 'Reportes de ventas' },
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

  return (
    <div className="menu-page">
      <h1 className="menu-title">MENÚ PRINCIPAL</h1>

      <div className="menu-grid">
        {ACTIVE_MODULES.map((m) => (
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
