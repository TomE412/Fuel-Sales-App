const { test, expect } = require('@playwright/test');

for (const app of ['/dashboard/', '/admin/']) {
  test(`${app} has rig assignment wired correctly`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,100)); });
    await page.goto(app);
    await page.waitForTimeout(2400);

    for (const id of ['#rigm','#rig-vehicle','#rig-trailer','#rig-driver','#rig-save','#rig-err']) {
      expect(await page.locator(id).count(), `${app} missing ${id}`).toBe(1);
    }
    const isAdmin = app === '/admin/';
    const fns = await page.evaluate(a => {
      const scope = a ? OverviewApp : window;
      return ['openRig','closeRig','saveRig','clearRig','rigVehiclePicked'].map(n => typeof scope[n]);
    }, isAdmin);
    console.log(app + ' handlers: ' + JSON.stringify(fns));
    expect(fns.every(t => t === 'function')).toBe(true);

    // the modal's inline handlers must match the scope they live in
    const html = await page.locator('#rigm').innerHTML();
    if (isAdmin) {
      expect(html).toContain('OverviewApp.saveRig()');
      expect(html).toContain('OverviewApp.rigVehiclePicked()');
    } else {
      expect(html).toContain('saveRig()');
      expect(html).not.toContain('OverviewApp.');
    }
    expect(errs).toEqual([]);
  });
}

test('picking a truck fills in its usual trailer and driver', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.waitForTimeout(2000);
  const out = await page.evaluate(() => {
    FLEET = {
      vehicles: [
        { id:'v1', fleet_no:'SH03', reg_no:'AFJ 2570', model:'VOLVO', default_driver_id:'d1', default_trailer_id:'t1' },
        { id:'v2', fleet_no:'SR04', reg_no:'AEG 8887', model:'SCANIA', default_driver_id:'d2', default_trailer_id:null },
      ],
      trailers: [{ id:'t1', trailer_no:'ST03', reg_no:'AFJ 2731' }],
      drivers:  [{ id:'d1', full_name:'Masden' }, { id:'d2', full_name:'Nkosana' }],
    };
    ASSIGN = {};
    allSales = [{ id: 99, customer: 'Khaya Cement', litres: 40000 }];
    openRig(99);

    const pick = (v) => {
      document.getElementById('rig-vehicle').value = v;
      rigVehiclePicked();
      return { trailer: document.getElementById('rig-trailer').value,
               driver:  document.getElementById('rig-driver').value };
    };
    const collection = pick('v1');                       // has a trailer
    // reset, then a rigid truck
    document.getElementById('rig-trailer').value = '';
    document.getElementById('rig-driver').value = '';
    const rigid = pick('v2');                            // no trailer

    // a deliberate choice must not be overwritten
    document.getElementById('rig-driver').value = 'd1';
    document.getElementById('rig-vehicle').value = 'v2';
    rigVehiclePicked();
    const kept = document.getElementById('rig-driver').value;

    const badgeNone = rigBadge(99);
    ASSIGN['99'] = { sale_id:99, vehicle_id:'v1', driver_id:'d1' };
    const badgeSet = rigBadge(99);
    return { collection, rigid, kept, badgeNone, badgeSet };
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.collection).toEqual({ trailer:'t1', driver:'d1' });  // both filled
  expect(out.rigid).toEqual({ trailer:'', driver:'d2' });         // no trailer invented
  expect(out.kept).toBe('d1');                                    // choice survives
  expect(out.badgeNone).toContain('Assign');
  expect(out.badgeSet).toContain('SH03');
  expect(out.badgeSet).toContain('Masden');
});

// The earlier tests checked that openRig() ran and set a class. They passed
// while the panel was invisible, because admin's modal CSS was scoped to
// #sec-overview and the modal is appended at body level. Assert what the user
// actually experiences: the panel is on screen and big enough to use.
for (const app of ['/dashboard/', '/admin/']) {
  test(`${app} assign panel actually becomes visible`, async ({ page }) => {
    await page.goto(app);
    await page.waitForTimeout(2300);
    const isAdmin = app === '/admin/';

    const before = await page.locator('#rigm').evaluate(el => getComputedStyle(el).display);
    expect(before).toBe('none');

    await page.evaluate(a => {
      const scope = a ? OverviewApp : window;
      FLEET = { vehicles:[{id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570',model:'VOLVO',
                           default_driver_id:'d1', default_trailer_id:'t1'}],
                trailers:[{id:'t1',trailer_no:'ST03',reg_no:'AFJ 2731'}],
                drivers:[{id:'d1',full_name:'Masden'}] };
      ASSIGN = {};
      allSales = [{ id: 99, customer:'Khaya Cement', litres:40000 }];
      scope.openRig(99);
    }, isAdmin);

    const after = await page.locator('#rigm').evaluate(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { display: cs.display, w: Math.round(r.width), h: Math.round(r.height) };
    });
    console.log(app + ' panel open: ' + JSON.stringify(after));
    expect(after.display).toBe('flex');
    expect(after.w).toBeGreaterThan(200);
    expect(after.h).toBeGreaterThan(200);

    // The one-click rig picker is the primary control now; the separate truck
    // and trailer dropdowns sit behind the swap link, hidden by default.
    await expect(page.locator('#rig-rig')).toBeVisible();
    await expect(page.locator('#rig-save')).toBeVisible();
    await expect(page.locator('#rig-vehicle')).toBeHidden();
    await page.click('#rig-adv-btn');
    await expect(page.locator('#rig-vehicle')).toBeVisible();
    // Admin keeps FLEET inside its OverviewApp module, so a global seeded
    // from here never reaches it - the option count is only meaningful on
    // the dashboard, where the module scope is the window.
    if (!isAdmin) {
      expect(await page.locator('#rig-vehicle option').count()).toBe(2);
    }
  });
}


const FLEET_FIXTURE = `FLEET = {
  vehicles: [
    {id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570',model:'VOLVO',default_driver_id:'d1',default_trailer_id:'t1'},
    {id:'v2',fleet_no:'SR01',reg_no:'ACQ 3840',model:'SCANIA',default_driver_id:'d2',default_trailer_id:null},
    {id:'v3',fleet_no:'SR06',reg_no:'ADS 3097',model:'SCANIA',default_driver_id:'d2',default_trailer_id:null}
  ],
  trailers: [{id:'t1',trailer_no:'ST03',reg_no:'AFJ 2731'}],
  drivers:  [{id:'d1',full_name:'Masden'},{id:'d2',full_name:'Phillip'}]
};
allSales = [{id:99,customer:'Khaya Cement',litres:40000}];`;

for (const app of ['/dashboard/', '/admin/']) {
  test(`${app} one-click rig picker`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,120)); });
    await page.goto(app);
    await page.waitForTimeout(2400);
    const isAdmin = app === '/admin/';

    const out = await page.evaluate(([a, fixture]) => {
      const scope = a ? OverviewApp : window;
      (0, eval)(fixture);
      // admin keeps this state inside its module; seed it through the hook
      if (a) scope.__seed({ FLEET, ASSIGN: {}, allSales });
      ASSIGN = {};
      scope.openRig(99);

      const labels = [...document.querySelectorAll('#rig-rig option')].map(o => o.textContent);
      const advAtOpen = document.getElementById('rig-adv').style.display;

      // pick the rig with a trailer
      document.getElementById('rig-rig').value = 'v1';
      scope.rigPicked();
      const afterTrailerRig = {
        vehicle: document.getElementById('rig-vehicle').value,
        trailer: document.getElementById('rig-trailer').value,
        driver:  document.getElementById('rig-driver').value,
      };

      // pick a rigid truck — no trailer should be invented
      document.getElementById('rig-rig').value = 'v2';
      scope.rigPicked();
      const afterRigid = {
        vehicle: document.getElementById('rig-vehicle').value,
        trailer: document.getElementById('rig-trailer').value,
        driver:  document.getElementById('rig-driver').value,
      };

      scope.toggleRigAdvanced();
      const advAfterToggle = document.getElementById('rig-adv').style.display;

      // reopen on a non-standard assignment: the detail should be showing
      ASSIGN['99'] = { sale_id:99, vehicle_id:'v1', trailer_id:'t1', driver_id:'d2' };
      if (a) scope.__seed({ ASSIGN });
      scope.openRig(99);
      const advOnUnusual = document.getElementById('rig-adv').style.display;

      // and on a standard one it should stay hidden
      ASSIGN['99'] = { sale_id:99, vehicle_id:'v1', trailer_id:'t1', driver_id:'d1' };
      if (a) scope.__seed({ ASSIGN });
      scope.openRig(99);
      const advOnUsual = document.getElementById('rig-adv').style.display;

      return { labels, advAtOpen, afterTrailerRig, afterRigid, advAfterToggle, advOnUnusual, advOnUsual };
    }, [isAdmin, FLEET_FIXTURE]);
    console.log(app + ' ' + JSON.stringify(out, null, 1));

    // one entry per truck, driver named first, both of Phillip's shown
    expect(out.labels.length).toBe(4);                       // placeholder + 3
    expect(out.labels[1]).toContain('Masden');
    expect(out.labels[1]).toContain('SH03 (AFJ 2570)');
    expect(out.labels[1]).toContain('ST03 (AFJ 2731)');
    expect(out.labels.filter(l => l.includes('Phillip')).length).toBe(2);
    expect(out.labels[2]).not.toContain('ST');               // rigid: no trailer

    expect(out.afterTrailerRig).toEqual({vehicle:'v1',trailer:'t1',driver:'d1'});
    expect(out.afterRigid).toEqual({vehicle:'v2',trailer:'',driver:'d2'});

    expect(out.advAtOpen).toBe('none');       // new assignment: one click only
    expect(out.advAfterToggle).toBe('');      // link reveals the detail
    expect(out.advOnUnusual).toBe('');        // odd pairing opens showing why
    expect(out.advOnUsual).toBe('none');      // normal pairing stays simple
    expect(errs).toEqual([]);
  });
}
