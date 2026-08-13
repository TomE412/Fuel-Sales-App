// Accounts section tests (Phase 2 port) — needs the same admin test login
// as auth.spec.js. Skips itself if credentials aren't set.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;

test.describe('admin app — Accounts section', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });
    await page.locator('.admin-tab', { hasText: 'Accounts' }).click();
    await expect(page.locator('#sec-accounts')).toHaveClass(/active/);
  });

  test('sales tracker loads with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await expect(page.locator('#track-body')).not.toContainText('Loading...', { timeout: 15000 });
    // Clock should be ticking (not stuck at the static placeholder).
    await expect(page.locator('#acc-clock')).not.toHaveText('00:00');

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('switching to Customer retention lazy-loads its data', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.click('#vt-retention');
    await expect(page.locator('#view-retention')).toBeVisible();
    await expect(page.locator('#retention-body')).not.toContainText('Loading…', { timeout: 15000 });
    // Summary counts should have resolved to real numbers, not stay blank.
    await expect(page.locator('#r-quiet')).not.toHaveText('');

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('switching to By rep lazy-loads its data', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.click('#vt-reps');
    await expect(page.locator('#view-reps')).toBeVisible();
    await expect(page.locator('#gap-groups')).not.toContainText('Loading…', { timeout: 15000 });

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('view tabs switch which view is displayed', async ({ page }) => {
    await page.click('#vt-retention');
    await expect(page.locator('#view-retention')).toBeVisible();
    await expect(page.locator('#view-tracker')).toBeHidden();

    await page.click('#vt-reps');
    await expect(page.locator('#view-reps')).toBeVisible();
    await expect(page.locator('#view-retention')).toBeHidden();

    await page.click('#vt-tracker');
    await expect(page.locator('#view-tracker')).toBeVisible();
    await expect(page.locator('#view-reps')).toBeHidden();
  });
});
