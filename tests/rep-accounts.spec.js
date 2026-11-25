// The rep Accounts view (trial: Tom Eager and Tom Eager CW only).
//
// A second view of the same sales inside the Sales tab: Pipeline is what is
// still to go out, Accounts is what is owed. The thing most worth proving is
// the gate - every OTHER rep must see the Sales tab exactly as it was, with
// delivered sales still in the list and no toggle anywhere.
//
// These drive the page's own render functions with stubbed data rather than
// signing in, so they run without credentials and without touching live data.
// Dates are built inside the page so the tests do not rot.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const HELPERS = `
  window.dayStr = function(off){
    var d = new Date();
    d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
           '-' + String(d.getDate()).padStart(2,'0');
  };
  // A DELIVERED sale, which is what Accounts is made of.
  //
  // The delivery defaults to a few days ago rather than due-minus-14, so
  // these fixtures sit inside the ACC_FROM window whatever today's date is.
  // The tests that care about the cutoff pass explicit dates instead.
  window.mk = function(customer, dueInDays, extra){
    return Object.assign({
      id: Math.floor(Math.random()*1e9),
      customer: customer, customer_id: null, location: 'Harare',
      litres: 10000, price_per_litre: 1.00, price_tba: false,
      fuel_type: 'Diesel', payment_term: '14 days',
      payment_due: dayStr(dueInDays),
      sale_date: dayStr(-4),
      delivery_date: dayStr(-3),
      delivered_at: dayStr(-3) + 'T09:00:00+02:00',
      status: 'delivered', paid: false, rep_id: 'me', invoice_ref: null
    }, extra || {});
  };
  window.asRep = function(name, sales, pays){
    currentUser = { id: 'me' };
    currentProfile = { full_name: name, role: 'rep' };
    allSales = sales || [];
    accPayments = pays || [];
    accOpen = {};
    accFilter = 'all';
    renderSales();
    renderAccounts();
  };
`;

async function boot(page){
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await page.goto('/');
  await page.waitForTimeout(2300);
  await page.evaluate(HELPERS);
  return errs;
}

const show = (page, sel) =>
  page.evaluate(s => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).display : 'MISSING';
  }, sel);

test.describe('rep accounts', () => {

  test('a rep outside the trial sees no toggle and keeps delivered sales in the list', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Someone Else', [ mk('Alpha', -5, {invoice_ref:'1'}), mk('Beta', 3) ])`);

    expect(await show(page, '#acc-toggle')).toBe('none');

    // The whole point: their Sales tab is untouched, delivered sales and all.
    const txt = await page.textContent('#sales-list');
    expect(txt).toContain('Alpha');
    expect(txt).toContain('Beta');

    // And Accounts renders nothing at all for them.
    expect(await page.textContent('#view-accounts')).toBe('');
    expect(realErrors(errs)).toEqual([]);
  });

  for (const who of ['Tom Eager', 'Tom Eager CW']) {
    test(`${who} gets the toggle`, async ({ page }) => {
      const errs = await boot(page);
      await page.evaluate(`asRep(${JSON.stringify(who)}, [ mk('Alpha', -5, {invoice_ref:'1'}) ])`);
      expect(await show(page, '#acc-toggle')).toBe('flex');
      expect(realErrors(errs)).toEqual([]);
    });
  }

  test('Pipeline drops delivered sales for a trial rep, and says where they went', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [
      mk('Delivered Co', -5, {invoice_ref:'1'}),
      Object.assign(mk('Pending Co', 9), {status:'pending', delivered_at:null})
    ])`);

    const txt = await page.textContent('#sales-list');
    expect(txt).toContain('Pending Co');
    expect(txt).not.toContain('Delivered Co');

    // With nothing left to go out, the empty state points at Accounts.
    await page.evaluate(`asRep('Tom Eager', [ mk('Delivered Co', -5, {invoice_ref:'1'}) ])`);
    expect(await page.textContent('#sales-list')).toContain('Accounts');
    expect(realErrors(errs)).toEqual([]);
  });

  test('balance is invoiced plus awaiting, less payments', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager',
      [ mk('JR Goddard', -12, {invoice_ref:'4471', litres:14000, price_per_litre:1.90}),
        mk('JR Goddard', 3,   {invoice_ref:'4502', litres:10000, price_per_litre:1.825}) ],
      [ {customer:'JR Goddard', customer_id:null, amount:12000, method:'transfer', pop_ref:'TXN-8841', paid_on:dayStr(-1)},
        {customer:'JR Goddard', customer_id:null, amount:8000,  method:'cash',     pop_ref:null,       paid_on:dayStr(-7)} ])`);

    const txt = await page.textContent('#view-accounts');
    expect(txt).toContain('JR Goddard');
    expect(txt).toContain('$24,850');   // 26,600 + 18,250 - 20,000
    expect(txt).toContain('Overdue');   // 20,000 does not cover the oldest line
    expect(realErrors(errs)).toEqual([]);
  });

  test('the four badges', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager',
      [ mk('Late Co',   -9, {invoice_ref:'1'}),
        mk('Soon Co',    3, {invoice_ref:'2'}),
        mk('NoRef Co',   5),
        mk('Paid Co',  -30, {invoice_ref:'4'}) ],
      [ {customer:'Paid Co', customer_id:null, amount:10000, method:'cash', pop_ref:null, paid_on:dayStr(-2)} ])`);

    const txt = await page.textContent('#view-accounts');
    expect(txt).toContain('Overdue');
    expect(txt).toContain('Due soon');
    expect(txt).toContain('Awaiting inv.');
    // Settled drops out of the active list until its own filter is picked.
    expect(txt).not.toContain('Paid Co');

    await page.evaluate(`accSetFilter('settled')`);
    const settled = await page.textContent('#view-accounts');
    expect(settled).toContain('Paid Co');
    expect(settled).toContain('Settled');
    expect(realErrors(errs)).toEqual([]);
  });

  test('a delivered Price TBA load never vanishes', async ({ page }) => {
    // It owes nothing because it has no price yet, so a naive zero-balance
    // check marked it Settled and dropped it - while it had already left
    // Pipeline for being delivered. It would have been visible nowhere.
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager',
      [ mk('TBA Co', 7, {price_tba:true, price_per_litre:0, litres:8000}) ])`);

    const txt = await page.textContent('#view-accounts');
    expect(txt).toContain('TBA Co');
    // Scoped to the card's own badge: "Settled" is also a filter chip label,
    // so searching the whole panel for the word proves nothing.
    const badges = await page.locator('#view-accounts .acc-cust .acc-badge').allTextContents();
    expect(badges).toEqual(['Awaiting inv.']);
    expect(realErrors(errs)).toEqual([]);
  });

  test("another rep's sale is not in my accounts", async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [
      mk('Mine',   -3, {invoice_ref:'1'}),
      mk('Theirs', -3, {invoice_ref:'2', rep_id:'someone-else'})
    ])`);

    const txt = await page.textContent('#view-accounts');
    expect(txt).toContain('Mine');
    expect(txt).not.toContain('Theirs');
    expect(realErrors(errs)).toEqual([]);
  });

  test('one customer stays one card when a sale has no customer_id', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [
      mk('Jumbo Transport', -2, {invoice_ref:'1', customer_id:'CID-1'}),
      mk('jumbo  transport', -2, {invoice_ref:'2'})
    ])`);

    expect(await page.locator('#view-accounts .acc-cust').count()).toBe(1);
    expect(await page.textContent('#view-accounts')).toContain('$20,000');
    expect(realErrors(errs)).toEqual([]);
  });

  test('expanding a customer shows the ref box only where a ref is missing', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [
      mk('Mixed Co', -4, {invoice_ref:'4471'}),
      mk('Mixed Co',  6)
    ])`);
    await page.evaluate(`accToggleCust(accBuild()[0].key)`);

    // One invoice has a ref and is shown; the other offers an input.
    expect(await page.textContent('#view-accounts')).toContain('#4471');
    expect(await page.locator('#view-accounts .acc-refrow input').count()).toBe(1);
    expect(realErrors(errs)).toEqual([]);
  });

  test('the payment sheet hides the ref field when two deliveries lack one', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [ mk('Two Co', 4), mk('Two Co', 6) ])`);
    await page.evaluate(`openPay(accBuild()[0].key)`);

    expect(await show(page, '#pay-reffld')).toBe('none');
    expect(await show(page, '#pay-refhint')).toBe('block');
    expect(await page.textContent('#pay-refhint')).toContain('2 deliveries');

    // With exactly one missing, it is offered, because it is unambiguous.
    await page.evaluate(`closePay(); asRep('Tom Eager', [ mk('One Co', 4) ]); openPay(accBuild()[0].key)`);
    expect(await show(page, '#pay-reffld')).toBe('block');
    expect(await show(page, '#pay-refhint')).toBe('none');
    expect(realErrors(errs)).toEqual([]);
  });

  // The chase starts at ACC_FROM (1 Nov 2026). Without a floor the first
  // screen was every delivered sale ever recorded - years of debt long
  // settled outside the app. These pin the boundary with explicit dates
  // rather than offsets, because the cutoff itself is a fixed date.
  test('deliveries before the cutoff are not chased', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [
      mk('Old Co', -40, {invoice_ref:'1', delivered_at:'2026-10-20T09:00:00+02:00', delivery_date:'2026-10-20'}),
      mk('New Co',  -5, {invoice_ref:'2', delivered_at:'2026-11-10T09:00:00+02:00', delivery_date:'2026-11-10'})
    ])`);

    const txt = await page.textContent('#view-accounts');
    expect(txt).toContain('New Co');
    expect(txt).not.toContain('Old Co');
    expect(realErrors(errs)).toEqual([]);
  });

  test('1 November itself is inside the window', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [
      mk('Boundary Co', -10, {invoice_ref:'1', delivered_at:'2026-11-01T06:00:00+02:00', delivery_date:'2026-11-01'}),
      mk('Day Before',  -11, {invoice_ref:'2', delivered_at:'2026-10-31T23:00:00+02:00', delivery_date:'2026-10-31'})
    ])`);

    const txt = await page.textContent('#view-accounts');
    expect(txt).toContain('Boundary Co');
    expect(txt).not.toContain('Day Before');
    expect(realErrors(errs)).toEqual([]);
  });

  test('a payment before the cutoff does not credit a balance inside it', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager',
      [ mk('Mixed Co', -5, {invoice_ref:'1', litres:10000, price_per_litre:1.00,
           delivered_at:'2026-11-10T09:00:00+02:00', delivery_date:'2026-11-10'}) ],
      [ {customer:'Mixed Co', customer_id:null, amount:4000, method:'cash', pop_ref:null, paid_on:'2026-10-15'} ])`);

    // The October payment belongs to October deliveries, which are not shown.
    expect(await page.textContent('#view-accounts')).toContain('$10,000');
    expect(realErrors(errs)).toEqual([]);
  });

  test('the screen says where the window starts', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [
      mk('Alpha', -3, {invoice_ref:'1', delivered_at:'2026-11-10T09:00:00+02:00', delivery_date:'2026-11-10'})
    ])`);
    expect(await page.textContent('#view-accounts')).toContain('01/11/2026');
    expect(realErrors(errs)).toEqual([]);
  });

  test('every balance carries the Adnan line, and export is offered', async ({ page }) => {
    const errs = await boot(page);
    await page.evaluate(`asRep('Tom Eager', [ mk('Alpha', -3, {invoice_ref:'1'}) ])`);
    await page.evaluate(`accToggleCust(accBuild()[0].key)`);

    const txt = await page.textContent('#view-accounts');
    expect(txt).toContain('Adnan');
    expect(txt).toContain('Export my accounts to Excel');
    expect(realErrors(errs)).toEqual([]);
  });

});
