import { createContext, useContext, useState } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(() => {
    const raw = localStorage.getItem('panel_admin');
    return raw ? JSON.parse(raw) : null;
  });

  async function login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('panel_token', res.data.token);
    localStorage.setItem('panel_admin', JSON.stringify(res.data.admin));
    setAdmin(res.data.admin);
    return res.data.admin;
  }

  function logout() {
    localStorage.removeItem('panel_token');
    localStorage.removeItem('panel_admin');
    setAdmin(null);
  }

  return (
    <AuthContext.Provider value={{ admin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
