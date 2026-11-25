// Logging a payment must reduce what the customer owes.
//
// The database is stubbed so these separate two very different failures:
// the balance not moving on screen (UI), and the row never reaching the
// table (write). The stub records every insert so the test can assert both.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const HELPERS = `
  window.dayStr = function(off){
    var d = new Date();
    d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
           '-' + String(d.getDate()).padStart(2,'0');
  };
  window.__ins = [];
  window.__srv = [];          // what the stubbed table currently holds
  window.__failInsert = false;

  window.stubSb = function(){
    sb = {
      from: function(table){
        return {
          insert: function(row){
            return { select: function(){
              if (window.__failInsert) return Promise.resolve({ data: [], error: null });
              window.__ins.push({ table: table, row: row });
              window.__srv.push(Object.assign({ id: window.__srv.length + 1 }, row));
              return Promise.resolve({ data: [{ id: window.__srv.length }], error: null });
            } };
          },
          update: function(row){
            return { eq: function(){ return { select: function(){
              return Promise.resolve({ data: [{ id: 1 }], error: null });
            } }; } };
          },
          select: function(){
            return { eq: function(){ return { order: function(){
              return Promise.resolve({ data: window.__srv.slice(), error: null });
            } }; } };
          }
        };
      }
    };
  };

  window.mkSale = function(customer, extra){
    return Object.assign({
      id: Math.floor(Math.random()*1e9),
      customer: customer, customer_id: null, location: 'Harare',
      litres: 10000, price_per_litre: 1.00, price_tba: false,
      fuel_type: 'Diesel', payment_term: '14 days',
      payment_due: dayStr(5), sale_date: dayStr(-4),
      delivery_date: dayStr(-3), delivered_at: dayStr(-3) + 'T09:00:00+02:00',
      status: 'delivered', paid: false, rep_id: 'me', invoice_ref: 'INV-1'
    }, extra || {});
  };

  window.setUp = function(sales){
    currentUser = { id: 'me' };
    currentProfile = { full_name: 'Tom Eager', role: 'rep' };
    allSales = sales;
    accPayments = [];
    accOpen = {}; accFilter = 'all';
    stubSb();
    renderSales(); renderAccounts();
  };

  window.payNow = async function(amount){
    var c = accBuild()[0];
    openPay(c.key);
    document.getElementById('pay-amount').value = String(amount);
    await savePayment();
  };
`;

async function boot(page){
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto('/');
  await page.waitForTimeout(2300);
  await page.evaluate(HELPERS);
  return errs;
}

test('a payment reduces the outstanding balance on screen', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ])`);

  expect(await page.textContent('#view-accounts')).toContain('$10,000');

  await page.evaluate(`payNow(4000)`);
  await page.waitForTimeout(300);

  // Scoped to the customer row, because "$10,000" still appears legitimately
  // on the "Delivered & invoiced" line inside the card.
  expect(await page.textContent('#view-accounts .acc-cust .acc-bal')).toBe('$6,000');
  expect(await page.textContent('#view-accounts')).toContain('−$4,000');
  expect(realErrors(errs)).toEqual([]);
});

test('the payment actually reaches rep_payments, with the right shape', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining', {customer_id:'11111111-1111-1111-1111-111111111111'}) ])`);
  await page.evaluate(`payNow(2500)`);
  await page.waitForTimeout(300);

  const ins = await page.evaluate('window.__ins');
  expect(ins.length).toBe(1);
  expect(ins[0].table).toBe('rep_payments');
  expect(ins[0].row.amount).toBe(2500);
  expect(ins[0].row.customer).toBe('Alpha Mining');
  expect(ins[0].row.customer_id).toBe('11111111-1111-1111-1111-111111111111');
  expect(ins[0].row.rep_id).toBe('me');
  expect(String(ins[0].row.client_uid)).toMatch(/^pay_/);
  expect(realErrors(errs)).toEqual([]);
});

test('the balance survives the reload from the server', async ({ page }) => {
  // The optimistic row is replaced by whatever the table returns. If the
  // two do not group to the same customer, the balance springs back up.
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ])`);
  await page.evaluate(`payNow(4000)`);
  await page.waitForTimeout(300);

  await page.evaluate(`accPayments = []; loadPayments().then(renderAccounts)`);
  await page.waitForTimeout(400);

  expect(await page.textContent('#view-accounts')).toContain('$6,000');
  expect(realErrors(errs)).toEqual([]);
});

test('two payments add up', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ])`);
  await page.evaluate(`payNow(4000)`);
  await page.waitForTimeout(250);
  await page.evaluate(`payNow(2500)`);
  await page.waitForTimeout(250);

  expect(await page.textContent('#view-accounts')).toContain('$3,500');
  expect(realErrors(errs)).toEqual([]);
});

test('a payment the database refuses is held, not silently dropped', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ]); window.__failInsert = true;`);
  await page.evaluate(`payNow(4000)`);
  await page.waitForTimeout(300);

  const queued = await page.evaluate('getAccQueue().length');
  expect(queued).toBe(1);
  expect(realErrors(errs)).toEqual([]);
});

// This is the bug Tom hit: money collected, balance unchanged.
test('a refused payment still comes off the balance, and says it is waiting', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ]); window.__failInsert = true;`);
  await page.evaluate(`payNow(4000)`);
  await page.waitForTimeout(300);

  expect(await page.textContent('#view-accounts .acc-cust .acc-bal')).toBe('$6,000');
  expect(await page.textContent('#view-accounts')).toContain('waiting to upload');
  expect(realErrors(errs)).toEqual([]);
});

test('a refused payment survives a refresh from the server', async ({ page }) => {
  // The old code re-read the table after a refusal, so the server's list -
  // which does not have the payment - replaced the one on screen and the
  // balance sprang back to the full amount.
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ]); window.__failInsert = true;`);
  await page.evaluate(`payNow(4000)`);
  await page.waitForTimeout(300);

  await page.evaluate(`accPayments = []; loadPayments().then(renderAccounts)`);
  await page.waitForTimeout(400);

  expect(await page.textContent('#view-accounts .acc-cust .acc-bal')).toBe('$6,000');
  expect(realErrors(errs)).toEqual([]);
});

test('a payment logged with no signal still comes off the balance', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ])`);
  // navigator.onLine is read directly, so override it rather than cutting
  // the network - setOffline would also kill the local test server.
  await page.evaluate(`Object.defineProperty(navigator, 'onLine', {get:()=>false, configurable:true})`);
  await page.evaluate(`payNow(2500)`);
  await page.waitForTimeout(300);

  expect(await page.textContent('#view-accounts .acc-cust .acc-bal')).toBe('$7,500');
  expect(await page.evaluate('getAccQueue().length')).toBe(1);
  expect(realErrors(errs)).toEqual([]);
});

test('an uploaded payment is not counted twice', async ({ page }) => {
  // It sits in accPayments AND in the queue until the queue drains; the
  // client_uid is what stops it being subtracted from the balance twice.
  const errs = await boot(page);
  await page.evaluate(`setUp([ mkSale('Alpha Mining') ])`);
  await page.evaluate(`payNow(4000)`);
  await page.waitForTimeout(300);

  // Force the same payment into the queue as well.
  await page.evaluate(`queueAcc({kind:'pay', payload: accPayments[0]}); renderAccounts();`);
  expect(await page.textContent('#view-accounts .acc-cust .acc-bal')).toBe('$6,000');
  expect(realErrors(errs)).toEqual([]);
});
