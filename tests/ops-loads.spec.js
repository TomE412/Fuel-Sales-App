// The ops planner's Loads tab.
//
// The Dash tab was a three-lane planner built on a `delivery_plan` table that
// was never created, so it 404'd on every load and the lanes were always
// empty. It is replaced by the Overview's order board, with the assign-a-rig
// dialog, en route and mark-delivered on each row.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

// Dates relative to today, so these tests do not rot.
const FIXTURE = `
window.dayStr = function(off){
  var d = new Date(); d.setDate(d.getDate() + off);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
         '-' + String(d.getDate()).padStart(2,'0');
};
window.seedOps = function(){
  SALES = [
    { id:1, customer:'Mukuyu Wines', location:'Marondera', litres:12000,
      fuel_type:'Diesel', sale_date:dayStr(-20), delivery_date:dayStr(-4),
      status:'pending', delivered_at:null, rep_name:'Tom Eager CW', notes:'' },
    { id:2, customer:'Border Timbers', location:'Mutare', litres:36000,
      fuel_type:'Diesel', sale_date:dayStr(-6), delivery_date:dayStr(0),
      status:'pending', delivered_at:null, rep_name:'Tom Eager CW',
      notes:'Gate round the back, ask for Joseph' },
    { id:3, customer:'Khaya Cement', location:'Norton', litres:40000,
      fuel_type:'Diesel', sale_date:dayStr(-2), delivery_date:dayStr(3),
      status:'pending', delivered_at:null, rep_name:'Carrie Watson', notes:'' },
    { id:4, customer:'Hill Farm', location:'Shurugwi', litres:9000,
      fuel_type:'Petrol', sale_date:dayStr(-9), delivery_date:null,
      status:'pending', delivered_at:null, rep_name:'Carrie Watson', notes:'' },
    { id:5, customer:'Olivine Industries', location:'Harare', litres:18000,
      fuel_type:'Diesel', sale_date:dayStr(-10), delivery_date:dayStr(-2),
      status:'delivered', delivered_at:dayStr(-2)+'T09:00:00+02:00',
      rep_name:'Tom Eager CW', notes:'', invoiced:false },
    { id:6, customer:'Ancient Co', location:'Harare', litres:5000,
      fuel_type:'Diesel', sale_date:dayStr(-60), delivery_date:dayStr(-40),
      status:'delivered', delivered_at:dayStr(-40)+'T09:00:00+02:00',
      rep_name:'Tom Eager CW', notes:'' },
    { id:7, customer:'Gone Co', location:'Harare', litres:3000,
      fuel_type:'Diesel', sale_date:dayStr(-3), delivery_date:dayStr(1),
      status:'cancelled', delivered_at:null, rep_name:'Tom Eager CW', notes:'' },
  ];
  FLEETMAP = {
    vehicles: [
      { id:'v1', fleet_no:'SH03', reg_no:'AFJ 2570', model:'VOLVO', needs_pump:true,
        capacity_litres:40000, driver_optional:false,
        default_driver_id:'d1', default_trailer_id:'t1', contractor_id:null, active:true },
      { id:'v2', fleet_no:'SR02', reg_no:'ACQ 3752', model:'VOLVO', needs_pump:false,
        capacity_litres:18000, driver_optional:false,
        default_driver_id:'d2', default_trailer_id:null, contractor_id:null, active:true },
    ],
    trailers: [{ id:'t1', trailer_no:'ST03', reg_no:'AFJ 2731', contractor_id:null }],
    drivers: [{ id:'d1', full_name:'Masden Majoni', phone:'0772910076' },
              { id:'d2', full_name:'Dennis Chitara', phone:'0772885979' }],
    pumps: [{ id:'p1', unit_no:'SP01', reg_no:'AFU 6092', driver_id:'d2',
              is_hired:false, contractor_id:null }],
    contractors: [],
    pos: {},
    assign: {
      '1': { sale_id:1, vehicle_id:'v1', trailer_id:'t1', driver_id:'d1',
             pump_unit_id:null, en_route_at:null },
      '2': { sale_id:2, vehicle_id:'v2', trailer_id:null, driver_id:'d2',
             pump_unit_id:null, en_route_at:new Date().toISOString(), en_route_by:'Munya' },
    },
  };
  PLACES = []; BOARD = []; CUSTNAMES = []; RIPE = [];
};
`;

async function boot(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  await page.goto('/ops/');
  await page.waitForTimeout(2300);
  return errs;
}

// Seeds the data AND puts the app in the state sign-in leaves it in. The
// sign-in screen is a fixed overlay at z-index 9999, so until it is hidden it
// swallows every click - which is correct in the app (you cannot use the
// planner before signing in) and would otherwise make these tests click on
// nothing.
const seed = page => page.evaluate(fx => {
  (0, eval)(fx);
  seedOps();
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('app').classList.add('active');
  renderDeliveries();
}, FIXTURE);

/* ------------------------------------------------------------------ */

test('the Dash tab and its planner are gone', async ({ page }) => {
  const errs = await boot(page);

  const tabs = await page.locator('.mtab').allTextContents();
  console.log('tabs: ' + JSON.stringify(tabs.map(t => t.trim())));
  expect(tabs.some(t => /Dash/i.test(t)), 'Dash must be gone').toBe(false);
  expect(tabs.some(t => /Loads/i.test(t)), 'Loads must be there').toBe(true);

  // The lanes, the drag trays and the page they lived on.
  for (const id of ['#p-today', '#lanes', '#tray-plan', '#tray-ripe', '#tp-list', '#tr-list']) {
    expect(await page.locator(id).count(), id + ' should be gone').toBe(0);
  }
  // And nothing may still ask the database for the table that was never made.
  const src = await page.evaluate(() =>
    [...document.querySelectorAll('script')].map(s => s.textContent).join('\n'));
  expect(src).not.toContain("from('delivery_plan')");
  expect(src).not.toContain('loadPlan(');

  expect(realErrors(errs)).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('the board is one list, soonest first, and nothing ages off it', async ({ page }) => {
  await boot(page);
  await seed(page);

  const out = await page.evaluate(() => ({
    order: [...document.querySelectorAll('#loads-list .order-row .order-name')]
             .map(n => n.textContent.replace(/Diesel|Petrol|Paraffin/g, '').trim()),
    count: document.getElementById('loads-count').textContent,
    badge: document.getElementById('bg-loads').textContent,
    doneOrder: [...document.querySelectorAll('#done-list .order-row .order-name')]
                 .map(n => n.textContent.replace(/Diesel|Petrol|Paraffin/g, '').trim()),
    doneCount: document.getElementById('done-count').textContent,
    metas: [...document.querySelectorAll('#loads-list .order-meta')].map(m => m.textContent),
  }));
  console.log(JSON.stringify(out, null, 1));

  // Late first, then today, then ahead, then the one with no date at all.
  expect(out.order).toEqual(['Mukuyu Wines', 'Border Timbers', 'Khaya Cement', 'Hill Farm']);
  expect(out.count).toContain('4');
  expect(out.count).toContain('97,000 L');
  expect(out.badge).toBe('4');

  // Cancelled is not a load.
  expect(out.order).not.toContain('Gone Co');

  // The words repeat what the date box colour says, because a long customer
  // name truncates and must never hide that a load is late.
  expect(out.metas[0]).toContain('4 days late');
  expect(out.metas[1]).toContain('today');
  expect(out.metas[3]).toContain('no delivery date');
  expect(out.metas[0]).toContain('Marondera');
  expect(out.metas[0]).toContain('Tom Eager CW');

  // Delivered: the last week only, so a wrong tick can be put back without
  // months of history crowding the screen.
  expect(out.doneOrder).toEqual(['Olivine Industries']);
  expect(out.doneCount).toBe('1');
});

/* ------------------------------------------------------------------ */

test('each row carries the three things the office does to a load', async ({ page }) => {
  await boot(page);
  await seed(page);

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#loads-list .order-row')].map(r => ({
      who: r.querySelector('.order-name').textContent.replace(/Diesel|Petrol/g, '').trim(),
      rig: r.querySelector('.ord-rig').textContent.trim(),
      rigClass: (r.querySelector('.rigbtn') || {}).className || '',
      litres: r.querySelector('.ord-lit').textContent.trim(),
      enroute: !!r.querySelector('.enroute-btn'),
      onRoad: !!r.querySelector('.enroute-on'),
      deliver: !!r.querySelector('.deliver-btn'),
      // The note itself is NOT on the row any more - it can run to a
      // paragraph. The row offers a button and the note opens in a sheet.
      // ops-notes-phone.spec.js covers that.
      noteBtn: (r.querySelector('.notebtn') || {}).textContent || '',
      noteInline: !!r.querySelector('.ord-note'),
    })));
  console.log(JSON.stringify(rows, null, 1));

  const mukuyu = rows.find(r => r.who === 'Mukuyu Wines');
  // SH03 needs a pump and has none, so the badge warns rather than reassures.
  expect(mukuyu.rig).toContain('SH03');
  expect(mukuyu.rig).toContain('Masden Majoni');
  expect(mukuyu.rigClass).toContain('warn');
  expect(mukuyu.litres).toBe('12,000 L');
  expect(mukuyu.enroute, 'not sent yet, so it offers to send it').toBe(true);
  expect(mukuyu.deliver).toBe(true);

  const border = rows.find(r => r.who === 'Border Timbers');
  expect(border.onRoad, 'already on the road, so it says so').toBe(true);
  expect(border.enroute).toBe(false);
  expect(border.noteBtn, 'it has a note, so it offers one').toContain('Notes');
  expect(border.noteInline, 'but the note text is never on the row').toBe(false);
  expect(rows.every(r => !r.noteInline)).toBe(true);
  // No note, no button.
  expect(rows.find(r => r.who === 'Khaya Cement').noteBtn).toBe('');

  const khaya = rows.find(r => r.who === 'Khaya Cement');
  expect(khaya.rig).toContain('Assign');
  expect(khaya.rigClass).not.toContain('on');

  // The delivered row offers the way back, and nothing else.
  const done = await page.evaluate(() => {
    const r = document.querySelector('#done-list .order-row');
    return { undo: !!r.querySelector('.undo-btn'), deliver: !!r.querySelector('.deliver-btn'),
             faded: r.classList.contains('done') };
  });
  expect(done.undo).toBe(true);
  expect(done.deliver).toBe(false);
  expect(done.faded).toBe(true);
});

/* ------------------------------------------------------------------ */

test('the assign dialog opens over the load and is really on screen', async ({ page }) => {
  await boot(page);
  await seed(page);

  expect(await page.locator('#rigm').count()).toBe(1);
  const before = await page.locator('#rigm').evaluate(el => getComputedStyle(el).display);
  expect(before).toBe('none');

  await page.evaluate(() => openRig(3));
  const open = await page.locator('#rigm').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('dialog: ' + JSON.stringify(open));
  expect(open.display).toBe('flex');
  expect(open.w).toBeGreaterThan(200);
  expect(open.h).toBeGreaterThan(200);

  await expect(page.locator('#rig-who')).toContainText('Khaya Cement');
  await expect(page.locator('#rig-rig')).toBeVisible();
  await expect(page.locator('#rig-save')).toBeVisible();
  // The detail fields stay behind the swap link, so the one-click case is one click.
  await expect(page.locator('#rig-vehicle')).toBeHidden();
  await page.click('#rig-adv-btn');
  await expect(page.locator('#rig-vehicle')).toBeVisible();

  // Picking the rig fills in the trailer and driver it runs with.
  const picked = await page.evaluate(() => {
    document.getElementById('rig-rig').value = 'v1';
    rigPicked();
    return { vehicle: document.getElementById('rig-vehicle').value,
             trailer: document.getElementById('rig-trailer').value,
             driver: document.getElementById('rig-driver').value,
             pumpShown: getComputedStyle(document.getElementById('rig-pump-wrap')).display };
  });
  console.log('picked: ' + JSON.stringify(picked));
  expect(picked).toMatchObject({ vehicle: 'v1', trailer: 't1', driver: 'd1' });
  expect(picked.pumpShown, 'SH03 pulls a tanker, so the pump field shows').not.toBe('none');

  await page.evaluate(() => closeRig());
  await expect(page.locator('#rigm')).toBeHidden();
});

/* ------------------------------------------------------------------ */

test('hiring a truck in works from here too', async ({ page }) => {
  await boot(page);
  await seed(page);
  await page.evaluate(() => openRig(3));

  // The last option on the picker, same as on the Overview.
  const last = await page.evaluate(() => {
    const s = document.getElementById('rig-rig');
    return s.options[s.options.length - 1].value;
  });
  expect(last).toBe('__hire__');

  await page.selectOption('#rig-rig', '__hire__');
  await expect(page.locator('#rig-new')).toBeVisible();
  await expect(page.locator('#hire-reg')).toBeVisible();
  await expect(page.locator('#rig-mainrow')).toBeHidden();

  // It refuses an incomplete truck rather than writing half a record.
  await page.click('#hire-save');
  await expect(page.locator('#hire-err')).toContainText('transporter');

  await page.click('#rig-new button.sec');
  await expect(page.locator('#rig-new')).toBeHidden();
  await expect(page.locator('#rig-mainrow')).toBeVisible();
});

/* ------------------------------------------------------------------ */

test('sending a load on its way needs a truck on it first', async ({ page }) => {
  await boot(page);
  await seed(page);

  const msgs = [];
  page.on('dialog', d => { msgs.push(d.message()); d.dismiss(); });

  // Khaya Cement has no rig, so this must open the dialog instead of telling
  // the rep a load has left with nothing to ring and no reg to look for.
  await page.evaluate(() => setEnRoute('3'));
  await page.waitForTimeout(400);
  console.log(JSON.stringify(msgs));
  expect(msgs.join(' ')).toContain('Assign a truck first');
  await expect(page.locator('#rigm')).toBeVisible();
  await expect(page.locator('#rig-who')).toContainText('Khaya Cement');
});

/* ------------------------------------------------------------------ */

test('a refusal by the database is reported, not shown as success', async ({ page }) => {
  // Row-level security refuses a write by matching NO rows and reporting no
  // error at all, so an empty result is the only way to tell a refusal from a
  // success.
  await page.route('**/rest/v1/delivery_assignment**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await boot(page);
  await seed(page);

  const msgs = [];
  page.on('dialog', d => { msgs.push(d.message()); d.accept(); });

  await page.evaluate(() => setEnRoute('1'));   // Mukuyu has SH03 on it
  await page.waitForTimeout(900);
  console.log(JSON.stringify(msgs));
  expect(msgs.length).toBeGreaterThanOrEqual(2);         // the confirm, then the refusal
  expect(msgs.join(' ')).toContain('would not accept it');
  // and it must not be left looking as though it went
  const onRoad = await page.evaluate(() => !!FLEETMAP.assign['1'].en_route_at);
  expect(onRoad, 'a refused send must not show as on the road').toBe(false);
});

/* ------------------------------------------------------------------ */

test('marking a load delivered names the customer before it commits', async ({ page }) => {
  await boot(page);
  await seed(page);

  const msgs = [];
  let wrote = 0;
  await page.route('**/rest/v1/sales**', route => {
    if (route.request().method() === 'PATCH') wrote++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  page.on('dialog', d => { msgs.push(d.message()); d.dismiss(); });

  await page.evaluate(() => markDelivered('1'));
  await page.waitForTimeout(400);
  console.log(JSON.stringify(msgs));
  expect(msgs[0]).toContain('Mukuyu Wines');
  expect(wrote, 'dismissing the question must not write anything').toBe(0);
});

/* ------------------------------------------------------------------ */

test('the reorder prompts finally have somewhere to go', async ({ page }) => {
  // renderChase() has always built this panel and has never had an element to
  // put it in - it wrote to #ripe-list, which did not exist, so it threw.
  const errs = await boot(page);
  expect(await page.locator('#ripe-list').count()).toBe(1);

  const out = await page.evaluate(() => {
    RIPE = [{ customer:'Dormant Farm', ripeness_pct:140, avg_litres:9000,
              days_since_last:42, avg_cycle_days:30, status:'overdue',
              order_count:5, lost_last_round:false, lost_count:0 }];
    BOARD = []; CUSTNAMES = []; SALES = SALES || [];
    renderChase();
    return document.getElementById('ripe-list').innerHTML;
  });
  expect(out).toContain('Dormant Farm');
  expect(realErrors(errs)).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('no "today" is worked out from a UTC timestamp', async ({ page }) => {
  // Harare is UTC+2, so between midnight and 02:00 local, toISOString() gives
  // YESTERDAY. On a board about "late" and "today", and on a date field that
  // refuses anything in the future, that is the one mistake that matters.
  await page.goto('/ops/');
  const bad = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
    return (src.match(/new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/g) || []).length;
  });
  expect(bad, 'use todayISO() instead').toBe(0);

  const ok = await page.evaluate(() => {
    const d = new Date();
    return todayISO() === d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  expect(ok).toBe(true);
});

/* ------------------------------------------------------------------ */

test('the build marker says which version the phone is running', async ({ page }) => {
  // A service worker makes an old copy entirely possible, so the version has
  // to be readable off the screen rather than guessed at.
  await page.goto('/ops/');
  await page.waitForTimeout(1500);
  // The top bar lives inside #app, which is hidden until sign-in; the sign-in
  // screen carries the same marker, from the same constant.
  await expect(page.locator('#auth-build')).toBeVisible();
  expect(await page.locator('#build').count()).toBe(1);
  const txt = await page.locator('#auth-build').textContent();
  console.log('build marker: ' + txt);
  expect(txt.trim().length).toBeGreaterThan(3);
});
