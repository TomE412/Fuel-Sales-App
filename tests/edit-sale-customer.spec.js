const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Editing a saved sale used to send everything on the form EXCEPT the
// customer, because the update object was written separately from the insert
// payload and the two drifted. The write succeeded, returned no error, and the
// customer silently stayed wrong - so a rep's mistake could not be corrected
// at all, and it looked like a caching problem.
//
// Found 14 Oct 2026: Molly logged Elsberry when it should have been Olivine,
// and the correction would not take.

const SALE = {
  id: 4242,
  customer: 'Elsberry',
  customer_id: 'cust-elsberry',
  sale_date: '2026-10-14',
  location: 'Mazowe',
  fuel_type: 'Diesel',
  litres: 20000,
  price_per_litre: 1.85,
  cost_price: null,
  price_tba: false,
  delivery_date: '2026-10-15',
  payment_term: '30 days',
  payment_due: '2026-11-14',
  paid: false,
  notes: '',
  status: 'pending',
};

test('correcting the customer on a saved sale actually sends the customer', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(async sale => {
    currentUser = { id: 'u-molly', email: 'molly@skelsee.co.zw' };
    currentProfile = { full_name: 'Molly Gwatidah', role: 'rep' };
    allSales = [sale];

    window.confirm = () => true;
    window.alert = () => {};

    let sent = null;
    sb.from = () => ({
      update: payload => { sent = payload; return { eq: () => Promise.resolve({ error: null }) }; },
    });
    loadSales = async () => {};
    renderSales = () => {};
    renderDash = () => {};

    // Open it for edit exactly as tapping the row does, then correct the
    // customer the way the office would.
    openSaleForEdit(sale.id);
    const openedWith = document.getElementById('s-customer').value;

    document.getElementById('s-customer').value = 'Olivine Industries';
    selectedCustomerId = 'cust-olivine';

    await recordSale();
    return { openedWith, sent };
  }, SALE);
  console.log(JSON.stringify(out, null, 1));

  // The form must open showing the sale as it stands.
  expect(out.openedWith).toBe('Elsberry');

  // And the correction must actually be on the wire. This is the whole bug.
  expect(out.sent).not.toBeNull();
  expect(out.sent.customer).toBe('Olivine Industries');
  expect(out.sent.customer_id).toBe('cust-olivine');

  // The rest of the form must still go with it - the fix must not have
  // replaced one missing field with another.
  expect(out.sent.litres).toBe(20000);
  expect(out.sent.location).toBe('Mazowe');

  expect(errs).toEqual([]);
});

// The rep app and the admin Sales tab are duplicated code. The bug was in
// both, so the guard has to be in both. Several places update sales (mark
// delivered, mark paid, invoiced); the edit-save is the one carrying litres.
test('both apps send the customer when updating a sale', () => {
  const editSaveBlock = (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    let at = -1;
    for (let i = src.indexOf("sb.from('sales').update({"); i >= 0;
         i = src.indexOf("sb.from('sales').update({", i + 1)) {
      const block = src.slice(i, src.indexOf('.eq(', i));
      if (block.includes('litres')) { at = i; break; }
    }
    expect(at, file + ': no edit-save update found').toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('.eq(', at));
  };
  for (const f of ['index.html', 'admin/index.html']) {
    const block = editSaveBlock(f);
    expect(block, f + ' must send the customer').toMatch(/\bcustomer\b/);
    expect(block, f + ' must send the customer link').toContain('customer_id');
  }
});

// Two more faults on the same save path, found while proving the fix above.
test('editing a credit sale does not corrupt its payment term or due date', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(async sale => {
    currentUser = { id: 'u-molly', email: 'molly@skelsee.co.zw' };
    currentProfile = { full_name: 'Molly Gwatidah', role: 'rep' };
    allSales = [sale];
    window.confirm = () => true;
    window.alert = () => {};
    loadSales = async () => {}; renderSales = () => {}; renderDash = () => {};

    let sent = null;
    sb.from = () => ({ update: p => { sent = p; return { eq: () => Promise.resolve({ error: null }) }; } });

    // First edit, changing nothing about the terms.
    openSaleForEdit(sale.id);
    await recordSale();
    const first = sent;

    // Second edit, of what the first one saved. This is where it used to
    // collapse to COD and mark the sale paid.
    allSales = [{ ...sale, ...first }];
    openSaleForEdit(sale.id);
    await recordSale();
    return { first, second: sent };
  }, SALE);
  console.log(JSON.stringify(out, null, 1));

  // The button reads "30 days"; its value is "30". Saving must not stack them.
  expect(out.first.payment_term).toBe('30 days');
  expect(out.second.payment_term).toBe('30 days');

  // And a credit sale must never quietly become a paid cash one.
  expect(out.first.paid).toBe(false);
  expect(out.second.paid).toBe(false);

  // Due date is delivery + 30 days. 15 Oct + 30 = 14 Nov; it used to come out
  // as the 13th because the date was formatted through UTC.
  expect(out.first.payment_due).toBe('2026-11-14');
  expect(out.second.payment_due).toBe('2026-11-14');
});
