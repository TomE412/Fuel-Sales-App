// The same customer sales report, in the merged admin app's Accounts tab.
// Kept as its own spec because the admin build wraps everything in the
// AccountsApp IIFE — an inline handler missing its module prefix there does
// nothing at all, silently, which is exactly the failure this catches.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TEST_ADMIN_EMAIL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD;

// Pre-existing console faults in the admin app, listed in one shared place so
// this spec and people-access.spec.js cannot disagree about them. Anything not
// on that list still fails these tests.
const { realErrors } = require('./known-noise');

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

test.describe('admin app — customer sales report', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD not set — see tests/README.md');

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', PASSWORD);
    await page.click('#auth-btn');
    await expect(page.locator('#admin-shell')).toHaveClass(/active/, { timeout: 15000 });
    await page.locator('.admin-tab', { hasText: 'Accounts' }).click();
    await expect(page.locator('#sec-accounts')).toHaveClass(/active/);
  });

  test('the By customer tab is wired to AccountsApp and loads its list', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    // Every handler on this panel must carry the module prefix, or the tab
    // looks fine and does nothing when clicked.
    const handlers = await page.$$eval('#sec-accounts .rp-tab, #cr-btn',
      els => els.map(e => e.getAttribute('onclick')));
    for (const h of handlers) expect(h).toContain('AccountsApp.');

    await page.locator('#sec-accounts .rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cust-mode')).toBeVisible();
    await expect(page.locator('#rep-mode')).toBeHidden();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 60000 });
    expect(await page.locator('#cr-list option').count()).toBeGreaterThan(20);

    expect(realErrors(errors), `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('matching, totals and TBA behave the same as the standalone app', async ({ page }) => {
    test.setTimeout(120000);
    await page.locator('#sec-accounts .rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 60000 });

    // CR_ENTRIES is inside the AccountsApp closure and cannot be reached from
    // out here, which is the point of the closure. So instead of inventing a
    // customer, the controlled rows are relabelled onto a customer the module
    // has genuinely loaded — the real matching path then does the work.
    const label = await page.locator('#cr-list option').first().getAttribute('value');

    const out = await page.evaluate(async ({ sales, label }) => {
      const mine = sales.map((s, i) => ({
        ...s,
        // Three spellings of the chosen name, and one that is somebody else.
        customer: i === 3 ? 'Somebody Else Entirely'
                : i === 1 ? '  ' + label.toLowerCase().replace(/ /g, '  ') + ' '
                : label,
      }));
      window.perfFetchAll = async () => mine;
      document.getElementById('cr-customer').value = label;
      document.getElementById('cr-fromM').value = '0';
      document.getElementById('cr-toM').value = '11';
      await AccountsApp.generateCustomerReport();
      return {
        html: document.getElementById('cr-out').innerHTML,
        status: document.getElementById('cr-status').textContent,
      };
    }, { sales: FAKE_SALES, label });

    // The double-spaced lower-case spelling must be caught by the normaliser,
    // so all three of this customer's sales are here and the fourth is not.
    expect(out.status).toBe('');
    expect(out.html).not.toContain('99,000');
    expect(out.html).toContain('65,000');
    // 35,000 x 1.45 + 20,000 x 1.50, with the TBA sale's litres in and its
    // value out.
    expect(out.html).toContain('$80,750.00');
    expect(out.html).toContain('TBA');
    expect(out.html).toContain('1 sale priced TBA');
    expect(out.html).not.toContain('$0.000');
    // Harare dates, not shifted back a day by a UTC conversion.
    expect(out.html).toContain('04/03/2026');
    expect(out.html).not.toContain('1970');
  });

  test('a real customer generates on screen with no console errors', async ({ page }) => {
    test.setTimeout(120000);

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.locator('#sec-accounts .rp-tab', { hasText: 'By customer' }).click();
    await expect(page.locator('#cr-status')).toContainText('customers to choose from', { timeout: 60000 });

    const label = await page.locator('#cr-list option').first().getAttribute('value');
    await page.fill('#cr-customer', label);
    await page.click('#cr-btn');

    // Either it found sales this month or it said so in the status line —
    // both are correct, and both prove the button is actually connected.
    await expect(page.locator('#cr-btn')).toHaveText('Generate', { timeout: 60000 });
    const said = await page.evaluate(() =>
      document.getElementById('cr-status').textContent.trim() +
      document.getElementById('cr-out').innerHTML.trim());
    expect(said, 'the button did nothing at all').not.toBe('');
    expect(said).not.toMatch(/Error:/);

    expect(realErrors(errors), `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
