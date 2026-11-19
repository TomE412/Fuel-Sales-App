// Hiring in a truck from another transporter.
//
// The rig picker groups trucks under their owner and offers "Hire in a
// truck…" at the bottom. Saving that form writes a contractor, a driver, an
// optional trailer and pump, and the truck itself — then selects it.
//
// Every write here is intercepted, so the tests exercise the real code path
// and assert the real payloads without touching the live database.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const APPS = ['/dashboard/', '/admin/'];
const scopeOf = app => app === '/admin/';

/* A fleet with one Skelsee truck and one already hired from Zimgo. */
const FIXTURE = `FLEET = {
  vehicles: [
    {id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570',model:'VOLVO',capacity_litres:40000,
     needs_pump:true,default_driver_id:'d1',default_trailer_id:'t1',contractor_id:null},
    {id:'v9',fleet_no:'ZIM1',reg_no:'ACZ 1234',model:null,capacity_litres:40000,
     needs_pump:false,default_driver_id:'d9',default_trailer_id:null,contractor_id:'c1'}
  ],
  trailers: [{id:'t1',trailer_no:'ST03',reg_no:'AFJ 2731',contractor_id:null}],
  drivers:  [{id:'d1',full_name:'Masden Majoni',phone:'0772910076',contractor_id:null},
             {id:'d9',full_name:'Tapiwa Moyo',phone:'0772123456',contractor_id:'c1'}],
  pumps:    [{id:'p1',unit_no:'SP01',reg_no:'AFU 6092',driver_id:null,is_hired:false,contractor_id:null},
             {id:'p3',unit_no:'SP03',reg_no:null,driver_id:null,is_hired:true,contractor_id:null}],
  contractors: [{id:'c1',name:'Zimgo Transport',code:'ZIM',active:true}]
};
allSales = [{id:99,customer:'Border Timbers',litres:36000,fuelType:'Diesel',location:'Mutare'}];`;

async function seed(page, isAdmin, fixture) {
  await page.evaluate(([a, f]) => {
    const scope = a ? OverviewApp : window;
    (0, eval)(f);
    ASSIGN = {};
    // Admin keeps this state - and its Supabase client - inside the module.
    // The client is normally set by init() at sign-in, which these tests do
    // not do, so it goes in through the same seed hook.
    if (a) scope.__seed({ FLEET, ASSIGN, allSales, sb: sb });
  }, [isAdmin, fixture || FIXTURE]);
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} hire form is wired to the scope it lives in`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 120)); });
    await page.goto(app);
    await page.waitForTimeout(2400);
    const isAdmin = scopeOf(app);

    for (const id of ['#rig-new', '#hire-con', '#hire-con-new', '#hire-reg', '#hire-trailer',
                      '#hire-cap', '#hire-driver', '#hire-phone', '#hire-id', '#hire-pump',
                      '#hire-pump-reg', '#hire-pump-driver', '#hire-pump-phone',
                      '#hire-err', '#hire-save', '#rig-note',
                      '#rig-advrow', '#rig-mainrow', '#rig-warow']) {
      expect(await page.locator(id).count(), `${app} missing ${id}`).toBe(1);
    }

    const fns = await page.evaluate(a => {
      const scope = a ? OverviewApp : window;
      return ['saveHiredTruck', 'cancelHire', 'hireConChanged', 'hirePumpToggle']
        .map(n => typeof scope[n]);
    }, isAdmin);
    expect(fns, `${app} handlers: ${JSON.stringify(fns)}`).toEqual(
      ['function', 'function', 'function', 'function']);

    // The inline handlers inside the panel must address the same scope the
    // rest of the modal does, or every button is a silent dead end.
    const html = await page.locator('#rig-new').innerHTML();
    if (isAdmin) {
      expect(html).toContain('OverviewApp.saveHiredTruck()');
      expect(html).toContain('OverviewApp.hirePumpToggle()');
    } else {
      expect(html).toContain('saveHiredTruck()');
      expect(html).not.toContain('OverviewApp.');
    }
    // The dashboard asks for app_customer_retention before anyone has signed
    // in and gets a 401. That pre-dates this feature and is listed in
    // known-noise.js; anything else here is new and fails.
    expect(realErrors(errs)).toEqual([]);
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} groups the picker by owner and offers the hire option`, async ({ page }) => {
    await page.goto(app);
    await page.waitForTimeout(2300);
    const isAdmin = scopeOf(app);
    await seed(page, isAdmin);

    const out = await page.evaluate(a => {
      const scope = a ? OverviewApp : window;
      scope.openRig(99);
      const sel = document.getElementById('rig-rig');
      const groups = [...sel.querySelectorAll('optgroup')].map(g => ({
        label: g.label, opts: [...g.querySelectorAll('option')].map(o => o.textContent)
      }));
      const last = sel.options[sel.options.length - 1];

      // ...and with nothing ever hired in, no grouping at all.
      FLEET.contractors = [];
      FLEET.vehicles = FLEET.vehicles.filter(v => !v.contractor_id);
      if (a) scope.__seed({ FLEET });
      scope.openRig(99);
      const plain = {
        groups: document.querySelectorAll('#rig-rig optgroup').length,
        options: [...document.querySelectorAll('#rig-rig option')].map(o => o.textContent)
      };
      return { groups, lastValue: last.value, lastText: last.textContent, plain };
    }, isAdmin);
    console.log(app + ' ' + JSON.stringify(out, null, 1));

    expect(out.groups.length).toBe(2);
    expect(out.groups[0].label).toBe('Skelsee fleet');
    expect(out.groups[0].opts.length).toBe(1);
    expect(out.groups[0].opts[0]).toContain('Masden Majoni');
    expect(out.groups[1].label).toBe('Zimgo Transport');
    expect(out.groups[1].opts.length).toBe(1);
    expect(out.groups[1].opts[0]).toContain('Tapiwa Moyo');
    expect(out.groups[1].opts[0]).toContain('ZIM1 (ACZ 1234)');
    // The transporter is already the heading, so it is not repeated per line.
    expect(out.groups[1].opts[0]).not.toContain('Zimgo Transport');

    expect(out.lastValue).toBe('__hire__');
    expect(out.lastText).toContain('Hire in a truck');

    // No contractors: exactly the list this app had before the feature.
    expect(out.plain.groups).toBe(0);
    expect(out.plain.options.length).toBe(3);          // placeholder + SH03 + hire
    expect(out.plain.options[2]).toContain('Hire in a truck');
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} the hire panel opens over the load and closes cleanly`, async ({ page }) => {
    await page.goto(app);
    await page.waitForTimeout(2300);
    const isAdmin = scopeOf(app);
    await seed(page, isAdmin);
    await page.evaluate(a => (a ? OverviewApp : window).openRig(99), isAdmin);

    await expect(page.locator('#rig-new')).toBeHidden();
    await expect(page.locator('#rig-mainrow')).toBeVisible();

    // Choosing the last option is what opens it.
    await page.selectOption('#rig-rig', '__hire__');
    await expect(page.locator('#rig-new')).toBeVisible();
    await expect(page.locator('#hire-reg')).toBeVisible();
    // Everything that would act on the load is put away while the form is up,
    // so Save cannot be pressed on a half-entered truck.
    await expect(page.locator('#rig-mainrow')).toBeHidden();
    await expect(page.locator('#rig-warow')).toBeHidden();
    await expect(page.locator('#rig-advrow')).toBeHidden();

    // The load being assigned is still named at the top — that is why the
    // form lives inside this box rather than in one of its own.
    await expect(page.locator('#rig-who')).toContainText('Border Timbers');

    // The transporter list, plus a way to add one that is not on it.
    const cons = await page.locator('#hire-con option').allTextContents();
    expect(cons.length).toBe(3);
    expect(cons[1]).toBe('Zimgo Transport');
    expect(cons[2]).toContain('not on the list');

    // A new company reveals the name box; an existing one hides it again.
    await expect(page.locator('#hire-con-new')).toBeHidden();
    await page.selectOption('#hire-con', '__new__');
    await expect(page.locator('#hire-con-new')).toBeVisible();
    await page.selectOption('#hire-con', { label: 'Zimgo Transport' });
    await expect(page.locator('#hire-con-new')).toBeHidden();

    // The pump fields only exist once the box is ticked.
    await expect(page.locator('#hire-pump-reg')).toBeHidden();
    await page.check('#hire-pump');
    await expect(page.locator('#hire-pump-reg')).toBeVisible();

    // Back restores exactly what was there before.
    await page.click('#rig-new button.sec');
    await expect(page.locator('#rig-new')).toBeHidden();
    await expect(page.locator('#rig-mainrow')).toBeVisible();
    await expect(page.locator('#rig-warow')).toBeVisible();
    await expect(page.locator('#rig-advrow')).toBeVisible();
    await expect(page.locator('#rig-adv')).toBeHidden();   // as it was: collapsed
    expect(await page.inputValue('#hire-reg')).toBe('');   // and emptied
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} refuses a truck with no plate, driver or number`, async ({ page }) => {
    let wrote = 0;
    await page.route('**/rest/v1/**', route => {
      if (route.request().method() === 'POST') wrote++;
      route.continue();
    });
    await page.goto(app);
    await page.waitForTimeout(2300);
    const isAdmin = scopeOf(app);
    await seed(page, isAdmin);
    await page.evaluate(a => (a ? OverviewApp : window).openRig(99), isAdmin);
    await page.selectOption('#rig-rig', '__hire__');

    const err = page.locator('#hire-err');
    await page.click('#hire-save');
    await expect(err).toContainText('Which transporter');

    await page.selectOption('#hire-con', { label: 'Zimgo Transport' });
    await page.click('#hire-save');
    await expect(err).toContainText('registration');

    await page.fill('#hire-reg', 'ACZ 9999');
    await page.click('#hire-save');
    await expect(err).toContainText('Who is driving');

    await page.fill('#hire-driver', 'Elias Banda');
    await page.click('#hire-save');
    await expect(err).toContainText('cannot ring them');

    // A new company with no name typed is caught too.
    await page.fill('#hire-phone', '0771 000 111');
    await page.selectOption('#hire-con', '__new__');
    await page.click('#hire-save');
    await expect(err).toContainText('transporter');

    expect(wrote, 'nothing may be written while the form is incomplete').toBe(0);
  });
}

/* ------------------------------------------------------------------ */

for (const app of APPS) {
  test(`${app} saving a hired rig writes it and selects it`, async ({ page }) => {
    const posts = [];
    await page.route('**/rest/v1/**', async route => {
      const req = route.request();
      const url = req.url();
      const table = (url.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        posts.push({ table, body });
        const made = {
          contractors: { id: 'c2', name: body.name, code: body.code, active: true },
          drivers:     { id: 'd20', full_name: body.full_name, phone: body.phone,
                         id_number: body.id_number, contractor_id: body.contractor_id },
          trailers:    { id: 't20', trailer_no: body.trailer_no, reg_no: body.reg_no,
                         contractor_id: body.contractor_id },
          pump_units:  { id: 'p20', unit_no: body.unit_no, reg_no: body.reg_no,
                         driver_id: body.driver_id, is_hired: true,
                         contractor_id: body.contractor_id },
          vehicles:    Object.assign({ id: 'v20' }, body),
        }[table] || {};
        return route.fulfill({ status: 201, contentType: 'application/json',
                               body: JSON.stringify(made) });
      }
      // The refresh after saving. Hand back the new rows so the picker can
      // show them without the real database being involved.
      const rows = {
        contractors: [{ id: 'c1', name: 'Zimgo Transport', code: 'ZIM', active: true },
                      { id: 'c2', name: 'Mashbrook Haulage', code: 'MAS', active: true }],
        drivers: [{ id: 'd1', full_name: 'Masden Majoni', contractor_id: null },
                  { id: 'd20', full_name: 'Tendai Juru', phone: '0773 222 111', contractor_id: 'c2' },
                  { id: 'd21', full_name: 'Lovemore', contractor_id: 'c2' }],
        trailers: [],
        pump_units: [{ id: 'p20', unit_no: 'MASP1', reg_no: 'AFX 1111',
                       driver_id: 'd21', is_hired: true, contractor_id: 'c2' }],
        vehicles: [{ id: 'v1', fleet_no: 'SH03', reg_no: 'AFJ 2570', contractor_id: null,
                     default_driver_id: 'd1' },
                   { id: 'v20', fleet_no: 'MAS1', reg_no: 'ABC 7788', contractor_id: 'c2',
                     needs_pump: true, capacity_litres: 36000, default_driver_id: 'd20' }],
      }[table];
      if (!rows) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify(rows) });
    });

    await page.goto(app);
    await page.waitForTimeout(2300);
    const isAdmin = scopeOf(app);
    await seed(page, isAdmin);
    await page.evaluate(a => (a ? OverviewApp : window).openRig(99), isAdmin);
    await page.selectOption('#rig-rig', '__hire__');

    await page.selectOption('#hire-con', '__new__');
    await page.fill('#hire-con-new', 'Mashbrook Haulage');
    await page.fill('#hire-reg', 'ABC 7788');
    await page.selectOption('#hire-cap', '36000');
    await page.fill('#hire-driver', 'Tendai Juru');
    await page.fill('#hire-phone', '0773 222 111');
    await page.check('#hire-pump');
    await page.fill('#hire-pump-reg', 'AFX 1111');
    await page.fill('#hire-pump-driver', 'Lovemore');
    await page.click('#hire-save');

    await expect(page.locator('#rig-note')).toContainText('MAS1', { timeout: 8000 });
    console.log(app + ' posted: ' + JSON.stringify(posts, null, 1));

    const by = t => posts.filter(p => p.table === t).map(p => p.body);

    // The transporter, with a code built from its name.
    expect(by('contractors').length).toBe(1);
    expect(by('contractors')[0].name).toBe('Mashbrook Haulage');
    expect(by('contractors')[0].code).toBe('MAS');

    // Both drivers belong to that transporter, never to Skelsee.
    const drv = by('drivers');
    expect(drv.length).toBe(2);
    expect(drv[0].full_name).toBe('Tendai Juru');
    expect(drv[0].phone).toBe('0773 222 111');
    expect(drv.every(d => d.contractor_id === 'c2')).toBe(true);
    expect(drv[1].full_name).toBe('Lovemore');

    // The pump unit is numbered off the transporter's code and marked hired.
    const pu = by('pump_units');
    expect(pu.length).toBe(1);
    expect(pu[0].unit_no).toBe('MASP1');
    expect(pu[0].reg_no).toBe('AFX 1111');
    expect(pu[0].is_hired).toBe(true);

    // The truck itself: first for this transporter, so MAS1.
    const veh = by('vehicles');
    expect(veh.length).toBe(1);
    expect(veh[0].fleet_no).toBe('MAS1');
    expect(veh[0].reg_no).toBe('ABC 7788');
    expect(veh[0].capacity_litres).toBe(36000);
    expect(veh[0].needs_pump).toBe(true);
    expect(veh[0].contractor_id).toBe('c2');
    expect(veh[0].default_driver_id).toBe('d20');
    expect(veh[0].active).toBe(true);

    // No trailer was typed, so none was invented.
    expect(by('trailers').length).toBe(0);

    // The load is NOT assigned yet - Save below still does that - but the new
    // rig is chosen and waiting, under its own heading.
    const after = await page.evaluate(() => ({
      rig: document.getElementById('rig-rig').value,
      vehicle: document.getElementById('rig-vehicle').value,
      driver: document.getElementById('rig-driver').value,
      groups: [...document.querySelectorAll('#rig-rig optgroup')].map(g => g.label),
      panelShut: getComputedStyle(document.getElementById('rig-new')).display,
      pumpShown: getComputedStyle(document.getElementById('rig-pump-wrap')).display,
    }));
    console.log(app + ' after: ' + JSON.stringify(after));
    expect(after.rig).toBe('v20');
    expect(after.vehicle).toBe('v20');
    expect(after.driver).toBe('d20');
    expect(after.groups).toContain('Mashbrook Haulage');
    expect(after.panelShut).toBe('none');
    // It needs a pump, so that field is now on show for this load.
    expect(after.pumpShown).not.toBe('none');
  });
}

/* ------------------------------------------------------------------ */

test('a second driver of the same name is kept apart, not merged', async ({ page }) => {
  // drivers.full_name is unique across the whole table, so the app has to
  // handle two transporters each employing a John Moyo.
  const names = [];
  await page.route('**/rest/v1/**', async route => {
    const req = route.request();
    const table = (req.url().match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (req.method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    const body = JSON.parse(req.postData() || '{}');
    if (table === 'drivers') {
      names.push(body.full_name);
      // The plain name is already taken by somebody else's driver.
      if (body.full_name === 'John Moyo') {
        return route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "drivers_full_name_key"' }) });
      }
      return route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ id: 'd21', full_name: body.full_name, contractor_id: body.contractor_id }) });
    }
    return route.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify(Object.assign({ id: 'x1' }, body)) });
  });

  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);
  await seed(page, false);
  await page.evaluate(() => openRig(99));
  await page.selectOption('#rig-rig', '__hire__');
  await page.selectOption('#hire-con', { label: 'Zimgo Transport' });
  await page.fill('#hire-reg', 'ACZ 4444');
  await page.fill('#hire-driver', 'John Moyo');
  await page.fill('#hire-phone', '0772 555 444');
  await page.click('#hire-save');

  await expect(page.locator('#rig-note')).toContainText('John Moyo (ZIM)', { timeout: 8000 });
  console.log('driver names tried: ' + JSON.stringify(names));
  expect(names).toEqual(['John Moyo', 'John Moyo (ZIM)']);
});

/* ------------------------------------------------------------------ */

test('a refusal by row-level security is reported, not retried away', async ({ page }) => {
  let tries = 0;
  await page.route('**/rest/v1/**', async route => {
    const req = route.request();
    if (req.method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    tries++;
    return route.fulfill({ status: 403, contentType: 'application/json',
      body: JSON.stringify({ code: '42501',
        message: 'new row violates row-level security policy for table "drivers"' }) });
  });

  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);
  await seed(page, false);
  await page.evaluate(() => openRig(99));
  await page.selectOption('#rig-rig', '__hire__');
  await page.selectOption('#hire-con', { label: 'Zimgo Transport' });
  await page.fill('#hire-reg', 'ACZ 5555');
  await page.fill('#hire-driver', 'Tendai Juru');
  await page.fill('#hire-phone', '0772 555 444');
  await page.click('#hire-save');

  await expect(page.locator('#hire-err')).toContainText('row-level security', { timeout: 8000 });
  // One attempt, not four: a refusal is not a name clash.
  expect(tries, 'a policy refusal must not be retried under another name').toBe(1);
  await expect(page.locator('#hire-save')).toBeEnabled();
  await expect(page.locator('#hire-save')).toHaveText('Save this truck');
});

/* ------------------------------------------------------------------ */

test('the pump list is grouped, and the old SP03 stand-in bows out', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);
  await seed(page, false);

  const out = await page.evaluate(() => {
    FLEET.pumps.push({ id: 'p9', unit_no: 'ZIMP1', reg_no: 'AFX 2222',
                       driver_id: 'd9', is_hired: true, contractor_id: 'c1' });
    const read = () => [...document.querySelectorAll('#rig-pump option')]
      .map(o => ({ v: o.value, t: o.textContent }));
    rigPumpOptions('');
    const normal = read();
    const groups = [...document.querySelectorAll('#rig-pump optgroup')].map(g => g.label);
    rigPumpOptions('p3');                 // SP03 is the one already on the load
    const withSp03 = read();
    return { normal, groups, withSp03 };
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.groups).toEqual(['Skelsee fleet', 'Zimgo Transport']);
  expect(out.normal.map(o => o.v)).not.toContain('p3');   // SP03 no longer offered
  expect(out.normal.map(o => o.v)).toContain('p1');
  expect(out.normal.find(o => o.v === 'p9').t).toContain('Tapiwa Moyo');

  // ...but it must still appear while it is the pump already chosen, or
  // saving the load would quietly drop it.
  expect(out.withSp03.map(o => o.v)).toContain('p3');
  expect(out.withSp03.find(o => o.v === 'p3').t).toContain('hired in');
});

/* ------------------------------------------------------------------ */

test("the driver's WhatsApp job names the transporter", async ({ page }) => {
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);
  await seed(page, false);

  const msgs = await page.evaluate(() => {
    openRig(99);
    document.getElementById('rig-rig').value = 'v9';   // the Zimgo truck
    rigPicked();
    const hired = driverMessage();
    document.getElementById('rig-rig').value = 'v1';   // one of ours
    rigPicked();
    return { hired, own: driverMessage() };
  });
  console.log(msgs.hired);

  expect(msgs.hired).toContain('ZIM1');
  expect(msgs.hired).toContain('ACZ 1234');
  expect(msgs.hired).toContain('(Zimgo Transport)');
  expect(msgs.hired).toContain('Tapiwa Moyo');
  expect(msgs.hired).toContain('0772123456');
  expect(msgs.hired).toContain('Border Timbers');

  // Our own trucks are not labelled with a transporter.
  expect(msgs.own).toContain('SH03');
  expect(msgs.own).not.toContain('(Zimgo Transport)');
});

/* ------------------------------------------------------------------ */

test('admin keeps hired rigs out of the standing-allocation screen', async ({ page }) => {
  // Logistics -> Drivers is where a Skelsee truck's usual driver and trailer
  // are set. Somebody else's horse has no business on it.
  await page.goto('/admin/');
  await page.waitForTimeout(2400);
  const queries = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script')]
      .map(s => s.textContent).join('\n');
    return ['drivers', 'vehicles', 'trailers'].map(t => {
      const re = new RegExp("sb\\.from\\('" + t + "'\\)[^\\n]*order\\('[a-z_]+'\\)", 'g');
      return (src.match(re) || []).filter(q => q.includes("eq('active',true)"));
    });
  });
  console.log(JSON.stringify(queries, null, 1));
  queries.forEach((list, i) => {
    expect(list.length, 'standing-allocation query ' + i).toBe(1);
    expect(list[0]).toContain("is('contractor_id',null)");
  });
});
