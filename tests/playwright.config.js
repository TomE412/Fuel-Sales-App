// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  fullyParallel: true,
  // Capped at 2 — 4 parallel Chromium instances all signing into the same
  // Supabase test account at once overwhelmed this machine badly enough
  // that unrelated tests timed out waiting on clicks that would otherwise
  // resolve in ~4s (confirmed: same 17 tests passed cleanly in 1.3 min
  // serially). If flakiness reappears, drop to `npx playwright test
  // --workers=1` rather than raising this back up.
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node static-server.js',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
