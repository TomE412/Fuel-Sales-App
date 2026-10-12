const { test, expect } = require('@playwright/test');

// Marking a sale paid is a money record, and only reps switched on for it
// (profiles.can_mark_paid) are offered the button. Asked for by one rep who
// watches her own accounts; everyone else's screen is unchanged.

const SALES = [
  { id: 1, customer: 'Unpaid Co',    litres: 10000, paid: false, status: 'pending',
    sale_date: '2026-10-12', delivery_date: '2026-10-14', payment_term: '30 days',
    fuel_type: 'Diesel', location: 'Harare', price_per_litre: 1.8 },
  { id: 2, customer: 'Already Paid', litres: 5000,  paid: true,  status: 'pending',
    sale_date: '2026-10-12', delivery_date: '2026-10-14', payment_term: 'COD',
    fuel_type: 'Diesel', location: 'Norton', price_per_litre: 1.8 },
  { id: 3, customer: 'Scrapped Co',  litres: 8000,  paid: false, status: 'cancelled',
    sale_date: '2026-10-12', delivery_date: '2026-10-14', payment_term: '30 days',
    fuel_type: 'Diesel', location: 'Gweru', price_per_litre: 1.8 },
];

const render = (page, canMarkPaid) => page.evaluate(([sales, flag]) => {
  currentProfile = { full_name: 'Carrie Watson', role: 'rep', can_mark_paid: flag };
  allSales = sales;
  renderSales();
  const rows = [...document.querySelectorAll('#sales-list .sale-row')];
  return rows.map(r => ({
    customer: (r.querySelector('.sale-customer') || {}).textContent || '',
    hasPaidBtn: [...r.querySelectorAll('button')].some(b => /Mark as paid/.test(b.textContent)),
  }));
}, [SALES, canMarkPaid]);

test('only a rep switched on for it is offered the paid button', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 90)); });
  await page.goto('/');
  await page.waitForTimeout(2300);

  const off = await render(page, false);
  const on  = await render(page, true);
  console.log(JSON.stringify({ off, on }, null, 1));

  // Switched off: nobody's screen changes, on any row.
  expect(off.some(r => r.hasPaidBtn)).toBe(false);

  // Switched on: only the sale that is unpaid and still live gets it.
  const byName = n => on.find(r => r.customer.startsWith(n));
  expect(byName('Unpaid Co').hasPaidBtn).toBe(true);
  expect(byName('Already Paid').hasPaidBtn).toBe(false);   // nothing left to mark
  expect(byName('Scrapped Co').hasPaidBtn).toBe(false);    // cancelled sale

  expect(errs).toEqual([]);
});

test('marking paid records who did it, and surfaces a refusal', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(async sales => {
    currentProfile = { full_name: 'Carrie Watson', role: 'rep', can_mark_paid: true };
    currentUser = { id: 'u1', email: 'carrie@skelsee.co.zw' };
    allSales = sales;

    const seen = { confirm: null, alert: null };
    window.confirm = msg => { seen.confirm = msg; return true; };
    window.alert = msg => { seen.alert = msg; };

    let sent = null;
    let fail = false;
    // sb is a const, but its from() is not.
    sb.from = () => ({ update: payload => { sent = payload; return {
      eq: async () => (fail ? { error: { message: 'permission denied for table sales' } } : { error: null }) }; } });
    loadSales = async () => {};   // the reload is not what is under test

    await markPaid(1);
    const ok = { sent, alert: seen.alert, confirm: seen.confirm };

    fail = true; sent = null; seen.alert = null;
    await markPaid(1);
    return { ok, refused: { sent, alert: seen.alert } };
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  // It names the customer, so a mis-tap on the wrong row is catchable.
  expect(out.ok.confirm).toContain('Unpaid Co');
  expect(out.ok.confirm).toContain('PAID');

  // The money record carries who and when, not just a flag.
  expect(out.ok.sent.paid).toBe(true);
  expect(out.ok.sent.paid_by).toBe('Carrie Watson');
  expect(out.ok.sent.paid_at).toBeTruthy();
  expect(out.ok.alert).toBeNull();

  // A refused write must be visible. Silently doing nothing would leave the
  // rep believing the money is logged when it is not.
  expect(out.refused.alert).toContain('Could not mark it paid');
  expect(out.refused.alert).toContain('permission denied');
});
