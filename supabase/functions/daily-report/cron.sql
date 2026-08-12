-- Fallback: only needed if the Dashboard's Integrations -> Cron UI isn't
-- available on your plan. If you used that UI instead, ignore this file.
--
-- Run once in the Supabase SQL Editor after the daily-report function is
-- deployed. Schedules it for 04:30 UTC = 06:30 Harare (UTC+2, no DST) every
-- day. To change the time, edit the cron expression (minute hour * * *).
--
-- The Authorization header below uses the project's anon key — it's
-- already public (embedded in every HTML file in this repo), so there's
-- nothing sensitive in this file. It's enough to pass Supabase's gateway
-- auth check; the function itself uses its own service-role secret
-- internally for the privileged database reads.

select cron.schedule(
  'daily-ops-report',
  '30 4 * * *',
  $$
  select net.http_post(
    url := 'https://lkaotuavapyvqfuuyzft.supabase.co/functions/v1/Daily-reports',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrYW90dWF2YXB5dnFmdXV5emZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MzU4NzcsImV4cCI6MjA5NzQxMTg3N30.he7Ah-TVyzZZAMiCHglIzP-UbdnxDw-CW4V9mYYJBDU',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check it's registered:
--   select * from cron.job where jobname = 'daily-ops-report';
-- To remove it later:
--   select cron.unschedule('daily-ops-report');
