// ============================================================
// SKELSEE OPS PLANNER — Service Worker (CACHE-FIRST)
// v2 — fixes the offline fallback bug (net is a promise, always
// truthy, so the old `cached || net || match` never fell back),
// caches each file individually, and includes the app's own icons.
// ============================================================
const CACHE = 'ops-planner-v12';

// THIS worker's own app, worked out from where the worker itself lives.
//
// A worker registered at the repository root is scoped to the WHOLE site,
// so every sub-app - /ops/, /admin/, /accounts/, /dashboard/ - sits inside
// its scope and it sees their page loads too, at least until each one's own
// worker is registered. Treating those as this app's page is what made the
// ops planner and the sales app open each other: see the navigate handler.
const SCOPE = new URL('./', self.location).pathname;
const OWN_PAGE = p => p === SCOPE || p === SCOPE + 'index.html';
const CORE = [
  './',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
];

// The borrowed libraries. These live on a file host, and the fetch handler
// below used to SKIP them - so with no signal they never arrived, `L` and
// `supabase` were undefined, and creating the database client threw at the
// top of the app's script. Every line after it then never ran, which is why
// offline was a dead page rather than a degraded one.
//
// The map tiles are NOT cached. They are thousands of images and the point
// here is the loads board, not a surveyed map. Offline the map draws its
// pins on an empty background.
const LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Individually, not addAll: that is atomic, so one missing icon would
      // mean nothing at all got cached and a swallowed error would hide it.
      await Promise.all([...CORE, ...LIBS].map(async url => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.ok) await cache.put(url, res);
        } catch (err) {
          // One missing file must not sink the rest, but it must be visible:
          // a silently skipped library is an app that works right up until
          // the moment it is needed offline.
          console.warn('[sw] skipped:', url, err.message);
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

  // The DATABASE must always go to the network - it is live data, not a file.
  // The two libraries are now ours to serve, cache-first, so they work with
  // no signal. Fonts stay on the network: if they fail the app renders in a
  // fallback face, which is a cosmetic loss rather than a broken app.
  if (url.includes('supabase.co') ||
      url.includes('cdnjs') ||
      url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    return;
  }
  if (req.method !== 'GET') return;

  // Page loads: serve the shell from cache when offline.
  if (req.mode === 'navigate') {
    // Only ever answer for, or cache, THIS app's own page.
    //
    // Without this the handler below wrote every page load it saw into the
    // key 'index.html' - its own shell - so opening a DIFFERENT app in this
    // worker's scope replaced this app's saved page with that one. The next
    // offline start then served the wrong app, and the two home-screen
    // icons opened the same thing. Anything that is not ours is handed back
    // to the browser, which gives it to that app's own worker instead.
    if (!OWN_PAGE(new URL(req.url).pathname)) return;

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
      // Deliberately NOT the app shell. This branch is a missing image,
      // script or stylesheet, and handing back a page of HTML turns a clear
      // "could not load" into a parse error three steps later.
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
