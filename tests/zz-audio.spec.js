const { test } = require('@playwright/test');
test('how the current alert behaves', async ({ page }) => {
  await page.goto('/dashboard/');
  const out = await page.evaluate(async () => {
    const res = { states: [], madeBeforeFailing: 0, error: null };
    // 1. What state does a context start in with no user gesture?
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      res.firstState = c.state;
      c.close();
    } catch (e) { res.firstState = 'THREW: ' + e.message; }

    // 2. How many can exist at once before it refuses? The dashboard makes a
    //    new one per alert and never closes any.
    const kept = [];
    try {
      for (let i = 0; i < 40; i++) {
        kept.push(new (window.AudioContext || window.webkitAudioContext)());
        res.madeBeforeFailing = kept.length;
      }
    } catch (e) { res.error = e.name + ': ' + e.message; }
    res.states = kept.slice(0, 3).map(c => c.state);
    kept.forEach(c => { try { c.close(); } catch (e) {} });
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
});
