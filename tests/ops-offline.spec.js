// Does the ops planner actually open with no signal?
//
// Reading the code is not evidence. These drive a real browser through the
// cold starts that matter, including the one everybody skips: a request that
// HANGS rather than failing. Offline fails fast and the catch block runs; a
// dying signal never settles, so catch never runs and the screen freezes.
//
// Two things the harness has to get right, both learned the hard way:
//
//   * page.goto() waits for the LOAD event, which waits on every subresource.
//     Timing the open from goto measures the fonts, not the app. So: load with
//     waitUntil 'commit', stamp t0 in an init script, and watch the DOM.
//   * context.setOffline(true) cuts localhost too, so the page itself will not
//     load. To make the app BELIEVE it is offline, override navigator.onLine.

const { test, expect } = require('@playwright/test');

const PROJECT_REF = 'lkaotuavapyvqfuuyzft';
const SESSION_KEY = 'sb-' + PROJECT_REF + '-auth-token';
const day = off => {
  const d = new Date(); d.setDate(d.getDate() + off);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
};

const SESSION = {
  access_token: 'fake-access', token_type: 'bearer', expires_in: 3600,
  // Far enough ahead that nothing tries to refresh it over the network.
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fake-refresh',
  user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated',
          role: 'authenticated', email: 'munya@skelsee.co.zw' },
};

const PHONE = {
  profile: { full_name: 'Munya Chibanda', role: 'ops', app_access: null, active: true },
  sales: [
    { id: 1, customer: 'Mukuyu Wines', location: 'Marondera', litres: 12000,
      fuel_type: 'Diesel', sale_date: day(-20), delivery_date: day(-4),
      status: 'pending', delivered_at: null, rep_name: 'Tom Eager CW',
      notes: 'Ask for Joseph' },
    { id: 2, customer: 'Border Timbers', location: 'Mutare', litres: 36000,
      fuel_type: 'Diesel', sale_date: day(-6), delivery_date: day(0),
      status: 'pending', delivered_at: null, rep_name: 'Tom Eager CW', notes: '' },
  ],
  refs: {
    ROUTES: [], PLACES: [{ place: 'Marondera', latitude: -18.19, longitude: 31.55 }],
    TRUCKS: [], DEPOTS: [], CUSTNAMES: [], PROSPECTS: [], BOARD: [],
    FLEETMAP: {
      vehicles: [{ id: 'v1', fleet_no: 'SH03', reg_no: 'AFJ 2570', needs_pump: false,
                   capacity_litres: 40000, default_driver_id: 'd1',
                   default_trailer_id: null, contractor_id: null, active: true }],
      trailers: [], pumps: [], contractors: [],
      drivers: [{ id: 'd1', full_name: 'Masden Majoni', phone: '0772910076' }],
      pos: {}, assign: { '1': { sale_id: 1, vehicle_id: 'v1', driver_id: 'd1',
                                pump_unit_id: null, en_route_at: null } },
    },
  },
};

/* Everything a phone that has used the planner before has on it, stamped
   before the app's first line runs. */
async function primePhone(context, opts) {
  const o = opts || {};
  await context.addInitScript(([key, session, phone, profile, pretendOffline]) => {
    window.__t0 = Date.now();
    if (pretendOffline) {
      try {
        Object.defineProperty(navigator, 'onLine',
          { get: () => false, configurable: true });
      } catch (e) {}
    }
    try {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(session));
      if (profile !== null) {
        localStorage.setItem('ops_profile', JSON.stringify(profile));
        localStorage.setItem('ops_sales', JSON.stringify(phone.sales));
        localStorage.setItem('ops_refs', JSON.stringify(phone.refs));
        localStorage.setItem('ops_synced_at',
          new Date(Date.now() - 3 * 3600 * 1000).toISOString());
      }
    } catch (e) {}
  }, [SESSION_KEY, SESSION, PHONE,
      o.profile === undefined ? PHONE.profile : o.profile,
      !!o.pretendOffline]);
}

/* The database is unreachable. `hang` is the flavour that breaks apps: it
   never answers and never fails, so a catch block never runs. */
async function cutDatabase(page, how) {
  await page.route('**/*supabase.co/**', route =>
    how === 'hang' ? undefined : route.abort('internetdisconnected'));
}

// Time from the first byte of the page to a board you can actually use.
async function msToUsableBoard(page, timeout) {
  const h = await page.waitForFunction(() => {
    const a = document.getElementById('app');
    const rows = document.querySelectorAll('#loads-list .order-row').length;
    return (a && a.classList.contains('active') && rows) ? Date.now() - window.__t0 : null;
  }, null, { timeout: timeout || 10000 });
  return h.jsonValue();
}

/* ------------------------------------------------------------------ */

test('cold start with the database hanging: open in under two seconds', async ({ page, context }) => {
  await primePhone(context, { pretendOffline: true });
  await cutDatabase(page, 'hang');
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  await page.goto('/ops/', { waitUntil: 'commit' });
  const ms = await msToUsableBoard(page);
  console.log('usable board at ' + ms + 'ms with every request hanging');

  // The bar from the testing protocol. The profile read is bounded at six
  // seconds, so if the paint waited on it at all this fails - which is why
  // it is measured rather than reasoned about.
  expect(ms, 'the first paint must not wait on the network').toBeLessThan(2000);

  await expect(page.locator('#auth')).toHaveClass(/hidden/);
  await expect(page.locator('#who')).toHaveText('Munya Chibanda');

  // The board is the phone's own copy, rig and all.
  expect(await page.locator('#loads-list .order-row').count()).toBe(2);
  await expect(page.locator('#loads-list')).toContainText('Mukuyu Wines');
  await expect(page.locator('#loads-list')).toContainText('SH03');
  await expect(page.locator('#loads-list')).toContainText('Masden Majoni');

  expect(errs, 'nothing may die on the way').toEqual([]);
});

test('same again with the database refusing outright', async ({ page, context }) => {
  // Offline is the easy case - it fails fast. Here for completeness.
  await primePhone(context, { pretendOffline: true });
  await cutDatabase(page, 'abort');
  await page.goto('/ops/', { waitUntil: 'commit' });
  const ms = await msToUsableBoard(page);
  console.log('usable board at ' + ms + 'ms with every request refused');
  expect(ms).toBeLessThan(2000);
  expect(await page.locator('#loads-list .order-row').count()).toBe(2);
});

/* ------------------------------------------------------------------ */

test('the badge says how old what you are looking at is', async ({ page, context }) => {
  await primePhone(context, { pretendOffline: true });
  await cutDatabase(page, 'abort');
  await page.goto('/ops/', { waitUntil: 'commit' });
  await msToUsableBoard(page);

  const badge = await page.locator('#live').textContent();
  const title = await page.locator('#live').getAttribute('title');
  console.log('badge: ' + JSON.stringify(badge) + '\ntitle: ' + JSON.stringify(title));

  // Amber with a time, not an optimistic green. navigator.onLine reports true
  // behind a captive portal and on a signal too weak to carry anything, so the
  // badge says what has been CONFIRMED.
  expect(badge).toContain('Offline');
  expect(badge).toMatch(/\d{2}:\d{2}/);
  expect(title).toContain('Nothing can be changed');
});

/* ------------------------------------------------------------------ */

test('offline, a button that changes something refuses at once', async ({ page, context }) => {
  await primePhone(context, { pretendOffline: true });
  await cutDatabase(page, 'hang');     // a leak would hang, not fail fast
  await page.goto('/ops/', { waitUntil: 'commit' });
  await msToUsableBoard(page);

  const msgs = [];
  page.on('dialog', d => { msgs.push(d.message()); d.accept(); });

  for (const call of ['markDelivered("1")', 'setEnRoute("1")',
                      'undoDelivered("1")', 'clearEnRoute("1")',
                      'removeUnit("vehicle:v1")']) {
    const t0 = Date.now();
    await page.evaluate(c => eval(c), call);
    const ms = Date.now() - t0;
    expect(ms, call + ' must refuse immediately, not hang').toBeLessThan(1500);
  }
  console.log(JSON.stringify(msgs, null, 1));

  // removeUnit has nothing placed to remove, so it returns before asking.
  expect(msgs.length).toBe(4);
  expect(msgs.every(m => /No signal/.test(m))).toBe(true);
  expect(msgs.every(m => /nothing has been changed/i.test(m)),
    'it has to say nothing was lost').toBe(true);

  const still = await page.evaluate(() =>
    (SALES.find(s => String(s.id) === '1') || {}).status);
  expect(still, 'nothing may have been written').toBe('pending');
});

/* ------------------------------------------------------------------ */

test('a phone that has never been online says so, plainly', async ({ page, context }) => {
  // The limitation to state out loud rather than let somebody find in a lay-by.
  await primePhone(context, { profile: null, pretendOffline: true });
  await cutDatabase(page, 'abort');

  await page.goto('/ops/', { waitUntil: 'commit' });
  await expect(page.locator('#err')).toContainText('No signal', { timeout: 9000 });
  await expect(page.locator('#err')).toContainText('has not opened the planner before');
  await expect(page.locator('#app')).not.toHaveClass(/active/);
});

/* ------------------------------------------------------------------ */

test('access taken away still shuts the door it opened from cache', async ({ page, context }) => {
  // Opening from a cached profile must not become a way back in through a
  // door that has been shut. The cached one gets it open; the live one is
  // allowed to close it again.
  await primePhone(context);
  // Catch-all FIRST: Playwright gives the most recently added route priority,
  // so the specific profiles route has to come second or it never runs.
  await page.route('**/*supabase.co/rest/v1/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/*supabase.co/rest/v1/profiles**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ full_name: 'Munya Chibanda', role: 'rep',
                             app_access: [], active: true }) }));

  await page.goto('/ops/', { waitUntil: 'commit' });
  // It opens first and then shuts. Deliberately NOT asserting that it was
  // briefly open: on a fast reply the shut can land before a check could see
  // it, and a test that depends on losing that race is a flaky test. What
  // matters is where it ends up.
  await expect(page.locator('#auth')).not.toHaveClass(/hidden/, { timeout: 9000 });
  await expect(page.locator('#app')).not.toHaveClass(/active/);
  const err = await page.locator('#err').textContent();
  console.log('refusal: ' + JSON.stringify(err));
  expect(err.length).toBeGreaterThan(5);

  // And the cached profile is forgotten, so the next offline start cannot use it.
  expect(await page.evaluate(() => localStorage.getItem('ops_profile')),
    'a revoked profile must not stay on the phone').toBeNull();
});

/* ------------------------------------------------------------------ */

test('without its libraries the app explains itself instead of dying', async ({ page, context }) => {
  // A phone that has never been online has no cached copy of Leaflet or the
  // database client, and createClient on a missing library throws at the top
  // of the script - every line after it then never runs, leaving a blank page
  // with nothing on it to say why.
  await primePhone(context);
  await page.route('**/cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/unpkg.com/**', route => route.abort());

  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('/ops/', { waitUntil: 'commit' });
  await expect(page.locator('#err')).toContainText('could not finish loading',
    { timeout: 9000 });
  await expect(page.locator('#err')).toContainText('Open it once with a signal');
  console.log('page errors: ' + JSON.stringify(errs));
  expect(errs.some(e => /supabase-js did not load/.test(e)),
    'it throws on purpose - but only after saying why').toBe(true);
});

/* ------------------------------------------------------------------ */

test('the worker really does serve the libraries with the hosts cut', async ({ page, context }) => {
  // The strongest evidence in this file, and the thing that made offline
  // impossible before: Leaflet and the database client come from a file host,
  // and the worker used to hand both straight back to the network.
  await page.goto('/ops/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(3500);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const out = [];
    for (const n of names) {
      const c = await caches.open(n);
      (await c.keys()).forEach(r => out.push(r.url));
    }
    return out;
  });
  console.log('cached:\n  ' + cached.map(u => u.replace(/^https?:\/\//, '')).join('\n  '));
  expect(cached.some(u => /supabase-js@2/.test(u)), 'the database client').toBe(true);
  expect(cached.some(u => /leaflet.*\.js/.test(u)), 'leaflet.js').toBe(true);
  expect(cached.some(u => /leaflet.*\.css/.test(u)), 'leaflet.css').toBe(true);

  // Now cut every external host and reload. If the worker is doing its job the
  // libraries still arrive.
  await page.evaluate(([key, session, phone, profile]) => {
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem('ops_profile', JSON.stringify(profile));
    localStorage.setItem('ops_sales', JSON.stringify(phone.sales));
    localStorage.setItem('ops_refs', JSON.stringify(phone.refs));
    localStorage.setItem('ops_synced_at', new Date(Date.now() - 10800000).toISOString());
  }, [SESSION_KEY, SESSION, PHONE, PHONE.profile]);

  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.route('**/unpkg.com/**', r => r.abort());
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.route('**/*supabase.co/**', r => undefined);          // hang
  await context.addInitScript(() => { window.__t0 = Date.now(); });

  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.reload({ waitUntil: 'commit' });
  const ms = await msToUsableBoard(page, 12000);
  console.log('USABLE BOARD, EVERYTHING CUT: ' + ms + 'ms');

  expect(ms, 'this is the real cold offline start').toBeLessThan(2000);
  expect(await page.evaluate(() => typeof L), 'Leaflet from cache').toBe('object');
  expect(await page.evaluate(() => typeof supabase), 'the client from cache').toBe('object');
  await expect(page.locator('#loads-list')).toContainText('Mukuyu Wines');
  await expect(page.locator('#live')).toContainText('Offline');
  expect(errs).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('the worker caches the libraries and no longer skips them', async () => {
  const fs = require('fs');
  const path = require('path');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'ops', 'sw.js'), 'utf8');

  for (const lib of ['@supabase/supabase-js@2', 'leaflet@1.9.4/dist/leaflet.js',
                     'leaflet@1.9.4/dist/leaflet.css']) {
    expect(sw, 'the worker must cache ' + lib).toContain(lib);
  }
  const skip = sw.slice(sw.indexOf('if (url.includes'), sw.indexOf('if (req.method'));
  console.log('skip list:\n' + skip.trim());
  expect(skip).not.toContain('jsdelivr');
  expect(skip).not.toContain('unpkg');
  // The database is live data and must always go to the network.
  expect(skip).toContain('supabase.co');

  // Individually, not addAll: that is atomic, so one missing icon would mean
  // nothing at all got cached.
  expect(sw).toContain('[...CORE, ...LIBS]');
  expect(sw).not.toContain('cache.addAll');
});

/* ------------------------------------------------------------------ */

test('the reads are bounded and the helper really rejects', async ({ page }) => {
  await page.goto('/ops/');
  await page.waitForTimeout(1200);

  const out = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
    return {
      hasTimeout: typeof withTimeout === 'function',
      bounded: (src.match(/withTimeout\(/g) || []).length,
      leafletGuard: /typeof L === 'undefined'/.test(src),
      needsSignal: typeof needsSignal === 'function',
      // No "today" from a UTC stamp, and no unbounded read left in a loader.
      // Every read that gates a screen, and every write a thumb reaches on a
      // phone, has to be bounded. The desk-only writes are a listed gap.
      unboundedPhoneWrites: (src.match(/await sb\.from\('(?:sales|delivery_assignment|fleet_positions)'\)/g) || []).length,
    };
  });
  console.log(JSON.stringify(out));
  expect(out.hasTimeout).toBe(true);
  expect(out.bounded).toBeGreaterThanOrEqual(8);
  expect(out.leafletGuard, 'the Map tab must not throw without Leaflet').toBe(true);
  expect(out.needsSignal).toBe(true);
  expect(out.unboundedPhoneWrites,
    'a dying signal must not be able to park a button on a phone').toBe(0);

  // Prove the helper does what its name says.
  const raced = await page.evaluate(async () => {
    const never = new Promise(() => {});
    const t0 = Date.now();
    try { await withTimeout(never, 120); return { threw: false, ms: Date.now() - t0 }; }
    catch (e) { return { threw: true, ms: Date.now() - t0, msg: e.message }; }
  });
  console.log(JSON.stringify(raced));
  expect(raced.threw, 'withTimeout must reject a promise that never settles').toBe(true);
  expect(raced.ms).toBeLessThan(600);
  expect(raced.msg).toMatch(/timeout/i);
});
