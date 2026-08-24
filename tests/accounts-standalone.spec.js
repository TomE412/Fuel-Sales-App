// Standalone Accounts app (/accounts/) tests — this is the app accountants
// actually use day to day (confirmed with the user), distinct from the
// merged admin app's Accounts tab covered by accounts.spec.js. Needs the
// same admin test login as auth.spec.js.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;

test.describe('standalone Accounts app', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test.beforeEach(async ({ page }) => {
    await page.goto('/accounts/');
    await page.fill('#acc-email', EMAIL);
    await page.fill('#acc-password', PASSWORD);
    await page.click('.auth-wrap .btn-primary');
    await expect(page.locator('#acc-wrap')).toHaveClass(/active/, { timeout: 15000 });
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
    // Week-start date picker should have auto-filled a default date, and
    // it must land on a real Monday — this used to silently drift to the
    // wrong week for anyone in a positive-UTC-offset timezone (e.g.
    // Harare) because the date helper used toISOString(), which converts
    // to UTC first. Checked via noon-UTC so this assertion itself can't
    // be thrown off by any timezone.
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
});
