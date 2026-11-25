// Deleting a sale, and the silent-refusal class of bug behind the report
// that reps could not delete.
//
// Row-level security refuses a write by changing ZERO ROWS and reporting
// NO ERROR. Without .select() the app cannot tell that apart from success,
// so it reloaded the list and the sale was still there, with nothing said.
// These prove the app now says so.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const HELPERS = `
  window.__deleted = [];
  window.__refuse  = false;   // RLS refusal: zero rows, no error
  window.__err     = null;    // a real database error

  window.stubSb = function(){
    function result(){
      if (window.__err) return Promise.resolve({ data: null, error: { message: window.__err } });
      if (window.__refuse) return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [{ id: 1 }], error: null });
    }
    sb = {
      from: function(){
        return {
          delete: function(){
            return { eq: function(_c, id){
              return { select: function(){
                if (!window.__refuse && !window.__err) window.__deleted.push(id);
                return result();
              } };
            } };
          },
          update: function(){
            return { eq: function(){ return { select: function(){ return result(); } }; } };
          },
          select: function(){
            return {
              order: function(){ return Promise.resolve({ data: window.__rows || [], error: null }); },
              eq: function(){ return { order: function(){
                return Promise.resolve({ data: [], error: null }); } }; }
            };
          }
        };
      }
    };
  };

  window.setUp = function(){
    currentUser = { id: 'me' };
    currentProfile = { full_name: 'Tom Eager CW', role: 'rep' };
    window.__rows = [{
      id: 77, customer: 'Barry Tech', customer_id: null, location: 'Mutare',
      litres: 8000, price_per_litre: 1.90, price_tba: false, fuel_type: 'Diesel',
      payment_term: '14 days', payment_due: '2026-12-09', sale_date: '2026-11-24',
      delivery_date: '2026-11-25', delivered_at: null, status: 'pending',
      paid: false, rep_id: 'me', invoice_ref: null
    }];
    allSales = window.__rows.slice();
    accPayments = []; accOpen = {}; accFilter = 'all';
    stubSb();
    renderSales();
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

// Accept the confirm, capture whatever alert follows.
function catchDialogs(page, seen){
  page.on('dialog', async d => {
    seen.push({ type: d.type(), text: d.message() });
    d.type() === 'confirm' ? await d.accept() : await d.dismiss();
  });
}

test('a refused delete tells the rep instead of doing nothing', async ({ page }) => {
  const errs = await boot(page);
  const seen = [];
  catchDialogs(page, seen);

  await page.evaluate(`setUp(); window.__refuse = true;`);
  await page.evaluate(`cancelSale(77)`);
  await page.waitForTimeout(400);

  expect(seen.length).toBe(2);
  expect(seen[0].type).toBe('confirm');
  expect(seen[1].type).toBe('alert');
  expect(seen[1].text).toContain('NOT deleted');
  expect(seen[1].text).toContain('permission');
  // and nothing was removed
  expect(await page.evaluate('window.__deleted')).toEqual([]);
  expect(realErrors(errs)).toEqual([]);
});

test('a delete that works still works', async ({ page }) => {
  const errs = await boot(page);
  const seen = [];
  catchDialogs(page, seen);

  await page.evaluate(`setUp()`);
  await page.evaluate(`cancelSale(77)`);
  await page.waitForTimeout(400);

  // The confirm, and no alert after it.
  expect(seen.map(d => d.type)).toEqual(['confirm']);
  expect(await page.evaluate('window.__deleted')).toEqual([77]);
  expect(realErrors(errs)).toEqual([]);
});

test('declining the confirm deletes nothing', async ({ page }) => {
  const errs = await boot(page);
  page.on('dialog', async d => await d.dismiss());

  await page.evaluate(`setUp()`);
  await page.evaluate(`cancelSale(77)`);
  await page.waitForTimeout(300);

  expect(await page.evaluate('window.__deleted')).toEqual([]);
  expect(realErrors(errs)).toEqual([]);
});

test('a real database error is quoted back, not swallowed', async ({ page }) => {
  const errs = await boot(page);
  const seen = [];
  catchDialogs(page, seen);

  await page.evaluate(`setUp(); window.__err = 'violates foreign key constraint "delivery_assignment_sale_id_fkey"';`);
  await page.evaluate(`cancelSale(77)`);
  await page.waitForTimeout(400);

  expect(seen[1].text).toContain('NOT deleted');
  expect(seen[1].text).toContain('foreign key');
  expect(realErrors(errs)).toEqual([]);
});

test('a refused delivery tick says so too', async ({ page }) => {
  const errs = await boot(page);
  const seen = [];
  catchDialogs(page, seen);

  await page.evaluate(`setUp(); window.__refuse = true;`);
  await page.evaluate(`markDelivered(77)`);
  await page.waitForTimeout(400);

  expect(seen[seen.length - 1].type).toBe('alert');
  expect(seen[seen.length - 1].text).toContain('NOT marked as delivered');
  expect(realErrors(errs)).toEqual([]);
});

test('a refused paid tick says so too', async ({ page }) => {
  const errs = await boot(page);
  const seen = [];
  catchDialogs(page, seen);

  await page.evaluate(`setUp(); currentProfile.can_mark_paid = true; window.__refuse = true;`);
  await page.evaluate(`markPaid(77)`);
  await page.waitForTimeout(400);

  expect(seen[seen.length - 1].type).toBe('alert');
  expect(seen[seen.length - 1].text).toContain('NOT marked as paid');
  expect(realErrors(errs)).toEqual([]);
});
