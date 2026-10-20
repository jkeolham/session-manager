// Service Worker for N100 Session Manager PWA
const CACHE_NAME = 'session-manager-v11';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/mobile.css',
  '/mobile.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon.svg',
  '/favicon.ico'
];

// Install: Cache core app shell assets and skip waiting immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate: Clean up all older caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first with cache fallback for app shell, Network-only for API & uploads
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always bypass cache for API calls, uploads, and non-GET requests
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // Network-first strategy for static assets
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If response is valid, update cache asynchronously
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If HTML request fails, fallback to index.html
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/');
          }
        });
      })
  );
});
