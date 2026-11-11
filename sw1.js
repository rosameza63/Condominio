const CACHE_NAME = 'v1_cache_pwa_desde_cero';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Evento de instalación: Guarda los archivos esenciales en la caché
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache)
          .then(() => self.skipWaiting());
      })
      .catch(err => console.log('No se ha registrado el caché', err))
  );
});

// Evento de activación: Elimina cachés antiguas si cambias la versión
self.addEventListener('activate', e => {
  const cacheWhitelist = [CACHE_NAME];
  e.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Evento fetch: Sirve el contenido desde la caché cuando no hay internet
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request)
      .then(res => {
        if (res) {
          return res; // Devuelve el archivo desde la caché
        }
        return fetch(e.request); // Si no está en caché, lo busca en internet
      })
  );
});
