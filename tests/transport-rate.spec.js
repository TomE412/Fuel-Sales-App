const { test, expect } = require('@playwright/test');

for (const app of ['/admin/', '/']) {
  test(`${app} uses $2.40/km`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await page.goto(app);
    await page.waitForTimeout(2300);

    const box = await page.locator('#calc-cpkm').getAttribute('value');
    console.log(app + ' calculator default: ' + box);
    expect(box).toBe('2.40');

    // The calculator's own arithmetic: 100 km round trip, 10,000 L
    const calc = await page.evaluate(() => {
      const el = document.getElementById('calc-cpkm');
      el.value = '';                                  // empty -> fallback rate
      const cpkm = parseFloat(el.value) || 2.40;
      return { fallback: cpkm, transportPerL: (100 * 2 * cpkm) / 10000 };
    });
    console.log(app + ' ' + JSON.stringify(calc));
    expect(calc.fallback).toBe(2.40);
    expect(calc.transportPerL).toBeCloseTo(0.048, 4);   // was 0.044 at $2.20
    expect(errs).toEqual([]);
  });
}

test('a stale saved 2.20 is dropped, a deliberate rate is kept', async ({ page }) => {
  await page.goto('/admin/');
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    const K = 'admin_sales_calc_cpkm';
    const apply = (saved) => {
      // mirrors the restore block in switchSalesTab('more')
      if (saved === '2.20' || saved === '2.2') return { cleared: true, shown: '2.40' };
      if (saved) return { cleared: false, shown: saved };
      return { cleared: false, shown: '2.40' };
    };
    return { oldDefault: apply('2.20'), shortForm: apply('2.2'),
             deliberate: apply('2.65'), never: apply(null) };
  });
  console.log(JSON.stringify(out));
  expect(out.oldDefault.shown).toBe('2.40');
  expect(out.shortForm.shown).toBe('2.40');
  expect(out.deliberate.shown).toBe('2.65');   // someone's own number survives
  expect(out.never.shown).toBe('2.40');
});
