// Service Worker EFA Aconta (Offline shell cache sans jamais interférer avec Supabase, Auth, ni les sessions)
const CACHE_NAME = 'efa-aconta-pwa-v7';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/apple-touch-icon.png',
  '/logo.png',
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          SHELL_ASSETS.map((asset) =>
            cache.add(new Request(asset, { cache: 'reload' })).catch(() => undefined)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
            return Promise.resolve(false);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    return;
  }

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Ne JAMAIS intercepter Supabase (DB, Auth, Storage, Realtime), API backend, sessions, ni HMR Vite
  if (
    url.origin !== self.location.origin ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.in') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/storage/') ||
    url.pathname.startsWith('/.well-known/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.includes('hot-update') ||
    url.pathname.startsWith('/src/') ||
    req.headers.has('authorization')
  ) {
    return;
  }

  // Navigation HTML : Network-First avec fallback offline sur l'app shell en cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedPage = await caches.match(req);
          if (cachedPage) return cachedPage;
          return (await caches.match('/index.html')) || (await caches.match('/'));
        })
    );
    return;
  }

  // Ressources statiques mêmes-origine (JS, CSS, images, icônes, manifest) : Network-First avec cache hors ligne
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return networkResponse;
      })
      .catch(() => caches.match(req))
  );
});

// GESTION DES NOTIFICATIONS LOCALES & PUSH (RAPPEL QUOTIDIEN 9H EFA ACONTA)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
