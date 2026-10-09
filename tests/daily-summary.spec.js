const { test, expect } = require('@playwright/test');

for (const app of ['/accounts/', '/admin/']) {
  test(`${app} has the daily summary report`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,90)); });
    await page.goto(app);
    await page.waitForTimeout(2400);
    for (const id of ['#rpt-daily','#dailyDate','#dailyCopyBtn','[data-r="daily"]']) {
      expect(await page.locator(id).count(), `${app} missing ${id}`).toBe(1);
    }
    for (const fn of ['dailyInit','dailyText','dailyLine','generateDaily','copyDaily']) {
      expect(await page.evaluate(n => typeof window[n], fn), `${app} ${fn}`).toBe('function');
    }
    // the switcher must hide the other two panels, not just show this one
    const vis = await page.evaluate(() => {
      document.getElementById('view-reports').style.display = 'block';
      switchReport('daily');
      const v = id => document.getElementById(id).style.display;
      return { daily: v('rpt-daily'), monthly: v('rpt-monthly'), perf: v('rpt-perf') };
    });
    console.log(app + ' panels: ' + JSON.stringify(vis));
    expect(vis.daily).toBe('');
    expect(vis.monthly).toBe('none');
    expect(vis.perf).toBe('none');
    expect(errs).toEqual([]);
  });
}

test('the WhatsApp text reads correctly', async ({ page }) => {
  await page.goto('/accounts/');
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    const rows = [
      {customer:'Khaya Cement Limited', location:'Goromonzi', litres:40000,
       price_per_litre:1.77, price_tba:false, fuel_type:'Diesel', rep_name:'Tom Eager'},
      {customer:'Broylay Investments (Pvt) Ltd', location:'Nyabira', litres:15000,
       price_per_litre:0, price_tba:true, fuel_type:'Diesel', rep_name:'Molly Gwatidah'},
      {customer:'Khaya Cement Limited', location:'Goromonzi', litres:5000,
       price_per_litre:1.80, price_tba:false, fuel_type:'Petrol', rep_name:'Tom Eager'},
    ];
    return { text: dailyText('2026-10-09', rows), empty: dailyText('2026-10-09', []) };
  });
  console.log('\n' + out.text + '\n');

  const t = out.text;
  expect(t).toContain('*SKELSEE — DAILY SALES*');
  expect(t).toContain('Friday 09 October 2026');
  expect(t).toContain('1. *Khaya Cement Limited*');
  expect(t).toContain('40,000 L diesel @ $1.770 = $70,800');
  expect(t).toContain('Goromonzi · Tom Eager');
  expect(t).toContain('@ price TBA');                  // TBA shown, not as $0
  expect(t).toContain('*TOTAL: 60,000 L*');            // all litres counted
  expect(t).toContain('$79,800');                      // TBA excluded from value
  expect(t).toContain('(1 at price TBA, not counted)');
  expect(t).toContain('3 sales · 2 customers');        // same customer counted once
  expect(out.empty).toContain('No sales recorded today.');
});
