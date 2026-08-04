import { useAuth } from '../context/AuthContext';

export default function RequirePermiso({ modulo, children }) {
  const { user } = useAuth();
  const permitido = user?.permisos ? user.permisos[modulo] !== false : true;
  if (!permitido) {
    return (
      <div className="panel">
        <h3>Acceso restringido</h3>
        <p className="empty-row">Tu rol no tiene permiso para acceder a este módulo.</p>
      </div>
    );
  }
  return children;
}
