import axios from 'axios';

// Servido bajo el mismo dominio que el CRM, en /panel — su API vive en
// /panel-api para no chocar con /api (la del CRM).
const api = axios.create({ baseURL: '/panel-api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('panel_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('panel_token');
      localStorage.removeItem('panel_admin');
      if (window.location.pathname !== '/panel/login') {
        window.location.href = '/panel/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
