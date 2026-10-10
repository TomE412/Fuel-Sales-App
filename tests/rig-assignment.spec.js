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
