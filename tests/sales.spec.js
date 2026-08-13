// Sales section tests (Phase 4 port) — the rep-facing app, with its
// distinctive offline-queue + PIN-lock behavior. Needs a SEPARATE
// role='rep' test account (TEST_REP_EMAIL/TEST_REP_PASSWORD) — the
// test-admin account used by the other spec files doesn't exercise the
// PIN/offline path meaningfully since admin never sees the lock screen.
// Also runs a couple of admin-role checks (admin gets the Sales tab too)
// using the existing TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD.
const { test, expect } = require('@playwright/test');

const REP_EMAIL = process.env.TEST_REP_EMAIL;
const REP_PASSWORD = process.env.TEST_REP_PASSWORD;
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

test.describe('admin app — Sales section (rep role)', () => {
  test.skip(!REP_EMAIL || !REP_PASSWORD, 'TEST_REP_EMAIL / TEST_REP_PASSWORD not set — see tests/README.md');

  test('rep login lands directly on the Sales tab, only tab visible, no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto('/admin/');
    await page.fill('#auth-email', REP_EMAIL);
    await page.fill('#auth-password', REP_PASSWORD);
    await page.click('#auth-btn');

    await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });
    await expect(page.locator('#sec-sales')).toHaveClass(/active/);
    await expect(page.locator('.admin-tab')).toHaveCount(1);
    await expect(page.locator('.admin-tab')).toContainText('Sales');

    // Record tab is the default and should load with no errors.
    await expect(page.locator('#tab-record')).toHaveClass(/active/);
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('reloading after login shows the PIN lock screen (offline-first boot)', async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', REP_EMAIL);
    await page.fill('#auth-password', REP_PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#sec-sales')).toHaveClass(/active/, { timeout: 15000 });

    // Reload — this is what happens every time a rep reopens the app/PWA.
    // startupFromCache() should detect the cached rep identity and show the
    // PIN screen immediately, without needing email/password again.
    await page.reload();
    await expect(page.locator('#lock-screen')).toHaveClass(/active/, { timeout: 10000 });
    await expect(page.locator('#auth-wrap')).toHaveClass(/hidden/);
  });

  test('default PIN (123456) unlocks the app and lands on Sales', async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', REP_EMAIL);
    await page.fill('#auth-password', REP_PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#sec-sales')).toHaveClass(/active/, { timeout: 15000 });

    await page.reload();
    await expect(page.locator('#lock-screen')).toHaveClass(/active/, { timeout: 10000 });

    // Type the default PIN unless this account already changed it.
    for (const digit of ['1','2','3','4','5','6']) {
      await page.click(`.lock-key >> text="${digit}"`);
    }
    await expect(page.locator('#lock-screen')).not.toHaveClass(/active/, { timeout: 10000 });
    await expect(page.locator('#sec-sales')).toHaveClass(/active/);
  });

  test('a sale recorded while offline queues locally and shows in the Sales list', async ({ page, context }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', REP_EMAIL);
    await page.fill('#auth-password', REP_PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#sec-sales')).toHaveClass(/active/, { timeout: 15000 });
    // adminSignIn()'s click handler is async — SalesApp.loadUser() (customer
    // list, place list, and its own loadSales() call) is all still running
    // in the background after the click event itself resolves. The badge
    // starts as static markup ("Ready"), so waiting for it to merely change
    // away from "Syncing..." resolves instantly and doesn't prove anything.
    // Wait for it to actually reach "Synced" — set only once loadUser()'s
    // own loadSales() call has fetched from Supabase and written the
    // admin_sales_cache_<uid> localStorage key that a later offline
    // loadSales() call depends on to render anything at all.
    await expect(page.locator('#sync-badge')).toContainText('Synced', { timeout: 15000 });

    await context.setOffline(true);
    try {
      const custName = 'Playwright Test Customer ' + Date.now();
      await page.fill('#s-customer', custName);
      await page.fill('#s-litres', '1234');
      await page.fill('#s-price', '1.50');
      await page.click('#submit-btn');

      // recordSale() queues offline and switches to the Sales tab itself.
      await expect(page.locator('#sales-list')).toContainText(custName, { timeout: 10000 });
      await expect(page.locator('#sales-list')).toContainText('Saved on this phone');
      // The list above updates almost immediately (renderSales() runs off
      // cached data before any network call). The badge only catches up
      // once loadSales()'s online fetch actually gives up — it's wrapped in
      // withTimeout(..., 10000), and Chromium's simulated offline mode
      // doesn't fail instantly, so this can take close to the full 10s.
      await expect(page.locator('#sync-badge')).toContainText('to upload', { timeout: 15000 });
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe('admin app — Sales tab as admin', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test('admin sees Sales as a 4th tab alongside the other three', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto('/admin/');
    await page.fill('#auth-email', ADMIN_EMAIL);
    await page.fill('#auth-password', ADMIN_PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });

    const tabs = page.locator('.admin-tab');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.last()).toContainText('Sales');

    await tabs.last().click();
    await expect(page.locator('#sec-sales')).toHaveClass(/active/);
    await expect(page.locator('#tab-record')).toHaveClass(/active/);

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
