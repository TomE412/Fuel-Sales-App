const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The "Round trip" tick box is a REFERENCE marker. It is recorded against the
// sale and printed on the Commission report, and it must not move a single
// figure. The calculator is the only place the leg count changes arithmetic.

for (const [app, url, prefix] of [['rep app', '/', ''], ['admin', '/admin/', 'SalesApp.']]) {

  test(`${app}: the tick box is on the record page and starts unticked`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto(url);
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const box = document.getElementById('rt-box');
      const label = box && box.parentElement;
      return {
        exists: !!box,
        text: label ? label.textContent.trim() : null,
        onAtStart: box ? box.classList.contains('on') : null,
        // the handler the markup actually calls
        handler: label ? label.getAttribute('onclick') : null,
      };
    });
    console.log(app + ' ' + JSON.stringify(out));

    expect(out.exists).toBe(true);
    expect(out.text).toContain('Round trip');
    // Nothing is claimed until the rep says so.
    expect(out.onAtStart).toBe(false);
    // Admin's modules are IIFEs - a bare handler name silently does nothing.
    expect(out.handler).toBe(prefix + 'toggleRoundTrip(event)');

    expect(errs).toEqual([]);
  });

  test(`${app}: ticking it flips the box and nothing else`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto(url);
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const box = document.getElementById('rt-box');
      const label = box.parentElement;
      const priceBefore = document.getElementById('s-price').value;
      label.click();
      const after = box.classList.contains('on');
      label.click();
      const back = box.classList.contains('on');
      return { after, back, priceBefore, priceAfter: document.getElementById('s-price').value };
    });
    console.log(app + ' ' + JSON.stringify(out));

    expect(out.after).toBe(true);
    expect(out.back).toBe(false);
    // A reference marker must not disturb the rest of the form.
    expect(out.priceAfter).toBe(out.priceBefore);

    expect(errs).toEqual([]);
  });

  test(`${app}: the calculator charges two legs or one`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto(url);
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const set = (id, v) => { document.getElementById(id).value = v; };
      set('calc-dist', '100'); set('calc-litres', '10000');
      set('calc-depot', '1.94'); set('calc-markup', '0'); set('calc-cpkm', '2.40');

      const run = () => {
        document.querySelector('#calc-result') && null;
        return null;
      };
      run();

      const roundBtn = document.getElementById('calc-leg-round');
      const oneBtn   = document.getElementById('calc-leg-one');

      // default: round trip selected
      const defaultSelected = roundBtn.classList.contains('selected') && !oneBtn.classList.contains('selected');

      const calcBtn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'Calculate');
      calcBtn.click();
      const two = document.getElementById('r-transport').textContent;
      const twoTotal = document.getElementById('r-total').textContent;

      oneBtn.click();
      calcBtn.click();
      const one = document.getElementById('r-transport').textContent;
      const oneTotal = document.getElementById('r-total').textContent;

      return { defaultSelected, two, twoTotal, one, oneTotal,
               oneNowSelected: oneBtn.classList.contains('selected'),
               roundNowOff: !roundBtn.classList.contains('selected') };
    });
    console.log(app + ' ' + JSON.stringify(out));

    // Round trip must stay the default so the calculator answers as it always has.
    expect(out.defaultSelected).toBe(true);

    // 100km x 2.40 x 2 / 10,000 = 0.0480     and one leg is exactly half
    expect(out.two).toContain('0.0480');
    expect(out.two).toContain('2 legs');
    expect(out.one).toContain('0.0240');
    expect(out.one).toContain('1 leg');

    // delivered price moves by exactly the transport saved
    expect(out.twoTotal).toContain('1.9880');
    expect(out.oneTotal).toContain('1.9640');

    expect(out.oneNowSelected).toBe(true);
    expect(out.roundNowOff).toBe(true);

    expect(errs).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// The Commission export. The column is appended so no existing formula shifts.
// ---------------------------------------------------------------------------
test('the commission export gains a Round trip column without shifting any formula', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');

  // the new column is read from the database
  expect(src).toContain('distance_km, round_trip');

  // header appended LAST, after Paid?
  expect(src).toContain('"Paid?",');
  expect(src).toContain('"Round trip (reference only)"];');

  // written to column 25, not inserted mid-sheet
  expect(src).toContain('set(r,25,S(sale.round_trip === true');

  // the sheet range and the column widths both grew to 25
  expect(src).toContain('ws["!ref"] = "A1:"+addr(sm+2,25);');
  expect(src).toMatch(/13,14,7,22\]\.map\(w=>\(\{wch:w\}\)\)/);

  // CRITICAL: the transport formula still charges two legs. The tick box is a
  // reference marker - if this ever reads round_trip, commission figures move.
  expect(src).toContain('set(r,6,F("E"+r+"*$B$3*2/C"+r,D4));');

  // and the formula columns that follow are untouched
  expect(src).toContain('set(r,7,F(g("$D"+r+"+F"+r),D4));');
  expect(src).toContain('set(r,24,S(sale.paid ? "Yes" : "No"));');
});

test('both record forms send round_trip when a sale is saved', () => {
  const rep   = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');

  // new sale
  expect(rep).toContain('round_trip: roundTrip,');
  expect(admin).toContain('round_trip: roundTrip,');

  // and an edit, otherwise correcting a sale would silently drop the marker
  expect(rep).toContain('notes,\r\n          round_trip: roundTrip\r\n        }).eq(\'id\', editingSaleId)'
    .replace(/\r\n/g, rep.includes('\r\n') ? '\r\n' : '\n'));
  expect(admin).toContain('notes, round_trip: roundTrip, distance_km: distanceKm');

  // and it is restored when a sale is reopened for editing
  expect(rep).toContain('setRoundTrip(sale.round_trip);');
  expect(admin).toContain('setRoundTrip(sale.round_trip);');
});
