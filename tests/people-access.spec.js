// People and access — the admin app's user administration page.
//
// This page can reset anybody's password and change who reaches what, so the
// tests care most about the two ways it could be dangerous: showing up for
// somebody who should not have it, and reporting a success for a change the
// database actually refused.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const REP_EMAIL = process.env.TEST_REP_EMAIL || 'test-rep@skelsee.co.zw';
const REP_PASSWORD = process.env.TEST_REP_PASSWORD || '123456';

// The throwaway rep login. Safe to write to and put back; nothing real is
// attached to it.
const GUINEA_PIG = 'Test rep';

// Pre-existing console faults in the admin app, listed in one shared place so
// this spec and customer-report-admin.spec.js cannot disagree about them.
// Anything not on that list still fails these tests.
const { realErrors } = require('./known-noise');

async function signInAdmin(page) {
  await page.goto('/admin/');
  await page.fill('#auth-email', EMAIL);
  await page.fill('#auth-password', PASSWORD);
  await page.click('#auth-btn');
  await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });
}

async function openPeople(page) {
  await page.locator('.admin-tab', { hasText: 'People' }).click();
  await expect(page.locator('#sec-people')).toHaveClass(/active/);
  await expect(page.locator('#ppl-status')).toContainText('people with a login', { timeout: 30000 });
}

test.describe('admin app — People and access', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test('a user administrator gets the tab; everyone is listed', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await signInAdmin(page);
    await expect(page.locator('.admin-tab', { hasText: 'People' })).toHaveCount(1);
    await openPeople(page);

    expect(await page.locator('.ppl-card').count()).toBeGreaterThan(5);
    // Your own card is marked, and cannot be switched off from here.
    await expect(page.locator('.ppl-badge.you')).toHaveCount(1);
    const mine = page.locator('.ppl-card', { has: page.locator('.ppl-badge.you') });
    await expect(mine.locator('.ppl-btn.danger')).toHaveCount(0);

    expect(realErrors(errors), `unexpected errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a rep signing into the admin app gets no People tab at all', async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', REP_EMAIL);
    await page.fill('#auth-password', REP_PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });

    await expect(page.locator('.admin-tab', { hasText: 'People' })).toHaveCount(0);
    // And the section is not merely hidden behind a missing tab — it is not
    // the active one, so navigating to it is not a matter of guessing a URL.
    await expect(page.locator('#sec-people')).not.toHaveClass(/active/);
  });

  test('the tick boxes start out matching exactly what each role can open today',
    async ({ page }) => {
      await signInAdmin(page);
      await openPeople(page);

      // Checked against the module's own table rather than a copy of it, so
      // this stays true if the apps list ever changes.
      const derived = await page.evaluate(() => ({
        rep:      PeopleApp._defaultApps('rep'),
        ops:      PeopleApp._defaultApps('ops'),
        accounts: PeopleApp._defaultApps('accounts'),
        admin:    PeopleApp._defaultApps('admin'),
        // Nothing ticked is NOT the same as nothing set.
        unset:    PeopleApp._appsFor({ role: 'rep', app_access: null }),
        emptied:  PeopleApp._appsFor({ role: 'rep', app_access: [] }),
      }));

      expect(derived.rep.sort()).toEqual(['admin', 'sales']);
      expect(derived.ops.sort()).toEqual(['admin', 'dashboard', 'ops', 'sales']);
      expect(derived.accounts.sort()).toEqual(['accounts', 'admin', 'sales']);
      expect(derived.admin.sort()).toEqual(['accounts', 'admin', 'dashboard', 'ops', 'sales']);
      // This distinction is the whole reason the column is nullable: rolling
      // the feature out must not lock anybody out of anything.
      expect(derived.unset.sort()).toEqual(['admin', 'sales']);
      expect(derived.emptied).toEqual([]);
    });

  test('a tick that the database cannot honour says so instead of failing quietly',
    async ({ page }) => {
      test.setTimeout(120000);
      await signInAdmin(page);
      await openPeople(page);

      const card = page.locator('.ppl-card', { hasText: GUINEA_PIG });
      await expect(card).toHaveCount(1);
      await expect(card.locator('.ppl-warn')).toHaveCount(0);

      try {
        // A rep with the Accounts app ticked would get through the door and
        // then find an empty page, because the database serves accounts data
        // to accounts and admin only.
        await card.locator('.ppl-app', { hasText: 'Accounts' }).locator('input').check();
        await expect(card.locator('.ppl-saved')).toHaveText('saved', { timeout: 20000 });

        const warn = page.locator('.ppl-card', { hasText: GUINEA_PIG }).locator('.ppl-warn');
        await expect(warn).toContainText('Ticked but will show nothing');
        await expect(warn).toContainText('Accounts');
        await expect(warn).toContainText('accounts');
      } finally {
        // Put it back to "not set", whatever happened above.
        await page.evaluate(async (name) => {
          const { data } = await sb.from('profiles').select('id').eq('full_name', name).maybeSingle();
          if (data) await sb.from('profiles').update({ app_access: null }).eq('id', data.id);
        }, GUINEA_PIG);
      }
    });

  test('a change the database refuses is reported, not swallowed', async ({ page }) => {
    await signInAdmin(page);
    await openPeople(page);

    // Row-level security refuses an UPDATE by matching zero rows and
    // reporting NO error, so a naive save would show a cheerful "saved" for a
    // change that never happened. Forcing that exact shape proves the page
    // treats an empty result as the failure it is.
    //
    // It has to be a REAL person: toggleApp looks the id up in its own list
    // first and returns straight away if it is not there, so a made-up id
    // would never reach the save at all and the test would pass vacuously.
    // Nothing is written either way - the stub replaces the update.
    const id = await page.evaluate(async (name) => {
      const { data } = await sb.from('profiles').select('id').eq('full_name', name).maybeSingle();
      return data ? data.id : null;
    }, GUINEA_PIG);
    expect(id, 'the throwaway test login should exist').toBeTruthy();

    await page.evaluate(async (id) => {
      const orig = sb.from.bind(sb);
      sb.from = (t) => {
        const q = orig(t);
        if (t !== 'profiles') return q;
        q.update = () => ({
          eq: () => ({ select: async () => ({ data: [], error: null }) }),
        });
        return q;
      };
      try { await PeopleApp.toggleApp(id, 'ops', true); } catch (e) { /* shown on the card */ }
      sb.from = orig;
    }, id);

    // The failure has to be visible on the person's own card, not just logged.
    await expect(page.locator('#ppl-saved-' + id))
      .toContainText(/would not accept it|user administrator/, { timeout: 10000 });
  });

  test('promoting somebody to full administrator asks first', async ({ page }) => {
    await signInAdmin(page);
    await openPeople(page);

    let asked = '';
    page.on('dialog', d => { asked = d.message(); d.dismiss(); });

    const card = page.locator('.ppl-card', { hasText: GUINEA_PIG });
    await card.locator('.ppl-role').selectOption('admin');
    await page.waitForTimeout(1500);

    expect(asked).toContain('full administrator');
    expect(asked).toContain('every sale');
    // Dismissed, so nothing changed.
    const role = await page.evaluate(async (name) => {
      const { data } = await sb.from('profiles').select('role').eq('full_name', name).maybeSingle();
      return data ? data.role : null;
    }, GUINEA_PIG);
    expect(role).toBe('rep');
  });

  test('a short password is refused before anything leaves the browser', async ({ page }) => {
    await signInAdmin(page);
    await openPeople(page);

    // The button is correctly disabled until manage-users is deployed, so the
    // dialog is opened through the module instead. What is under test is the
    // length check, which happens in the browser and needs no function.
    const id = await page.evaluate(async (name) => {
      const { data } = await sb.from('profiles').select('id').eq('full_name', name).maybeSingle();
      return data ? data.id : null;
    }, GUINEA_PIG);
    await page.evaluate((id) => PeopleApp.openPw(id), id);
    await expect(page.locator('#pplpw')).toHaveClass(/on/);

    await page.fill('#pplpw-value', 'short');
    await page.click('#pplpw-save');
    await expect(page.locator('#pplpw-err')).toContainText('At least 8 characters');
    // Still open, nothing sent.
    await expect(page.locator('#pplpw')).toHaveClass(/on/);

    await page.click('#pplpw .ppl-btn');
    await expect(page.locator('#pplpw')).not.toHaveClass(/on/);
    // The typed password must not be left sitting in the field for whoever
    // opens this screen next.
    await expect(page.locator('#pplpw-value')).toHaveValue('');
  });

  test('the page scrolls, and the last person can actually be reached', async ({ page }) => {
    await signInAdmin(page);
    await openPeople(page);

    // .admin-section.active is a flex column, so without flex-shrink:0 on the
    // panels they are squashed to fit the screen rather than overflowing it,
    // and overflow:hidden then clips the list with no scrollbar to recover
    // it. Measuring is the only honest test: a screenshot of the top looks
    // identical whether the page scrolls or not.
    const m = await page.evaluate(() => {
      const s = document.getElementById('sec-people');
      return { client: s.clientHeight, scroll: s.scrollHeight };
    });
    expect(m.scroll, 'the content does not overflow, so nothing can scroll')
      .toBeGreaterThan(m.client + 2);

    const reached = await page.evaluate(() => {
      const s = document.getElementById('sec-people');
      s.scrollTop = s.scrollHeight;
      const cards = document.querySelectorAll('.ppl-card');
      const r = cards[cards.length - 1].getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 1;
    });
    expect(reached, 'the last person is still off screen at full scroll').toBe(true);
    // The change log sits below everyone, so it is the real end of the page.
    await expect(page.locator('#ppl-audit')).toBeVisible();
  });

  test('every handler on this page carries its module prefix', async ({ page }) => {
    await signInAdmin(page);
    await openPeople(page);

    // In this app an inline handler without its module prefix looks perfectly
    // fine and does absolutely nothing when clicked.
    const handlers = await page.$$eval(
      '#sec-people [onclick], #sec-people [onchange], #pplpw [onclick], #ppladd [onclick]',
      els => els.map(e => e.getAttribute('onclick') || e.getAttribute('onchange')));
    expect(handlers.length).toBeGreaterThan(5);
    for (const h of handlers) expect(h).toContain('PeopleApp.');
  });
});
