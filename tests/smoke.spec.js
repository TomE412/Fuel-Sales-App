// Smoke tests — no login required. Confirms every app's entry page loads,
// shows the expected title/auth form, and doesn't throw a JS error on load.
// This is exactly the class of bug that's bitten this project before (a
// scoping mistake, a missing element, a broken script tag) and is cheap to
// catch automatically instead of by a human clicking through five apps.
const { test, expect } = require('@playwright/test');

const APPS = [
  { path: '/', title: 'Skelsee Fuel Sales', authField: '#auth-email' },
  { path: '/admin/', title: 'Skelsee — Admin', authField: '#auth-email' },
  { path: '/ops/', title: 'Skelsee — Ops Planner', authField: null },
  { path: '/accounts/', title: 'Skelsee — Accounts', authField: '#acc-email' },
  { path: '/dashboard/', title: 'Skelsee — Overview', authField: '#dash-email' },
];

for (const app of APPS) {
  test(`${app.path} loads with no console errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    const response = await page.goto(app.path);
    expect(response.status(), `HTTP status for ${app.path}`).toBeLessThan(400);
    await expect(page).toHaveTitle(app.title);

    if (app.authField) {
      await expect(page.locator(app.authField)).toBeVisible();
    }

    // Give any async init (Supabase client creation, session check) a beat
    // to run and surface errors before we assert the page stayed clean.
    await page.waitForTimeout(1000);
    expect(errors, `console/page errors on ${app.path}:\n${errors.join('\n')}`).toEqual([]);
  });
}
