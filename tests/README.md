# Testing this repo

Real browser tests (Playwright) for the static HTML apps in this repo —
root (rep sales app), `admin/`, `ops/`, `accounts/`, `dashboard/`. No build
step, matching the rest of the project — just a static file server and a
headless Chromium.

## One-time setup

Already done in this environment (Node.js + `npm install` + Chromium
browser binary). On a fresh machine:
```powershell
winget install -e --id OpenJS.NodeJS.LTS
cd tests
npm install
npx playwright install chromium
```

## Running the smoke tests (no login needed)

```powershell
cd tests
npm test
```
This checks that every app's entry page loads (HTTP 2xx/3xx), shows its
expected title and login form, and throws no JavaScript console errors on
load. Fast, safe to run anytime, catches structural mistakes (a broken
script tag, a missing element, a scoping bug) automatically.

## Running the authenticated tests (role-gated UI, live data)

These need a real Supabase login and are **skipped automatically** if no
credentials are set — they won't fail your run, they just won't execute.

**Recommended: one dedicated test account.** Create a throwaway user (e.g.
`test-admin@skelsee.co.zw`) with `profiles.role = 'admin'` — admin sees
every tab, so one account covers all role-gated paths. Never use a real
staff password for this.

Set credentials for the current terminal session only (not saved to disk):
```powershell
$env:TEST_ADMIN_EMAIL = "test-admin@skelsee.co.zw"
$env:TEST_ADMIN_PASSWORD = "whatever you set"
cd tests
npm test
```

`.env` files are gitignored in this folder if you'd rather keep a local
copy of the values for reference (see `.env.example`) — but note the tests
don't auto-load `.env`, they only read real environment variables, so
you'd still need to `$env:...` them before running, or paste them into
your shell's profile if you want this permanent on your own machine only.

## What's covered right now

- `smoke.spec.js` — every app loads, correct title, auth form present, zero
  console errors. Runs unconditionally.
- `auth.spec.js` — signs into `admin/` as the test account, checks the
  right nav tabs appear for its role, Overview's live data actually loads
  (not stuck on "Loading…"), tab switching works, sign-out returns to the
  login screen.

## Adding more tests later

- When Accounts/Logistics get ported into `admin/` (Phase 2/3), add their
  own `*.spec.js` files here following the same pattern.
- A second test account with `role='ops'` or `role='accounts'` would let
  you assert the *narrower* tab set too (right now only the admin-sees-all
  path is tested) — set `TEST_OPS_EMAIL`/`TEST_ACCOUNTS_EMAIL` env vars and
  extend `auth.spec.js` if that's worth the extra account to maintain.

## Viewing a failure in detail

```powershell
npx playwright show-report
```
Opens an HTML report with a trace/screenshot for anything that failed.
