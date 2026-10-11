const { test, expect } = require('@playwright/test');

test('rep app: rig badge and details sheet', async ({ page }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,120)); });
  await page.goto('/');
  await page.waitForTimeout(2300);

  expect(await page.locator('#rigdm').count(), 'details sheet missing').toBe(1);
  for (const fn of ['loadRigInfo','rigLoadCached','repRigBadge','openRepRig','closeRepRig']) {
    expect(await page.evaluate(n => typeof window[n], fn), fn).toBe('function');
  }

  const out = await page.evaluate(() => {
    RIG = {
      assign: {
        '7': { sale_id:7, vehicle_id:'v1', trailer_id:'t1', driver_id:'d1', seen_by_rep_at:null },
        '8': { sale_id:8, vehicle_id:'v2', trailer_id:null, driver_id:'d2',
               seen_by_rep_at:'2026-10-11T06:00:00Z' },
      },
      vehicles: { v1:{id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570',model:'VOLVO'},
                  v2:{id:'v2',fleet_no:'SR01',reg_no:'ACQ 3840',model:'SCANIA'} },
      trailers: { t1:{id:'t1',trailer_no:'ST03',reg_no:'AFJ 2731',make:'Tanker',model:'Henred'} },
      drivers:  { d1:{id:'d1',full_name:'Masden',id_number:'63-123456X78',phone:'0772 123 456'},
                  d2:{id:'d2',full_name:'Phillip',id_number:null,phone:null} },
    };
    allSales = [{id:7,customer:'Khaya Cement',litres:40000},
                {id:8,customer:'Broylay',litres:15000},
                {id:9,customer:'Unassigned Co',litres:5000}];
    // don't let the seen-stamp write hit the network in a test
    const origFrom = sb.from;
    sb.from = () => ({ update: () => ({ eq: () => Promise.resolve({ error:null }) }) });

    const badges = { newOne: repRigBadge(7), seen: repRigBadge(8), none: repRigBadge(9) };

    openRepRig(7);
    const sheet = {
      display: getComputedStyle(document.getElementById('rigdm')).display,
      who: document.getElementById('rigd-who').textContent,
      body: document.getElementById('rigd-body').innerHTML,
    };
    const afterOpen = repRigBadge(7);     // should no longer say NEW
    closeRepRig();
    const closed = getComputedStyle(document.getElementById('rigdm')).display;

    openRepRig(8);
    const noDetails = document.getElementById('rigd-body').innerHTML;
    sb.from = origFrom;
    return { badges, sheet, afterOpen, closed, noDetails };
  });
  console.log(JSON.stringify({ badges: out.badges, who: out.sheet.who,
    display: out.sheet.display, closed: out.closed, afterOpen: out.afterOpen }, null, 1));

  // badge states
  expect(out.badges.newOne).toContain('AFJ 2570');
  expect(out.badges.newOne).toContain('Masden');
  expect(out.badges.newOne).toContain('NEW');
  expect(out.badges.seen).toContain('ACQ 3840');
  expect(out.badges.seen).not.toContain('NEW');
  expect(out.badges.none).toBe('');                 // unassigned sale shows nothing

  // the sheet
  expect(out.sheet.display).toBe('flex');
  expect(out.sheet.who).toContain('Khaya Cement');
  expect(out.sheet.body).toContain('AFJ 2570');     // truck reg
  expect(out.sheet.body).toContain('AFJ 2731');     // trailer reg
  expect(out.sheet.body).toContain('Masden');
  expect(out.sheet.body).toContain('63-123456X78'); // ID
  expect(out.sheet.body).toContain('href="tel:0772123456"');  // tap to call, digits only
  expect(out.closed).toBe('none');

  // opening clears NEW
  expect(out.afterOpen).not.toContain('NEW');

  // a driver with no ID or phone yet — says so rather than showing blanks
  expect(out.noDetails).toContain('not recorded');
  expect(out.noDetails).not.toContain('href="tel:');
  expect(errs).toEqual([]);
});
