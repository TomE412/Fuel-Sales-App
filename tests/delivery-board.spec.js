const { test, expect } = require('@playwright/test');

// The Overview board is one list now, ordered by the delivery date the rep
// put on the order. The rules that matter on the wall:
//   - an order past its date stays pinned at the top until someone ticks it
//   - an order for next week sits at the bottom and walks up
//   - nothing ages off the list; only Mark delivered removes it
//   - an order with no delivery date sinks below the dated ones
// Driven through the dashboard copy, whose renderAll and allSales are at top
// level. Admin runs the same code inside the OverviewApp IIFE, so its state
// is private and cannot be driven from a test - the shared logic is here.

const day = n => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
};

// One of each case, deliberately fed in the wrong order so a pass cannot
// come from the fixture already being sorted.
const FIXTURE = () => ([
  { id: 1, customer: 'Future Ten',  litres: 10000, deliveryDate: day(10), date: day(-1), rep: 'Tom',   location: 'Gweru',     status: 'pending' },
  { id: 2, customer: 'Late Three',  litres: 15000, deliveryDate: day(-3), date: day(-9), rep: 'Molly', location: 'Shamva',    status: 'pending' },
  { id: 3, customer: 'No Date',     litres:  8000, deliveryDate: '',      date: day(-2), rep: 'Niel',  location: 'Harare',    status: 'pending' },
  { id: 4, customer: 'Due Today',   litres:  2000, deliveryDate: day(0),  date: day(-4), rep: 'Molly', location: 'Westgate',  status: 'pending' },
  { id: 5, customer: 'Late One',    litres:  5000, deliveryDate: day(-1), date: day(-6), rep: 'Tom',   location: 'Mvuma',     status: 'pending' },
  { id: 6, customer: 'Future Two',  litres: 40000, deliveryDate: day(2),  date: day(-1), rep: 'Tom',   location: 'Norton',    status: 'pending' },
  { id: 7, customer: 'Ticked Off',  litres:  9000, deliveryDate: day(-1), date: day(-5), rep: 'Niel',  location: 'Beatrice',  status: 'delivered' },
  { id: 8, customer: 'Cancelled',   litres: 99000, deliveryDate: day(1),  date: day(-3), rep: 'Tom',   location: 'Mazowe',    status: 'cancelled' },
].map(s => ({ ...s, delivered: s.status === 'delivered', fuelType: 'Diesel', notes: '' })));

test('the board is one list, soonest first, and nothing ages off it', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 90)); });
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(fix => {
    allSales = fix;
    isFirstLoad = true;          // suppress the NEW pills and the alert sound
    renderAll();
    const rows = [...document.querySelectorAll('#week-list .order-row')];
    return {
      // The two old panels are gone, replaced by one.
      todayPanelGone: !document.getElementById('today-list'),
      order: rows.map(r => r.querySelector('.order-name').textContent.trim()),
      count: document.getElementById('week-count').textContent,
      metas: rows.map(r => r.querySelector('.order-meta').textContent.trim()),
      // Fixed cells: the rig button, litres and Mark delivered all sit on
      // the row, which is what buys the density.
      cells: rows.length ? {
        rig: !!rows[0].querySelector('.ord-rig .rigbtn'),
        lit: rows[0].querySelector('.ord-lit').textContent.trim(),
        del: !!rows[0].querySelector('.ord-del .deliver-btn'),
      } : null,
      delivered: [...document.querySelectorAll('#delivered-list .order-row')]
        .map(r => r.querySelector('.order-name').textContent.trim()),
    };
  }, FIXTURE());
  console.log(JSON.stringify(out, null, 1));

  expect(out.todayPanelGone).toBe(true);

  // Oldest late at the very top, then today, then ahead by date, undated last.
  expect(out.order.map(n => n.replace('Diesel', '').trim())).toEqual([
    'Late Three', 'Late One', 'Due Today', 'Future Two', 'Future Ten', 'No Date',
  ]);

  // Cancelled is out; delivered has moved to its own panel.
  expect(out.order.join(' ')).not.toContain('Cancelled');
  expect(out.order.join(' ')).not.toContain('Ticked Off');
  expect(out.delivered.join(' ')).toContain('Ticked Off');

  // Six orders, 80,000 L — the figure the undelivered tile has to match.
  expect(out.count).toBe('6 · 80,000 L');

  // Lateness is in words as well as colour, because a long customer name
  // truncates and must never be able to hide it.
  expect(out.metas[0]).toContain('3 days late');
  expect(out.metas[1]).toContain('1 day late');       // singular
  expect(out.metas[2]).toContain('today');
  expect(out.metas[3]).not.toMatch(/late|today/);
  expect(out.metas[5]).toContain('no delivery date');

  expect(out.cells.rig).toBe(true);
  expect(out.cells.lit).toBe('15,000 L');
  expect(out.cells.del).toBe(true);

  expect(errs).toEqual([]);
});
