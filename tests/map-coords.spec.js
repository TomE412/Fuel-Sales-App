const { test, expect } = require('@playwright/test');

// Pasting coordinates from WhatsApp into the map search. The search was a
// pure substring match on names, so a coordinate always returned "Nothing
// found". These check the parser against the shapes a phone actually
// produces, and the two Zimbabwe-specific mistakes worth catching.

const HARARE = { lat: -17.8252, lng: 31.0335 };

for (const [app, url] of [['ops planner', '/ops/'], ['admin', '/admin/']]) {

  test(`${app}: reads the coordinate formats a phone produces`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto(url);
    await page.waitForTimeout(2500);

    const out = await page.evaluate(() => {
      const P = typeof parseLatLng === 'function'
        ? parseLatLng
        : LogisticsApp.parseLatLng || window.parseLatLng;
      const run = s => P(s);
      return {
        comma:    run('-17.8252, 31.0335'),
        space:    run('-17.8252 31.0335'),
        tight:    run('-17.8252,31.0335'),
        waLink:   run('https://maps.google.com/?q=-17.8252,31.0335'),
        atLink:   run('https://www.google.com/maps/@-17.8252,31.0335,15z'),
        noMinus:  run('17.8252, 31.0335'),
        swapped:  run('31.0335, -17.8252'),
        shortUrl: run('https://maps.app.goo.gl/Ab1Cd2Ef3'),
        london:   run('51.5074, -0.1278'),
        aName:    run('Proton Bakers'),
        empty:    run(''),
      };
    });
    console.log(app + '\n' + JSON.stringify(out, null, 1));

    // the three ways a person types or pastes the same point
    for (const k of ['comma', 'space', 'tight', 'waLink', 'atLink']) {
      expect(out[k], k).not.toBeNull();
      expect(out[k].lat, k + ' lat').toBeCloseTo(HARARE.lat, 4);
      expect(out[k].lng, k + ' lng').toBeCloseTo(HARARE.lng, 4);
      expect(out[k].fix, k + ' needed no correction').toBeNull();
    }

    // dropped minus sign: 17.8 N is in Sudan, so assume Harare and say so
    expect(out.noMinus.lat).toBeCloseTo(HARARE.lat, 4);
    expect(out.noMinus.lng).toBeCloseTo(HARARE.lng, 4);
    expect(out.noMinus.fix).toContain('Sudan');

    // longitude given first
    expect(out.swapped.lat).toBeCloseTo(HARARE.lat, 4);
    expect(out.swapped.lng).toBeCloseTo(HARARE.lng, 4);
    expect(out.swapped.fix).toContain('Swapped');

    // a shortened google link genuinely cannot be resolved by a static page
    expect(out.shortUrl.shortLink).toBe(true);
    expect(out.shortUrl.lat).toBeUndefined();

    // a real point that is not in Zimbabwe is flagged, not silently flown to
    expect(out.london.outside).toBe(true);

    // and ordinary searching must still fall through to the name match
    expect(out.aName).toBeNull();
    expect(out.empty).toBeNull();

    expect(errs).toEqual([]);
  });

  test(`${app}: the dropdown offers both actions for a pasted point`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await page.goto(url);
    await page.waitForTimeout(2500);

    const out = await page.evaluate(() => {
      const box = document.getElementById('msq');
      box.value = '-17.8252, 31.0335';
      box.dispatchEvent(new Event('input'));
      const res = document.getElementById('mres');
      return { open: res.classList.contains('on'), html: res.innerHTML };
    });
    console.log(app + ' ' + JSON.stringify({ open: out.open }, null, 1));

    expect(out.open).toBe(true);
    expect(out.html).toContain('Go to this point');
    expect(out.html).toContain('Add a customer here');
    expect(out.html).toContain('-17.82520, 31.03350');
    // the admin copy is inside an IIFE, so a bare handler would do nothing
    if (app === 'admin') {
      expect(out.html).toContain('LogisticsApp.flyToCoords');
      expect(out.html).toContain('LogisticsApp.addHere');
    }

    expect(errs).toEqual([]);
  });
}
