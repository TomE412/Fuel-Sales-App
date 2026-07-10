// ============================================================
// SKELSEE REP APP — Service Worker (CACHE-FIRST)
// App shell loads instantly from cache, always.
// Network is only used to update the cache in the background.
// ============================================================
const CACHE = 'fuel-v10';
const CORE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // NEVER touch Supabase / CDNs / fonts — these must hit the network directly
  if (url.includes('supabase.co') ||
      url.includes('jsdelivr') ||
      url.includes('cdnjs') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return; // browser handles normally
  }

  // Only handle GET requests
  if (e.request.method !== 'GET') return;

  // CACHE-FIRST for everything (the app shell)
  // Serve from cache instantly if available; fetch in background to update.
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Background fetch to refresh the cache for next time
      const networkFetch = fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => null);

      // Return cached immediately if we have it, otherwise wait for network
      return cached || networkFetch || caches.match('index.html');
    })
  );
});
