// What the TV does when a new order arrives, and the settings that choose it.
//
// Four shapes: a chime (picked or designed), Tom's own recorded voice, the
// screen reading the order out, or silence. Shared by every screen, because a
// voice note has to be recorded on a phone and reach the wall - except the
// volume, which stays on each screen.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

/* Counts notes played and words spoken, without needing to hear anything.
   Installed before the page's own script runs. */
const SPY = `
  window.__spy = { notes: [], spoken: [], clips: [], contexts: 0 };
  (function(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const realOsc = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function(){
        window.__spy.contexts = window.__spy.contexts;
        const o = realOsc.call(this);
        const start = o.start.bind(o);
        o.start = function(t){ window.__spy.notes.push(Math.round(o.frequency.value)); return start(t); };
        return o;
      };
      const Ctor = function(...a){ window.__spy.contexts++; return new AC(...a); };
      Ctor.prototype = AC.prototype;
      window.AudioContext = Ctor;
      window.webkitAudioContext = Ctor;
    }
    if (!window.speechSynthesis) window.speechSynthesis = {};
    window.speechSynthesis.speak = u => window.__spy.spoken.push(String(u && u.text || ''));
    window.speechSynthesis.cancel = () => {};
    window.speechSynthesis.getVoices = () => [];
    if (!window.SpeechSynthesisUtterance)
      window.SpeechSynthesisUtterance = function(t){ this.text = t; };
    // Every Audio element reports what it was asked to play, and whether it
    // was told to fail - which is how an unplayable recording is simulated.
    const RealAudio = window.Audio;
    window.Audio = function(){
      const a = new RealAudio();
      Object.defineProperty(a, 'play', { value: function(){
        window.__spy.clips.push(String(a.src).slice(0, 40));
        return window.__clipFails ? Promise.reject(new Error('cannot play'))
                                  : Promise.resolve();
      }});
      return a;
    };
  })();
`;

async function boot(page, context) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  await context.addInitScript(SPY);
  await page.goto('/dashboard/');
  await page.waitForTimeout(2300);
  await page.evaluate(() => {
    document.getElementById('auth-wrap').classList.add('hidden');
    document.getElementById('dash-wrap').classList.add('active');
  });
  return errs;
}

const spy = page => page.evaluate(() => window.__spy);
const reset = page => page.evaluate(() => {
  window.__spy.notes = []; window.__spy.spoken = []; window.__spy.clips = [];
});

/* ------------------------------------------------------------------ */

test('the settings sheet is there, and opens', async ({ page, context }) => {
  const errs = await boot(page, context);

  for (const id of ['#setm', '#kind-segs', '#preset-list', '#notes-list', '#wave-segs',
                    '#rep-segs', '#say-chk', '#vol', '#vol-val', '#snd-state',
                    '#rec-btn', '#rec-state', '#clip-state', '#set-save', '#set-err']) {
    expect(await page.locator(id).count(), 'missing ' + id).toBe(1);
  }

  await expect(page.locator('#setm')).toBeHidden();
  await page.click('.gearbtn');
  await expect(page.locator('#setm')).toBeVisible();
  const box = await page.locator('#setm .rigbox').boundingBox();
  expect(box.width).toBeGreaterThan(250);
  expect(box.height).toBeGreaterThan(250);

  await page.evaluate(() => closeSettings());
  await expect(page.locator('#setm')).toBeHidden();
  expect(realErrors(errs)).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('the four kinds each show their own controls', async ({ page, context }) => {
  await boot(page, context);
  await page.click('.gearbtn');

  const shown = async () => page.evaluate(() => ({
    chime: getComputedStyle(document.getElementById('chime-part')).display,
    voice: getComputedStyle(document.getElementById('voice-part')).display,
    on: [...document.querySelectorAll('#kind-segs .seg.on')].map(b => b.textContent),
  }));

  expect((await shown()).chime).not.toBe('none');
  expect((await shown()).voice).toBe('none');

  await page.evaluate(() => setKind('voice'));
  let s = await shown();
  expect(s.voice).not.toBe('none');
  expect(s.chime).toBe('none');
  expect(s.on).toEqual(['My voice']);

  await page.evaluate(() => setKind('speak'));
  s = await shown();
  expect(s.chime, 'reading it out needs neither a tune nor a recording').toBe('none');
  expect(s.voice).toBe('none');

  await page.evaluate(() => setKind('silent'));
  expect((await shown()).on).toEqual(['Silent']);
});

/* ------------------------------------------------------------------ */

test('each preset plays its own notes', async ({ page, context }) => {
  await boot(page, context);
  await page.click('.gearbtn');

  const played = async key => {
    await reset(page);
    await page.evaluate(k => setPreset(k), key);
    await page.waitForTimeout(120);
    return (await spy(page)).notes;
  };

  const chime = await played('chime');
  console.log('chime: ' + JSON.stringify(chime));
  expect(chime).toEqual([880, 660, 880]);

  const ping = await played('ping');
  expect(ping.length, 'a single ping is one note').toBe(1);

  const rising = await played('rising');
  console.log('rising: ' + JSON.stringify(rising));
  expect(rising.length).toBe(4);
  // It climbs - that is the whole point of it.
  for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThan(rising[i - 1]);

  const horn = await played('horn');
  expect(horn[0], 'the depot horn is low').toBeLessThan(300);
});

/* ------------------------------------------------------------------ */

test('a tune you design is what gets played', async ({ page, context }) => {
  await boot(page, context);
  await page.click('.gearbtn');

  const out = await page.evaluate(async () => {
    setPreset('ping');
    addNote(); addNote();
    setNotePitch(0, 523.3);
    setNotePitch(1, 659.3);
    setNotePitch(2, 784);
    setNoteLen(0, 200);
    window.__spy.notes = [];
    playMine();
    await new Promise(r => setTimeout(r, 120));
    return { notes: window.__spy.notes, preset: ALERT.preset,
             tune: ALERT.tune, rows: document.querySelectorAll('#notes-list .noterow').length };
  });
  console.log(JSON.stringify(out));

  expect(out.rows).toBe(3);
  expect(out.preset, 'editing a preset makes it your own, not a changed preset').toBe('mine');
  expect(out.notes).toEqual([523, 659, 784]);
  expect(out.tune[0][1], 'the length slider is what it says').toBe(200);

  // And removing one takes it out.
  const after = await page.evaluate(() => { removeNote(1); return ALERT.tune.length; });
  expect(after).toBe(2);
});

/* ------------------------------------------------------------------ */

test('an order plays whatever was chosen', async ({ page, context }) => {
  await boot(page, context);
  const sale = { id: 1, customer: 'Border Timbers', litres: 36000, rep: 'Tom Eager CW' };

  // A chime, twice.
  await reset(page);
  await page.evaluate(async s => {
    ALERT = Object.assign({}, ALERT, { kind: 'chime', preset: 'chime', repeats: 2,
                                       say_detail: false, clip: null });
    await playAlert(s);
    await new Promise(r => setTimeout(r, 1600));
  }, sale);
  let out = await spy(page);
  console.log('chime x2: ' + JSON.stringify(out.notes));
  expect(out.notes.length, 'twice means six notes, not three').toBe(6);
  expect(out.spoken).toEqual([]);

  // Reading it out instead.
  await reset(page);
  await page.evaluate(async s => {
    ALERT = Object.assign({}, ALERT, { kind: 'speak' });
    await playAlert(s);
  }, sale);
  out = await spy(page);
  console.log('spoken: ' + JSON.stringify(out.spoken));
  expect(out.notes, 'reading it out makes no chime').toEqual([]);
  expect(out.spoken.length).toBe(1);
  expect(out.spoken[0]).toContain('Border Timbers');
  expect(out.spoken[0]).toContain('36,000');
  expect(out.spoken[0]).toContain('Tom Eager CW');

  // Silence means silence.
  await reset(page);
  await page.evaluate(async s => {
    ALERT = Object.assign({}, ALERT, { kind: 'silent' });
    await playAlert(s);
    await new Promise(r => setTimeout(r, 200));
  }, sale);
  out = await spy(page);
  expect(out.notes).toEqual([]);
  expect(out.spoken).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('a recording that this screen cannot play falls back to a chime', async ({ page, context }) => {
  // The one that matters. Browsers record in different formats and will not
  // all play each other's, so a voice note recorded on a phone may be
  // unplayable on the TV - and that must never come out as silence.
  await boot(page, context);
  const sale = { id: 1, customer: 'Border Timbers', litres: 36000, rep: 'Tom Eager CW' };

  // First, one it CAN play.
  await reset(page);
  await page.evaluate(async s => {
    window.__clipFails = false;
    ALERT = Object.assign({}, ALERT, { kind: 'voice', clip: 'data:audio/webm;base64,AAAA',
                                       clip_ms: 1200, say_detail: false, preset: 'chime' });
    await playAlert(s);
    await new Promise(r => setTimeout(r, 200));
  }, sale);
  let out = await spy(page);
  console.log('playable: clips=' + out.clips.length + ' notes=' + out.notes.length);
  expect(out.clips.length, 'it plays the recording').toBe(1);
  expect(out.notes, 'and no chime on top of it').toEqual([]);

  // Now one it cannot.
  await reset(page);
  await page.evaluate(async s => {
    window.__clipFails = true;
    await playAlert(s);
    await new Promise(r => setTimeout(r, 300));
  }, sale);
  out = await spy(page);
  console.log('unplayable: clips=' + out.clips.length + ' notes=' + JSON.stringify(out.notes));
  expect(out.clips.length, 'it tries').toBe(1);
  expect(out.notes.length, 'and falls back to the chime rather than going quiet').toBe(3);

  // And it says so on screen instead of leaving you guessing.
  await page.click('.gearbtn');
  await page.evaluate(() => setKind('voice'));
  const state = await page.locator('#clip-state').textContent();
  console.log('clip state: ' + JSON.stringify(state));
  expect(state).toContain('cannot play');
});

/* ------------------------------------------------------------------ */

test('volume stays on this screen, everything else is shared', async ({ page, context }) => {
  const sent = [];
  await page.route('**/rest/v1/alert_settings**', route => {
    const req = route.request();
    if (req.method() === 'POST') sent.push(JSON.parse(req.postData() || '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json',
                           body: JSON.stringify([{ id: 1 }]) });
  });
  await boot(page, context);
  await page.click('.gearbtn');

  await page.evaluate(async () => {
    setPreset('rising'); setRepeats(3); toggleSayDetail(); setVolumePct(35);
    await saveAlertSettings();
  });
  await page.waitForTimeout(400);

  console.log('saved: ' + JSON.stringify(sent, null, 1));
  expect(sent.length).toBe(1);
  const row = Array.isArray(sent[0]) ? sent[0][0] : sent[0];
  expect(row.id).toBe(1);
  expect(row.preset).toBe('rising');
  expect(row.repeats).toBe(3);
  expect(row.say_detail).toBe(true);
  // The volume is this room's business, not the company's.
  expect(row).not.toHaveProperty('volume');
  expect(await page.evaluate(() => localStorage.getItem('dash_alert_volume'))).toBe('35');
  expect(await page.evaluate(() => Math.round(alertVolume() * 100))).toBe(35);
});

/* ------------------------------------------------------------------ */

test('a refusal by the database is reported, not shown as saved', async ({ page, context }) => {
  // Row-level security refuses by matching NO rows and reporting no error at
  // all, so an empty result is the only way to tell a refusal from a success.
  await page.route('**/rest/v1/alert_settings**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await boot(page, context);
  await page.click('.gearbtn');

  await page.evaluate(async () => { await saveAlertSettings(); });
  await page.waitForTimeout(400);
  const err = await page.locator('#set-err').textContent();
  console.log('refusal: ' + JSON.stringify(err));
  expect(err).toContain('would not accept it');
  expect(err).toContain('only ops or an administrator');
  await expect(page.locator('#set-save')).toBeEnabled();
  await expect(page.locator('#set-save')).toHaveText('Save for every screen');
});

/* ------------------------------------------------------------------ */

test('silence you cannot see is the worst kind, so it is shown', async ({ page, context }) => {
  await boot(page, context);
  await page.click('.gearbtn');
  const state = await page.locator('#snd-state').textContent();
  console.log('sound state: ' + JSON.stringify(state));
  // The test browser is launched with the gesture rule switched off, so it
  // reports ready here. What is asserted is that the page SAYS which it is.
  expect(['Sound on', 'Tap once to turn sound on']).toContain(state.trim());

  // One shared engine, not one per order - the old code built a new one each
  // time and never closed it.
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) { await playAlert({ id: i, customer: 'X', litres: 1 }); }
  });
  await page.waitForTimeout(300);
  const made = (await spy(page)).contexts;
  console.log('audio engines created: ' + made);
  expect(made, 'five orders must not make five sound engines').toBeLessThanOrEqual(1);
});

/* ------------------------------------------------------------------ */

test('a screen with no microphone says so rather than failing quietly', async ({ page, context }) => {
  await context.addInitScript(() => {
    // A TV has no microphone, and that is the normal case for this screen.
    try { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); } catch (e) {}
    try { delete window.MediaRecorder; } catch (e) {}
  });
  await boot(page, context);
  await page.click('.gearbtn');
  await page.evaluate(() => setKind('voice'));
  await page.evaluate(() => startRecording());
  await page.waitForTimeout(200);
  const st = await page.locator('#rec-state').textContent();
  console.log('no mic: ' + JSON.stringify(st));
  expect(st).toContain('cannot record');
  expect(st).toContain('phone or laptop');
});

/* ------------------------------------------------------------------ */

test('the dashboard survives its own migration not having run yet', async ({ page, context }) => {
  // The house rule is SQL first, then push. This is what happens when it goes
  // the other way round - which it did on 23 Nov 2026. The screen must keep
  // working on the default chime rather than throwing, and a save must say
  // why rather than pretending.
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/rest/v1/alert_settings**', r => r.fulfill({
    status: 404, contentType: 'application/json',
    body: JSON.stringify({ code: '42P01',
      message: 'relation "public.alert_settings" does not exist' }) }));
  await boot(page, context);

  const out = await page.evaluate(async () => {
    await playAlert({ id: 1, customer: 'Border Timbers', litres: 36000, rep: 'Tom' });
    await new Promise(r => setTimeout(r, 400));
    return { kind: ALERT.kind, preset: ALERT.preset,
             notes: window.__spy.notes, gear: !!document.querySelector('.gearbtn') };
  });
  console.log(JSON.stringify(out));

  expect(out.kind, 'it falls back to the built-in default').toBe('chime');
  expect(out.notes, 'and still alerts').toEqual([880, 660, 880]);
  expect(out.gear, 'the settings button still opens').toBe(true);
  expect(realErrors(errs), 'a missing table must not throw').toEqual([]);

  await page.click('.gearbtn');
  await page.evaluate(async () => { await saveAlertSettings(); });
  await page.waitForTimeout(400);
  const err = await page.locator('#set-err').textContent();
  console.log('save says: ' + JSON.stringify(err));
  expect(err).toContain('Could not save');
  expect(err).toContain('does not exist');
});
