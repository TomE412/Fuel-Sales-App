// ============================================================
// SKELSEE REP APP — Service Worker (CACHE-FIRST)
// v11 — FIXES THE OFFLINE BUG
//
// v10 bug: return cached || networkFetch || caches.match('index.html')
// networkFetch is a PROMISE and promises are always truthy, so the
// index.html fallback was unreachable. Offline it resolved to null,
// and respondWith(null) = "site can't be reached".
//
// Also: addAll() is atomic. One missing icon = nothing cached at all,
// and the .catch() hid it. Files now cache individually.
// ============================================================
const CACHE = 'fuel-v11';

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
          else console.warn('[sw] skipped (not ok):', url, res && res.status);
        } catch (err) {
          console.warn('[sw] skipped (failed):', url, err.message);
        }
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

  if (url.includes('supabase.co') ||
      url.includes('jsdelivr') ||
      url.includes('cdnjs') ||
      url.includes('unpkg') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return;
  }

  if (req.method !== 'GET') return;

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
            || new Response(
                 '<h1>Offline</h1><p>Open the app once while online, then it will work offline.</p>',
                 { headers: { 'Content-Type': 'text/html' }, status: 503 }
               );
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    if (cached) {
      fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
      }).catch(() => {});
      return cached;
    }

    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const shell = await cache.match('index.html');
      if (shell) return shell;
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});