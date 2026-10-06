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


for (const app of ['/accounts/', '/admin/']) {
  test(`${app} loads clean with the cost-check feature`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,90)); });
    await page.goto(app);
    await page.waitForTimeout(2400);
    const fns = await page.evaluate(() => {
      const scope = (typeof AccountsApp !== 'undefined') ? AccountsApp : window;
      return ['markCostChecked','markAllCostChecked'].map(n => typeof scope[n]);
    });
    console.log(app + ' handlers: ' + JSON.stringify(fns));
    expect(fns).toEqual(['function','function']);
    expect(errs).toEqual([]);
  });
}

test('checked sales stop raising the alarm but stay visible as below cost', async ({ page }) => {
  await page.goto('/accounts/');
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    const unchecked = { price:1.20, cost:1.75, priceTba:false, litres:10000, costCheckAt:null };
    const checked   = { price:1.20, cost:1.75, priceTba:false, litres:10000,
                        costCheckAt:'2026-10-06T08:00:00Z', costCheckBy:'Adnan Hill' };
    const healthy   = { price:1.80, cost:1.50, priceTba:false, litres:10000, costCheckAt:null };
    return {
      uncheckedBelow: isBelowCost(unchecked),  uncheckedAlarms: needsCostCheck(unchecked),
      checkedBelow:   isBelowCost(checked),    checkedAlarms:   needsCostCheck(checked),
      healthyBelow:   isBelowCost(healthy),    healthyAlarms:   needsCostCheck(healthy),
    };
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.uncheckedBelow).toBe(true);
  expect(out.uncheckedAlarms).toBe(true);
  // the key property: checking it silences the alarm WITHOUT pretending the
  // sale was fine — it is still below cost and still says so
  expect(out.checkedBelow).toBe(true);
  expect(out.checkedAlarms).toBe(false);
  expect(out.healthyBelow).toBe(false);
  expect(out.healthyAlarms).toBe(false);
});
