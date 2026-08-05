import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

// Botón rápido en la barra superior para que Gerencia cambie de sede sin
// salir de la app (sin pasar por /seleccionar-sede). Solo tiene sentido si
// hay más de una sede activa — si solo hay una, no se renderiza nada.
export default function SedeSwitcher() {
  const { user, sucursal, setSucursal } = useAuth();
  const [sucursales, setSucursales] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (user?.role !== 'gerencia') return;
    api.get('/sucursales').then((res) => setSucursales(res.data)).catch(() => {});
  }, [user?.role]);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (user?.role !== 'gerencia' || sucursales.length <= 1) return null;

  function elegir(s) {
    setOpen(false);
    if (s.id === sucursal?.id) return;
    setSucursal(s.id, s.nombre);
    // La página actual pudo haber cargado datos de la sede anterior (ventas,
    // inventario, caja, reportes...); recargar garantiza que todo se vuelva
    // a pedir ya con la sede nueva, sin tener que auditar cada pantalla.
    window.location.reload();
  }

  return (
    <div className="sede-switcher" ref={boxRef}>
      <button
        type="button"
        className="sede-switcher-btn"
        onClick={() => setOpen((v) => !v)}
        title="Cambiar de sede"
      >
        <Building2 size={15} />
        <span>{sucursal?.nombre || 'Elegir sede'}</span>
        <ChevronDown size={13} className={'caret-icon' + (open ? ' open' : '')} />
      </button>
      <div className={'user-dropdown sede-switcher-dropdown' + (open ? ' open' : '')}>
        {sucursales.map((s) => (
          <div key={s.id} className="user-dropdown-item" onClick={() => elegir(s)}>
            <Building2 size={15} className="dropdown-icon" />
            <span style={{ flex: 1 }}>{s.nombre}</span>
            {s.id === sucursal?.id && <Check size={15} style={{ color: 'var(--good)' }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
