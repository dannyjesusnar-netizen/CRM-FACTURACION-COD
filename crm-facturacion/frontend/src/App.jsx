import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import RequireAuth from './components/RequireAuth';
import RequirePermiso from './components/RequirePermiso';
import Layout from './components/Layout';
import Login from './pages/Login';
import Menu from './pages/Menu';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Products from './pages/Products';
import Movements from './pages/Movements';
import Lotes from './pages/Lotes';
import Caja from './pages/Caja';
import Traslados from './pages/Traslados';
import Produccion from './pages/Produccion';
import Invoices from './pages/Invoices';
import RegistroVenta from './pages/RegistroVenta';
import RegistroNotaCredito from './pages/RegistroNotaCredito';
import GuiaRemitente from './pages/GuiaRemitente';
import Compras from './pages/Compras';
import Reports from './pages/Reports';
import Configuracion from './pages/Configuracion';
import CambiarContrasena from './pages/CambiarContrasena';
import SeleccionarSede from './pages/SeleccionarSede';
import RolForm from './pages/RolForm';

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/seleccionar-sede"
            element={
              <RequireAuth>
                <SeleccionarSede />
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/menu" element={<Menu />} />
            <Route path="/dashboard" element={<RequirePermiso modulo="dashboard"><Dashboard /></RequirePermiso>} />
            <Route path="/clientes" element={<RequirePermiso modulo="clientes"><Clients /></RequirePermiso>} />
            <Route path="/productos" element={<RequirePermiso modulo="inventario"><Products /></RequirePermiso>} />
            <Route path="/movimientos" element={<RequirePermiso modulo="inventario"><Movements /></RequirePermiso>} />
            <Route path="/lotes" element={<RequirePermiso modulo="inventario"><Lotes /></RequirePermiso>} />
            <Route path="/caja" element={<RequirePermiso modulo="caja"><Caja /></RequirePermiso>} />
            <Route path="/traslados" element={<RequirePermiso modulo="inventario"><Traslados /></RequirePermiso>} />
            <Route path="/produccion" element={<RequirePermiso modulo="inventario"><Produccion /></RequirePermiso>} />
            <Route path="/ventas" element={<RequirePermiso modulo="ventas"><Invoices /></RequirePermiso>} />
            <Route path="/ventas/nuevo/:tipo" element={<RequirePermiso modulo="ventas"><RegistroVenta /></RequirePermiso>} />
            <Route path="/ventas/nota-credito/nueva" element={<RequirePermiso modulo="ventas"><RegistroNotaCredito /></RequirePermiso>} />
            <Route path="/ventas/guia-remitente/nueva" element={<RequirePermiso modulo="ventas"><GuiaRemitente /></RequirePermiso>} />
            <Route path="/compras" element={<RequirePermiso modulo="compras"><Compras /></RequirePermiso>} />
            <Route path="/reportes" element={<RequirePermiso modulo="reportes"><Reports /></RequirePermiso>} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="/configuracion/roles/nuevo" element={<RolForm />} />
            <Route path="/configuracion/roles/:id" element={<RolForm />} />
            <Route path="/cambiar-contrasena" element={<CambiarContrasena />} />
          </Route>
          <Route path="*" element={<Navigate to="/menu" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
