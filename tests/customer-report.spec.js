// Customer sales report — the "By customer" half of the Generate sales report
// panel at the bottom of the Accounts tracker view.
//
// The point of this report is that accounts can check a customer's statement
// against what the reps actually logged, so the two things that must be right
// are (a) it finds every sale however the name was typed, and (b) the money
// total is honest about TBA-priced sales. Both are tested here against
// controlled rows rather than hoping live data happens to contain the case.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;

// Rows shaped exactly as the real query returns them, covering the cases that
// matter: the proper name, the rep's alias, a lower-case typo, a TBA sale at
// price 0, and somebody else's sale that must not be counted.
const FAKE_SALES = [
  { id: 1, sale_date: '2026-03-04', delivery_date: '2026-03-05', fuel_type: 'Diesel',
    litres: 35000, price_per_litre: 1.45, price_tba: false, payment_term: '30d',
    payment_due: '2026-04-03', customer: 'Testco Service Station', customer_id: null },
  { id: 2, sale_date: '2026-03-11', delivery_date: null, fuel_type: 'Diesel',
    litres: 20000, price_per_litre: 1.50, price_tba: false, payment_term: 'COD',
    payment_due: null, customer: 'testco  service  station', customer_id: null },
  { id: 3, sale_date: '2026-03-18', delivery_date: '2026-03-19', fuel_type: 'Petrol',
    litres: 10000, price_per_litre: 0, price_tba: true, payment_term: 'COD',
    payment_due: null, customer: 'Testco SS', customer_id: null },
  { id: 4, sale_date: '2026-03-20', delivery_date: null, fuel_type: 'Diesel',
    litres: 99000, price_per_litre: 2.00, price_tba: false, payment_term: 'COD',
    payment_due: null, customer: 'Somebody Else Entirely', customer_id: null },
];

test.describe('Accounts — customer sales report', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test.beforeEach(async ({ page }) => {
    await page.goto('/accounts/');
    await page.fill('#acc-email', EMAIL);
    await page.fill('#acc-password', PASSWORD);
    await page.click('.auth-wrap .btn-primary');
    await expect(page.locator('#acc-wrap')).toHaveClass(/active/, { timeout: 15000 });
  });

  test('the panel opens on By sales rep, with the old controls untouched', async ({ page }) => {
    await expect(page.locator('.rp-tab', { hasText: 'By sales rep' })).toHaveClass(/active/);
    await expect(page.locator('#rep-mode')).toBeVisible();
    await expect(page.locator('#cust-mode')).toBeHidden();
    // The rep report must still work exactly as it did.
    await expect(page.locator('#rep-select')).toBeVisible();
    await expect(page.locator('#gen-btn')).toHaveText('Download Excel');
  });

  test('By customer switches panels and loads the picker list', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.locator('.rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cust-mode')).toBeVisible();
    await expect(page.locator('#rep-mode')).toBeHidden();

    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 30000 });
    const options = await page.locator('#cr-list option').count();
    expect(options, 'the datalist should be populated from customer_locations').toBeGreaterThan(20);

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('it refuses to run without a customer, and rejects a name not in the list', async ({ page }) => {
    await page.locator('.rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 30000 });

    await page.click('#cr-btn');
    await expect(page.locator('#cr-status')).toContainText('Pick a customer first');
    await expect(page.locator('#cr-out')).toBeEmpty();

    await page.fill('#cr-customer', 'Not A Real Customer At All');
    await page.click('#cr-btn');
    await expect(page.locator('#cr-status')).toContainText('Nothing called');
    await expect(page.locator('#cr-out')).toBeEmpty();
  });

  test('a From month later than To is caught before any query runs', async ({ page }) => {
    await page.locator('.rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 30000 });

    // Any real label will do — the date check must fire regardless.
    const label = await page.locator('#cr-list option').first().getAttribute('value');
    await page.fill('#cr-customer', label);
    await page.selectOption('#cr-fromM', '11');   // Dec
    await page.selectOption('#cr-toM', '0');      // Jan, same year
    await page.click('#cr-btn');

    await expect(page.locator('#cr-status')).toContainText('later than the To month');
    await expect(page.locator('#cr-out')).toBeEmpty();
  });

  // ---- the derivation, against controlled rows -------------------------
  // perfFetchAll is swapped out so the rows are known. Everything else runs
  // for real: the matching, the totals, the table, the TBA handling.
  async function runWithFakeSales(page, entry) {
    await page.locator('.rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 30000 });

    return await page.evaluate(async ({ sales, entry }) => {
      window.perfFetchAll = async () => sales;
      // A customer whose proper name, rep alias and a typo are all in use.
      CR_ENTRIES = [{ label: entry.label, id: entry.id, names: new Set(entry.names) }];
      document.getElementById('cr-list').innerHTML =
        '<option value="' + entry.label + '"></option>';
      document.getElementById('cr-customer').value = entry.label;
      document.getElementById('cr-fromM').value = '0';
      document.getElementById('cr-toM').value = '11';
      await generateCustomerReport();
      return {
        html: document.getElementById('cr-out').innerHTML,
        status: document.getElementById('cr-status').textContent,
        rows: CR_ROWS.map(r => r.id),
      };
    }, { sales: FAKE_SALES, entry });
  }

  const TESTCO = {
    label: 'Testco Service Station',
    id: null,
    names: ['testco service station', 'testco ss'],
  };

  test('one pick catches every spelling, and nobody else is counted', async ({ page }) => {
    const out = await runWithFakeSales(page, TESTCO);

    // Sale 2 is the double-spaced lower-case typo, sale 3 the rep's alias.
    expect(out.rows).toEqual([1, 2, 3]);
    // Sale 4 belongs to a different customer and must be absent.
    expect(out.html).not.toContain('99,000');
    // 35,000 + 20,000 + 10,000 — the TBA litres are real litres.
    expect(out.html).toContain('65,000');
  });

  test('TBA sales show as TBA and stay out of the money total', async ({ page }) => {
    const out = await runWithFakeSales(page, TESTCO);

    // 35,000 x 1.45 = 50,750 and 20,000 x 1.50 = 30,000 -> 80,750.
    // If the TBA sale were priced at 0 the total would be unchanged, so the
    // thing that proves this is the note, not the number alone.
    expect(out.html).toContain('$80,750.00');
    expect(out.html).toContain('TBA');
    expect(out.html).toContain('1 sale priced TBA');
    expect(out.html).toContain('10,000 L');
    // And never a 0 price dressed up as a real one.
    expect(out.html).not.toContain('$0.000');
  });

  test('the total row adds up to the rows above it', async ({ page }) => {
    await runWithFakeSales(page, TESTCO);

    // Litres is the 4th column in every row, total row included — that is the
    // whole reason the total row has eight real cells instead of a colspan.
    const litres = await page.$$eval('#cr-out tbody tr:not(.cr-total) td:nth-child(4)',
      tds => tds.map(td => Number(td.textContent.replace(/,/g, ''))));
    const totalCell = await page.locator('#cr-out tr.cr-total td:nth-child(4)').textContent();

    expect(litres).toEqual([35000, 20000, 10000]);
    expect(Number(totalCell.replace(/,/g, '')))
      .toBe(litres.reduce((a, b) => a + b, 0));
  });

  test('dates read as DD/MM/YYYY in Harare, not shifted a day', async ({ page }) => {
    const out = await runWithFakeSales(page, TESTCO);
    // sale_date 2026-03-04 must render as the 4th, not the 3rd. A UTC-first
    // conversion is what breaks this, which is why the suite runs in Harare.
    expect(out.html).toContain('04/03/2026');
    expect(out.html).toContain('05/03/2026');
    // An undelivered sale shows a dash, never 01/01/1970.
    expect(out.html).not.toContain('1970');
    expect(out.html).toContain('—');
  });

  test('a customer with nothing in the period says so instead of an empty table', async ({ page }) => {
    const out = await runWithFakeSales(page, {
      label: 'Quiet Customer Ltd', id: null, names: ['quiet customer ltd'],
    });
    expect(out.status).toContain('No sales recorded for Quiet Customer Ltd');
    expect(out.html).toBe('');
  });

  test('the Excel button only appears once there is something to download', async ({ page }) => {
    await page.locator('.rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 30000 });
    await expect(page.locator('#cr-out button')).toHaveCount(0);

    await runWithFakeSales(page, TESTCO);
    await expect(page.locator('#cr-out button')).toHaveText(/Download Excel/);
  });

  test('a real customer from the live list generates without errors', async ({ page }) => {
    // Generous, because this one pays for the full customer-list scan AND a
    // real range query on top of the sign-in. The feature is not slow; the
    // default 30s budget just is not enough for three round trips.
    test.setTimeout(120000);

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.locator('.rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 60000 });

    // Take a real sale out of the tracker's own data and report on the month
    // that sale is actually in, rather than guessing a range and risking an
    // honest "no sales" that proves nothing.
    const picked = await page.evaluate(() => {
      for (const s of (allSales || [])) {
        if (!s.date) continue;
        const hit = CR_ENTRIES.find(e => e.names.has(crNorm(s.customer)));
        if (hit) return { label: hit.label, date: s.date };
      }
      return null;
    });
    test.skip(!picked, 'no recent sale resolved to a customer in the list');

    const [y, m] = picked.date.split('-');
    await page.fill('#cr-customer', picked.label);
    await page.selectOption('#cr-fromM', String(Number(m) - 1));
    await page.selectOption('#cr-toM', String(Number(m) - 1));
    await page.selectOption('#cr-fromY', y);
    await page.selectOption('#cr-toY', y);
    await page.click('#cr-btn');

    await expect(page.locator('#cr-out .cr-name')).toHaveText(picked.label, { timeout: 60000 });
    await expect(page.locator('#cr-out tr.cr-total')).toContainText('TOTAL');
    await expect(page.locator('#cr-btn')).toHaveText('Generate');
    // The row the customer was chosen for must be in the period shown.
    await expect(page.locator('#cr-out .cr-period'))
      .toContainText(String(Number(y)));

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
