const { test, expect } = require('@playwright/test');

for (const app of ['/admin/', '/accounts/', '/ops/', '/dashboard/']) {
  test(`${app} makes note links tappable and safe`, async ({ page }) => {
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0,90)); });
    await page.goto(app);
    await page.waitForTimeout(2300);

    const out = await page.evaluate(() => {
      const shortMap = noteHtml('Gate is round the back https://maps.app.goo.gl/x7Kp2 ask for Joseph');
      const longMap  = noteHtml('https://www.google.com/maps/place/Norton/@-17.8825,30.7003,14z');
      const plain    = noteHtml('Deliver before 10am, no link here');
      const other    = noteHtml('see https://example.com/a/very/long/path/that/keeps/going/on/forever');
      const nasty    = noteHtml('<img src=x onerror=alert(1)> & "quoted"');
      const empty    = noteHtml(null);
      return {
        shortMapLinked: shortMap.includes('href="https://maps.app.goo.gl/x7Kp2"'),
        shortMapLabel:  shortMap.includes('Open in Maps'),
        shortMapKeepsText: shortMap.includes('Gate is round the back') && shortMap.includes('ask for Joseph'),
        longMapLabel:   longMap.includes('Open in Maps'),
        newTab:         shortMap.includes('target="_blank"') && shortMap.includes('rel="noopener noreferrer"'),
        plainUnchanged: plain === 'Deliver before 10am, no link here',
        otherTruncated: other.includes('&hellip;') && other.includes('href="https://example.com/a/very/long/path'),
        scriptNeutered: !nasty.includes('<img') && nasty.includes('&lt;img'),
        ampersandSafe:  nasty.includes('&amp;'),
        emptySafe:      empty === '',
      };
    });
    console.log(app + ' ' + JSON.stringify(out, null, 1));

    expect(out.shortMapLinked).toBe(true);
    expect(out.shortMapLabel).toBe(true);
    expect(out.shortMapKeepsText).toBe(true);   // the note still reads as a note
    expect(out.longMapLabel).toBe(true);
    expect(out.newTab).toBe(true);
    expect(out.plainUnchanged).toBe(true);
    expect(out.otherTruncated).toBe(true);
    expect(out.scriptNeutered).toBe(true);      // a pasted tag must never become markup
    expect(out.ampersandSafe).toBe(true);
    expect(out.emptySafe).toBe(true);
    expect(errs).toEqual([]);
  });
}
