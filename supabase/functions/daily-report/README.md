# Daily Ops report — setup

This function is written and ready to deploy, but the actual deployment,
secrets, and scheduling need to happen from your Supabase/Resend accounts —
I don't have logins for either. Steps below.

## 1. Resend account (email sending)

1. Sign up at resend.com (free tier: 3,000 emails/month, 100/day).
2. Copy your **API key** from the dashboard.
3. For now you can send from Resend's shared test address
   `onboarding@resend.dev` — no setup needed, works immediately.
   To send from a `@skelsee.co.zw` address later, add Resend under
   **Domains**, then add the SPF/DKIM DNS records it gives you at your
   domain registrar. Not required to get started.

## 2. Deploy the function

**Option A — Supabase CLI** (if you install Node + the Supabase CLI):
```
supabase login
supabase link --project-ref lkaotuavapyvqfuuyzft
supabase functions deploy Daily-reports
```

**Option B — Dashboard, no CLI needed:**
Supabase Dashboard → Edge Functions → Create a new function named
`Daily-reports` → paste the contents of `index.ts` → Deploy.

## 3. Set secrets

Dashboard → Edge Functions → `Daily-reports` → Secrets:

| Key | Value |
|---|---|
| `RESEND_API_KEY` | the key from step 1 |
| `REPORT_RECIPIENTS` | `marketing@skelsee.co.zw` (comma-separate more later — no redeploy needed) |
| `REPORT_FROM` | optional, defaults to `Skelsee Ops <onboarding@resend.dev>` |

(`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are already there automatically
— don't add them yourself.)

## 4. Schedule it

Dashboard → Integrations → **Cron** → New job → pick the `Daily-reports`
function → schedule `30 4 * * *` (04:30 UTC = 06:30 Harare).

If your plan doesn't show that Cron UI, run `cron.sql` (in this folder)
once in the SQL Editor instead — same result via `pg_cron` directly.

## 5. Test it once before trusting the schedule

Trigger it manually and check the response:
```
curl -X POST https://lkaotuavapyvqfuuyzft.supabase.co/functions/v1/Daily-reports \
  -H "Authorization: Bearer <anon key>"
```
A `{"ok":true,...}` response with an email landing in your inbox a few
seconds later means it's working. If `ok:false`, the `error` field will say
which secret is missing or which query failed.
