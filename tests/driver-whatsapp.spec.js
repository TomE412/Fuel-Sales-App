const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Munya runs the trucks. Once he has put a rig on a job he sends the driver
// the whole thing on WhatsApp, so the assign panel builds that message for him
// in one paste. Two things must hold: everything the driver needs is in it,
// and nothing commercial is.

const FLEET = {
  vehicles: [
    { id: 'v-tank', fleet_no: 'SH01', reg_no: 'AEZ 9005', model: 'VOLVO', needs_pump: true,
      capacity_litres: 40000, default_driver_id: 'd1', default_trailer_id: 't1' },
    { id: 'v-rigid', fleet_no: 'SR02', reg_no: 'ACQ 3752', model: 'VOLVO', needs_pump: false,
      capacity_litres: 18000, default_driver_id: 'd2', default_trailer_id: null },
  ],
  trailers: [{ id: 't1', trailer_no: 'ST01', reg_no: 'ACZ 9014', make: 'Trailer', model: 'Tanker' }],
  drivers: [
    { id: 'd1', full_name: 'Pachavo Chitsa', phone: '00263772913225' },
    { id: 'd2', full_name: 'Dennis Chitara', phone: '00263772885979' },
    { id: 'dp', full_name: 'Bernard',        phone: '00263773259308' },
  ],
  pumps: [
    { id: 'p1', unit_no: 'SP01', reg_no: 'AFU 6092', driver_id: 'dp', is_hired: false },
    { id: 'p3', unit_no: 'SP03', reg_no: null, driver_id: null, is_hired: true },
  ],
};

const SALES = [
  { id: 3451, customer: 'Olivine Industries', location: 'Birmingham, Harare', litres: 18000,
    fuelType: 'Diesel', deliveryDate: '2026-10-16', date: '2026-10-15', rep: 'Molly Gwatidah',
    status: 'pending', delivered: false, invoiced: false, paid: false,
    price_per_litre: 1.85, payment_term: '14 days',
    notes: 'Gate round the back, ask for Joseph https://maps.app.goo.gl/x7Kp2' },
  { id: 3452, customer: 'Yellowcob t/a Spar', location: 'Westgate', litres: 2000,
    fuelType: 'Petrol', deliveryDate: '2026-10-16', date: '2026-10-15', rep: 'Molly Gwatidah',
    status: 'pending', delivered: false, invoiced: false, paid: false, notes: '' },
];

const build = (page, saleId, opts = {}) => page.evaluate(([fleet, sales, id, o]) => {
  FLEET = fleet;
  ASSIGN = {};
  allSales = sales;
  openRig(String(id));
  if (o.vehicle) {
    document.getElementById('rig-vehicle').value = o.vehicle;
    rigVehiclePicked();
  }
  if (o.pump !== undefined) document.getElementById('rig-pump').value = o.pump;
  return driverMessage();
}, [FLEET, SALES, saleId, opts]);

test('the driver gets the whole job and none of the money', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const msg = await build(page, 3451, { vehicle: 'v-tank', pump: 'p1' });
  console.log('\n--- TANKER JOB ---\n' + msg + '\n');

  // Everything the driver needs to do the run.
  expect(msg).toContain('Olivine Industries');
  expect(msg).toContain('Birmingham, Harare');
  expect(msg).toContain('16/10/2026');
  expect(msg).toContain('18,000 L');
  expect(msg).toContain('Diesel');
  expect(msg).toContain('SH01');
  expect(msg).toContain('AEZ 9005');
  expect(msg).toContain('ST01');
  expect(msg).toContain('Pachavo Chitsa');
  expect(msg).toContain('SP01');
  expect(msg).toContain('Bernard');
  expect(msg).toContain('Ref: 3451');

  // The maps link must survive intact or the whole point of it is lost.
  expect(msg).toContain('https://maps.app.goo.gl/x7Kp2');

  // And nothing commercial. This message gets forwarded on.
  expect(msg).not.toContain('1.85');
  expect(msg).not.toMatch(/\$/);
  expect(msg).not.toContain('14 days');

  // WhatsApp bold, and no table characters that would reflow into mush.
  expect(msg).toContain('*Customer:*');
  expect(msg).not.toContain('|');

  expect(errs).toEqual([]);
});

test('a rigid shows no trailer or pump, a tanker without one says so', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const rigid = await build(page, 3452, { vehicle: 'v-rigid' });
  console.log('\n--- RIGID JOB ---\n' + rigid + '\n');

  // A rigid pulls no trailer and carries its own pump - neither line belongs.
  expect(rigid).toContain('SR02');
  expect(rigid).not.toContain('Trailer:');
  expect(rigid).not.toContain('Pump unit:');
  // No notes on this sale, so no empty heading.
  expect(rigid).not.toContain('Notes:');

  // A tanker with no pump picked must flag it rather than go out quiet.
  const noPump = await build(page, 3451, { vehicle: 'v-tank', pump: '' });
  expect(noPump).toContain('*Pump unit:* TO BE CONFIRMED');

  // A hired unit says so, and carries no driver we do not have.
  const hired = await build(page, 3451, { vehicle: 'v-tank', pump: 'p3' });
  expect(hired).toContain('SP03');
  expect(hired).toContain('hired in');
});

test('reopening the panel does not leave the last job in the box', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(([fleet, sales]) => {
    FLEET = fleet; ASSIGN = {}; allSales = sales;
    openRig('3451');
    document.getElementById('rig-vehicle').value = 'v-tank';
    rigVehiclePicked();
    const ta = document.getElementById('rig-wa-text');
    ta.value = driverMessage();
    ta.style.display = '';
    const before = { text: ta.value.slice(0, 40), shown: ta.style.display };
    openRig('3452');            // next job
    return { before, after: { text: ta.value, shown: ta.style.display } };
  }, [FLEET, SALES]);
  console.log(JSON.stringify(out, null, 1));

  // Sending the previous customer's job to the next driver would be a real
  // mistake, so the box empties on open.
  expect(out.before.text).toContain('SKELSEE');
  expect(out.after.text).toBe('');
  expect(out.after.shown).toBe('none');
});

// The two apps are duplicated code; this feature went into both.
test('both apps build the same driver message', () => {
  const grab = (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = src.indexOf('function driverMessage(){');
    expect(start, file + ' is missing driverMessage').toBeGreaterThan(-1);
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const indent = src.slice(lineStart, start);
    const end = src.indexOf('\n' + indent + '}', start);
    return src.slice(start, end).split(/\r?\n/).map(l => l.trim()).join('\n');
  };
  expect(grab('admin/index.html')).toBe(grab('dashboard/index.html'));
});
