const CACHE = 'nexo-palo-alto-v104';
const QR_LIBRARY = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
const FILES = [
  './',
  './index.html',
  './style.css',
  './auth.css',
  './app.js',
  './admin-data.js',
  './cuotas.js',
  './notices.js',
  './summary-data.js',
  './assembly.js',
  './directory.js',
  './loans.js',
  './incidents.js',
  './visitors.js',
  './auth-ui.js',
  './install-app.js',
  './supabase-client.example.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES))
      .then(cache => fetch(QR_LIBRARY, { mode: 'cors' }).then(response => response.ok ? cache.put(QR_LIBRARY, response) : null).catch(() => null))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (event.request.url === QR_LIBRARY) {
    event.respondWith(caches.match(QR_LIBRARY).then(cached => cached || fetch(event.request)));
    return;
  }
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) caches.open(CACHE).then(cache => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
        return response;
      }))
      .catch(() => caches.match('./index.html')),
  );
});
