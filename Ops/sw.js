// ============================================================
// SKELSEE OPS PLANNER — Service Worker (CACHE-FIRST)
// Loads instantly from cache; updates in background.
// ============================================================
const CACHE = 'ops-planner-v1';
const CORE = ['./', 'index.html', 'manifest.json'];

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
  if (url.includes('supabase.co') || url.includes('jsdelivr') ||
      url.includes('cdnjs') || url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r && r.status === 200) { const cl = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
        return r;
      }).catch(() => null);
      return cached || net || caches.match('index.html');
    })
  );
});
