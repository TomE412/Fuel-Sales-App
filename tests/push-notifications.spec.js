const { test, expect } = require('@playwright/test');

// Phase D7 — the buzz on a shut phone.
//
// The sending half runs on Supabase and cannot be tested from here. What CAN
// be tested is everything that decides whether a rep ever gets that far: the
// key in the app, what the card tells them in each of the five situations it
// has to handle, the service worker's behaviour when a push arrives with no
// payload, and — most important — that a failed push can never break the
// thing the office was actually doing.

test.describe('rep app: turning notifications on', () => {

  test('the card and its workings are on the page', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    expect(await page.locator('#push-card').count(), 'card missing').toBe(1);
    expect(await page.locator('#push-btn').count(), 'button missing').toBe(1);
    expect(await page.locator('#push-test').count(), 'test button missing').toBe(1);

    for (const fn of ['renderPushCard','pushButtonTapped','disablePush','sendTestPush',
                      'vapidKeyBytes','pushSupported','pushIsIOS','pushInstalled','pushDeviceLabel']) {
      expect(await page.evaluate(n => typeof window[n], fn), fn).toBe('function');
    }
    expect(errs).toEqual([]);
  });

  test('the signing key in the app is a real one', async ({ page }) => {
    // A truncated or mistyped key produces a subscribe() that fails on the
    // phone with nothing useful said, so check the shape here instead: a
    // P-256 public key is 65 bytes and starts with 0x04 (uncompressed point).
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const bytes = vapidKeyBytes(VAPID_PUBLIC_KEY);
      return { length: bytes.length, first: bytes[0], keyChars: VAPID_PUBLIC_KEY.length,
               hasPadding: /[=+/]/.test(VAPID_PUBLIC_KEY) };
    });
    console.log(JSON.stringify(out, null, 1));

    expect(out.length, 'a P-256 public key is 65 bytes').toBe(65);
    expect(out.first, 'must be an uncompressed point (0x04)').toBe(4);
    expect(out.keyChars).toBe(87);
    // base64url, not plain base64 — the browser rejects the other alphabet
    expect(out.hasPadding, 'must be base64url with no padding').toBe(false);
  });

  test('an iPhone that has not installed the app is told what to do', async ({ page }) => {
    // This is the single most likely way for a rep to conclude the feature is
    // broken: on iOS, web notifications do not work at all until the app is
    // on the Home Screen. Offering a button that cannot possibly work is
    // worse than offering none.
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(async () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ' +
               '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        configurable: true,
      });
      await renderPushCard();
      return {
        isIOS:    pushIsIOS(),
        state:    document.getElementById('push-state').innerHTML,
        btnShown: document.getElementById('push-btn').style.display !== 'none',
        extra:    document.getElementById('push-extra').style.display !== 'none',
      };
    });
    console.log(JSON.stringify(out, null, 1));

    expect(out.isIOS).toBe(true);
    expect(out.state).toContain('Home Screen');
    expect(out.state).toContain('Share');
    expect(out.btnShown, 'no button that cannot work').toBe(false);
    expect(out.extra).toBe(false);
    expect(errs).toEqual([]);
  });

  test('a rep who already said no is told how to undo it', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(async () => {
      Object.defineProperty(Notification, 'permission', { value: 'denied', configurable: true });
      await renderPushCard();
      return {
        state:    document.getElementById('push-state').innerHTML,
        btnShown: document.getElementById('push-btn').style.display !== 'none',
      };
    });
    console.log(JSON.stringify(out, null, 1));

    expect(out.state).toContain('blocked');
    // The app genuinely cannot re-ask once denied — it must say so rather
    // than show a button that silently does nothing.
    expect(out.state).toContain('cannot ask you again');
    expect(out.btnShown).toBe(false);
    expect(errs).toEqual([]);
  });

  test('on and off read correctly once it is working', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(async () => {
      Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true });
      const reg = await navigator.serviceWorker.ready;

      // pretend this phone is subscribed
      reg.pushManager.getSubscription = async () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        toJSON: () => ({ endpoint:'https://fcm.googleapis.com/fcm/send/abc123',
                         keys: { p256dh:'p', auth:'a' } }),
      });
      await renderPushCard();
      const on = {
        state:    document.getElementById('push-state').innerHTML,
        btnShown: document.getElementById('push-btn').style.display !== 'none',
        extra:    document.getElementById('push-extra').style.display !== 'none',
      };

      // ...and now it is not
      reg.pushManager.getSubscription = async () => null;
      await renderPushCard();
      const off = {
        state:    document.getElementById('push-state').innerHTML,
        btnLabel: document.getElementById('push-btn').textContent,
        btnShown: document.getElementById('push-btn').style.display !== 'none',
        extra:    document.getElementById('push-extra').style.display !== 'none',
      };
      return { on, off };
    });
    console.log(JSON.stringify(out, null, 1));

    expect(out.on.state).toContain('On for this phone');
    expect(out.on.btnShown, 'nothing left to turn on').toBe(false);
    expect(out.on.extra, 'the test and off controls should appear').toBe(true);

    expect(out.off.state).toContain('Off');
    expect(out.off.btnShown).toBe(true);
    expect(out.off.btnLabel).toBe('Turn on notifications');
    expect(out.off.extra).toBe(false);

    // Both states must say the bell still works, so nobody thinks turning
    // this off means they stop being told anything at all.
    expect(out.off.state.toLowerCase()).toContain('bell');
    expect(errs).toEqual([]);
  });
});

test.describe('the service worker shows something useful', () => {

  test('a push with nothing in it still says something sensible', async ({ page }) => {
    // A push service is allowed to wake a worker with no payload at all, and
    // a worker that throws shows the browser's own "this site was updated in
    // the background" notice instead — which looks broken to a rep.
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(async () => {
      const src = await (await fetch('sw.js')).text();
      const made = [];
      const listeners = {};
      const fakeSelf = {
        addEventListener: (k, fn) => { listeners[k] = fn; },
        registration: { showNotification: (title, opts) => { made.push({ title, opts });
                                                             return Promise.resolve(); } },
        clients: { matchAll: async () => [], openWindow: async () => {} },
        skipWaiting(){}, clients_claim(){},
      };
      // Run the worker's source with a stand-in `self` so its listeners can
      // be called directly. Only consts and addEventListener run at the top.
      new Function('self', 'caches', 'fetch', src)(fakeSelf, window.caches, window.fetch.bind(window));

      const ran = [];
      const fire = (data) => listeners.push({ data, waitUntil: p => ran.push(p) });

      fire(null);                                                   // no payload at all
      fire({ json: () => { throw new Error('not json'); },           // junk payload
             text: () => 'something happened' });
      fire({ json: () => ({ title:'On its way', body:'Khaya Cement  ·  40,000 L',
                            tag:'skelsee-sale-12', url:'/Fuel-Sales-App/', sale_id:12 }) });

      await Promise.all(ran);
      return { made, handlers: Object.keys(listeners).sort() };
    });
    console.log(JSON.stringify(out, null, 1));

    expect(out.handlers).toContain('push');
    expect(out.handlers).toContain('notificationclick');
    expect(out.made.length, 'every push must show something').toBe(3);

    // no payload -> a sensible fallback, never a blank or a crash
    expect(out.made[0].title).toBe('Fuel Sales');
    expect(out.made[0].opts.body).toContain('one of your loads');
    // junk payload -> fall back to the plain text
    expect(out.made[1].opts.body).toBe('something happened');
    // a proper one -> the office's words, and a tag so three updates on one
    // load replace each other rather than stacking up
    expect(out.made[2].title).toBe('On its way');
    expect(out.made[2].opts.body).toContain('Khaya Cement');
    expect(out.made[2].opts.tag).toBe('skelsee-sale-12');
    expect(out.made[2].opts.data.sale_id).toBe(12);

    expect(errs).toEqual([]);
  });
});

test.describe('a failed push cannot break the office', () => {

  test('no office action ever waits on a push', async () => {
    // The guarantee above only holds if nobody awaits it. Checked against the
    // source rather than at runtime, because an `await notifyRep(...)` added
    // later would pass every behavioural test right up until Supabase is slow.
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    for (const rel of ['dashboard/index.html', 'admin/index.html']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const calls = src.match(/^.*notifyRep\s*\(.*$/gm) || [];
      console.log(rel + ': ' + calls.length + ' lines mentioning notifyRep');
      expect(calls.length, rel + ' should call it').toBeGreaterThanOrEqual(3);
      for (const line of calls) {
        expect(line, rel + ': must not be awaited -> ' + line.trim()).not.toMatch(/await\s+notifyRep/);
        expect(line, rel + ': must not be returned -> ' + line.trim()).not.toMatch(/return\s+notifyRep/);
      }
    }
  });

  for (const [app, url] of [['dashboard', '/dashboard/'], ['admin', '/admin/']]) {

    test(`${app}: notifyRep swallows everything`, async ({ page }) => {
      // The whole point: the rep's in-app bell comes from the data and owes
      // nothing to this call. If notify-rep was never deployed, or Supabase
      // is down, the office's assign / en route / delivered must still work.
      const errs = [];
      page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
      await page.goto(url);
      await page.waitForTimeout(2500);

      const out = await page.evaluate(async () => {
        const logs = [];
        const origLog = console.log;
        console.log = (...a) => { logs.push(a.map(String).join(' ')); };
        let threw = null, returned = 'not called';

        // Nothing is stubbed here. sb.functions is a getter on supabase-js, so
        // a stub silently does not take and the real network call goes out
        // anyway — a test that looked like it was checking a fake failure was
        // really checking nothing at all. This calls it for real: notify-rep
        // either is not deployed, or answers "no such sale" for sale 0.
        try {
          returned = notifyRep(0, 'assigned');
        } catch (e) { threw = e.message; }

        // It must come straight back. An office action waiting on a push is
        // the whole failure mode this exists to prevent.
        const immediate = returned === undefined;
        await new Promise(r => setTimeout(r, 4000));

        console.log = origLog;
        return { threw, immediate, logs: logs.filter(l => l.indexOf('push') === 0) };
      });
      console.log(app + ' ' + JSON.stringify(out, null, 1));

      // Nothing escapes to the caller.
      expect(out.threw, 'notifyRep must never throw at its caller').toBeNull();
      expect(out.immediate, 'notifyRep must return at once, not a promise to await').toBe(true);
      // ...but it is not silent either. Whatever happened — not deployed, no
      // such sale, refused — there has to be a line in the log about it.
      expect(out.logs.length, 'the outcome should be logged').toBeGreaterThanOrEqual(1);
      expect(out.logs.join(' ')).toMatch(/push (not sent|skipped)/);

      expect(errs).toEqual([]);
    });
  }
});
