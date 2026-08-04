import { createContext, useContext, useState } from 'react';
import api from '../api';

const AuthContext = createContext(null);

function readSucursal() {
  const id = localStorage.getItem('crm_sucursal_id');
  const nombre = localStorage.getItem('crm_sucursal_nombre');
  return id ? { id: Number(id), nombre } : null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [sucursal, setSucursalState] = useState(readSucursal);

  function setSucursal(id, nombre) {
    localStorage.setItem('crm_sucursal_id', String(id));
    localStorage.setItem('crm_sucursal_nombre', nombre || '');
    setSucursalState({ id: Number(id), nombre });
  }

  function limpiarSucursal() {
    localStorage.removeItem('crm_sucursal_id');
    localStorage.removeItem('crm_sucursal_nombre');
    setSucursalState(null);
  }

  async function login(ruc, dni, password) {
    const res = await api.post('/auth/login', { ruc, dni, password });
    localStorage.setItem('crm_token', res.data.token);
    localStorage.setItem('crm_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    // Si el usuario tiene sede fija (vendedor), queda seleccionada de una vez
    // y nunca ve el selector de negocio.
    if (res.data.user.sucursal_id) {
      setSucursal(res.data.user.sucursal_id, res.data.user.sucursal_nombre);
    } else {
      limpiarSucursal();
    }
    return res.data.user;
  }

  function logout() {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
    limpiarSucursal();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, sucursal, setSucursal, limpiarSucursal }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
