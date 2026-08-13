// Service worker mínimo: solo existe para que el navegador considere la app
// "instalable" (criterio de Chrome/Android para mostrar el aviso de agregar
// a la pantalla de inicio). No cachea nada — cada request va directo a la
// red, así los usuarios siempre ven la versión actual del sistema.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
