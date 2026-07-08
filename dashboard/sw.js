const CACHE = 'fuel-ops-v1';
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

  // Never intercept Supabase, fonts, or CDN requests
  if (url.includes('supabase.co') ||
      url.includes('jsdelivr') ||
      url.includes('cdnjs') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return;
  }

  // Network-first for HTML pages so updates always show
  if (e.request.mode === 'navigate' || e.request.destination === 'document' || url.endsWith('.html') || url.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.status === 200) { const cl = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
        return r;
      }).catch(() => caches.match(e.request).then(c => c || caches.match('index.html')))
    );
    return;
  }

  // Cache-first for static assets
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      if (r && r.status === 200 && e.request.method === 'GET') { const cl = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, cl)); }
      return r;
    }))
  );
});
