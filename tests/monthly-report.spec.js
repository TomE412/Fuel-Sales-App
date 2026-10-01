const { test, expect } = require('@playwright/test');

for (const app of ['/admin/', '/accounts/', '/']) {
  test(`${app} monthly report excludes cancelled orders`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await page.goto(app);
    await page.waitForTimeout(2300);

    // Capture what generateReport() actually sends, without a live login.
    const out = await page.evaluate(async () => {
      const calls = [];
      const q = {
        select: () => q, returns: () => q,   // admin chains .returns() on its second query
        gte: (c,v) => { calls.push(['gte',c,v]); return q; },
        lt: (c,v) => { calls.push(['lt',c,v]); return q; },
        neq: (c,v) => { calls.push(['neq',c,v]); return q; },
        then: (res) => res({ data: [], error: null }),
      };
      sb.from = () => q;
      const mSel = document.getElementById('reportMonthSel');
      const ySel = document.getElementById('reportYearSel');
      if (!mSel || !ySel) return { skipped: 'no month picker' };
      mSel.innerHTML = '<option value="8" selected>Sep</option>';
      ySel.innerHTML = '<option value="2026" selected>2026</option>';
      try { await generateReport(); } catch (e) {}
      return { calls };
    });
    console.log(app + ' ' + JSON.stringify(out));

    if (out.skipped) return;
    const gte = out.calls.find(c => c[0] === 'gte');
    const lt  = out.calls.find(c => c[0] === 'lt');
    const neq = out.calls.find(c => c[0] === 'neq');
    expect(gte[2]).toBe('2026-09-01');           // local date, not 2026-08-31
    expect(lt[2]).toBe('2026-10-01');
    expect(neq, 'cancelled filter missing').toBeTruthy();
    expect(neq[1]).toBe('status');
    expect(neq[2]).toBe('cancelled');
    expect(errs).toEqual([]);
  });
}
