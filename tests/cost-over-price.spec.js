const { test, expect } = require('@playwright/test');

for (const app of ['/', '/admin/']) {
  test(`${app} warns when cost price exceeds sell price`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,90)); });
    await page.goto(app);
    await page.waitForTimeout(2400);

    expect(await page.locator('#cost-warn').count(), 'warning strip missing').toBe(1);
    const txt = await page.locator('#cost-warn').textContent();
    console.log(app + ' message: ' + txt.trim());
    expect(txt).toContain('Mike Alarm');
    expect(txt).toContain('cost price is higher than your sell price');

    const out = await page.evaluate(() => {
      const scope = (typeof SalesApp !== 'undefined') ? SalesApp : window;
      const cost = document.getElementById('s-cost');
      const price = document.getElementById('s-price');
      const warn = document.getElementById('cost-warn');
      const run = (c, p) => {
        cost.value = c; price.value = p;
        scope.checkCostVsPrice();
        return warn.style.display === 'block';
      };
      return {
        swapped:   run('1.75', '1.20'),   // the mistake that happened
        healthy:   run('1.50', '1.80'),
        equal:     run('1.50', '1.50'),   // not "higher than"
        costBlank: run('',     '1.20'),   // optional field, left empty
        noPrice:   run('1.75', ''),
      };
    });
    console.log(app + ' ' + JSON.stringify(out));

    expect(out.swapped).toBe(true);
    expect(out.healthy).toBe(false);
    expect(out.equal).toBe(false);
    expect(out.costBlank).toBe(false);   // must never nag when cost is left blank
    expect(out.noPrice).toBe(false);
    expect(errs).toEqual([]);
  });
}
