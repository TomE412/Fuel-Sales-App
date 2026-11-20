// Orders on the map, and the drag-and-drop fleet panel.
//
// The ops planner and the admin app carry the same map code. ops keeps it in
// globals, admin inside LogisticsApp, so the pure functions are driven
// through whichever scope the app uses.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const APPS = ['/ops/', '/admin/'];
const isAdmin = app => app === '/admin/';

const FIXTURE = `
window.mkFixture = function(){
  var PLACES = [
    { place:'Harare',    latitude:-17.83, longitude:31.05, parent:null },
    { place:'Marondera', latitude:-18.19, longitude:31.55, parent:null },
    { place:'Mutare',    latitude:-18.97, longitude:32.67, parent:null },
    { place:'Norton',    latitude:-17.88, longitude:30.70, parent:null },
    // on file but never given coordinates, so it cannot be drawn
    { place:'Shurugwi',  latitude:null,   longitude:null,  parent:null },
  ];
  var SALES = [
    { id:1, customer:'Border Timbers', location:'Marondera', litres:36000,
      fuel_type:'Diesel', delivery_date:'2026-11-21', status:'pending', delivered_at:null },
    { id:2, customer:'Mukuyu Wines', location:'marondera ', litres:12000,
      fuel_type:'Diesel', delivery_date:'2026-11-21', status:'pending', delivered_at:null },
    { id:3, customer:'Olivine', location:'Birmingham, Harare', litres:18000,
      fuel_type:'Diesel', delivery_date:'2026-11-24', status:'pending', delivered_at:null },
    { id:4, customer:'Khaya Cement', location:'Norton', litres:40000,
      fuel_type:'Diesel', delivery_date:'2026-11-22', status:'pending', delivered_at:null },
    // excluded: already delivered
    { id:5, customer:'Done Co', location:'Mutare', litres:5000,
      fuel_type:'Petrol', delivery_date:'2026-11-10', status:'delivered',
      delivered_at:'2026-11-10T09:00:00+02:00' },
    // excluded: cancelled
    { id:6, customer:'Gone Co', location:'Mutare', litres:5000,
      fuel_type:'Petrol', delivery_date:'2026-11-12', status:'cancelled', delivered_at:null },
    // cannot be drawn: no coordinates on file
    { id:7, customer:'Hill Farm', location:'Shurugwi', litres:9000,
      fuel_type:'Diesel', delivery_date:'2026-11-25', status:'pending', delivered_at:null },
    // cannot be drawn: not a place we know at all
    { id:8, customer:'Bridge Store', location:'Birchenough Bridge', litres:3000,
      fuel_type:'Paraffin', delivery_date:'2026-11-26', status:'pending', delivered_at:null },
  ];
  var FLEETMAP = {
    vehicles: [
      { id:'v1', fleet_no:'SH03', reg_no:'AFJ 2570', capacity_litres:40000,
        driver_optional:false, default_driver_id:'d1', contractor_id:null },
      { id:'v2', fleet_no:'SR01', reg_no:'ACQ 3840', capacity_litres:3500,
        driver_optional:true, default_driver_id:null, contractor_id:null },
      { id:'v9', fleet_no:'ZIM1', reg_no:'ACZ 1234', capacity_litres:40000,
        driver_optional:false, default_driver_id:'d9', contractor_id:'c1' },
    ],
    pumps: [
      { id:'p1', unit_no:'SP01', reg_no:'AFU 6092', driver_id:'d2', contractor_id:null },
    ],
    drivers: [
      { id:'d1', full_name:'Masden Majoni', phone:'0772910076' },
      { id:'d2', full_name:'Bernard', phone:'0773259308' },
      { id:'d9', full_name:'Tapiwa Moyo', phone:'0772123456' },
    ],
    contractors: [{ id:'c1', name:'Zimgo Transport', code:'ZIM' }],
    pos: { 'vehicle:v1': { lat:-17.9, lng:31.0, at:'2026-11-20T06:30:00Z', by:'Munya' } },
    assign: {
      '1': { sale_id:1, vehicle_id:'v1', pump_unit_id:'p1' },
      '4': { sale_id:4, vehicle_id:'v9', pump_unit_id:null },
      '5': { sale_id:5, vehicle_id:'v2', pump_unit_id:null },   // delivered, so not busy
    },
  };
  return { PLACES: PLACES, SALES: SALES, FLEETMAP: FLEETMAP };
};
`;

// Runs fn in whichever scope the app keeps the map code in.
async function inScope(page, app, body) {
  return page.evaluate(([a, fx, src]) => {
    (0, eval)(fx);
    const f = mkFixture();
    const scope = a ? LogisticsApp : window;
    if (a) {
      scope.__seed({ SALES: f.SALES, PLACES: f.PLACES, FLEETMAP: f.FLEETMAP, sb: sb });
    } else {
      SALES = f.SALES; PLACES = f.PLACES; FLEETMAP = f.FLEETMAP;
    }
    return (0, eval)('(' + src + ')')(scope, f);
  }, [isAdmin(app), FIXTURE, body.toString()]);
}

async function boot(page, app) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  await page.goto(app);
  await page.waitForTimeout(2500);
  return errs;
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} the fleet panel is present and wired to its own scope`, async ({ page }) => {
    const errs = await boot(page, app);

    for (const id of ['#fleetlist', '#fleet-cnt', '#fleet-arm']) {
      expect(await page.locator(id).count(), `${app} missing ${id}`).toBe(1);
    }
    // It belongs above the run planner: where things are comes before what a
    // trip would cost.
    const order = await page.evaluate(() => {
      const side = document.querySelector('.mside');
      const heads = [...side.querySelectorAll('.runsec h3')].map(h => h.textContent.trim());
      return heads;
    });
    console.log(app + ' side panel: ' + JSON.stringify(order));
    expect(order[0]).toContain('Where is the fleet');
    expect(order[1]).toContain('Loading where');

    const fns = await page.evaluate(a => {
      const scope = a ? LogisticsApp : window;
      return ['armUnit', 'removeUnit', 'fleetDragStart', 'renderFleetPanel',
              'drawFleet', 'drawOrders', 'orderGroups', 'fleetUnits', 'placeFor']
        .map(n => typeof scope[n]);
    }, isAdmin(app));
    expect(fns.every(x => x === 'function'), `${app} handlers: ${JSON.stringify(fns)}`).toBe(true);

    expect(realErrors(errs)).toEqual([]);
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} matches the town a rep typed against the place list`, async ({ page }) => {
    await boot(page, app);
    const out = await inScope(page, app, (scope) => ({
      exact:       (scope.placeFor('Marondera') || {}).place || null,
      messyCase:   (scope.placeFor('marondera ') || {}).place || null,
      afterComma:  (scope.placeFor('Birmingham, Harare') || {}).place || null,
      beforeComma: (scope.placeFor('Norton, somewhere odd') || {}).place || null,
      noCoords:    (scope.placeFor('Shurugwi') || {}).place || null,
      unknown:     (scope.placeFor('Birchenough Bridge') || {}).place || null,
      blank:       (scope.placeFor('') || {}).place || null,
      nullish:     (scope.placeFor(null) || {}).place || null,
    }));
    console.log(app + ' ' + JSON.stringify(out));

    expect(out.exact).toBe('Marondera');
    expect(out.messyCase, 'case and stray spaces must not matter').toBe('Marondera');
    expect(out.afterComma, '"Birmingham, Harare" is Harare on a map').toBe('Harare');
    expect(out.beforeComma).toBe('Norton');
    expect(out.noCoords, 'on file but with no coordinates cannot be placed').toBeNull();
    expect(out.unknown).toBeNull();
    expect(out.blank).toBeNull();
    expect(out.nullish).toBeNull();
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} groups orders by town and owns up to the ones it cannot draw`, async ({ page }) => {
    await boot(page, app);
    const out = await inScope(page, app, (scope) => {
      const g = scope.orderGroups();
      return {
        total: g.total,
        towns: g.groups.map(x => ({ place: x.place, n: x.rows.length, litres: x.litres }))
                 .sort((a, b) => a.place.localeCompare(b.place)),
        missing: g.missing,
      };
    });
    console.log(app + ' ' + JSON.stringify(out, null, 1));

    // Marondera 2, Harare 1, Norton 1 = 4. Delivered and cancelled are out,
    // and the two unplaceable ones are not counted as drawn.
    expect(out.total).toBe(4);
    expect(out.towns).toEqual([
      { place: 'Harare',    n: 1, litres: 18000 },
      { place: 'Marondera', n: 2, litres: 48000 },
      { place: 'Norton',    n: 1, litres: 40000 },
    ]);
    // Mutare only had a delivered and a cancelled order, so it must not appear.
    expect(out.towns.some(t => t.place === 'Mutare')).toBe(false);

    // An order left off the map silently would be worse than one the panel
    // admits it cannot draw.
    expect(out.missing).toEqual({ 'Shurugwi': 1, 'Birchenough Bridge': 1 });
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} lists the whole active fleet, hired-in units under their transporter`, async ({ page }) => {
    await boot(page, app);
    const out = await inScope(page, app, (scope) => ({
      units: scope.fleetUnits().map(u => u.kind + ':' + u.code + '|' + u.name + '|' + u.owner + '|' + u.sub),
      busy: Object.keys(scope.fleetBusy()).sort(),
    }));
    console.log(app + ' ' + JSON.stringify(out, null, 1));

    expect(out.units).toEqual([
      'vehicle:SH03|Masden Majoni|Skelsee fleet|40k',
      // SR01 is the runabout anyone may take, so it is labelled by that
      'vehicle:SR01|Any driver|Skelsee fleet|4k',
      'vehicle:ZIM1|Tapiwa Moyo|Zimgo Transport|40k',
      'pump:SP01|Bernard|Skelsee fleet|pump',
    ]);

    // SH03 and SP01 are on sale 1, ZIM1 is on sale 4. SR01 is only on sale 5,
    // which is already delivered, so it is free.
    expect(out.busy).toEqual(['pump:p1', 'vehicle:v1', 'vehicle:v9']);
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} the panel puts what still needs placing at the top`, async ({ page }) => {
    await boot(page, app);
    const out = await inScope(page, app, (scope) => {
      scope.renderFleetPanel();
      const el = document.getElementById('fleetlist');
      return {
        groups: [...el.querySelectorAll('.fleetgrp')].map(g => g.textContent),
        rows: [...el.querySelectorAll('.fu')].map(r => ({
          code: r.querySelector('.code').textContent,
          placed: r.classList.contains('placed'),
          onmap: !!r.querySelector('.onmap'),
          busy: !!r.querySelector('.load'),
          pump: r.classList.contains('ispump'),
          draggable: r.getAttribute('draggable'),
        })),
        count: document.getElementById('fleet-cnt').textContent,
        miss: (el.querySelector('.fmiss') || {}).textContent || '',
      };
    });
    console.log(app + ' ' + JSON.stringify(out, null, 1));

    expect(out.groups).toEqual(['Skelsee fleet', 'Zimgo Transport']);
    expect(out.count).toBe('1 of 4 placed');

    // SH03 is the only one placed, so it sinks below the ones still to do.
    const codes = out.rows.map(r => r.code);
    expect(codes.indexOf('SH03')).toBeGreaterThan(codes.indexOf('SR01'));
    const sh03 = out.rows.find(r => r.code === 'SH03');
    expect(sh03.placed).toBe(true);
    expect(sh03.onmap).toBe(true);
    expect(sh03.busy, 'SH03 has a load booked on it').toBe(true);

    const sr01 = out.rows.find(r => r.code === 'SR01');
    expect(sr01.placed).toBe(false);
    expect(sr01.busy, 'SR01 is only on a delivered load').toBe(false);

    expect(out.rows.find(r => r.code === 'SP01').pump).toBe(true);
    expect(out.rows.every(r => r.draggable === 'true')).toBe(true);

    expect(out.miss).toContain('2 orders cannot be shown');
    expect(out.miss).toContain('Shurugwi');
    expect(out.miss).toContain('Birchenough Bridge');
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} the legend gains an Orders tick box with a live count`, async ({ page }) => {
    await boot(page, app);
    // The legend is normally drawn by drawPins(), which does nothing until the
    // map is up. Drive the renderer directly so the test does not depend on
    // Leaflet being initialised behind the sign-in screen.
    const labels = await inScope(page, app, (scope) => {
      scope.renderLayerToggles();
      const el = document.getElementById('legend');
      return [...el.querySelectorAll('.lg')].map(l => ({
        text: l.textContent.trim(),
        checked: l.querySelector('input').checked,
        dot: l.querySelector('span').className,
      }));
    });
    console.log(app + ' legend: ' + JSON.stringify(labels, null, 1));

    const orders = labels.find(l => l.text.indexOf('Orders') === 0);
    expect(orders, 'an Orders row in the legend').toBeTruthy();
    expect(orders.checked).toBe(true);
    // A different SHAPE, not one more colour on top of the ripeness palette.
    expect(orders.dot).toBe('dot od');
    expect(labels.length).toBe(8);          // five statuses, two prospects, orders
  });
}

/* ------------------------------------------------------------------ */

test('ops: units actually appear on the map, and only the placed ones', async ({ page }) => {
  await boot(page, '/ops/');
  const out = await page.evaluate(fx => {
    (0, eval)(fx);
    const f = mkFixture();
    SALES = f.SALES; PLACES = f.PLACES; FLEETMAP = f.FLEETMAP;
    // The map page is behind the sign-in screen; Leaflet still builds its
    // layers, which is what is being counted here.
    initMap();
    drawFleet();
    drawOrders();
    const before = { fleet: fleetLayer.getLayers().length, orders: orderLayer.getLayers().length };

    FLEETMAP.pos['pump:p1'] = { lat: -18.0, lng: 31.3, at: '2026-11-20T07:00:00Z', by: 'Munya' };
    drawFleet();
    const after = fleetLayer.getLayers().length;

    LAYERS.orders = false;
    drawOrders();
    const ordersOff = orderLayer.getLayers().length;
    LAYERS.orders = true;
    drawOrders();

    return { before: before, after: after, ordersOff: ordersOff,
             ordersBack: orderLayer.getLayers().length };
  }, FIXTURE);
  console.log(JSON.stringify(out));

  expect(out.before.fleet, 'only SH03 is placed').toBe(1);
  expect(out.before.orders, 'one badge per town, not per order').toBe(3);
  expect(out.after, 'placing the pump adds a second marker').toBe(2);
  expect(out.ordersOff, 'the tick box really clears them').toBe(0);
  expect(out.ordersBack).toBe(3);
});

/* ------------------------------------------------------------------ */

test('ops: arming a unit, then tapping the map, writes the position', async ({ page }) => {
  const writes = [];
  await page.route('**/rest/v1/fleet_positions**', async route => {
    const req = route.request();
    writes.push({ method: req.method(), body: req.postData() || '',
                  url: req.url().replace(/^.*\/rest\/v1\//, '') });
    return route.fulfill({ status: 201, contentType: 'application/json',
                           body: JSON.stringify([{ unit_id: 'v2' }]) });
  });
  await boot(page, '/ops/');

  const out = await page.evaluate(fx => {
    (0, eval)(fx);
    const f = mkFixture();
    SALES = f.SALES; PLACES = f.PLACES; FLEETMAP = f.FLEETMAP;
    initMap();
    renderFleetPanel();

    // Tap SR01 in the panel.
    armUnit('vehicle:v2');
    const armed = {
      note: document.getElementById('fleet-arm').textContent,
      shown: document.getElementById('fleet-arm').style.display,
      rowArmed: !!document.querySelector('.fu.armed'),
      mapCursor: map.getContainer().className.indexOf('armed') > -1,
    };

    // Tapping it again cancels, which is the only way out on a phone.
    armUnit('vehicle:v2');
    const cancelled = { shown: document.getElementById('fleet-arm').style.display,
                        rowArmed: !!document.querySelector('.fu.armed') };

    // Arm it again and place it.
    armUnit('vehicle:v2');
    placeUnit('vehicle:v2', { lat: -18.5, lng: 31.9 });
    return { armed: armed, cancelled: cancelled,
             pos: FLEETMAP.pos['vehicle:v2'],
             stillArmed: !!document.querySelector('.fu.armed') };
  }, FIXTURE);
  console.log(JSON.stringify(out, null, 1));

  expect(out.armed.note).toContain('tap the map to place SR01');
  expect(out.armed.shown).not.toBe('none');
  expect(out.armed.rowArmed).toBe(true);
  expect(out.armed.mapCursor, 'the map becomes a target').toBe(true);
  expect(out.cancelled.shown).toBe('none');
  expect(out.cancelled.rowArmed).toBe(false);

  expect(out.pos.lat).toBeCloseTo(-18.5, 5);
  expect(out.pos.lng).toBeCloseTo(31.9, 5);
  expect(out.stillArmed, 'placing it disarms it').toBe(false);

  await expect.poll(() => writes.length, { timeout: 6000 }).toBeGreaterThan(0);
  const w = writes[0];
  console.log('wrote: ' + JSON.stringify(w));
  expect(w.method).toBe('POST');
  const body = JSON.parse(w.body);
  const row = Array.isArray(body) ? body[0] : body;
  expect(row.kind).toBe('vehicle');
  expect(row.unit_id).toBe('v2');
  expect(row.latitude).toBeCloseTo(-18.5, 5);
  expect(row.longitude).toBeCloseTo(31.9, 5);
  // Nobody is signed in here, so there is no name to record - and the em dash
  // the top bar shows until sign-in must never be stored as the person who
  // moved it.
  expect(row).toHaveProperty('moved_by');
  expect(row.moved_by).toBeNull();
  expect(out.pos.by).toBeNull();
  // An upsert, so moving the same truck twice does not make a second row.
  expect(w.url.toLowerCase()).toContain('on_conflict=kind%2cunit_id');
});

/* ------------------------------------------------------------------ */

test('ops: a refusal puts the truck back where it was and says so', async ({ page }) => {
  // Row-level security refuses by matching zero rows and reporting NO error.
  // Without the empty-result check the map would show a move the database
  // threw away, and only the person who dragged it would ever see it.
  await page.route('**/rest/v1/fleet_positions**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await boot(page, '/ops/');

  const msgs = [];
  page.on('dialog', d => { msgs.push(d.message()); d.accept(); });

  const out = await page.evaluate(async fx => {
    (0, eval)(fx);
    const f = mkFixture();
    SALES = f.SALES; PLACES = f.PLACES; FLEETMAP = f.FLEETMAP;
    initMap();

    // moving one that was already placed must put it back, not clear it
    await placeUnit('vehicle:v1', { lat: -20.1, lng: 28.6 });
    const movedBack = FLEETMAP.pos['vehicle:v1'];

    // and one that was never placed must not be left on the map
    await placeUnit('vehicle:v2', { lat: -20.1, lng: 28.6 });
    const neverPlaced = FLEETMAP.pos['vehicle:v2'] || null;

    // taking one off that the database refuses must restore it
    await removeUnit('vehicle:v1');
    const stillThere = FLEETMAP.pos['vehicle:v1'];

    return { movedBack: movedBack, neverPlaced: neverPlaced, stillThere: stillThere };
  }, FIXTURE);
  console.log(JSON.stringify(out, null, 1));
  console.log('dialogs: ' + JSON.stringify(msgs));

  expect(out.movedBack.lat).toBeCloseTo(-17.9, 5);   // its original spot
  expect(out.movedBack.lng).toBeCloseTo(31.0, 5);
  expect(out.neverPlaced, 'a refused first placement must not stick').toBeNull();
  expect(out.stillThere.lat).toBeCloseTo(-17.9, 5);

  expect(msgs.length).toBe(3);
  expect(msgs.every(m => /only ops or an administrator/.test(m)),
    'the message has to say why: ' + JSON.stringify(msgs)).toBe(true);
});

/* ------------------------------------------------------------------ */

test('ops: dragging a unit carries the right payload', async ({ page }) => {
  await boot(page, '/ops/');
  const out = await page.evaluate(fx => {
    (0, eval)(fx);
    const f = mkFixture();
    SALES = f.SALES; PLACES = f.PLACES; FLEETMAP = f.FLEETMAP;
    renderFleetPanel();
    const row = [...document.querySelectorAll('.fu')]
      .find(r => r.querySelector('.code').textContent === 'SP01');
    let got = null;
    fleetDragStart({ dataTransfer: { setData: (k, v) => { got = k + '=' + v; },
                                     effectAllowed: null } }, 'pump:p1');
    return { got: got, hasHandler: row.getAttribute('ondragstart') };
  }, FIXTURE);
  console.log(JSON.stringify(out));
  // Prefixed so a stray drag from somewhere else on the page is ignored.
  expect(out.got).toBe('text/plain=fleet:pump:p1');
  expect(out.hasHandler).toContain('fleetDragStart');
});

/* ------------------------------------------------------------------ */

test('the two apps address their own scope in the markup', async ({ page }) => {
  await page.goto('/ops/');
  await page.waitForTimeout(2200);
  let html = await page.locator('.mside .runsec').first().innerHTML();
  expect(html).not.toContain('LogisticsApp.');

  await page.goto('/admin/');
  await page.waitForTimeout(2500);
  html = await page.locator('.mside .runsec').first().innerHTML();
  expect(html).toContain('Where is the fleet');

  // The rows are built in script, so check the generated handler prefix too.
  const rowHtml = await page.evaluate(fx => {
    (0, eval)(fx);
    const f = mkFixture();
    LogisticsApp.__seed({ SALES: f.SALES, PLACES: f.PLACES, FLEETMAP: f.FLEETMAP });
    LogisticsApp.renderFleetPanel();
    return document.getElementById('fleetlist').innerHTML;
  }, FIXTURE);
  expect(rowHtml).toContain('LogisticsApp.armUnit');
  expect(rowHtml).toContain('LogisticsApp.fleetDragStart');
});
