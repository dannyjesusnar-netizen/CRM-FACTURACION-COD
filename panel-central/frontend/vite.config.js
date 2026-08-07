import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/panel/' — se sirve bajo el mismo dominio que el CRM, en la ruta
// /panel (ver crm-facturacion/backend/server.js), no en la raíz.
export default defineConfig({
  base: '/panel/',
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/panel-api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
})
