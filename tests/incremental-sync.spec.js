// The TV board asking "what changed?" instead of re-downloading everything.
//
// It used to pull 90 days of sales (193 kB measured) plus every delivery
// assignment, every 30 seconds, around the clock - about 19 GB a month
// against a 5 GB allowance. That is what put the Supabase account over
// quota.
//
// The two things that can go badly wrong with incremental sync, and that
// these pin down:
//   1. a DELETED row never disappears, because an incremental poll only
//      ever hears about rows that still exist;
//   2. the watermark comes from the screen's clock instead of the
//      database's, so a TV with a drifting clock skips rows for ever.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const HELPERS = `
  window.__calls = [];      // every query the page built
  window.__sales = [];      // what the stubbed table holds
  window.__assign = [];

  function rowsFor(table){ return table === 'sales' ? window.__sales : window.__assign; }

  // sb is declared const in the dashboard, so replace its from() rather
  // than the client itself.
  window.stubSb = function(){
    sb.from = function(table){
        const q = { table: table, gte: {}, cols: null };
        const api = {
          select: function(c){ q.cols = c; return api; },
          gte: function(col, val){ q.gte[col] = val; return api; },
          order: function(){ return api; },
          limit: function(){ return api; },
          eq: function(){ return api; },
          then: function(res, rej){
            window.__calls.push(JSON.parse(JSON.stringify(q)));
            let rows = rowsFor(table).slice();
            // The stub applies the updated_at filter the way the server would.
            if (q.gte.updated_at) rows = rows.filter(r => r.updated_at >= q.gte.updated_at);
            return Promise.resolve({ data: rows, error: null }).then(res, rej);
          }
        };
        return api;
    };
  };

  window.mkSale = function(id, customer, updated){
    return { id: id, sale_date: '2026-11-20', delivery_date: '2026-11-21',
      payment_due: '2026-12-05', payment_term: '14 days', followup_date: null,
      created_at: '2026-11-20T08:00:00+02:00', updated_at: updated,
      customer: customer, location: 'Harare', litres: 10000, fuel_type: 'Diesel',
      rep_name: 'Tom Eager', status: 'pending', paid: false, invoiced: false, notes: '' };
  };

  window.lastCalls = function(n){ return window.__calls.slice(-n); };
  window.clearCalls = function(){ window.__calls = []; };
`;

async function boot(page){
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,160)); });
  await page.goto('/dashboard/');
  await page.waitForTimeout(2000);
  await page.evaluate(HELPERS);
  await page.evaluate(`
    stubSb();
    resetSync();
    window.__sales = [ mkSale(1,'Alpha','2026-11-26T08:00:00+02:00'),
                       mkSale(2,'Beta', '2026-11-26T09:00:00+02:00') ];
    window.__assign = [];
    loadFleet = async () => {};
    renderAll = () => {};
    loadCachedData = () => { window.__fellBack = true; };
  `);
  return errs;
}

test('the first poll is a full load, the second asks only what changed', async ({ page }) => {
  const errs = await boot(page);

  await page.evaluate(`clearCalls(); fetchData()`);
  await page.waitForTimeout(250);
  let calls = await page.evaluate('lastCalls(2)');
  expect(calls[0].table).toBe('sales');
  expect(calls[0].gte.updated_at).toBeUndefined();          // full
  expect(calls[0].gte.sale_date).toBeTruthy();              // still windowed

  await page.evaluate(`clearCalls(); fetchData()`);
  await page.waitForTimeout(250);
  calls = await page.evaluate('lastCalls(2)');
  expect(calls[0].gte.updated_at).toBe('2026-11-26T09:00:00+02:00');  // newest seen
  expect(realErrors(errs)).toEqual([]);
});

test('an unchanged poll brings back nothing and leaves the board alone', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`fetchData()`);
  await page.waitForTimeout(250);
  const n1 = await page.evaluate('allSales.length');

  await page.evaluate(`fetchData()`);
  await page.waitForTimeout(250);
  expect(await page.evaluate('allSales.length')).toBe(n1);
  expect(await page.evaluate('allSales.map(s=>s.customer).sort().join()')).toBe('Alpha,Beta');
  expect(realErrors(errs)).toEqual([]);
});

test('a changed row merges in without re-downloading the rest', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`fetchData()`);
  await page.waitForTimeout(250);

  // Alpha is renamed and stamped later than the watermark.
  await page.evaluate(`
    window.__sales[0] = mkSale(1,'Alpha Renamed','2026-11-26T10:00:00+02:00');
    clearCalls(); fetchData();
  `);
  await page.waitForTimeout(250);

  expect(await page.evaluate('allSales.length')).toBe(2);          // not duplicated
  expect(await page.evaluate("allSales.map(s=>s.customer).sort().join()"))
    .toBe('Alpha Renamed,Beta');
  expect(realErrors(errs)).toEqual([]);
});

test('a new order arrives on the next poll', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`fetchData()`);
  await page.waitForTimeout(250);

  await page.evaluate(`
    window.__sales.push(mkSale(3,'Gamma','2026-11-26T11:00:00+02:00'));
    fetchData();
  `);
  await page.waitForTimeout(250);

  expect(await page.evaluate('allSales.length')).toBe(3);
  expect(await page.evaluate("allSales.some(s=>s.customer==='Gamma')")).toBe(true);
  expect(realErrors(errs)).toEqual([]);
});

test('a DELETED sale survives an incremental poll but dies on the full reload', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`fetchData()`);
  await page.waitForTimeout(250);

  // Beta is deleted. An incremental poll cannot possibly know.
  await page.evaluate(`window.__sales = window.__sales.filter(s => s.id !== 2); fetchData();`);
  await page.waitForTimeout(250);
  expect(await page.evaluate('allSales.length')).toBe(2);   // still there, as expected

  // Ten minutes pass: the reconcile runs and it goes.
  await page.evaluate(`SYNC.sales.lastFull = Date.now() - (11*60*1000); clearCalls(); fetchData();`);
  await page.waitForTimeout(250);

  const calls = await page.evaluate('lastCalls(2)');
  expect(calls[0].gte.updated_at).toBeUndefined();          // a real full load
  expect(await page.evaluate('allSales.length')).toBe(1);
  expect(await page.evaluate("allSales[0].customer")).toBe('Alpha');
  expect(realErrors(errs)).toEqual([]);
});

test("the watermark comes from the data, not this screen's clock", async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`fetchData()`);
  await page.waitForTimeout(250);

  // Whatever the browser thinks the time is, the mark is the newest
  // updated_at that actually arrived.
  expect(await page.evaluate('SYNC.sales.mark')).toBe('2026-11-26T09:00:00+02:00');

  // A row stamped in the past must still be asked for on the next poll,
  // which is why the filter is gte rather than gt.
  await page.evaluate(`clearCalls(); fetchData()`);
  await page.waitForTimeout(250);
  expect(await page.evaluate('lastCalls(2)[0].gte.updated_at')).toBe('2026-11-26T09:00:00+02:00');
  expect(realErrors(errs)).toEqual([]);
});

test('a failed poll falls back to cache and forces a full load next time', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`fetchData()`);
  await page.waitForTimeout(250);

  await page.evaluate(`
    window.__good = sb.from;
    sb.from = () => ({ select:()=>({ gte:()=>({ gte:()=>({ then:(r,j)=>Promise.reject(new Error('boom')).then(r,j) }) }) }) });
    window.__fellBack = false;
    fetchData().then(() => { sb.from = window.__good; });
  `);
  await page.waitForTimeout(300);

  expect(await page.evaluate('window.__fellBack')).toBe(true);
  expect(await page.evaluate('SYNC.sales.mark')).toBeNull();   // next poll is full
  expect(realErrors(errs)).toEqual([]);
});

test('assignments sync the same way and stay bounded', async ({ page }) => {
  const errs = await boot(page);
  await page.evaluate(`
    window.__assign = [{ sale_id:1, vehicle_id:'v1', trailer_id:null, driver_id:'d1',
      pump_unit_id:null, assigned_at:'2026-11-25T08:00:00+02:00', assigned_by:'Munya',
      seen_by_rep_at:null, en_route_at:null, en_route_by:null,
      updated_at:'2026-11-25T08:00:00+02:00' }];
    clearCalls(); fetchData();
  `);
  await page.waitForTimeout(250);

  const calls = await page.evaluate('lastCalls(2)');
  const assignCall = calls.find(c => c.table === 'delivery_assignment');
  expect(assignCall).toBeTruthy();
  expect(assignCall.gte.assigned_at).toBeTruthy();            // no longer unbounded
  expect(await page.evaluate("ASSIGN['1'].vehicle_id")).toBe('v1');
  expect(realErrors(errs)).toEqual([]);
});
