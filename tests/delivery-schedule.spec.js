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

let nextId = 9000;
const mk = (customer, litres, off, fuel, location) => ({
  id: nextId++,
  customer, litres, fuelType: fuel || 'Diesel', location: location || 'Harare',
  deliveryDate: off === null ? '' : day(off), date: day(-2), rep: 'Molly Gwatidah',
  status: 'pending', delivered: false, invoiced: false, paid: false, notes: '',
});

const SALES = [
  mk('Petroflex', 15000, -2, 'Diesel', 'Shamva'),                    // 9000
  mk('Grainco (Private) Limited', 8000, -1, 'Diesel', 'Headlands'),  // 9001
  mk('Sunny Yi Feng Tiles', 40000, 0, 'Diesel', 'Norton'),           // 9002
  mk('Dynamic Logistics', 2000, 0, 'Petrol', 'Westgate'),            // 9003
  mk('Proton Bakers (Pvt) Ltd', 25000, 1, 'Diesel', 'Harare'),       // 9004
  mk('JR Goddard Contracting', 40000, 3, 'Diesel', 'Gweru'),         // 9005
  mk('Nemchem International', 6000, 3, 'Paraffin', 'Msasa'),         // 9006
  mk('Celibel Investments', 8000, null, 'Diesel', 'Domboshawa'),     // 9007
];

// Who is on what. Deliberately leaves several loads with no truck, because
// those are the ones a planner is hunting for.
const FLEET = {
  vehicles: [
    { id: 'v7', fleet_no: 'SH07', reg_no: 'AGL 4918', needs_pump: true,
      default_driver_id: 'd-amos', default_trailer_id: null },
    { id: 'v2', fleet_no: 'SR02', reg_no: 'ACQ 3752', needs_pump: false,
      default_driver_id: 'd-dennis', default_trailer_id: null },
    { id: 'v1', fleet_no: 'SR01', reg_no: 'ACQ 3840', needs_pump: false,
      driver_optional: true, default_driver_id: null, default_trailer_id: null },
  ],
  trailers: [],
  drivers: [
    { id: 'd-amos',   full_name: 'Amos Mugarapanyama', phone: '00263772769730' },
    { id: 'd-dennis', full_name: 'Dennis Chitara',     phone: '00263772885979' },
  ],
  pumps: [],
};

const ASSIGN = {
  '9002': { sale_id: 9002, vehicle_id: 'v7', driver_id: 'd-amos' },
  '9004': { sale_id: 9004, vehicle_id: 'v2', driver_id: 'd-dennis' },
  '9005': { sale_id: 9005, vehicle_id: 'v1', driver_id: null },   // the runabout
};

const buildMessage = page => page.evaluate(([sales, fleet, assign]) => {
  isFirstLoad = true;
  allSales = sales;
  FLEET = fleet;
  ASSIGN = assign;
  renderAll();                 // BOARD is filled by the render, as in the app
  return scheduleMessage();
}, [SALES, FLEET, ASSIGN]);

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
  // Each line now ends with the rig, in the form the yard talks in.
  expect(msg).toContain(
    '• Sunny Yi Feng Tiles  —  40,000 L Diesel  —  Norton  —  SH07 Amos');

  // A truck with no named driver still names the truck.
  expect(msg).toContain('SR01');

  // And a load nobody has put a truck on says so - that is the gap the
  // whole message exists to surface.
  expect(msg).toContain('no truck yet');

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
