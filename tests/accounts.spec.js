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

  test('Customer retention search filters the chase table with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.click('#vt-retention');
    await expect(page.locator('#view-retention')).toBeVisible();
    await expect(page.locator('#retention-body')).not.toContainText('Loading…', { timeout: 15000 });

    await page.fill('#ret-search', 'zzz-no-such-customer-zzz');
    await expect(page.locator('#retention-body')).toContainText('No customer matches that search.');

    await page.fill('#ret-search', '');
    await expect(page.locator('#retention-body')).not.toContainText('No customer matches that search.');

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('Weekly forecast tab loads with no console errors', async ({ page }) => {
    const errors = [];
    let missingSnapshotTable404s = 0;
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('response', (res) => {
      if (res.status() === 404 && res.url().includes('weekly_forecast_snapshots')) missingSnapshotTable404s++;
    });

    await page.click('#vt-forecast');
    await expect(page.locator('#view-forecast')).toBeVisible();
    // Must land on a real Monday — used to silently drift to the wrong
    // week for anyone in a positive-UTC-offset timezone (e.g. Harare)
    // because the date helper used toISOString(), which converts to UTC
    // first. Checked via noon-UTC so the assertion itself is timezone-safe.
    await expect(page.locator('#fc-week-start')).not.toHaveValue('', { timeout: 15000 });
    const weekStartValue = await page.locator('#fc-week-start').inputValue();
    const weekday = new Date(weekStartValue + 'T12:00:00Z').getUTCDay();
    expect(weekday, `#fc-week-start (${weekStartValue}) should be a Monday`).toBe(1);
    await expect(page.locator('#fc-deliveries-body')).not.toContainText('Loading…', { timeout: 15000 });
    await expect(page.locator('#fc-fuel-body')).not.toContainText('Loading…');
    await expect(page.locator('#fc-cash-confirmed-body')).not.toContainText('Loading…');
    await expect(page.locator('#fc-cash-predicted-body')).not.toContainText('Loading…');
    // Forecast-vs-actual chart: resolves to either the empty state (no
    // history yet) or a rendered SVG once at least one week is saved —
    // not asserting which, since that depends on whether the
    // weekly_forecast_snapshots migration has been run and how many
    // weeks have accumulated.
    await expect(page.locator('#fc-history-chart')).not.toContainText('Loading…', { timeout: 15000 });

    // weekly_forecast_snapshots won't exist until the phase_b7 migration
    // is run — until then, its 404s surface as generic browser "Failed to
    // load resource" console entries (the app itself handles the missing
    // table gracefully, no thrown exception). Allow only exactly as many
    // generic resource-load errors as confirmed 404s against that one
    // table, so any other unexpected error — including a 404 on some
    // other resource — still fails this test. Once the migration is run,
    // this collapses back to "zero errors allowed" on its own.
    const genericLoadErrors = errors.filter(e => e.includes('Failed to load resource'));
    const otherErrors = errors.filter(e => !e.includes('Failed to load resource'));
    expect(otherErrors, `console/page errors:\n${otherErrors.join('\n')}`).toEqual([]);
    expect(genericLoadErrors.length,
      `expected at most ${missingSnapshotTable404s} generic resource-load errors (weekly_forecast_snapshots not migrated yet), got ${genericLoadErrors.length}:\n${genericLoadErrors.join('\n')}`
    ).toBeLessThanOrEqual(missingSnapshotTable404s);
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
