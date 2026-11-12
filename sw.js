/**
 * Service Worker PWA - Gestor de Condominios
 * - Precachea el App Shell con rutas relativas (compatible con / y /repo/).
 * - Estrategia Network-First para ./data/*.json (evita datos antiguos cuando hay red).
 * - Nunca intercepta ni cachea peticiones a api.github.com.
 */

const CACHE_VERSION = 'v1.1.0';
const SHELL_CACHE = `condominios-shell-${CACHE_VERSION}`;
const DATA_CACHE = `condominios-data-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/images/header-pattern.svg',
  './css/variables.css',
  './css/main.css',
  './css/layout.css',
  './css/components.css',
  './css/admin.css',
  './js/app.js',
  './js/core/state.js',
  './js/core/utils.js',
  './js/core/ui-feedback.js',
  './js/modules/assignments.js',
  './js/modules/modals.js',
  './js/modules/territories.js',
  './js/modules/publishers.js',
  './js/services/storage.js',
  './js/services/database.js',
  './js/services/github.js',
  './js/services/auth-proxy.js',
  './js/admin/admin.js',
  './js/admin/admin-ui.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca interceptar peticiones externas ni llamadas a GitHub API
  if (url.origin !== self.location.origin) {
    return;
  }

  // Datos JSON: Network-First con fallback a caché para consulta offline
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(request)
        .then(networkRes => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(url.pathname, copy));
          }
          return networkRes;
        })
        .catch(() => caches.match(url.pathname))
    );
    return;
  }

  // Navegación SPA/PWA: Network-First con fallback a index.html cacheado
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // App Shell estático: Stale-While-Revalidate para carga instantánea y actualización progresiva
  event.respondWith(
    caches.match(request).then(cached => {
      const networkPromise = fetch(request)
        .then(networkRes => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
          }
          return networkRes;
        })
        .catch(() => null);

      return cached || networkPromise;
    })
  );
});

