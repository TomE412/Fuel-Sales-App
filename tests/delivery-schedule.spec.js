const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The Delivery schedule button turns the outstanding book into one WhatsApp
// message, grouped by the day each load was promised. It exists because
// supply has to be ordered against what has already been committed, so the
// per-day and per-fuel litres are the point, not the customer list.

const day = n => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
};

const mk = (customer, litres, off, fuel, location) => ({
  id: Math.abs((customer + off).split('').reduce((a, c) => a + c.charCodeAt(0), 0)),
  customer, litres, fuelType: fuel || 'Diesel', location: location || 'Harare',
  deliveryDate: off === null ? '' : day(off), date: day(-2), rep: 'Molly Gwatidah',
  status: 'pending', delivered: false, invoiced: false, paid: false, notes: '',
});

const SALES = [
  mk('Petroflex', 15000, -2, 'Diesel', 'Shamva'),
  mk('Grainco (Private) Limited', 8000, -1, 'Diesel', 'Headlands'),
  mk('Sunny Yi Feng Tiles', 40000, 0, 'Diesel', 'Norton'),
  mk('Dynamic Logistics', 2000, 0, 'Petrol', 'Westgate'),
  mk('Proton Bakers (Pvt) Ltd', 25000, 1, 'Diesel', 'Harare'),
  mk('JR Goddard Contracting', 40000, 3, 'Diesel', 'Gweru'),
  mk('Nemchem International', 6000, 3, 'Paraffin', 'Msasa'),
  mk('Celibel Investments', 8000, null, 'Diesel', 'Domboshawa'),
];

const buildMessage = page => page.evaluate(sales => {
  isFirstLoad = true;
  allSales = sales;
  renderAll();                 // BOARD is filled by the render, as in the app
  return scheduleMessage();
}, SALES);

test('the schedule groups by promised day and totals the fuel', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const msg = await buildMessage(page);
  console.log('\n--- DELIVERY SCHEDULE ---\n' + msg + '\n');

  // The headline number is what supply gets ordered against.
  expect(msg).toContain('*Still to deliver: 144,000 L*');
  expect(msg).toContain('Diesel 136,000 L');
  expect(msg).toContain('Petrol 2,000 L');
  expect(msg).toContain('Paraffin 6,000 L');

  // Days are labelled in the words people plan in.
  expect(msg).toMatch(/\(LATE by 2 days\)/);
  expect(msg).toMatch(/\(LATE by 1 day\)/);     // singular
  expect(msg).toContain('(TODAY)');
  expect(msg).toContain('(TOMORROW)');
  expect(msg).toContain('NO DATE AGREED YET');

  // Each day carries its own total - that is the day's supply requirement.
  expect(msg).toContain('42,000 L');            // today: 40,000 + 2,000
  expect(msg).toContain('46,000 L');            // in 3 days: 40,000 + 6,000

  // Customers appear under their day with litres, fuel and where.
  expect(msg).toContain('• Sunny Yi Feng Tiles  —  40,000 L Diesel  —  Norton');

  // WhatsApp formatting only; no columns to reflow into mush.
  expect(msg).toContain('*SKELSEE DELIVERY SCHEDULE*');
  expect(msg).not.toContain('|');

  expect(msg).toContain('8 orders over 6 days');

  expect(errs).toEqual([]);
});

test('the message always matches what the panel is showing', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(sales => {
    isFirstLoad = true;
    allSales = sales;
    renderAll();
    const onScreen = [...document.querySelectorAll('#week-list .order-row .order-name')]
      .map(e => e.textContent.replace(/Diesel|Petrol|Paraffin|NEW/g, '').trim());
    const msg = scheduleMessage();
    // Order of customers as the message lists them.
    const inMsg = msg.split(String.fromCharCode(10))
      .filter(l => l.indexOf('•') === 0)
      .map(l => l.slice(1).split('  —  ')[0].trim());
    return { onScreen, inMsg, count: document.getElementById('week-count').textContent };
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  // Same customers, same order. If these ever drift, somebody sends a
  // schedule that does not match the board they are looking at.
  expect(out.inMsg).toEqual(out.onScreen);
  expect(out.count).toContain('144,000 L');
});

test('an empty board says so rather than sending a blank message', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);
  const msg = await page.evaluate(() => {
    isFirstLoad = true; allSales = []; renderAll(); return scheduleMessage();
  });
  expect(msg).toContain('Nothing outstanding');
});

// Duplicated code in two apps, as ever.
test('both apps build the same schedule message', () => {
  const grab = (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = src.indexOf('function scheduleMessage(){');
    expect(start, file + ' is missing scheduleMessage').toBeGreaterThan(-1);
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const indent = src.slice(lineStart, start);
    const end = src.indexOf('\n' + indent + '}', start);
    return src.slice(start, end).split(/\r?\n/).map(l => l.trim()).join('\n');
  };
  expect(grab('admin/index.html')).toBe(grab('dashboard/index.html'));
});
