// Service Worker pour EFA ACONTA V5 (Offline-first avec Network-First garanti sans cache périmé)
const CACHE_NAME = 'efa-aconta-v5-cache-v6';

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  // Activation immédiate sans attendre la fermeture des onglets
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Suppression ancien cache PWA:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ne JAMAIS intercepter les requêtes de dev Vite, HMR, ou API externes
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.includes('hot-update') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('pollinations.ai') ||
    url.hostname.includes('unsplash.com') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Pour la navigation (HTML), toujours chercher sur le réseau en direct
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Met à jour le cache de secours
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          // Secours hors-ligne uniquement si le réseau est totalement inaccessible
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // Pour les autres ressources statiques (images, icônes) : Network first avec fallback cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
