// Logistics section tests (Phase 3 port) — needs the same admin test login
// as auth.spec.js/accounts.spec.js. Skips itself if credentials aren't set.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;

test.describe('admin app — Logistics section', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });
    await page.locator('.admin-tab', { hasText: 'Logistics' }).click();
    await expect(page.locator('#sec-logistics')).toHaveClass(/active/);
  });

  test('dash (today) loads with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await expect(page.locator('#log-today-list')).not.toContainText('Loading…', { timeout: 15000 });
    await expect(page.locator('#ripe-list')).not.toContainText('Loading…', { timeout: 15000 });

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('5 sub-tabs are present and switch pages', async ({ page }) => {
    const tabs = page.locator('#sec-logistics .mtab');
    await expect(tabs).toHaveCount(5);

    await page.click('#sec-logistics .mtab:has-text("Routes")');
    await expect(page.locator('#p-routes')).toHaveClass(/active/);

    await page.click('#sec-logistics .mtab:has-text("Book")');
    await expect(page.locator('#p-book')).toHaveClass(/active/);
    await expect(page.locator('#bk-body')).not.toContainText('Loading…', { timeout: 15000 });

    await page.click('#sec-logistics .mtab:has-text("Settings")');
    await expect(page.locator('#p-set')).toHaveClass(/active/);
  });

  test('map initializes with no console errors and shows layer toggles', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.click('#sec-logistics .mtab:has-text("Map")');
    await expect(page.locator('#p-map')).toHaveClass(/active/);
    // Leaflet stamps its own class onto the map container once initialized.
    await expect(page.locator('#map.leaflet-container')).toBeVisible({ timeout: 10000 });
    // The 7 layer toggles (5 status + farmer + mine prospects) from earlier
    // this session's map-layers work should render into #legend.
    await expect(page.locator('#legend .lg')).toHaveCount(7);

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('switching away from and back to an already-open Map tab does not error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.click('#sec-logistics .mtab:has-text("Map")');
    await expect(page.locator('#map.leaflet-container')).toBeVisible({ timeout: 10000 });

    // Leave Logistics entirely (outer admin shell switch), then come back —
    // this is the scenario that needed the extra invalidateSize() hook,
    // since the standalone ops app never had an outer tab to hide behind.
    await page.locator('.admin-tab', { hasText: 'Overview' }).click();
    await expect(page.locator('#sec-overview')).toHaveClass(/active/);
    await page.locator('.admin-tab', { hasText: 'Logistics' }).click();
    await expect(page.locator('#sec-logistics')).toHaveClass(/active/);
    await expect(page.locator('#p-map')).toHaveClass(/active/);

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
