const { test, expect } = require('@playwright/test');

for (const app of ['/accounts/', '/admin/']) {
  test(`${app} tracker shows cost price and flags below-cost sales`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await page.goto(app);
    await page.waitForTimeout(2400);

    expect(await page.locator('#cost-alarm').count(), 'banner missing').toBe(1);
    expect(await page.locator('[data-t="belowcost"]').count(), 'chip missing').toBe(1);
    const heads = await page.locator('#track-body').evaluate(b =>
      [...b.closest('table').querySelectorAll('thead th')].map(t => t.textContent.trim()));
    console.log(app + ' headers: ' + JSON.stringify(heads));
    expect(heads).toContain('Cost/L');
    expect(heads.indexOf('Cost/L')).toBe(heads.indexOf('Price/L') + 1);
    expect(errs).toEqual([]);
  });
}

test('the below-cost test is correct at every edge', async ({ page }) => {
  await page.goto('/accounts/');
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    const cases = {
      swappedPrices:   { price: 1.20, cost: 1.75, priceTba: false, litres: 10000 },
      healthy:         { price: 1.80, cost: 1.50, priceTba: false, litres: 10000 },
      breakEven:       { price: 1.50, cost: 1.50, priceTba: false, litres: 10000 },
      noCostRecorded:  { price: 1.20, cost: null, priceTba: false, litres: 10000 },
      costZero:        { price: 1.20, cost: 0,    priceTba: false, litres: 10000 },
      priceTBA:        { price: 0,    cost: 1.75, priceTba: true,  litres: 10000 },
      priceZeroNotTba: { price: 0,    cost: 1.75, priceTba: false, litres: 10000 },
    };
    const r = {};
    for (const k in cases) r[k] = isBelowCost(cases[k]);
    return r;
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.swappedPrices).toBe(true);     // the real failure that happened
  expect(out.healthy).toBe(false);
  expect(out.breakEven).toBe(false);        // equal is not "less than"
  expect(out.noCostRecorded).toBe(false);   // can't judge what wasn't recorded
  expect(out.costZero).toBe(false);
  expect(out.priceTBA).toBe(false);         // TBA is stored at 0 by design
  expect(out.priceZeroNotTba).toBe(false);  // a 0 price is bad data, not a loss
});
