// Captura el evento `beforeinstallprompt` (Chrome/Android/desktop Chrome) a
// nivel de módulo — se dispara muy temprano, apenas el navegador considera
// la página instalable, así que el listener tiene que existir desde que se
// carga el bundle, no recién cuando un componente se monta.
let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

export function canInstallPwa() {
  return !!deferredPrompt;
}

export function subscribePwaInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Muestra el aviso nativo de instalación; devuelve el resultado
// ({ outcome: 'accepted' | 'dismissed' }) o null si no había un aviso
// disponible (navegador sin soporte, iOS, o ya instalada).
export async function promptPwaInstall() {
  if (!deferredPrompt) return null;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return choice;
}

export function isPwaInstalled() {
  return installed;
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

// La app ya se está ejecutando como PWA instalada (abierta desde la
// pantalla de inicio, no desde el navegador) — no tiene sentido ofrecer
// instalarla de nuevo.
export function isRunningStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}
