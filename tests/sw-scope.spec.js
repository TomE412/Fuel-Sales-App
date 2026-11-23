// Why the ops planner and the sales app opened each other.
//
// A service worker registered at the repository root is scoped to the WHOLE
// site, so /ops/, /admin/, /accounts/ and /dashboard/ all sit inside it and
// it sees their page loads too. The navigate handler used to write every
// page it saw into the key 'index.html' - its own shell - and to answer any
// page load from that same key when offline. So opening the ops planner
// replaced the sales app's saved page with the ops planner, and from then on
// the two home-screen icons opened the same app.
//
// These tests load each worker's REAL source and call its actual fetch
// handler with a stubbed `self`, so what is checked is the shipped code.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// `at` is where the worker script itself lives. Absolute, because that is
// what self.location is in a real worker and what new URL() needs as a base.
const HOST = 'https://x.test';
const WORKERS = [
  { file: 'sw.js',       at: HOST + '/Fuel-Sales-App/sw.js',       own: '/Fuel-Sales-App/' },
  { file: 'ops/sw.js',   at: HOST + '/Fuel-Sales-App/ops/sw.js',   own: '/Fuel-Sales-App/ops/' },
  { file: 'admin/sw.js', at: HOST + '/Fuel-Sales-App/admin/sw.js', own: '/Fuel-Sales-App/admin/' },
];
const ROOT_SW = WORKERS[0].at;

/* Runs a worker's fetch handler against one request and reports what it did:
   whether it answered at all, what it put in the cache, and what came back. */
async function drive(page, src, at, url, { offline = false, mode = 'navigate' } = {}) {
  return page.evaluate(async ([src, at, url, offline, mode]) => {
    const puts = [], fetched = [];
    // A real Cache resolves a relative key against the worker's own URL, so
    // cache.match('index.html') in /Fuel-Sales-App/sw.js looks up
    // /Fuel-Sales-App/index.html. The stub has to do the same or the offline
    // fallback would look broken when it is not.
    const key = k => new URL(String(k && k.url ? k.url : k), at).href;
    const store = {};
    store[key('index.html')] = 'CACHED-OWN-SHELL';

    const cache = {
      put: (k, v) => { puts.push(String(k)); store[key(k)] = v && v.body; return Promise.resolve(); },
      match: k => Promise.resolve(store[key(k)] ? { body: store[key(k)] } : undefined),
    };
    const caches = {
      open: () => Promise.resolve(cache),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    };
    const fakeFetch = (req) => {
      fetched.push(String(req && req.url ? req.url : req));
      if (offline) return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, body: 'FRESH:' + (req.url || req),
                               clone(){ return this; } });
    };
    const FakeResponse = function (body, init) { this.body = body; Object.assign(this, init || {}); };

    const handlers = {};
    const self = {
      location: at,
      addEventListener: (k, fn) => { handlers[k] = fn; },
      skipWaiting(){}, clients: { claim(){}, matchAll: () => Promise.resolve([]) },
      registration: { showNotification(){} },
    };

    // The worker's own source, with our stubs standing in for the globals it
    // would normally get from the worker scope.
    new Function('self', 'caches', 'fetch', 'Response', 'console', src)(
      self, caches, fakeFetch, FakeResponse, console);

    let answered = false, result = null;
    const event = {
      request: { url: url, method: 'GET', mode: mode },
      respondWith: p => { answered = true; result = p; },
      waitUntil: () => {},
    };
    handlers.fetch(event);
    let body = null;
    if (answered) { try { body = (await result); body = body && body.body; } catch (e) { body = 'THREW'; } }
    return { answered, body, puts, fetched };
  }, [src, at, url, offline, mode]);
}

/* ------------------------------------------------------------------ */

test('the root worker hands every other app its own page loads back', async ({ page }) => {
  await page.goto('/');
  const src = read('sw.js');

  // These all sit inside the root worker's scope but are NOT its app.
  for (const other of ['/Fuel-Sales-App/ops/', '/Fuel-Sales-App/ops/index.html',
                       '/Fuel-Sales-App/admin/', '/Fuel-Sales-App/accounts/',
                       '/Fuel-Sales-App/dashboard/', '/Fuel-Sales-App/reports/']) {
    const out = await drive(page, src, ROOT_SW, 'https://x.test' + other);
    expect(out.answered, other + ' must be left to its own app').toBe(false);
    expect(out.puts, other + ' must not touch the sales app cache').toEqual([]);
  }
});

test('the root worker still looks after its own page', async ({ page }) => {
  await page.goto('/');
  const src = read('sw.js');

  for (const mine of ['/Fuel-Sales-App/', '/Fuel-Sales-App/index.html',
                      '/Fuel-Sales-App/index.html?from=push']) {
    const out = await drive(page, src, ROOT_SW, 'https://x.test' + mine);
    expect(out.answered, mine + ' is the sales app and must be handled').toBe(true);
    expect(out.body).toContain('FRESH:');
    // and it refreshes its own shell, under its own key
    expect(out.puts).toEqual(['index.html']);
  }
});

test('offline, the root worker serves its own shell and nobody else gets it', async ({ page }) => {
  await page.goto('/');
  const src = read('sw.js');

  const mine = await drive(page, src, ROOT_SW,
    'https://x.test/Fuel-Sales-App/', { offline: true });
  expect(mine.answered).toBe(true);
  expect(mine.body, 'its own page falls back to the saved shell').toBe('CACHED-OWN-SHELL');

  // This is the actual reported fault: offline, opening the ops planner used
  // to come back with the sales app's shell.
  const theirs = await drive(page, src, ROOT_SW,
    'https://x.test/Fuel-Sales-App/ops/', { offline: true });
  expect(theirs.answered, 'the ops planner must never be served the sales app').toBe(false);
  expect(theirs.body).toBeNull();
});

/* ------------------------------------------------------------------ */

test('each sub-app worker minds only its own app', async ({ page }) => {
  await page.goto('/');

  for (const w of WORKERS.slice(1)) {
    const src = read(w.file);
    const own = await drive(page, src, w.at, 'https://x.test' + w.own);
    expect(own.answered, w.file + ' must handle ' + w.own).toBe(true);

    // The root page and its sibling apps are outside this worker's app, even
    // where they are inside nothing at all - the check is the same either way.
    for (const other of ['/Fuel-Sales-App/', '/Fuel-Sales-App/accounts/']) {
      if (other === w.own) continue;
      const out = await drive(page, src, w.at, 'https://x.test' + other);
      expect(out.answered, w.file + ' must not answer for ' + other).toBe(false);
    }
  }
});

/* ------------------------------------------------------------------ */

test('a missing image or script is not answered with a page of HTML', async ({ page }) => {
  await page.goto('/');
  for (const w of WORKERS) {
    const src = read(w.file);
    const out = await drive(page, src, w.at, 'https://x.test' + w.own + 'icon-192.png',
      { offline: true, mode: 'no-cors' });
    expect(out.answered, w.file + ' handles its own assets').toBe(true);
    // Handing back HTML where a PNG or a script was asked for turns a clear
    // "could not load" into a parse error three steps later.
    expect(out.body, w.file + ' served its shell for an image').not.toBe('CACHED-OWN-SHELL');
    console.log(w.file + ' asset miss -> ' + JSON.stringify(out.body));
  }
});

/* ------------------------------------------------------------------ */

test('the three workers keep separate caches and are all bumped past the fault', async ({ page }) => {
  const names = WORKERS.map(w => (read(w.file).match(/const CACHE = '([^']+)'/) || [])[1]);
  console.log('caches: ' + JSON.stringify(names));
  expect(names.every(Boolean)).toBe(true);
  expect(new Set(names).size, 'two apps sharing a cache name would share a shell').toBe(3);

  // The old cache is deleted on activate, so bumping the version is what
  // clears the wrong shell already saved on everyone's phone.
  expect(names[0]).toBe('fuel-v37');
  expect(names[1]).toBe('ops-planner-v9');
  expect(names[2]).toBe('admin-v32');
});

/* ------------------------------------------------------------------ */

test('each app declares its own identity to the phone', async ({ page }) => {
  // Two apps that install as one is the other half of the same complaint, so
  // the manifests have to stay distinct.
  const apps = ['', 'ops/', 'admin/', 'accounts/', 'dashboard/'];
  const seen = {};
  for (const a of apps) {
    const m = JSON.parse(read(a + 'manifest.json'));
    console.log(a || '(root)', JSON.stringify({ id: m.id, scope: m.scope, start: m.start_url }));
    expect(m.id, a + ' needs its own id').toBeTruthy();
    expect(seen[m.id], 'two apps share the id ' + m.id).toBeUndefined();
    seen[m.id] = a;
    // Relative, so it keeps working under the /Fuel-Sales-App/ prefix that
    // GitHub Pages puts everything behind.
    expect(m.scope, a + ' scope must be relative').toBe('./');
    expect(m.start_url, a + ' start_url must be relative').toBe('./');
    expect(m.name, a + ' needs its own name').toBeTruthy();
  }
  expect(Object.keys(seen).length).toBe(apps.length);
});
