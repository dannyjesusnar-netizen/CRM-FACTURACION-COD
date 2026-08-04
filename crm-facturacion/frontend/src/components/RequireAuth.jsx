import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RequireAuth({ children }) {
  const { user, sucursal } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!sucursal && !user.sucursal_id && location.pathname !== '/seleccionar-sede') {
    return <Navigate to="/seleccionar-sede" replace />;
  }
  return children;
}
