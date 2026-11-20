// Payment-due reminders in the rep app.
//
// Two alerts per sale: one two days before the money is due, one on the day.
// Worked out from sales.payment_due, never stored, and only ever for the rep
// whose sale it is.
//
// Dates are built relative to today inside the page, so these tests do not
// rot the way a hard-coded November date would.

const { test, expect } = require('@playwright/test');
const { realErrors } = require('./known-noise');

// A sale whose money falls due `inDays` from today. Negative is overdue.
//
// Assigned onto window rather than declared: an indirect eval puts const and
// let in a scope of its own that is thrown away immediately, so `const mk`
// here would be undefined by the time the test used it.
const SALES = `
  window.dayStr = function(off){
    var d = new Date();
    d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
           '-' + String(d.getDate()).padStart(2,'0');
  };
  window.mk = function(id, customer, inDays, extra){
    return Object.assign({
      id: id, customer: customer, location: 'Harare', litres: 10000,
      price_per_litre: 1.85, price_tba: false, fuel_type: 'Diesel',
      payment_term: '14 days', payment_due: dayStr(inDays),
      sale_date: dayStr(inDays - 14), delivery_date: dayStr(inDays - 14),
      delivered_at: dayStr(inDays - 14) + 'T09:00:00+02:00',
      status: 'delivered', paid: false, rep_id: 'me',
    }, extra || {});
  };
`;

async function boot(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 120)); });
  await page.goto('/');
  await page.waitForTimeout(2300);
  return errs;
}

/* ------------------------------------------------------------------ */

test('the payment helpers are all there and the app still loads clean', async ({ page }) => {
  const errs = await boot(page);
  for (const fn of ['payDueDay','payDaysLeft','payState','payMoney','payWords',
                    'payPillClass','payStamp','payWhen','notifEvents','renderNotifBadge']) {
    expect(await page.evaluate(n => typeof window[n], fn), fn).toBe('function');
  }
  expect(await page.evaluate(() => PAY_WARN_DAYS)).toBe(2);
  expect(realErrors(errs)).toEqual([]);
});

/* ------------------------------------------------------------------ */

test('what counts as owed, and what is deliberately left alone', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(seed => {
    (0, eval)(seed);
    const owed = s => { const p = payState(s); return p ? p.left : null; };
    return {
      dueIn2:      owed(mk(1, 'Border Timbers', 2)),
      dueToday:    owed(mk(2, 'Olivine', 0)),
      overdue:     owed(mk(3, 'Mukuyu', -9)),
      notYetNear:  owed(mk(4, 'Khaya', 30)),

      // the four things that must never raise a reminder
      paid:        owed(mk(5, 'Paid Co',      0, { paid: true })),
      tba:         owed(mk(6, 'TBA Co',       0, { price_tba: true, price_per_litre: 0 })),
      cancelled:   owed(mk(7, 'Gone Co',      0, { status: 'cancelled' })),
      undelivered: owed(mk(8, 'Pending Co',   0, { status: 'pending', delivered_at: null })),
      noDueDate:   owed(mk(9, 'History Co',   0, { payment_due: null })),
      codTerm:     owed(mk(10,'Cash Co',      0, { payment_term: 'COD', paid: true })),

      // a timestamp in the column rather than a plain date must still work
      asStamp:     owed(mk(11,'Stamp Co',     0, { payment_due: (() => {
                       const d = new Date();
                       return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+
                              '-'+String(d.getDate()).padStart(2,'0')+'T00:00:00+00:00';
                     })() })),

      amount:      payState(mk(12,'Money Co', 0)).amount,
      money:       payMoney(payState(mk(12,'Money Co', 0)).amount),
      nearFar:     payState(mk(13,'Far Co', 30)).near,
      nearClose:   payState(mk(14,'Close Co', 2)).near,
    };
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  expect(out.dueIn2).toBe(2);
  expect(out.dueToday).toBe(0);
  expect(out.overdue).toBe(-9);
  expect(out.notYetNear).toBe(30);        // still a state, just not near yet

  expect(out.paid,        'a paid sale must never be chased').toBeNull();
  expect(out.tba,         'no agreed price, no figure to ask for').toBeNull();
  expect(out.cancelled).toBeNull();
  expect(out.undelivered, 'fuel that has not arrived cannot be chased').toBeNull();
  expect(out.noDueDate).toBeNull();
  expect(out.codTerm).toBeNull();
  expect(out.asStamp,     'payment_due may come back as a timestamp').toBe(0);

  expect(out.amount).toBeCloseTo(18500, 2);
  expect(out.money).toBe('$18,500');
  expect(out.nearFar).toBe(false);
  expect(out.nearClose).toBe(true);
});

/* ------------------------------------------------------------------ */

test('the wording says plainly how late it is', async ({ page }) => {
  await boot(page);
  const words = await page.evaluate(() =>
    [5, 2, 1, 0, -1, -2, -9].map(left => payWords({ left: left })));
  console.log(JSON.stringify(words));
  expect(words).toEqual([
    'Due in 5 days', 'Due in 2 days', 'Due tomorrow', 'Due today',
    '1 day overdue', '2 days overdue', '9 days overdue',
  ]);

  const classes = await page.evaluate(() =>
    [2, 0, -3].map(left => payPillClass({ left: left })));
  expect(classes).toEqual(['p-soon', 'p-due', 'p-over']);
});

/* ------------------------------------------------------------------ */

test('one row per debt, escalating on the due date', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(seed => {
    (0, eval)(seed);
    currentUser = { id: 'me' };
    RIG = { assign: {}, vehicles: {}, trailers: {}, drivers: {} };
    const stagesFor = inDays => {
      allSales = [mk(1, 'Border Timbers', inDays)];
      return notifEvents().filter(n => n.stage.indexOf('pay_') === 0)
        .map(n => n.stage + '@' + n.at);
    };
    return {
      threeOut: stagesFor(3),     // nothing yet
      twoOut:   stagesFor(2),     // the amber warning
      oneOut:   stagesFor(1),     // still amber
      onTheDay: stagesFor(0),     // red, and ONLY red
      late:     stagesFor(-4),    // still red, unchanged
      // The amber stamp sits exactly two days before the red one.
      stamps: { soon: payStamp('2026-11-20', -PAY_WARN_DAYS),
                due:  payStamp('2026-11-20', 0) },
    };
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  expect(out.threeOut).toEqual([]);
  expect(out.twoOut.length).toBe(1);
  expect(out.twoOut[0]).toContain('pay_soon@');
  expect(out.oneOut.length).toBe(1);
  expect(out.oneOut[0]).toContain('pay_soon@');

  // The amber row must be GONE by the due date, not sitting above the red one
  // telling the rep the money is due "soon".
  expect(out.onTheDay.length).toBe(1);
  expect(out.onTheDay[0]).toContain('pay_due@');
  expect(out.late.length).toBe(1);
  expect(out.late[0]).toContain('pay_due@');

  // Local midnight, never a UTC stamp - in Harare that would land a day early,
  // which is exactly how payment_due itself was once wrong everywhere.
  expect(out.stamps.soon).toBe('2026-11-18T00:00:00');
  expect(out.stamps.due).toBe('2026-11-20T00:00:00');
  expect(out.stamps.soon).not.toContain('Z');
});

/* ------------------------------------------------------------------ */

test('a reminder belongs to one rep, and vanishes the moment it is paid', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(seed => {
    (0, eval)(seed);
    currentUser = { id: 'me' };
    RIG = { assign: {}, vehicles: {}, trailers: {}, drivers: {} };

    // Row-level security hands an admin every rep's sales, so the bell has to
    // filter by rep or Tom would be chasing the whole company's money.
    allSales = [mk(1, 'Mine Co', 0), mk(2, 'Somebody Elses Co', 0, { rep_id: 'other' })];
    const mineOnly = notifEvents().filter(n => n.stage.indexOf('pay_') === 0)
      .map(n => n.sale.customer);

    // Nothing is stored, so marking it paid removes it with no cleanup.
    allSales = [mk(1, 'Mine Co', 0)];
    const beforePaid = notifEvents().filter(n => n.stage.indexOf('pay_') === 0).length;
    allSales[0].paid = true;
    const afterPaid = notifEvents().filter(n => n.stage.indexOf('pay_') === 0).length;

    return { mineOnly: mineOnly, beforePaid: beforePaid, afterPaid: afterPaid };
  }, SALES);
  console.log(JSON.stringify(out));

  expect([...new Set(out.mineOnly)]).toEqual(['Mine Co']);
  expect(out.beforePaid).toBe(1);
  expect(out.afterPaid, 'paid means gone, with nothing to clean up').toBe(0);
});

/* ------------------------------------------------------------------ */

test('the bell row says what is owed, when it was due, and on what terms', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(seed => {
    (0, eval)(seed);
    currentUser = { id: 'me' };
    RIG = { assign: {}, vehicles: {}, trailers: {}, drivers: {} };
    allSales = [mk(1, 'Olivine Industries', 0, { litres: 18000, price_per_litre: 1.85 })];
    try { localStorage.removeItem('notif_read_me'); } catch(e) {}

    openNotifs();
    const body = document.getElementById('notif-body').innerHTML;
    const rows = [...document.querySelectorAll('#notif-body .notif-row')].map(r => ({
      head: r.querySelector('.notif-head').className,
      title: r.querySelector('.notif-head').textContent,
      who: r.querySelector('.notif-who').textContent,
      det: r.querySelector('.notif-det') ? r.querySelector('.notif-det').textContent : '',
    }));
    const open = getComputedStyle(document.getElementById('notifm')).display;
    closeNotifs();
    return { rows: rows, open: open, hasEscapedName: body.indexOf('Olivine Industries') > -1 };
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  expect(out.open, 'the sheet must actually be on screen').not.toBe('none');
  // One money row, plus the existing "Delivered" row for the same load.
  expect(out.rows.length).toBe(2);

  const due = out.rows.find(r => r.head.indexOf('notif-head due') === 0);
  expect(due, 'a red "payment due" row').toBeTruthy();
  expect(due.who).toContain('Olivine Industries');
  expect(due.who).toContain('18,000 L');
  expect(due.det).toContain('Due today');
  expect(due.det).toContain('$33,300');
  expect(due.det).toContain('14 days from delivery');

  // Not alongside an amber row saying the same money is due "soon".
  expect(out.rows.filter(r => r.head.indexOf('soon') > -1).length).toBe(0);
  expect(out.rows.some(r => r.head.indexOf('done') > -1), 'load rows still work').toBe(true);

  // The right-hand column carries the due date, not a 00:00 clock reading.
  expect(out.rows.every(r => r.title.indexOf('00:00') === -1)).toBe(true);
  expect(due.title).toMatch(/\d{2} [A-Z][a-z]{2}$/);
});

/* ------------------------------------------------------------------ */

test('the badge counts them and marking all read clears it', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(seed => {
    (0, eval)(seed);
    currentUser = { id: 'me' };
    RIG = { assign: {}, vehicles: {}, trailers: {}, drivers: {} };
    try { localStorage.removeItem('notif_read_me'); } catch(e) {}
    allSales = [mk(1, 'A Co', 0), mk(2, 'B Co', 2), mk(3, 'C Co', -5)];

    // A phone that has shown the bell before must NOT swallow these as
    // history: the baseline only applies to a phone seeing it for the first
    // time, and the reps have all seen it since 3 Nov.
    localStorage.setItem('notif_read_me', JSON.stringify({}));
    renderNotifBadge();
    const badge = document.getElementById('bellcount');
    const shown = { text: badge.textContent, display: badge.style.display };

    const money = notifEvents().filter(n => n.stage.indexOf('pay_') === 0).length;

    markAllNotifsRead();
    const after = { text: badge.textContent, display: badge.style.display };
    closeNotifs();
    return { shown: shown, after: after, money: money };
  }, SALES);
  console.log(JSON.stringify(out));

  // One money row each - A Co red, B Co amber, C Co red.
  expect(out.money).toBe(3);
  // Plus the three "Delivered" rows these fixtures also carry.
  expect(out.shown.text).toBe('6');
  expect(out.shown.display).not.toBe('none');
  expect(out.after.display).toBe('none');
});

/* ------------------------------------------------------------------ */

test('a first-time phone is not buried in old debt', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(seed => {
    (0, eval)(seed);
    currentUser = { id: 'fresh' };
    RIG = { assign: {}, vehicles: {}, trailers: {}, drivers: {} };
    try { localStorage.removeItem('notif_read_fresh'); } catch(e) {}
    allSales = [mk(1, 'A Co', -3), mk(2, 'B Co', -8)];
    renderNotifBadge();
    return document.getElementById('bellcount').style.display;
  }, SALES);
  // The existing baseline applies to these too: on a phone that has never
  // shown the bell, everything already true is history, not news.
  expect(n).toBe('none');
});

/* ------------------------------------------------------------------ */

test('the pill shows on the order itself, and is visible', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(seed => {
    (0, eval)(seed);
    currentUser = { id: 'me' };
    currentProfile = { can_mark_paid: false };
    RIG = { assign: {}, vehicles: {}, trailers: {}, drivers: {} };
    allSales = [
      mk(1, 'Due Today Co', 0),
      mk(2, 'Soon Co', 2),
      mk(3, 'Late Co', -9),
      mk(4, 'Far Off Co', 30),
      mk(5, 'Pending Co', 0, { status: 'pending', delivered_at: null }),
      mk(6, 'Paid Co', 0, { paid: true }),
    ];
    // The Sales tab is behind the sign-in screen, and counting elements on a
    // hidden page is a false pass. Put it on screen first.
    document.getElementById('screen-app').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-sales').classList.add('active');
    renderSales();

    const rows = [...document.querySelectorAll('#sales-list .sale-row')].map(r => {
      const pill = r.querySelector('.p-soon, .p-due, .p-over');
      const box = pill ? pill.getBoundingClientRect() : null;
      return {
        who: r.querySelector('.sale-customer').textContent.split(/[✓⏳✗]/)[0].trim(),
        pill: pill ? pill.textContent : null,
        cls: pill ? pill.className.replace('pill ', '') : null,
        painted: box ? (box.width > 10 && box.height > 5) : null,
        meta: [...r.querySelectorAll('.sale-meta')].map(m => m.textContent).join(' | '),
      };
    });
    return rows;
  }, SALES);
  console.log(JSON.stringify(out, null, 1));

  const by = who => out.find(r => r.who.indexOf(who) === 0);

  expect(by('Due Today Co').pill).toBe('Due today');
  expect(by('Due Today Co').cls).toBe('p-due');
  expect(by('Due Today Co').painted, 'the pill must really be on screen').toBe(true);

  expect(by('Soon Co').pill).toBe('Due in 2 days');
  expect(by('Soon Co').cls).toBe('p-soon');

  expect(by('Late Co').pill).toBe('9 days overdue');
  expect(by('Late Co').cls).toBe('p-over');

  expect(by('Far Off Co').pill, 'a month out is not worth a pill').toBeNull();
  expect(by('Pending Co').pill, 'not delivered, so no clock').toBeNull();
  expect(by('Paid Co').pill).toBeNull();

  // The date it is counted from stays on the card, so there is never an
  // argument about why a sale is due on a particular day.
  expect(by('Due Today Co').meta).toContain('Pay due:');
  expect(by('Due Today Co').meta).not.toContain('Pay due: —');
});

/* ------------------------------------------------------------------ */

test('tapping a payment reminder opens the order, not the truck', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(seed => {
    (0, eval)(seed);
    currentUser = { id: 'me' };
    RIG = { assign: { '1': { sale_id: 1, vehicle_id: 'v1' } },
            vehicles: { v1: { id: 'v1', fleet_no: 'SH01', reg_no: 'AEZ 9005' } },
            trailers: {}, drivers: {} };
    allSales = [mk(1, 'Olivine Industries', 0)];

    const calls = [];
    const realEdit = window.openSaleForEdit;
    const realRig = window.openRepRig;
    window.openSaleForEdit = id => calls.push('sale:' + id);
    window.openRepRig = id => calls.push('rig:' + id);

    tapNotif(1, 'pay_due');          // money -> the order
    tapNotif(1, 'delivered');        // a load -> the rig, as before

    window.openSaleForEdit = realEdit;
    window.openRepRig = realRig;
    return calls;
  }, SALES);
  console.log(JSON.stringify(out));
  // This sale HAS a truck on it, so the payment row proves it chooses the
  // order deliberately rather than falling through to the rig by accident.
  expect(out).toEqual(['sale:1', 'rig:1']);
});
