// The front door on each of the five apps.
//
// This is the riskiest change in the People-page work: get it wrong and real
// staff cannot sign in on a Monday morning. So the first and most important
// tests are simply that nothing changed for anybody, and only then that the
// tick boxes actually bite.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const REP_EMAIL = process.env.TEST_REP_EMAIL || 'test-rep@skelsee.co.zw';
const REP_PASSWORD = process.env.TEST_REP_PASSWORD || '123456';

const GUINEA_PIG = 'Test rep';

// How each app's sign-in screen is built. They were written at different
// times and no two of them share a login form.
const APPS = {
  sales:     { path: '/',           email: '#auth-email', pw: '#auth-password',
               submit: null, in: '#screen-app.active', err: '#auth-err' },
  admin:     { path: '/admin/',     email: '#auth-email', pw: '#auth-password',
               submit: '#auth-btn', in: '#admin-shell.active', err: '#auth-err' },
  accounts:  { path: '/accounts/',  email: '#acc-email',  pw: '#acc-password',
               submit: '.auth-wrap .btn-primary', in: '#acc-wrap.active', err: '#acc-err' },
  ops:       { path: '/ops/',       email: '#em',         pw: '#pw',
               submit: null, in: '#app.active', err: '#err' },
  dashboard: { path: '/dashboard/', email: '#dash-email', pw: '#dash-password',
               submit: null, in: '#dash-wrap.active', err: '#dash-err' },
};

// Each attempt gets its OWN browser context. Sharing one page across apps
// does not work: a successful sign-in leaves a live session behind, so the
// next app auto-enters and its login form is never visible to fill in. The
// rep app's cached_profile in localStorage would leak across too.
async function tryApp(browser, key, email, password) {
  const a = APPS[key];
  const ctx = await browser.newContext({ timezoneId: 'Africa/Harare' });
  const page = await ctx.newPage();
  try {
    await page.goto(a.path);
    await page.fill(a.email, email);
    await page.fill(a.pw, password);
    if (a.submit) await page.click(a.submit);
    else await page.getByRole('button', { name: /sign in/i }).first().click();

    // Either we land inside, or an error appears. Watching for both at once
    // is what makes a failure here readable instead of just a timeout.
    const landed = page.locator(a.in).first();
    const errEl = page.locator(a.err);
    for (let i = 0; i < 40; i++) {
      if (await landed.count() && await landed.isVisible().catch(() => false)) {
        return { in: true, err: '' };
      }
      const msg = (await errEl.textContent().catch(() => '')) || '';
      if (msg.trim() && !/signing in/i.test(msg)) return { in: false, err: msg.trim() };
      await page.waitForTimeout(400);
    }
    return { in: false, err: '(nothing happened at all)' };
  } finally {
    await ctx.close();
  }
}

// Runs a piece of database work signed in as the test administrator, in its
// own context so it never disturbs whatever a test is doing.
async function asAdmin(browser, fn) {
  const ctx = await browser.newContext({ timezoneId: 'Africa/Harare' });
  const page = await ctx.newPage();
  try {
    await page.goto('/accounts/');
    await page.fill('#acc-email', EMAIL);
    await page.fill('#acc-password', PASSWORD);
    await page.click('.auth-wrap .btn-primary');
    await page.waitForSelector('#acc-wrap.active', { timeout: 20000 });
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

const setAccess = (browser, name, patch) => asAdmin(browser, (page) =>
  page.evaluate(async ({ name, patch }) => {
    const { data } = await sb.from('profiles').select('id').eq('full_name', name).maybeSingle();
    if (!data) return false;
    const r = await sb.from('profiles').update(patch).eq('id', data.id).select('id');
    return !!(r.data && r.data.length);
  }, { name, patch }));

// Always put the guinea pig back, whatever a test did to it. It is shared
// with sales.spec.js, so leaving it locked out would break another spec.
const restore = (browser, name) => setAccess(browser, name, { app_access: null, active: true });

test.describe('front door on every app', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test('nobody was locked out: an administrator still opens all five', async ({ browser }) => {
    test.setTimeout(180000);
    for (const key of ['sales', 'admin', 'accounts', 'ops', 'dashboard']) {
      const r = await tryApp(browser, key, EMAIL, PASSWORD);
      expect(r.in, `an administrator was refused by ${key}: ${r.err}`).toBe(true);
    }
  });

  test('nobody was locked out: a rep still opens exactly what they did before',
    async ({ browser }) => {
      test.setTimeout(180000);
      // A rep could always open the sales app and the admin app, and was
      // always refused the other three by their role. That must be unchanged.
      for (const key of ['sales', 'admin']) {
        const r = await tryApp(browser, key, REP_EMAIL, REP_PASSWORD);
        expect(r.in, `a rep was refused by ${key}: ${r.err}`).toBe(true);
      }
      for (const key of ['accounts', 'ops', 'dashboard']) {
        const r = await tryApp(browser, key, REP_EMAIL, REP_PASSWORD);
        expect(r.in, `a rep got into ${key}, which should never happen`).toBe(false);
      }
    });

  test('unticking an app actually shuts that door', async ({ browser }) => {
    test.setTimeout(180000);
    try {
      // Everything except the sales app. Written straight to the column
      // rather than through the page, so this tests the door and not the UI.
      const ok = await setAccess(browser, GUINEA_PIG, { app_access: ['sales'] });
      expect(ok, 'could not set app_access — is phase_e2 run?').toBe(true);

      const sales = await tryApp(browser, 'sales', REP_EMAIL, REP_PASSWORD);
      expect(sales.in, `the ticked app was refused: ${sales.err}`).toBe(true);

      // The admin app is not ticked, so it must refuse — even though their
      // ROLE still allows it. That is the entire point of the tick box.
      const adminApp = await tryApp(browser, 'admin', REP_EMAIL, REP_PASSWORD);
      expect(adminApp.in, 'an unticked app still opened').toBe(false);
    } finally {
      await restore(browser, GUINEA_PIG);
    }
  });

  test('switching a login off stops it everywhere', async ({ browser }) => {
    test.setTimeout(180000);
    try {
      await setAccess(browser, GUINEA_PIG, { active: false });

      const sales = await tryApp(browser, 'sales', REP_EMAIL, REP_PASSWORD);
      expect(sales.in).toBe(false);
      expect(sales.err).toMatch(/switched off/i);

      const adminApp = await tryApp(browser, 'admin', REP_EMAIL, REP_PASSWORD);
      expect(adminApp.in).toBe(false);
    } finally {
      await restore(browser, GUINEA_PIG);
    }
  });

  test('a reload does not walk back in through a shut door', async ({ browser }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext({ timezoneId: 'Africa/Harare' });
    const page = await ctx.newPage();
    try {
      await page.goto('/accounts/');
      await page.fill('#acc-email', EMAIL);
      await page.fill('#acc-password', PASSWORD);
      await page.click('.auth-wrap .btn-primary');
      await expect(page.locator('#acc-wrap')).toHaveClass(/active/, { timeout: 20000 });

      // Shut this administrator's own accounts door from inside, then reload.
      // The session is still perfectly valid; the door is not.
      await page.evaluate(async () => {
        const me = (await sb.auth.getUser()).data.user;
        await sb.from('profiles').update({ app_access: ['admin'] }).eq('id', me.id);
      });
      await page.reload();
      await page.waitForTimeout(5000);
      await expect(page.locator('#acc-wrap')).not.toHaveClass(/active/);
    } finally {
      // Put the test administrator back, or every other spec stops working.
      await page.evaluate(async () => {
        const me = (await sb.auth.getUser()).data.user;
        if (me) await sb.from('profiles').update({ app_access: null, active: true }).eq('id', me.id);
      }).catch(() => {});
      await ctx.close();
      await asAdmin(browser, (p) => p.evaluate(async () => {
        const me = (await sb.auth.getUser()).data.user;
        await sb.from('profiles').update({ app_access: null, active: true }).eq('id', me.id);
      })).catch(() => {});
    }
  });

  test('everyone is left exactly as they started', async ({ browser }) => {
    const state = await asAdmin(browser, (page) => page.evaluate(async () => {
      const { data } = await sb.from('profiles').select('full_name,app_access,active');
      return {
        restricted: (data || []).filter(p => p.app_access !== null).map(p => p.full_name),
        off: (data || []).filter(p => p.active === false).map(p => p.full_name),
      };
    }));
    expect(state.restricted, 'a test left somebody with restricted access').toEqual([]);
    expect(state.off, 'a test left somebody switched off').toEqual([]);
  });
});
