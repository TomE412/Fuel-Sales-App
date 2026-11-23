// The rep's notes, and the Loads board at phone width.
//
// Notes used to sit on the row. They can run to a paragraph - a gate code,
// who to ask for, a maps link, what went wrong last time - and one long one
// pushed every other load off a phone screen. So the row carries a button and
// the note lives in a sheet it can be copied out of.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

const LONG_NOTE =
  'Gate round the back off the main road, ask for Joseph at the guard house.\n' +
  'He has the key to the bund wall. Do NOT use the front entrance, the\n' +
  'weighbridge is broken and they will send you round anyway.\n' +
  'Last time the driver waited two hours because nobody rang ahead.\n' +
  'Ring Joseph on 0772 000 111 the morning of.\n' +
  'Pin: https://maps.app.goo.gl/x7Kp2abc';

const FIXTURE = `
window.seedNotes = function(note){
  var day = function(off){ var d = new Date(); d.setDate(d.getDate()+off);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+
           String(d.getDate()).padStart(2,'0'); };
  SALES = [
    { id:1, customer:'Mukuyu Wines', location:'Marondera', litres:12000,
      fuel_type:'Diesel', sale_date:day(-20), delivery_date:day(-4),
      status:'pending', delivered_at:null, rep_name:'Tom Eager CW', notes:'' },
    { id:2, customer:'Border Timbers', location:'Mutare', litres:36000,
      fuel_type:'Diesel', sale_date:day(-6), delivery_date:day(0),
      status:'pending', delivered_at:null, rep_name:'Tom Eager CW', notes:note },
    { id:3, customer:'Khaya Cement', location:'Norton', litres:40000,
      fuel_type:'Diesel', sale_date:day(-2), delivery_date:day(3),
      status:'pending', delivered_at:null, rep_name:'Carrie Watson', notes:'   ' },
  ];
  FLEETMAP = { vehicles:[], trailers:[], drivers:[], pumps:[], contractors:[],
               pos:{}, assign:{} };
  PLACES = []; BOARD = []; CUSTNAMES = []; RIPE = [];
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('app').classList.add('active');
  renderDeliveries();
};
`;

async function boot(page, note) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  await page.goto('/ops/');
  await page.waitForTimeout(2300);
  await page.evaluate(([fx, n]) => { (0, eval)(fx); seedNotes(n); },
    [FIXTURE, note === undefined ? LONG_NOTE : note]);
  return errs;
}

/* ------------------------------------------------------------------ */

test('a long note sits behind a button and never on the board', async ({ page }) => {
  const errs = await boot(page);

  // Not one word of it may be on the board itself. That is the whole point.
  const listed = await page.locator('#loads-list').innerText();
  expect(listed).not.toContain('guard house');
  expect(listed).not.toContain('weighbridge');
  expect(listed).not.toContain('maps.app.goo.gl');
  expect(listed).not.toContain('0772 000 111');

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#loads-list .order-row')].map(r => ({
      who: r.querySelector('.order-name').textContent.replace(/Diesel|Petrol/g, '').trim(),
      note: (r.querySelector('.notebtn') || {}).textContent || null,
    })));
  console.log(JSON.stringify(rows, null, 1));

  const withNote = rows.find(r => r.who === 'Border Timbers');
  expect(withNote.note, 'the row offers the note').toContain('Notes');
  // There is a link in it, so a pin shows without tapping through.
  expect(withNote.note).toContain('📍');

  // No note, no button. Whitespace is not a note either.
  expect(rows.find(r => r.who === 'Mukuyu Wines').note).toBeNull();
  expect(rows.find(r => r.who === 'Khaya Cement').note,
    'a note of only spaces must not earn a button').toBeNull();

  expect(realErrors(errs)).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('a note with no link gets no pin', async ({ page }) => {
  await boot(page, 'Ask for Joseph. Gate round the back.');
  const label = await page.locator('#loads-list .notebtn').first().textContent();
  console.log('label: ' + JSON.stringify(label));
  expect(label).toContain('Notes');
  expect(label).not.toContain('📍');
});

/* ------------------------------------------------------------------ */

test('the sheet shows the whole note, and copies the plain text', async ({ page }) => {
  await boot(page);

  await expect(page.locator('#notem')).toBeHidden();
  await page.locator('#loads-list .notebtn').first().click();
  await expect(page.locator('#notem')).toBeVisible();

  // It says which load, so a copied note is never a mystery.
  await expect(page.locator('#note-who')).toContainText('Border Timbers');
  await expect(page.locator('#note-who')).toContainText('36,000 L');

  const body = await page.locator('#note-body').innerText();
  expect(body).toContain('guard house');
  expect(body).toContain('Ring Joseph');
  // The line breaks the rep typed survive, so a list stays a list.
  expect(body.split('\n').length).toBeGreaterThan(4);

  // The maps link is tappable, and labelled rather than dumped as a raw URL.
  const link = page.locator('#note-body a');
  await expect(link).toHaveCount(1);
  expect(await link.getAttribute('href')).toBe('https://maps.app.goo.gl/x7Kp2abc');
  expect(await link.innerText()).toContain('Open in Maps');
  expect(await link.getAttribute('target')).toBe('_blank');

  // What gets COPIED is the plain text the rep typed. "Open in Maps" is no use
  // at all pasted into WhatsApp, and nor is a tag.
  const raw = await page.inputValue('#note-raw');
  expect(raw).toBe(LONG_NOTE);
  expect(raw).toContain('https://maps.app.goo.gl/x7Kp2abc');
  expect(raw).not.toContain('Open in Maps');
  expect(raw).not.toContain('<a href');

  await page.evaluate(() => closeNote());
  await expect(page.locator('#notem')).toBeHidden();
});

/* ------------------------------------------------------------------ */

test('a note that tries to inject markup is shown as text', async ({ page }) => {
  // The rep types this freely and it is rendered as HTML, so it has to be
  // escaped before the links are made tappable.
  await boot(page, 'Careful <img src=x onerror="window.__owned=1"> here');
  await page.locator('#loads-list .notebtn').first().click();
  const out = await page.evaluate(() => ({
    owned: !!window.__owned,
    imgs: document.querySelectorAll('#note-body img').length,
    text: document.getElementById('note-body').innerText,
  }));
  console.log(JSON.stringify(out));
  expect(out.owned, 'a note must never be able to run anything').toBe(false);
  expect(out.imgs).toBe(0);
  expect(out.text).toContain('<img src=x');
});

/* ------------------------------------------------------------------ */

test('copying reports whether it actually worked', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => openNote('2'));

  const out = await page.evaluate(async () => {
    let got = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: t => { got = t; return Promise.resolve(); } } });
    await copyNote();
    const ok = { label: document.getElementById('note-copy').textContent, copied: got };

    // The clipboard is refused on some phones and over plain http, so the
    // button must never be a dead end: it reveals the text and selects it.
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: () => Promise.reject(new Error('refused')) } });
    await copyNote();
    const fail = { label: document.getElementById('note-copy').textContent,
                   shown: document.getElementById('note-raw').style.display };
    return { ok, fail };
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.ok.copied).toBe(LONG_NOTE);
  expect(out.ok.label).toContain('Copied');
  expect(out.fail.label).toContain('Ctrl+C');
  expect(out.fail.shown, 'the text is revealed so it can be selected by hand').toBe('');
});

/* ------------------------------------------------------------------ */

test('at phone width a row becomes a card with thumb-sized buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await boot(page);

  const out = await page.evaluate(() => {
    const row = document.querySelector('#loads-list .order-row');
    const cs = el => getComputedStyle(el);
    return {
      wrap: cs(row).flexWrap,
      nameWrap: cs(row.querySelector('.order-name')).whiteSpace,
      rigW: Math.round(row.querySelector('.rigbtn').getBoundingClientRect().width),
      rowW: Math.round(row.getBoundingClientRect().width),
      delH: Math.round(row.querySelector('.deliver-btn').getBoundingClientRect().height),
      longLbl: cs(row.querySelector('.lbl-long')).display,
      shortLbl: cs(row.querySelector('.lbl-short')).display,
      hint: cs(document.querySelector('.ph .hint')).display,
      build: cs(document.getElementById('build')).display,
      tabs: cs(document.querySelector('.mtabs')).overflowX,
      tabShrink: cs(document.querySelector('.mtab')).flexShrink,
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
    };
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.wrap).toBe('wrap');
  expect(out.nameWrap, 'the customer name wraps instead of truncating').toBe('normal');
  expect(out.rigW, 'the rig badge takes the full width').toBeGreaterThan(out.rowW * 0.7);
  expect(out.delH, 'a thumb needs more than a 26px target').toBeGreaterThanOrEqual(34);
  expect(out.longLbl, 'the long label is too wide here').toBe('none');
  expect(out.shortLbl).not.toBe('none');
  expect(out.hint, 'the explanatory line is clutter on a phone').toBe('none');
  expect(out.build, 'which build you are on matters most on a phone').not.toBe('none');
  expect(out.tabs, 'five tabs scroll rather than crush').toBe('auto');
  expect(out.tabShrink, 'and are not squashed to fit instead').toBe('0');
  expect(out.docW, 'the page must never scroll sideways').toBeLessThanOrEqual(out.winW + 1);
});

/* ------------------------------------------------------------------ */

test('the notes sheet is usable on a phone too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await boot(page);
  await page.locator('#loads-list .notebtn').first().click();

  const out = await page.evaluate(() => {
    const box = document.querySelector('#notem .rigbox');
    const body = document.getElementById('note-body');
    const r = box.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    return { boxW: Math.round(r.width), winW: window.innerWidth,
             fits: r.left >= -1 && r.right <= window.innerWidth + 1,
             bodyScrolls: body.scrollHeight > b.height + 1 ||
                          getComputedStyle(body).overflowY === 'auto',
             copyH: Math.round(document.getElementById('note-copy')
                      .getBoundingClientRect().height) };
  });
  console.log(JSON.stringify(out));
  expect(out.fits, 'the sheet must sit inside the screen').toBe(true);
  expect(out.boxW).toBeLessThanOrEqual(out.winW);
  expect(out.bodyScrolls, 'a long note scrolls inside the sheet').toBe(true);
  expect(out.copyH).toBeGreaterThanOrEqual(34);
});

/* ------------------------------------------------------------------ */

test('on a desk the board is exactly as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);

  const out = await page.evaluate(() => {
    const row = document.querySelector('#loads-list .order-row');
    const cs = el => getComputedStyle(el);
    return {
      wrap: cs(row).flexWrap,
      nameWrap: cs(row.querySelector('.order-name')).whiteSpace,
      rigW: Math.round(row.querySelector('.ord-rig').getBoundingClientRect().width),
      longLbl: cs(row.querySelector('.lbl-long')).display,
      shortLbl: cs(row.querySelector('.lbl-short')).display,
      hint: cs(document.querySelector('.ph .hint')).display,
    };
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.wrap).toBe('nowrap');
  expect(out.nameWrap).toBe('nowrap');
  expect(out.rigW, 'the fixed rig column stays 152px').toBe(152);
  expect(out.longLbl).not.toBe('none');
  expect(out.shortLbl).toBe('none');
  expect(out.hint).not.toBe('none');
});
