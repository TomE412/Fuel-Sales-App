// ============================================================
// SKELSEE REP APP — Service Worker (CACHE-FIRST)
//
// v11 — FIXES THE OFFLINE BUG
//
// What was broken in v10:
//   return cached || networkFetch || caches.match('index.html');
// networkFetch is a PROMISE, and a promise is always truthy, so the
// index.html fallback could never be reached. Offline, that promise
// resolved to null and respondWith(null) = "site can't be reached".
//
// Also: addAll() is atomic. One missing icon = nothing cached at all,
// and the .catch() hid it. Now each file is cached individually so a
// missing icon can't take the whole app shell down with it.
// ============================================================
const CACHE = 'fuel-v12';

// index.html and './' are the same page but different cache keys — both needed.
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
      // Cache each file on its own. If an icon is missing, we still get the app.
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

  // Never touch Supabase / CDNs / fonts — these must hit the network directly.
  if (url.includes('supabase.co') ||
      url.includes('jsdelivr') ||
      url.includes('cdnjs') ||
      url.includes('unpkg') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return; // browser handles normally
  }

  if (req.method !== 'GET') return;

  // Page loads (typing the URL, refreshing, opening the PWA):
  // always answer with the app shell if the network is unavailable.
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
        // Offline. Serve the shell.
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

  // Everything else: cache-first, refresh in the background.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    if (cached) {
      // Serve instantly, quietly refresh for next time.
      fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
      }).catch(() => {});
      return cached;
    }

    // Not cached — we must actually WAIT for the network here.
    // (This is what v10 got wrong: it returned the unresolved promise.)
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
