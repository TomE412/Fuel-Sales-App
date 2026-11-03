const { test, expect } = require('@playwright/test');

// Phase D6 — telling a rep what the office has done to their load.
//
// The notification list is DERIVED from three timestamps rather than stored,
// so most of what can go wrong is in the derivation: the wrong rep's loads,
// the wrong order, a stale "delivered" surviving an undo, or a date that
// shifts a day because someone formatted it through UTC. These pin all of it.

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

test.describe('rep app: the bell', () => {

  test('the bell and its sheet are actually on the page', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    expect(await page.locator('#bellbtn').count(), 'bell button missing').toBe(1);
    expect(await page.locator('#bellcount').count(), 'unread badge missing').toBe(1);
    expect(await page.locator('#notifm').count(), 'notification sheet missing').toBe(1);

    for (const fn of ['notifEvents','notifFeed','notifBaseline','renderNotifBadge',
                      'notifWhen','openNotifs','closeNotifs','tapNotif','markAllNotifsRead']) {
      expect(await page.evaluate(n => typeof window[n], fn), fn).toBe('function');
    }
    expect(errs).toEqual([]);
  });

  test('builds the list from the three timestamps, newest first', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(({ DAY }) => {
      const iso = ms => new Date(ms).toISOString();
      const now = Date.now();
      currentUser = { id: 'me' };
      try { localStorage.removeItem('notif_read_me'); } catch(e) {}

      RIG = {
        assign: {
          '1': { sale_id:1, vehicle_id:'v1', driver_id:'d1',
                 assigned_at: iso(now - 3*DAY), en_route_at: iso(now - 2*DAY) },
          '2': { sale_id:2, vehicle_id:'v2', driver_id:'d2',
                 assigned_at: iso(now - 1*DAY), en_route_at: null },
          // another rep's load, with a truck on it
          '3': { sale_id:3, vehicle_id:'v1', driver_id:'d1', assigned_at: iso(now - 60000) },
          // older than the 21-day window
          '4': { sale_id:4, vehicle_id:'v1', driver_id:'d1', assigned_at: iso(now - 40*DAY) },
        },
        vehicles: { v1:{id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570'},
                    v2:{id:'v2',fleet_no:'SR01',reg_no:'ACQ 3840'} },
        trailers: {},
        drivers:  { d1:{id:'d1',full_name:'Masden',phone:'0772 123 456'},
                    d2:{id:'d2',full_name:'Phillip',phone:null} },
        pumps: {},
      };
      allSales = [
        { id:1, rep_id:'me',    customer:'Khaya Cement', litres:40000, delivered_at: iso(now - 3600000) },
        { id:2, rep_id:'me',    customer:'Broylay',      litres:15000, delivered_at:null },
        { id:3, rep_id:'other', customer:'Not Mine',     litres:30000, delivered_at: iso(now - 120000) },
        { id:4, rep_id:'me',    customer:'Ancient Co',   litres:10000, delivered_at:null },
        { id:5, rep_id:'me',    customer:'Cancelled Co', litres:9000,  delivered_at: iso(now - 60000),
          status:'cancelled' },
        { id:6, rep_id:'me',    customer:'No Truck Yet', litres:5000,  delivered_at:null },
      ];

      const ev = notifEvents();
      return {
        stages:    ev.map(e => e.saleId + ':' + e.stage),
        customers: ev.map(e => e.sale.customer),
      };
    }, { DAY });
    console.log(JSON.stringify(out, null, 1));

    // Newest first: delivered (1h) > assigned 2 (1d) > en route 1 (2d) > assigned 1 (3d)
    expect(out.stages).toEqual(['1:delivered','2:assigned','1:en_route','1:assigned']);

    // another rep's load must never appear — RLS hands an admin everyone's
    expect(out.customers).not.toContain('Not Mine');
    // nor a cancelled sale, nor one older than the window
    expect(out.customers).not.toContain('Cancelled Co');
    expect(out.customers).not.toContain('Ancient Co');
    // a sale with nothing done to it yet produces no event at all
    expect(out.customers).not.toContain('No Truck Yet');

    expect(errs).toEqual([]);
  });

  test('a first open is not forty unread items, but a new one does count', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(({ DAY }) => {
      const iso = ms => new Date(ms).toISOString();
      const now = Date.now();
      currentUser = { id: 'me' };
      try { localStorage.removeItem('notif_read_me'); } catch(e) {}

      RIG = { assign: { '1': { sale_id:1, vehicle_id:'v1', driver_id:'d1',
                               assigned_at: iso(now - 2*DAY) } },
              vehicles:{v1:{id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570'}},
              trailers:{}, drivers:{d1:{id:'d1',full_name:'Masden',phone:'0772 123 456'}}, pumps:{} };
      allSales = [{ id:1, rep_id:'me', customer:'Khaya Cement', litres:40000, delivered_at:null }];

      renderNotifBadge();
      const firstOpen = document.getElementById('bellcount').style.display;

      // the office now sends it on its way
      RIG.assign['1'].en_route_at = iso(now);
      renderNotifBadge();
      const afterEvent = {
        shown: document.getElementById('bellcount').style.display !== 'none',
        count: document.getElementById('bellcount').textContent,
      };

      // ...and the rep taps it
      const beforeTap = notifFeed().filter(x => x.unread).length;
      markAllNotifsRead();
      const afterRead = {
        count:  document.getElementById('bellcount').textContent,
        hidden: document.getElementById('bellcount').style.display === 'none',
        unread: notifFeed().filter(x => x.unread).length,
      };

      // a RE-assignment is new news again: a new assigned_at means a new truck
      RIG.assign['1'].assigned_at = iso(now + 1000);
      renderNotifBadge();
      const afterReassign = document.getElementById('bellcount').textContent;

      // and an undone delivery takes its own notification away with it
      allSales[0].delivered_at = iso(now + 2000);
      renderNotifBadge();
      const withDelivered = notifEvents().length;
      allSales[0].delivered_at = null;
      renderNotifBadge();
      const afterUndo = notifEvents().length;

      return { firstOpen, afterEvent, beforeTap, afterRead, afterReassign,
               withDelivered, afterUndo };
    }, { DAY });
    console.log(JSON.stringify(out, null, 1));

    // Nothing already in the past is news on a brand new phone.
    expect(out.firstOpen, 'first ever open should show no count').toBe('none');
    // But the next thing that happens is.
    expect(out.afterEvent.shown).toBe(true);
    expect(out.afterEvent.count).toBe('1');
    expect(out.beforeTap).toBe(1);
    // Mark all read clears it.
    expect(out.afterRead.hidden).toBe(true);
    expect(out.afterRead.unread).toBe(0);
    // Read state is stored per TIMESTAMP, so a changed truck is unread again.
    expect(out.afterReassign, 're-assignment should be new again').toBe('1');
    // Undo retracts the notification — the whole reason this is derived.
    expect(out.withDelivered).toBe(out.afterUndo + 1);

    expect(errs).toEqual([]);
  });

  test('the sheet reads properly and gives the driver to ring', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(({ DAY }) => {
      const iso = ms => new Date(ms).toISOString();
      const now = Date.now();
      currentUser = { id: 'me' };
      try { localStorage.setItem('notif_read_me', '{}'); } catch(e) {}

      RIG = { assign: { '1': { sale_id:1, vehicle_id:'v1', driver_id:'d1',
                               assigned_at: iso(now - 2*DAY), en_route_at: iso(now - 1800000),
                               en_route_by: 'Munya' } },
              vehicles:{v1:{id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570'}},
              trailers:{}, drivers:{d1:{id:'d1',full_name:'Masden',phone:'0772 123 456'}}, pumps:{} };
      allSales = [{ id:1, rep_id:'me', customer:'Khaya Cement', litres:40000,
                    delivered_at: iso(now - 600000) }];

      openNotifs();
      const open = {
        display: getComputedStyle(document.getElementById('notifm')).display,
        sub:     document.getElementById('notif-sub').textContent,
        html:    document.getElementById('notif-body').innerHTML,
        clear:   document.getElementById('notif-clear').style.display,
      };
      closeNotifs();
      const closed = getComputedStyle(document.getElementById('notifm')).display;

      // and the empty case
      allSales = [];
      openNotifs();
      const empty = document.getElementById('notif-body').innerHTML;
      const emptySub = document.getElementById('notif-sub').textContent;
      closeNotifs();
      return { open, closed, empty, emptySub };
    }, { DAY });
    console.log(JSON.stringify({ sub: out.open.sub, display: out.open.display,
      closed: out.closed, emptySub: out.emptySub }, null, 1));
    console.log(out.open.html);

    expect(out.open.display).not.toBe('none');
    expect(out.closed).toBe('none');

    // all three stages present, each named in words a rep would use
    expect(out.open.html).toContain('Truck assigned');
    expect(out.open.html).toContain('On its way');
    expect(out.open.html).toContain('Delivered');
    expect(out.open.html).toContain('Marked delivered by the office');
    // the load it is about
    expect(out.open.html).toContain('Khaya Cement');
    expect(out.open.html).toContain('40,000 L');
    // the truck and someone to ring, which is the point of opening it
    expect(out.open.html).toContain('AFJ 2570');
    expect(out.open.html).toContain('SH03');
    expect(out.open.html).toContain('Masden');
    expect(out.open.html).toContain('tel:0772123456');
    // three unread
    expect(out.open.sub).toContain('3 new updates');
    expect(out.open.clear).not.toBe('none');

    // nothing yet must explain itself rather than showing a blank sheet
    expect(out.empty).toContain('No updates on your loads yet');
    expect(out.emptySub).toBe('Nothing yet');

    expect(errs).toEqual([]);
  });

  test('the date never shifts a day, late at night in Harare', async ({ page }) => {
    // Harare is UTC+2 with no DST. Anything formatted by going through an ISO
    // string reads a day early for the last two hours of every day here —
    // this is the bug the test timezone exists to catch.
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const now = new Date();
      const at = h => { const d = new Date(now); d.setHours(h, 45, 0, 0); return d.toISOString(); };
      const back = d => { const x = new Date(now); x.setDate(x.getDate() - d); x.setHours(12,0,0,0);
                          return x.toISOString(); };
      return {
        lateTonight: notifWhen(at(23)),   // 23:45 local today
        earlyToday:  notifWhen(at(1)),    // 01:45 local today
        yesterday:   notifWhen(back(1)),
        threeDays:   notifWhen(back(3)),
        longAgo:     notifWhen(back(30)),
        rubbish:     notifWhen('not a date'),
        nothing:     notifWhen(null),
      };
    });
    console.log(JSON.stringify(out, null, 1));

    // today shows a clock time, and 23:45 is still TODAY in Harare
    expect(out.lateTonight).toBe('23:45');
    expect(out.earlyToday).toBe('01:45');
    expect(out.yesterday).toBe('yesterday');
    expect(out.threeDays).toBe('3 days ago');
    expect(out.longAgo).toMatch(/^\d{2} [A-Z][a-z]{2}$/);
    expect(out.rubbish).toBe('');
    expect(out.nothing).toBe('');

    expect(errs).toEqual([]);
  });

  test('the row pill says gone, not just booked', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      RIG = { assign: {
                '1': { sale_id:1, vehicle_id:'v1', driver_id:'d1',
                       assigned_at:'2026-11-01T08:00:00Z', seen_by_rep_at:'2026-11-01T09:00:00Z' },
                '2': { sale_id:2, vehicle_id:'v1', driver_id:'d1',
                       assigned_at:'2026-11-01T08:00:00Z', seen_by_rep_at:'2026-11-01T09:00:00Z',
                       en_route_at:'2026-11-02T06:00:00Z' } },
              vehicles:{v1:{id:'v1',fleet_no:'SH03',reg_no:'AFJ 2570'}},
              trailers:{}, drivers:{d1:{id:'d1',full_name:'Masden',phone:'0772 123 456'}}, pumps:{} };
      return { booked: repRigBadge(1), gone: repRigBadge(2) };
    });
    console.log(JSON.stringify(out, null, 1));

    expect(out.booked).toContain('AFJ 2570');
    expect(out.booked).not.toContain('On its way');
    expect(out.gone).toContain('On its way');
    expect(out.gone).toContain('AFJ 2570');

    expect(errs).toEqual([]);
  });

  test('the app brings in what the office did without being asked', async ({ page }) => {
    // The bell is only as fresh as the last load, and nothing used to refresh
    // this app at all except signing in and saving a sale.
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/');
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const calls = [];
      const orig = window.loadSales;
      window.loadSales = () => { calls.push('load'); };
      currentUser = { id: 'me' };

      refreshFromOffice();                       // visible + online -> refreshes
      const whenVisible = calls.length;

      currentUser = null;
      refreshFromOffice();                       // nobody signed in -> must not
      const whenSignedOut = calls.length;

      window.loadSales = orig;
      return { whenVisible, whenSignedOut, hooked: typeof refreshFromOffice };
    });
    console.log(JSON.stringify(out, null, 1));

    expect(out.hooked).toBe('function');
    expect(out.whenVisible, 'should refresh when brought to the front').toBe(1);
    expect(out.whenSignedOut, 'must not refresh with nobody signed in').toBe(1);

    expect(errs).toEqual([]);
  });
});

test.describe('the office end: sending a load on its way', () => {

  for (const [app, url, prefix] of [
    ['dashboard', '/dashboard/', ''],
    ['admin',     '/admin/',     'OverviewApp.'],
  ]) {

    test(`${app}: the button, and the chip once it has gone`, async ({ page }) => {
      const errs = [];
      page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
      await page.goto(url);
      await page.waitForTimeout(2500);

      const out = await page.evaluate(({ isAdmin }) => {
        const now = new Date();
        const todayAt = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString(); };
        const ASS = {
          '1': { sale_id:1, vehicle_id:'v1', driver_id:'d1' },                      // booked, not gone
          '2': { sale_id:2, vehicle_id:'v1', driver_id:'d1',
                 en_route_at: todayAt(14, 32), en_route_by:'Munya' },                // gone today
          '3': { sale_id:3, vehicle_id:'v1', driver_id:'d1',
                 en_route_at:'2026-01-05T09:00:00Z' },                               // gone long ago
        };
        const cell = isAdmin
          ? (id => { OverviewApp.__seed({ ASSIGN: ASS }); return OverviewApp.enRouteCell(id); })
          : (id => { ASSIGN = ASS; return enRouteCell(id); });
        return { booked: cell(1), goneToday: cell(2), goneOld: cell(3), missing: cell(99) };
      }, { isAdmin: app === 'admin' });
      console.log(app + '\n' + JSON.stringify(out, null, 1));

      // not gone yet: an invitation to send it
      expect(out.booked).toContain('En route');
      expect(out.booked).toContain('enroute-btn');
      // a load with no assignment at all still offers the button (it warns
      // and opens the assign dialog when tapped, rather than hiding)
      expect(out.missing).toContain('enroute-btn');

      // gone: says so, with the time it left and a way to take it back
      expect(out.goneToday).toContain('On its way');
      expect(out.goneToday).toContain('14:32');
      expect(out.goneToday).toContain('er-undo');
      expect(out.goneToday).toContain('Munya');
      // one that left on an earlier day shows the DATE, not a bare time that
      // would read as if it had just left
      expect(out.goneOld).toContain('05 Jan');
      expect(out.goneOld).not.toContain('09:00');

      // The admin copy lives inside an IIFE, so a bare handler name would be
      // a button that silently does nothing at all.
      if (app === 'admin') {
        expect(out.booked).toContain('OverviewApp.setEnRoute');
        expect(out.goneToday).toContain('OverviewApp.clearEnRoute');
      }

      expect(errs).toEqual([]);
    });
  }

  test('dashboard: will not send a load with no truck on it', async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto('/dashboard/');
    await page.waitForTimeout(2500);

    const out = await page.evaluate(async () => {
      const seen = { alerts: [], opened: [], wrote: false };
      const origAlert = window.alert, origOpen = window.openRig, origFrom = sb.from;
      window.alert = m => seen.alerts.push(String(m));
      window.openRig = id => seen.opened.push(String(id));
      sb.from = () => { seen.wrote = true; throw new Error('must not reach the database'); };
      window.confirm = () => true;

      ASSIGN = { '2': { sale_id:2, vehicle_id:null, driver_id:null } };
      allSales = [{ id:1, customer:'Khaya Cement' }, { id:2, customer:'Broylay' }];
      FLEET = { vehicles: [], trailers: [], drivers: [], pumps: [] };

      await setEnRoute(1);   // no assignment row at all
      await setEnRoute(2);   // a row, but no truck on it

      window.alert = origAlert; window.openRig = origOpen; sb.from = origFrom;
      return seen;
    });
    console.log(JSON.stringify(out, null, 1));

    // Both cases warned, neither wrote.
    expect(out.alerts.length).toBe(2);
    expect(out.alerts[0]).toContain('Assign a truck first');
    expect(out.wrote, 'must not write without a truck').toBe(false);
    // and it takes him somewhere useful rather than just refusing
    expect(out.opened).toEqual(['1','2']);

    expect(errs).toEqual([]);
  });
});
