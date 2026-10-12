const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// A horse and tanker (SH + ST) carries up to 40,000 L and cannot discharge on
// its own - it needs a pump unit alongside. A rigid (SR) carries 18,000 L and
// has its own pump, so it never needs one. Getting that backwards sends a
// truck to a customer that cannot offload, so it is worth pinning down.

const FIXTURE = {
  vehicles: [
    { id: 'v-tank',  fleet_no: 'SH01', reg_no: 'AEZ 9005', needs_pump: true,
      default_driver_id: 'd1', default_trailer_id: 't1' },
    { id: 'v-rigid', fleet_no: 'SR02', reg_no: 'ACQ 3752', needs_pump: false,
      default_driver_id: 'd2', default_trailer_id: null },
  ],
  trailers: [{ id: 't1', trailer_no: 'ST01', reg_no: 'ACZ 9014' }],
  drivers: [
    { id: 'd1', full_name: 'Pachavo Chitsa', phone: '00263772913225' },
    { id: 'd2', full_name: 'Dennis Chitara', phone: '00263772885979' },
    { id: 'dp', full_name: 'Bernard',        phone: '00263773259308' },
  ],
  pumps: [
    { id: 'p1', unit_no: 'SP01', reg_no: 'AFU 6092', driver_id: 'dp', is_hired: false },
    { id: 'p3', unit_no: 'SP03', reg_no: null,       driver_id: null, is_hired: true },
  ],
};

test('the pump field shows for a tanker and hides for a rigid', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(fix => {
    FLEET = fix;
    rigPumpOptions('');
    const wrap = document.getElementById('rig-pump-wrap');
    const sel = document.getElementById('rig-vehicle');
    sel.innerHTML = '<option value="v-tank">t</option><option value="v-rigid">r</option>';

    sel.value = 'v-tank';  rigPumpVisibility();
    const onTanker = getComputedStyle(wrap).display;

    sel.value = 'v-rigid'; rigPumpVisibility();
    const onRigid = getComputedStyle(wrap).display;
    const clearedOnRigid = document.getElementById('rig-pump').value;

    sel.value = 'v-tank';  rigPumpVisibility();
    return {
      onTanker, onRigid, clearedOnRigid,
      options: [...document.getElementById('rig-pump').options].map(o => o.textContent.trim()),
    };
  }, FIXTURE);
  console.log(JSON.stringify(out, null, 1));

  expect(out.onTanker).not.toBe('none');   // SH01 pulls a tanker - must be offered
  expect(out.onRigid).toBe('none');        // SR02 has its own pump
  expect(out.clearedOnRigid).toBe('');     // and must not carry a stale choice

  // Ours are named by their driver; a hired unit says so instead of looking
  // like a unit with a missing driver.
  expect(out.options.join(' | ')).toContain('SP01');
  expect(out.options.join(' | ')).toContain('Bernard');
  expect(out.options.join(' | ')).toContain('SP03');
  expect(out.options.join(' | ')).toContain('hired in');

  expect(errs).toEqual([]);
});

// The office books the truck before it knows which pump is free, so a tanker
// must save with the pump still to come. SR01 is a second case of the same
// idea: the 3,500 L runabout goes out with whoever is available, so it must
// save with no driver at all.
test('a tanker saves with the pump still to come, and SR01 with no driver', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(async fix => {
    FLEET = {
      ...fix,
      vehicles: fix.vehicles.concat([{
        id: 'v-small', fleet_no: 'SR01', reg_no: 'ACQ 3840',
        needs_pump: false, driver_optional: true, capacity_litres: 3500,
        default_driver_id: null, default_trailer_id: null,
      }]),
    };
    ASSIGN = {};
    isFirstLoad = true;
    allSales = [{ id: 1, customer: 'Test Co', litres: 40000, status: 'pending',
                  delivered: false, date: '2026-10-12', deliveryDate: '2026-10-13',
                  rep: 'Tom', location: 'Harare', fuelType: 'Diesel', notes: '' }];
    rigSaleId = '1';

    // sb is a const, but its methods are not - swap out the one call saveRig makes.
    let sent = null;
    sb.from = () => ({ upsert: async row => { sent = row; return { error: null }; } });

    document.getElementById('rig-vehicle').innerHTML =
      '<option value=""></option><option value="v-tank">t</option>' +
      '<option value="v-rigid">r</option><option value="v-small">s</option>';
    document.getElementById('rig-driver').innerHTML =
      '<option value=""></option><option value="d1">Pachavo</option>';
    rigPumpOptions('');

    const err = document.getElementById('rig-err');
    const attempt = async (veh, drv, pump) => {
      sent = null;
      err.textContent = '';
      // A successful save calls closeRig(), which clears rigSaleId - so each
      // attempt has to re-open on the same sale.
      rigSaleId = '1';
      document.getElementById('rig-vehicle').value = veh;
      document.getElementById('rig-driver').value = drv;
      document.getElementById('rig-pump').value = pump;
      await saveRig();
      return { error: err.textContent, saved: sent };
    };

    return {
      tankerNoPump:   await attempt('v-tank',  'd1', ''),
      tankerWithPump: await attempt('v-tank',  'd1', 'p1'),
      smallNoDriver:  await attempt('v-small', '',   ''),
      rigidNoDriver:  await attempt('v-rigid', '',   ''),
    };
  }, FIXTURE);
  console.log(JSON.stringify(out, null, 1));

  // A tanker with no pump yet must still save - the pump is added later.
  expect(out.tankerNoPump.error).toBe('');
  expect(out.tankerNoPump.saved).not.toBeNull();
  expect(out.tankerNoPump.saved.pump_unit_id).toBeNull();

  // With a pump it saves, and the pump goes on the row.
  expect(out.tankerWithPump.saved).not.toBeNull();
  expect(out.tankerWithPump.saved.pump_unit_id).toBe('p1');

  // SR01 saves with nobody named - that is how the yard runs it.
  expect(out.smallNoDriver.error).toBe('');
  expect(out.smallNoDriver.saved).not.toBeNull();
  expect(out.smallNoDriver.saved.driver_id).toBeNull();

  // Every other truck still needs a driver the rep can ring.
  expect(out.rigidNoDriver.error).toContain('Pick a driver');
  expect(out.rigidNoDriver.saved).toBeNull();

  expect(errs).toEqual([]);
});

// Allowing the pump to be added later only works if the board shows which
// loads are still waiting for one. Without this the tanker just looks done.
test('a tanker still waiting for a pump is marked on the board', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(fix => {
    FLEET = fix;
    ASSIGN = {
      '1': { sale_id: 1, vehicle_id: 'v-tank',  driver_id: 'd1', pump_unit_id: null },
      '2': { sale_id: 2, vehicle_id: 'v-tank',  driver_id: 'd1', pump_unit_id: 'p1' },
      '3': { sale_id: 3, vehicle_id: 'v-rigid', driver_id: 'd2', pump_unit_id: null },
    };
    return { waiting: rigBadge(1), done: rigBadge(2), rigid: rigBadge(3), unassigned: rigBadge(99) };
  }, FIXTURE);
  console.log(JSON.stringify(out, null, 1));

  // Waiting on a pump: amber, warning triangle, and a tooltip saying so.
  expect(out.waiting).toContain('rigbtn warn');
  expect(out.waiting).toContain('&#9888;');
  expect(out.waiting).toContain('No pumping unit yet');

  // Sorted: back to the ordinary truck badge.
  expect(out.done).toContain('rigbtn on');
  expect(out.done).toContain('&#128666;');
  expect(out.done).not.toContain('warn');

  // A rigid never needs one, so it must never be flagged as missing it.
  expect(out.rigid).toContain('rigbtn on');
  expect(out.rigid).not.toContain('warn');

  // Nothing assigned at all is still just the invitation to assign.
  expect(out.unassigned).toContain('Assign');

  expect(errs).toEqual([]);
});

test('the rep is told which of the four pump situations applies', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('/');
  await page.waitForTimeout(2300);

  const out = await page.evaluate(fix => {
    const map = rows => { const o = {}; rows.forEach(r => { o[String(r.id)] = r; }); return o; };
    RIG = { assign: {}, vehicles: map(fix.vehicles), trailers: map(fix.trailers),
            drivers: map(fix.drivers), pumps: map(fix.pumps) };
    const row = (k, v, extra) => '<' + k + '>' + v + (extra || '');
    return {
      rigid:      repPumpRow(row, {},                    { needs_pump: false }),
      assigned:   repPumpRow(row, { pump_unit_id: 'p1' }, { needs_pump: true }),
      hired:      repPumpRow(row, { pump_unit_id: 'p3' }, { needs_pump: true }),
      notYet:     repPumpRow(row, {},                    { needs_pump: true }),
      noVehicle:  repPumpRow(row, {},                    null),
    };
  }, FIXTURE);
  console.log(JSON.stringify(out, null, 1));

  // A rigid must say so, not show a blank that reads as an oversight.
  expect(out.rigid).toContain('Not needed');
  expect(out.rigid).toContain('its own pump');

  // Ours: the rep gets the reg, the driver and a number that dials.
  expect(out.assigned).toContain('SP01');
  expect(out.assigned).toContain('AFU 6092');
  expect(out.assigned).toContain('Bernard');
  expect(out.assigned).toContain('href="tel:00263773259308"');

  // Hired in: we do not have the details, and the rep is told that plainly
  // rather than being shown empty fields.
  expect(out.hired).toContain('SP03');
  expect(out.hired).toContain('hired in');
  expect(out.hired).toContain('message you');
  expect(out.hired).not.toContain('href="tel:');

  // A tanker with nothing assigned is a live gap, not a blank.
  expect(out.notYet).toContain('Not assigned yet');

  // Missing vehicle must not throw.
  expect(out.noVehicle).toContain('Not needed');

  expect(errs).toEqual([]);
});

// The TV dashboard and the admin Overview tab are duplicated code. A fix that
// lands in one and not the other has bitten this project repeatedly.
test('both copies of the assign panel carry the same pump logic', () => {
  // admin's copy lives inside the OverviewApp IIFE, so its closing brace is
  // indented. Find the brace at the function's OWN indent, not at column 0.
  const grab = (file, fn) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = src.indexOf('function ' + fn + '(');
    expect(start, file + ' is missing ' + fn).toBeGreaterThan(-1);
    const lineStart = src.lastIndexOf('\n', start) + 1;
    const indent = src.slice(lineStart, start);
    const end = src.indexOf('\n' + indent + '}', start);
    expect(end, file + ': could not find the end of ' + fn).toBeGreaterThan(start);
    return src.slice(start, end).split(/\r?\n/).map(l => l.trim()).join('\n');
  };
  for (const fn of ['rigPumpOptions', 'rigPumpVisibility']) {
    expect(grab('admin/index.html', fn), fn).toBe(grab('dashboard/index.html', fn));
  }
});
