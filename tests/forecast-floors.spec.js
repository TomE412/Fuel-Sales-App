const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The weekly forecast decides who is expected to order this week. Two things
// about that decision have gone wrong historically and are guarded here.
//
// 1. The eligibility floors used to be absolute - a customer had to buy at
//    least 14 days apart and have been silent 7 days. That made every
//    frequent buyer invisible: in the week of 5 Oct 2026, 19 such customers
//    ordered 473,373 L, 52% of the week, and the forecast named none of them.
//    The floors are now relative to each customer's own cycle.
//
// 2. The standalone accounts app and the admin app's Accounts tab are
//    duplicated code, not shared. A fix applied to one and not the other has
//    bitten this project before, so the two blocks are compared directly.

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// The three lines that decide eligibility, pulled out of either copy.
function bandBlock(src) {
  const start = src.indexOf('const recencyFloor =');
  const end = src.indexOf('recentOrderConsistent) return;', start);
  expect(start, 'recencyFloor not found - were the forecast floors removed?').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end).split(/\r?\n/).map(l => l.trim()).join('\n');
}

test('both copies of the forecast use the same eligibility rule', () => {
  const admin = bandBlock(read('admin/index.html'));
  const accounts = bandBlock(read('accounts/index.html'));
  expect(accounts).toBe(admin);
});

test('the floors are relative to the cycle, not absolute', () => {
  for (const f of ['admin/index.html', 'accounts/index.html']) {
    const block = bandBlock(read(f));
    expect(block, f).toContain('Math.min(7, avgCycleDays * 0.5)');
    expect(block, f).toContain('avgCycleDays >= 3 && avgCycleDays <= 90');
    // The old absolute floors must not come back.
    expect(block, f).not.toContain('daysSinceLastOrder >= 7');
    expect(block, f).not.toContain('avgCycleDays >= 14');
  }
});

// The claim made to the user when this shipped was that the change is purely
// ADDITIVE: no customer who was predicted under the old rule stops being
// predicted. That rests on min(7, cycle/2) still being exactly 7 for every
// cycle the old rule allowed. If someone lowers the 7 or raises the 0.5, the
// change stops being additive and that promise quietly breaks.
test('no customer eligible under the old rule loses eligibility', () => {
  const recencyFloor = cycle => Math.min(7, cycle * 0.5);
  for (let cycle = 14; cycle <= 90; cycle++) {
    expect(recencyFloor(cycle), 'cycle ' + cycle).toBe(7);
  }
  // And below the old cycle floor it genuinely relaxes, which is the point.
  expect(recencyFloor(6)).toBe(3);
  expect(recencyFloor(10)).toBe(5);
});

// ripeness_pct is days_since_last / avg_cycle_days * 100 - confirmed against
// 12 live customers on 12 Oct 2026, worst disagreement 0.5 points. The whole
// justification for relaxing the recency floor is that the 85% projection
// already enforces "not too soon" on its own. This records why 7 was safe to
// keep above 14 days and wrong below it.
test('the 85% projection already rules out customers who just ordered', () => {
  const dueWithin = (cycle, daysSince, workingDays = 5) => {
    for (let n = 0; n < workingDays; n++) {
      if (daysSince + n >= 0.85 * cycle) return true;
    }
    return false;
  };
  // A monthly buyer who ordered a week ago is nowhere near due, with or
  // without the old floor - so the floor never did any work for them.
  expect(dueWithin(30, 7)).toBe(false);
  expect(dueWithin(30, 26)).toBe(true);
  // A six-day buyer who ordered five days ago is due tomorrow. The old
  // 7-day floor threw them away; this is the case the fix is for.
  expect(dueWithin(6, 5)).toBe(true);
  // But someone who ordered yesterday on a 30-day cycle still is not due.
  expect(dueWithin(30, 1)).toBe(false);
});
