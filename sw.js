// ============================================================
// SKELSEE REP APP — Service Worker (CACHE-FIRST)
//
// v14 — TRUE OFFLINE-FIRST STARTUP
//
// What changed from v13:
//   The two helper libraries (Supabase = database, XLSX = Excel reports)
//   were loaded from an internet file-host (a CDN) and the service worker
//   was told to SKIP them. That meant offline they never loaded, so the
//   app died before it could show the PIN screen.
//
//   Now: those two library files are saved into the cache on install and
//   served from the cache when offline, just like the app's own files.
//   The app itself (index.html) has also been rebuilt to open the PIN
//   screen even if these libraries somehow fail — this is belt AND braces.
//
// Kept from v13:
//   - Each file cached individually (one missing file can't sink the rest).
//   - navigate requests fall back to the cached shell.
//   - We AWAIT the network before returning (no truthy-promise bug).
// ============================================================
const CACHE = 'fuel-v28';

// The app's own files. index.html and './' are the same page but different
// cache keys — both needed.
const CORE = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

// The borrowed helper libraries. These live on a CDN (internet file-host).
// We now save copies so the app can use them with no connection.
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Cache each file on its own. If one file is missing or the CDN is
      // slow, we still get everything else — the app never goes all-or-nothing.
      await Promise.all([...CORE, ...LIBS].map(async url => {
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


/* ============================================================
   PHONE NOTIFICATIONS

   The buzz on a shut phone. Google (Android, Chrome) or Apple (iPhone)
   wakes this worker and hands it the message; all it does is show it.

   Deliberately forgiving about the payload. A push service is allowed to
   wake a worker with nothing attached, and a worker that throws here shows
   the browser's own "This site has been updated in the background" notice
   instead - which looks broken and tells the rep nothing.
   ============================================================ */
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) {
    try { d = { body: event.data.text() }; } catch (e2) { d = {}; }
  }
  event.waitUntil(self.registration.showNotification(d.title || 'Fuel Sales', {
    body: d.body || 'There is an update on one of your loads.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    // One tag per load, so three updates on the same delivery replace each
    // other on the lock screen rather than stacking three deep.
    tag: d.tag || 'skelsee',
    renotify: true,
    data: { url: d.url || './', sale_id: d.sale_id || null, stage: d.stage || null },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Already open somewhere: bring that to the front rather than starting a
    // second copy, which on a phone looks like the app has lost the rep's
    // place and any half-typed sale with it.
    for (const c of open) {
      if ('focus' in c) { await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // The two library CDNs are now handled by us (cache-first), so DON'T skip
  // them any more. But the DATABASE itself and fonts must still hit the
  // network directly — those are live data / styling, not app files.
  if (url.includes('supabase.co') ||          // the live database API
      url.includes('unpkg') ||
      url.includes('cdnjs') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return; // browser handles normally
  }

  if (req.method !== 'GET') return;

  // Page loads (typing the URL, refreshing, opening the installed app):
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
        // Offline. Serve the saved app shell.
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

  // Everything else (including the two libraries now): cache-first, and
  // quietly refresh in the background for next time.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    if (cached) {
      // Serve instantly from the saved copy, quietly refresh for next time.
      fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
      }).catch(() => {});
      return cached;
    }

    // Not saved yet — we must actually WAIT for the network here.
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
