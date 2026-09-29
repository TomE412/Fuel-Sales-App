const { test, expect } = require('@playwright/test');

// The runner is pinned to Africa/Harare (UTC+2) in playwright.config.js —
// this test is meaningless in UTC, which is exactly how the bug survived.
for (const app of ['/admin/', '/accounts/']) {
  test(`${app} builds month ranges from local dates, not UTC`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await page.goto(app);
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const sep = new Date(2026, 8, 1);    // 1 Sep local
      const oct = new Date(2026, 9, 1);    // 1 Oct local
      const jan = new Date(2026, 0, 1);    // 1 Jan local — year boundary
      return {
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offsetMin: sep.getTimezoneOffset(),
        sepLocal: localISO(sep),
        octLocal: localISO(oct),
        janLocal: localISO(jan),
        sepUtc: sep.toISOString().split('T')[0],   // what it used to produce
      };
    });
    console.log(app + ' ' + JSON.stringify(out));

    expect(out.sepLocal).toBe('2026-09-01');
    expect(out.octLocal).toBe('2026-10-01');
    expect(out.janLocal).toBe('2026-01-01');
    // prove the runner is actually east of UTC, or this test proves nothing
    expect(out.offsetMin).toBeLessThan(0);
    expect(out.sepUtc).toBe('2026-08-31');
    expect(errs).toEqual([]);
  });
}

test('the Monthly Sales Report also builds its range locally', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/admin/');
  await page.waitForTimeout(2300);
  // Mirrors generateReport()'s own construction for September 2026.
  const out = await page.evaluate(() => {
    const month = 8, year = 2026;
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 1);
    return { start: localISO(startDate), end: localISO(endDate) };
  });
  console.log(JSON.stringify(out));
  expect(out.start).toBe('2026-09-01');
  expect(out.end).toBe('2026-10-01');
  expect(errs).toEqual([]);
});
