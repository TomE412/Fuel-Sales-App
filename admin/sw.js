// ============================================================
// SKELSEE ADMIN — Service Worker (CACHE-FIRST)
// Adapted from ops/sw.js — same cache-first strategy with an
// offline-navigate fallback.
// ============================================================
const CACHE = 'admin-v1';
const CORE = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      await Promise.all(CORE.map(async url => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.ok) await cache.put(url, res);
        } catch (err) { /* skip missing file, don't fail the whole install */ }
      }));
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  if (url.includes('supabase.co') || url.includes('jsdelivr') ||
      url.includes('cdnjs') || url.includes('unpkg') ||
      url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    return;
  }
  if (req.method !== 'GET') return;

  // Page loads: serve the shell from cache when offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          c.put('index.html', fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match('index.html'))
            || (await cache.match('./'))
            || new Response('<h1>Offline</h1><p>Open once online, then it works offline.</p>',
                 { headers: { 'Content-Type': 'text/html' }, status: 503 });
      }
    })());
    return;
  }

  // Everything else: cache-first, refresh in background, real await on miss.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) {
      fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match('index.html')) || new Response('', { status: 504 });
    }
  })());
});
