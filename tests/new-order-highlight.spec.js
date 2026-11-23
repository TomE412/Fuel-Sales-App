// New orders stay highlighted red on the TV board for thirty minutes.
//
// There was already a NEW pill, but it was near-black and it worked off a set
// of ids held in memory - so a page reload wiped it and nothing looked new any
// more. The banner and the chime last ten seconds. Between them, an order that
// arrived while nobody was watching the wall left no trace at all.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const minsAgo = n => new Date(Date.now() - n * 60000).toISOString();

const FIXTURE = `
window.seedBoard = function(){
  var day = function(off){ var d=new Date(); d.setDate(d.getDate()+off);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+
           String(d.getDate()).padStart(2,'0'); };
  var mk = function(id, customer, createdMinsAgo, extra){
    return Object.assign({
      id:id, customer:customer, litres:12000, date:day(-1),
      deliveryDate:day(2), location:'Marondera', fuelType:'Diesel',
      rep:'Tom Eager CW', rep_name:'Tom Eager CW', delivered:false,
      notes:'', status:'pending',
      created_at:new Date(Date.now()-createdMinsAgo*60000).toISOString(),
    }, extra||{});
  };
  allSales = [
    mk(1,'Just In Co', 0),          // this second
    mk(2,'Ten Mins Co', 10),
    mk(3,'Twenty Nine Co', 29),     // the last minute of the highlight
    mk(4,'Thirty One Co', 31),      // just past it
    mk(5,'Yesterday Co', 1440),
    mk(6,'No Stamp Co', 5, { created_at:null }),
    mk(7,'Clock Ahead Co', -20),    // a phone or server clock running fast
  ];
  ASSIGN = {}; FLEET = { vehicles:[], trailers:[], drivers:[], pumps:[], contractors:[] };
  lastKnownIds = new Set(allSales.map(function(s){ return String(s.id); }));
  isFirstLoad = false;
  renderAll();
};
`;

async function boot(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);
  await page.evaluate(fx => {
    (0, eval)(fx);
    // Put the board on screen, the way signing in does. Without this every
    // check below would be running against a hidden page - which is how a
    // test passes while the thing it is testing is invisible.
    document.getElementById('auth-wrap').classList.add('hidden');
    document.getElementById('dash-wrap').classList.add('active');
    seedBoard();
  }, FIXTURE);
  return errs;
}

const rows = page => page.evaluate(() =>
  [...document.querySelectorAll('#week-list .order-row')].map(r => ({
    who: (r.querySelector('.order-name') || {}).textContent || '',
    fresh: r.classList.contains('fresh'),
    pill: (r.querySelector('.p-new') || {}).textContent || null,
    bg: getComputedStyle(r).backgroundColor,
    bar: getComputedStyle(r).boxShadow,
  })));

/* ------------------------------------------------------------------ */

test('an order logged in the last half hour is highlighted, and nothing else is', async ({ page }) => {
  const errs = await boot(page);
  const out = await rows(page);
  console.log(JSON.stringify(out, null, 1));

  const by = name => out.find(r => r.who.indexOf(name) === 0);

  // Inside the window.
  for (const n of ['Just In Co', 'Ten Mins Co', 'Twenty Nine Co']) {
    expect(by(n).fresh, n + ' is new and must be highlighted').toBe(true);
  }
  // Outside it.
  for (const n of ['Thirty One Co', 'Yesterday Co']) {
    expect(by(n).fresh, n + ' is not new and must look normal').toBe(false);
    expect(by(n).pill, n + ' must carry no NEW pill').toBeNull();
  }

  // An order with no timestamp is not treated as new - better plain than
  // permanently red.
  expect(by('No Stamp Co').fresh, 'no created_at must not mean new for ever').toBe(false);

  // And a clock running ahead of ours must not make an order new for hours.
  expect(by('Clock Ahead Co').fresh, 'a future timestamp is not new').toBe(false);

  expect(realErrors(errs)).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('the highlight is red, and strong enough to read off a wall', async ({ page }) => {
  await boot(page);
  const out = await rows(page);
  const fresh = out.find(r => r.who.indexOf('Just In Co') === 0);
  const plain = out.find(r => r.who.indexOf('Yesterday Co') === 0);
  console.log('fresh: ' + JSON.stringify(fresh));
  console.log('plain: ' + JSON.stringify(plain));

  // A tinted row...
  expect(fresh.bg).not.toBe(plain.bg);
  const rgb = fresh.bg.match(/\d+/g).map(Number);
  expect(rgb[0], 'the tint must be the red one').toBeGreaterThan(rgb[1]);
  expect(rgb[0]).toBeGreaterThan(rgb[2]);

  // ...and a solid bar down the near edge, which is what actually carries at
  // a distance. Inset, so the panel's rounded corner cannot clip it.
  expect(fresh.bar).toContain('inset');
  const barRgb = fresh.bar.match(/\d+/g).map(Number);
  expect(barRgb[0], 'the bar must be red too').toBeGreaterThan(barRgb[1] + 60);

  // The pill is red rather than the near-black it used to be.
  const pillBg = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.p-new')).backgroundColor);
  console.log('pill: ' + pillBg);
  const p = pillBg.match(/\d+/g).map(Number);
  expect(p[0]).toBeGreaterThan(150);
  expect(p[0]).toBeGreaterThan(p[1] + 80);
});

/* ------------------------------------------------------------------ */

test('the pill counts the highlight down', async ({ page }) => {
  await boot(page);
  const out = await rows(page);
  const label = n => (out.find(r => r.who.indexOf(n) === 0) || {}).pill;
  console.log(JSON.stringify({ justIn: label('Just In Co'), ten: label('Ten Mins Co'),
                               late: label('Twenty Nine Co') }));

  // Thirty minutes left at the moment it lands, counting down from there, so
  // whoever is at the wall can see which came in most recently.
  expect(label('Just In Co')).toBe('NEW · 30m');
  expect(label('Ten Mins Co')).toBe('NEW · 20m');
  // Never zero: the last minute still reads as a minute, not as nothing.
  expect(label('Twenty Nine Co')).toBe('NEW · 1m');
});

/* ------------------------------------------------------------------ */

test('it survives a reload, which the old marker did not', async ({ page }) => {
  // This is the actual fault being fixed. The old pill was "arrived while this
  // tab was open", so a TV that reloaded overnight showed nothing as new.
  await boot(page);
  expect((await rows(page)).filter(r => r.fresh).length).toBe(3);

  const out = await page.evaluate(fx => {
    (0, eval)(fx);
    seedBoard();
    // Exactly what a reload does: the app has no memory of what it has seen.
    lastKnownIds = new Set();
    isFirstLoad = true;
    renderAll();
    return [...document.querySelectorAll('#week-list .order-row')]
      .filter(r => r.classList.contains('fresh'))
      .map(r => r.querySelector('.order-name').textContent);
  }, FIXTURE);
  console.log('still highlighted after a reload: ' + JSON.stringify(out));
  expect(out.length, 'a reload must not forget which orders are new').toBe(3);
});

/* ------------------------------------------------------------------ */

test('the highlight clears itself when the time is up', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const row = () => {
      const r = [...document.querySelectorAll('#week-list .order-row')]
        .find(x => x.querySelector('.order-name').textContent.indexOf('Just In Co') === 0);
      return { fresh: r.classList.contains('fresh'),
               pill: (r.querySelector('.p-new') || {}).textContent || null };
    };
    const atStart = row();
    // Put its clock back half an hour and redraw: the 30-second refresh does
    // exactly this, so there is no timer that can be left running.
    allSales.find(s => s.id === 1).created_at =
      new Date(Date.now() - 31 * 60000).toISOString();
    renderAll();
    return { atStart: atStart, after: row() };
  });
  console.log(JSON.stringify(out));
  expect(out.atStart.fresh).toBe(true);
  expect(out.after.fresh, 'past thirty minutes it must go back to normal').toBe(false);
  expect(out.after.pill).toBeNull();
});

/* ------------------------------------------------------------------ */

test('what it looks like on the wall', async ({ page }) => {
  // Not an assertion so much as evidence: the point of this change is how it
  // reads from across a room.
  await page.setViewportSize({ width: 1600, height: 900 });
  await boot(page);
  const panel = page.locator('#week-list');
  // Visible, not merely present: counting elements on a hidden page is how a
  // test passes while nothing is actually on the wall.
  await expect(panel.locator('.order-row.fresh').first()).toBeVisible();
  expect(await panel.locator('.order-row.fresh').count()).toBe(3);
  const box0 = await panel.locator('.order-row.fresh').first().boundingBox();
  expect(box0.width, 'a highlighted row must have real width').toBeGreaterThan(200);
  expect(box0.height).toBeGreaterThan(20);

  /* A page screenshot clipped to the panel, not an element screenshot.

     An element screenshot waits for the element to stop moving, and this page
     never does: the clock ticks every second and a ticker scrolls across the
     top, so it waits until it gives up. */
  const box = await panel.boundingBox();
  await page.screenshot({
    path: 'new-order-highlight.png',
    clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 420) },
    animations: 'disabled',
  });
  console.log('screenshot written to tests/new-order-highlight.png');
});
