// Authenticated tests — need a real Supabase login to exercise role-gated
// UI (nav tabs, section switching, live data rendering). Reads credentials
// from environment variables so nothing sensitive is ever committed to the
// repo. Skips itself entirely if they're not set, rather than failing —
// see tests/README.md for how to provide them.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;

test.describe('admin app — logged in as admin', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });
  });

  test('admin role sees all three nav tabs', async ({ page }) => {
    const tabs = page.locator('.admin-tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText('Overview');
    await expect(tabs.nth(1)).toContainText('Accounts');
    await expect(tabs.nth(2)).toContainText('Logistics');
  });

  test('Overview section loads real data with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    // fetchData()/loadDueSoon() are async — give them a moment, then confirm
    // the "Loading…" placeholder cleared (real data or an explicit empty
    // state, either is fine — stuck "Loading…" means the query never returned).
    await expect(page.locator('#due-list')).not.toContainText('Loading…', { timeout: 15000 });
    await expect(page.locator('#clock')).not.toHaveText('00:00:00');

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('clicking each visible tab switches the active section', async ({ page }) => {
    const tabs = page.locator('.admin-tab');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click();
      const label = await tabs.nth(i).textContent();
      await expect(tabs.nth(i)).toHaveClass(/active/);
      // Exactly one section should be visible at a time.
      await expect(page.locator('.admin-section.active')).toHaveCount(1);
    }
  });

  test('sign out returns to the login screen', async ({ page }) => {
    await page.click('.signout');
    await expect(page.locator('#auth-wrap')).not.toHaveClass(/hidden/);
    await expect(page.locator('#admin-shell')).not.toHaveClass(/active/);
  });
});
