const { test, expect } = require('@playwright/test');

// A wrong "delivered" tick becomes a wrong invoice, because accounts invoice
// off that flag. So there are two things to get right: make the tick harder to
// misfire, and make it reversible by the rep and from the Overview board.

// Dates are relative on purpose. The Delivered panel only shows deliveries
// within seven days either side of today, so fixed dates rot: this fixture
// passed in October and then started failing once the calendar moved past it.
const day = n => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
};

const SALES = [
  { id: 1, customer: 'Delivered Co', litres: 20000, status: 'delivered', paid: false,
    invoiced: false, sale_date: day(-2), delivery_date: day(-1),
    payment_term: '30 days', fuel_type: 'Diesel', location: 'Norton', price_per_litre: 1.8 },
  { id: 2, customer: 'Invoiced Co',  litres: 40000, status: 'delivered', paid: false,
    invoiced: true,  sale_date: day(-3), delivery_date: day(-2),
    payment_term: '30 days', fuel_type: 'Diesel', location: 'Gweru', price_per_litre: 1.8 },
  { id: 3, customer: 'Still Pending', litres: 10000, status: 'pending', paid: false,
    invoiced: false, sale_date: day(-1), delivery_date: day(2),
    payment_term: 'COD', fuel_type: 'Diesel', location: 'Harare', price_per_litre: 1.8 },
  { id: 4, customer: 'Scrapped Co',  litres: 5000, status: 'cancelled', paid: false,
    invoiced: false, sale_date: day(-3), delivery_date: day(-1),
    payment_term: 'COD', fuel_type: 'Diesel', location: 'Mvuma', price_per_litre: 1.8 },
];

test('the rep gets a way back only on a delivered sale', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/');
  await page.waitForTimeout(2300);

  const rows = await page.evaluate(sales => {
    currentProfile = { full_name: 'Molly Gwatidah', role: 'rep', can_mark_paid: false };
    allSales = sales;
    renderSales();
    return [...document.querySelectorAll('#sales-list .sale-row')].map(r => ({
      customer: (r.querySelector('.sale-customer') || {}).textContent || '',
      undo: [...r.querySelectorAll('button')].some(b => /not delivered/i.test(b.textContent)),
      deliver: [...r.querySelectorAll('button')].some(b => /Mark as delivered/i.test(b.textContent)),
    }));
  }, SALES);
  console.log(JSON.stringify(rows, null, 1));

  const by = n => rows.find(r => r.customer.startsWith(n));
  expect(by('Delivered Co').undo).toBe(true);
  expect(by('Invoiced Co').undo).toBe(true);
  expect(by('Still Pending').undo).toBe(false);   // nothing to undo
  expect(by('Scrapped Co').undo).toBe(false);     // cancelled, leave it alone

  // The two must never both be offered on the same row.
  rows.forEach(r => expect(r.undo && r.deliver).toBe(false));

  expect(errs).toEqual([]);
});

test('undoing clears the delivered stamp and warns when already invoiced', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(async sales => {
    currentProfile = { full_name: 'Molly Gwatidah', role: 'rep' };
    currentUser = { id: 'u1', email: 'molly@skelsee.co.zw' };
    allSales = sales;

    const seen = { confirms: [], alert: null };
    window.confirm = m => { seen.confirms.push(m); return true; };
    window.alert = m => { seen.alert = m; };

    const sent = [];
    sb.from = () => ({ update: p => { sent.push(p); return { eq: () => Promise.resolve({ error: null }) }; } });
    loadSales = async () => {};

    await undoDelivered(1);
    const plain = { confirm: seen.confirms.pop(), status: sent[0], trail: sent[1] };

    sent.length = 0;
    await undoDelivered(2);
    const invoiced = { confirm: seen.confirms.pop() };

    return { plain, invoiced };
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  // Names the customer, so the wrong row is caught before anything changes.
  expect(out.plain.confirm).toContain('Delivered Co');
  expect(out.plain.confirm).toContain('NOT delivered');

  // The sale goes back to pending and the delivered stamp is cleared - leaving
  // delivered_at set would keep it looking delivered to anything reading dates.
  expect(out.plain.status.status).toBe('pending');
  expect(out.plain.status.delivered_at).toBeNull();

  // Who reversed it, recorded separately so a missing column cannot block it.
  expect(out.plain.trail.undelivered_by).toBe('Molly Gwatidah');
  expect(out.plain.trail.undelivered_at).toBeTruthy();

  // An already-invoiced sale has to say so. This is the whole point.
  expect(out.invoiced.confirm).toContain('invoiced');
  expect(out.invoiced.confirm).toMatch(/CAREFUL/);
});

test('marking delivered now names the customer before it commits', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2300);

  const asked = await page.evaluate(async sales => {
    allSales = sales;
    let msg = null;
    window.confirm = m => { msg = m; return false; };   // decline - nothing should change
    const sent = [];
    sb.from = () => ({ update: p => { sent.push(p); return { eq: () => Promise.resolve({ error: null }) }; } });
    await markDelivered(3);
    return { msg, sentCount: sent.length };
  }, SALES);
  console.log(JSON.stringify(asked));

  expect(asked.msg).toContain('Still Pending');
  expect(asked.msg).toContain('10,000 L');
  expect(asked.sentCount).toBe(0);   // declining must not write
});

test('the Overview board can put a delivery back too', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(async sales => {
    isFirstLoad = true;
    allSales = sales.map(s => ({
      id: s.id, customer: s.customer, litres: s.litres, status: s.status,
      delivered: s.status === 'delivered', invoiced: s.invoiced,
      date: s.sale_date, deliveryDate: s.delivery_date, rep: 'Molly',
      location: s.location, fuelType: s.fuel_type, notes: '',
    }));
    renderAll();
    const undoButtons = [...document.querySelectorAll('#delivered-list .undo-btn')].length;
    const deliveredRows = [...document.querySelectorAll('#delivered-list .order-row')].length;

    const seen = [];
    window.confirm = m => { seen.push(m); return true; };
    const sent = [];
    sb.from = () => ({ update: p => { sent.push(p); return { eq: () => Promise.resolve({ error: null }) }; } });
    fetchData = async () => {};

    await undoDelivered('2');   // the invoiced one
    return { undoButtons, deliveredRows, confirm: seen[0], status: sent[0], trail: sent[1] };
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  // Every delivered row offers the way back, not just some of them.
  expect(out.deliveredRows).toBeGreaterThan(0);
  expect(out.undoButtons).toBe(out.deliveredRows);

  expect(out.confirm).toContain('Invoiced Co');
  expect(out.confirm).toContain('invoiced');
  expect(out.status.status).toBe('pending');
  expect(out.status.delivered_at).toBeNull();
  // The board is a shared screen, so it records that rather than a name it
  // does not have.
  expect(out.trail.undelivered_by).toBe('Overview board');

  expect(errs).toEqual([]);
});
