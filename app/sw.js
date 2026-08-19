// Caches the app shell so the UI loads instantly / survives a flaky connection.
// Data always goes to the network (/api is never cached).
const CACHE_NAME = 'fitness-tracker-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './io.js',
  './charts.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache API calls — always hit the server.
  if (url.pathname.startsWith('/api')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
