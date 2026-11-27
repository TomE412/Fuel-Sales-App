// A rep cancelling their own order.
//
// The button used to run a DELETE, and the only DELETE policy on sales is
// admin_delete_sales - so for a rep the write was always refused, the old
// code never checked, and the sale just stayed on the list saying nothing.
//
// Cancelling is an UPDATE, which rep_update_own_sales already allows on a
// rep's own sales. These pin down that the button now writes a status
// change rather than a delete, that it can be undone, and that permanent
// deletion is offered to admins only.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const HELPERS = `
  window.__ops = [];     // every write the page attempted
  window.__refuse = false;

  window.stubSb = function(){
    function res(){
      return window.__refuse
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: [{ id: 77 }], error: null });
    }
    sb.from = function(){
      return {
        update: function(patch){
          return { eq: function(_c, id){ return { select: function(){
            window.__ops.push({ kind: 'update', patch: patch, id: id });
            return res();
          } }; } };
        },
        delete: function(){
          return { eq: function(_c, id){ return { select: function(){
            window.__ops.push({ kind: 'delete', id: id });
            return res();
          } }; } };
        },
        select: function(){
          return { order: function(){ return Promise.resolve({ data: window.__rows || [], error: null }); } };
        }
      };
    };
  };

  window.setUp = function(role, status){
    currentUser = { id: 'me' };
    currentProfile = { full_name: 'Tom Eager CW', role: role || 'rep' };
    window.__rows = [{
      id: 77, customer: 'Barry Tech', customer_id: null, location: 'Mutare',
      litres: 8000, price_per_litre: 1.90, price_tba: false, fuel_type: 'Diesel',
      payment_term: '14 days', payment_due: '2026-12-09', sale_date: '2026-11-24',
      delivery_date: '2026-11-28', delivered_at: null,
      status: status || 'pending', paid: false, rep_id: 'me'
    }];
    allSales = window.__rows.slice();
    window.__ops = [];
    stubSb();
    renderSales();
  };

  window.btns = function(){
    return [...document.querySelectorAll('#sales-list button')].map(b => b.textContent.trim());
  };
`;

async function boot(page){
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,160)); });
  await page.goto('/');
  await page.waitForTimeout(2300);
  await page.evaluate(HELPERS);
  return errs;
}

function dialogs(page, seen){
  page.on('dialog', async d => {
    seen.push({ type: d.type(), text: d.message() });
    d.type() === 'confirm' ? await d.accept() : await d.dismiss();
  });
}

test('a rep cancels with an UPDATE, never a delete', async ({ page }) => {
  const errs = await boot(page);
  const seen = []; dialogs(page, seen);

  await page.evaluate(`setUp('rep')`);
  await page.evaluate(`cancelSale(77)`);
  await page.waitForTimeout(350);

  const ops = await page.evaluate('window.__ops');
  expect(ops.length).toBe(1);
  expect(ops[0].kind).toBe('update');            // the whole point
  expect(ops[0].patch.status).toBe('cancelled');
  expect(seen[0].text).toContain('Cancel this order');
  expect(seen[0].text).toContain('put it back');
  expect(realErrors(errs)).toEqual([]);
});

test('the rep button says cancel, not delete', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`setUp('rep')`);
  const labels = (await page.evaluate('btns()')).join(' | ');
  expect(labels).toContain('Cancel order');
  expect(labels).not.toContain('Delete sale');
  expect(labels).not.toContain('Delete permanently');   // reps cannot anyway
  expect(realErrors(errs)).toEqual([]);
});

test('a cancelled order can be put back', async ({ page }) => {
  const errs = await boot(page);
  const seen = []; dialogs(page, seen);

  await page.evaluate(`setUp('rep','cancelled')`);
  expect((await page.evaluate('btns()')).join(' | ')).toContain('Put this order back');

  await page.evaluate(`uncancelSale(77)`);
  await page.waitForTimeout(350);

  const ops = await page.evaluate('window.__ops');
  expect(ops[0].kind).toBe('update');
  expect(ops[0].patch.status).toBe('pending');
  expect(realErrors(errs)).toEqual([]);
});

test('permanent delete is offered to admins only', async ({ page }) => {
  const errs = await boot(page);

  await page.evaluate(`setUp('rep')`);
  expect((await page.evaluate('btns()')).join(' | ')).not.toContain('Delete permanently');

  await page.evaluate(`setUp('admin')`);
  const adminLabels = (await page.evaluate('btns()')).join(' | ');
  expect(adminLabels).toContain('Delete permanently');
  expect(adminLabels).toContain('Cancel order');        // admins get both
  expect(realErrors(errs)).toEqual([]);
});

test("an admin's permanent delete really does delete", async ({ page }) => {
  const errs = await boot(page);
  const seen = []; dialogs(page, seen);

  await page.evaluate(`setUp('admin')`);
  await page.evaluate(`deleteSaleForever(77)`);
  await page.waitForTimeout(350);

  const ops = await page.evaluate('window.__ops');
  expect(ops[0].kind).toBe('delete');
  expect(seen[0].text).toContain('permanently');
  expect(seen[0].text).toContain('cancel it instead');  // the gentler route is offered
  expect(realErrors(errs)).toEqual([]);
});

test('a refused cancel says so rather than doing nothing', async ({ page }) => {
  const errs = await boot(page);
  const seen = []; dialogs(page, seen);

  await page.evaluate(`setUp('rep'); window.__refuse = true;`);
  await page.evaluate(`cancelSale(77)`);
  await page.waitForTimeout(350);

  const alert = seen.find(d => d.type === 'alert');
  expect(alert).toBeTruthy();
  expect(alert.text).toContain('NOT cancelled');
  expect(alert.text).toContain('permission');
  expect(realErrors(errs)).toEqual([]);
});

test('declining the confirm writes nothing', async ({ page }) => {
  const errs = await boot(page);
  page.on('dialog', async d => await d.dismiss());

  await page.evaluate(`setUp('rep')`);
  await page.evaluate(`cancelSale(77)`);
  await page.waitForTimeout(300);

  expect(await page.evaluate('window.__ops')).toEqual([]);
  expect(realErrors(errs)).toEqual([]);
});
