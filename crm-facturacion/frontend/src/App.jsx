import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import RequireAuth from './components/RequireAuth';
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

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/menu" element={<Menu />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/productos" element={<Products />} />
            <Route path="/movimientos" element={<Movements />} />
            <Route path="/lotes" element={<Lotes />} />
            <Route path="/caja" element={<Caja />} />
            <Route path="/traslados" element={<Traslados />} />
            <Route path="/produccion" element={<Produccion />} />
            <Route path="/ventas" element={<Invoices />} />
            <Route path="/ventas/nuevo/:tipo" element={<RegistroVenta />} />
            <Route path="/ventas/nota-credito/nueva" element={<RegistroNotaCredito />} />
            <Route path="/ventas/guia-remitente/nueva" element={<GuiaRemitente />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/reportes" element={<Reports />} />
          </Route>
          <Route path="*" element={<Navigate to="/menu" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
