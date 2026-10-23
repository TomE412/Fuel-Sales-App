const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// "All reps" on the Rep Performance report: every rep's volume side by side,
// month by month. Driven with the real October 2026 figures so the assertions
// are against numbers that actually occurred.
//
// Six series on overlapping lines cannot be made colourblind-safe (checked
// with the dataviz palette validator: green against orange is ΔE 3.2 where 8
// is the target), so the six-way comparison is bars and the line chart is
// capped at four with every line labelled.

const REAL = {
  'Molly Gwatidah':        { '2026-07': [563000, 59], '2026-08': [926399, 96], '2026-09': [882757, 99], '2026-10': [742155, 81] },
  'Tom Eager CW':          { '2026-07': [573000, 20], '2026-08': [496000, 15], '2026-09': [791000, 25], '2026-10': [866000, 31] },
  'Tom Eager':             { '2026-07': [409075, 31], '2026-08': [860500, 51], '2026-09': [663000, 50], '2026-10': [263003, 27] },
  'Niel Martin':           { '2026-07': [417388, 16], '2026-08': [202000,  7], '2026-09': [624500, 32], '2026-10': [748388, 33] },
  'Marshall Mukombachoto': { '2026-07': [314300, 13], '2026-08': [372460, 19], '2026-09': [548500, 28], '2026-10': [322170, 17] },
  'Mack Charlie':          { '2026-07': [ 59000,  4], '2026-08': [299000, 19], '2026-09': [167000, 10], '2026-10': [ 89000,  6] },
};

// One row per order, so the order counts and the averages are real too.
const ROWS = [];
Object.keys(REAL).forEach(rep => {
  Object.keys(REAL[rep]).forEach(m => {
    const [litres, orders] = REAL[rep][m];
    for (let i = 0; i < orders; i++) {
      ROWS.push({ rep_name: rep, sale_date: m + '-15', litres: litres / orders,
                  customer: 'C' + i, price_per_litre: 1.8, price_tba: false, cost_price: null });
    }
  });
});

const render = page => page.evaluate(rows => {
  perfRenderAll(new Date(2026, 6, 1), new Date(2026, 10, 1), rows, 'app');
  const cell = (r, c) => {
    const tr = document.querySelectorAll('.cmp-tbl tr')[r];
    return tr ? (tr.children[c] || {}).textContent : null;
  };
  return {
    headers: [...document.querySelectorAll('.cmp-tbl th')].map(t => t.textContent.trim()),
    firstRep: cell(1, 0).trim(),
    firstRepTotal: cell(1, 5),
    firstRepOrders: cell(1, 6),
    firstRepAvg: cell(1, 7),
    allRepsRow: [...document.querySelectorAll('.cmp-tbl tr.cmp-tot td')].map(t => t.textContent.trim()),
    multiples: document.querySelectorAll('.cmp-mult').length,
    barSeries: typeof perfChart1 !== 'undefined' && perfChart1 ? perfChart1.data.datasets.length : 0,
    lineSeries: typeof perfChart2 !== 'undefined' && perfChart2 ? perfChart2.data.datasets.length : 0,
    lineLabels: typeof perfChart2 !== 'undefined' && perfChart2 ? perfChart2.data.datasets.map(d => d.label) : [],
    lineColours: typeof perfChart2 !== 'undefined' && perfChart2 ? perfChart2.data.datasets.map(d => d.borderColor) : [],
    barColours: typeof perfChart1 !== 'undefined' && perfChart1 ? perfChart1.data.datasets.map(d => ({ n: d.label, c: d.backgroundColor })) : [],
  };
}, ROWS);

test('all reps compare side by side, month by month', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/accounts/');
  await page.waitForTimeout(2500);

  const out = await render(page);
  console.log(JSON.stringify(out, null, 1));

  // A column per month in the chosen range, plus the three summary columns.
  expect(out.headers.slice(0, 5)).toEqual(['Rep', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26']);
  expect(out.headers.slice(5)).toEqual(['Total', 'Orders', 'Avg / order']);

  // Molly is top on volume AND on order count - 335 of them.
  expect(out.firstRep).toBe('Molly Gwatidah');
  expect(out.firstRepTotal).toBe('3,114k');
  expect(out.firstRepOrders).toBe('335');
  expect(out.firstRepAvg).toBe('9k');

  // The all-reps row has to tie to the real monthly totals.
  expect(out.allRepsRow[1]).toBe('2,336k');
  expect(out.allRepsRow[2]).toBe('3,156k');
  expect(out.allRepsRow[3]).toBe('3,677k');
  expect(out.allRepsRow[4]).toBe('3,031k');
  expect(out.allRepsRow[5]).toBe('12,200k');
  expect(out.allRepsRow[6]).toBe('789');   // 794 all-time; June's 5 are outside this window

  // One small chart per rep.
  expect(out.multiples).toBe(6);

  // Bars carry all six; the line chart is capped at four.
  expect(out.barSeries).toBe(6);
  expect(out.lineSeries).toBe(4);
  expect(out.lineLabels[3]).toBe('Everyone else (3)');

  expect(errs).toEqual([]);
});

test('colour follows the rep, not the ranking', async ({ page }) => {
  await page.goto('/accounts/');
  await page.waitForTimeout(2500);

  const out = await page.evaluate(rows => {
    const grab = () => { perfRenderAll(new Date(2026, 6, 1), new Date(2026, 10, 1), rows, 'app');
      return perfChart1.data.datasets.map(d => ({ n: d.label, c: d.backgroundColor })); };
    const before = grab();
    // Knock the leader down so the standings change completely.
    const knocked = rows.filter(r => r.rep_name !== 'Molly Gwatidah');
    perfRenderAll(new Date(2026, 6, 1), new Date(2026, 10, 1), knocked, 'app');
    const after = perfChart1.data.datasets.map(d => ({ n: d.label, c: d.backgroundColor }));
    return { before, after };
  }, ROWS);
  console.log(JSON.stringify(out, null, 1));

  // Every rep that survives must keep the colour it had. If colour tracked
  // rank, removing the leader would repaint everyone below.
  const was = Object.fromEntries(out.before.map(d => [d.n, d.c]));
  out.after.forEach(d => {
    expect(d.c, d.n + ' changed colour when the ranking changed').toBe(was[d.n]);
  });
});

// The standalone accounts app and the admin Accounts tab are duplicated code.
test('both apps build the same comparison', () => {
  const grab = (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = src.indexOf('function perfBuildMatrix(');
    expect(start, file + ' is missing perfBuildMatrix').toBeGreaterThan(-1);
    const end = src.indexOf('\n}', src.indexOf('function perfRenderAll('));
    return src.slice(start, end).split(/\r?\n/).map(l => l.trim()).join('\n');
  };
  expect(grab('admin/index.html')).toBe(grab('accounts/index.html'));
});
