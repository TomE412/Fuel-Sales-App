-- phase_e6_alert_settings.sql
--
-- WHAT THE TV DOES WHEN A NEW ORDER ARRIVES.
--
-- Until now that was three hard-coded beeps. This lets Tom choose a sound, or
-- design one, or record his own voice, or have the screen read the order out.
--
-- WHY IT IS IN THE DATABASE AND NOT ON EACH SCREEN.
--
--   A voice note has to be recorded somewhere with a microphone, and the TV on
--   the wall has none. So Tom records it on his phone and the TV has to be
--   able to fetch it - which a setting saved in the browser could never do.
--
--   Everything else rides along with it for the same reason: the alert is a
--   company decision made once, not a per-screen preference. The one thing
--   that IS per-screen is VOLUME, which stays in each browser, because the
--   right level in the office is not the right level on a phone in a lay-by.
--
-- ONE ROW, FOR EVER. The `check (id = 1)` is what guarantees that: there is
-- no "which settings row" question to get wrong later.
--
-- Safe to run twice. Nothing existing is touched.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste PART 1,
-- Run, read it. Then PART 2. Then PART 3.


-- ===========================================================
-- PART 1 - LOOK ONLY. Reads the catalogue, nothing else.
-- ===========================================================

select 'alert_settings table' as item,
       case when to_regclass('public.alert_settings') is null
            then 'MISSING - Part 2 creates it' else 'already exists' end as state
union all
select 'current_user_role() helper',
       case when to_regprocedure('public.current_user_role()') is null
            then 'MISSING - the write policy below needs it' else 'exists' end;


-- ===========================================================
-- PART 2 - BUILD.
-- ===========================================================

create table if not exists alert_settings (
  id          smallint primary key default 1 check (id = 1),

  -- chime: a tune. voice: Tom's recording. speak: the screen reads the order
  -- out in the browser's own voice. silent: the red highlight only.
  kind        text not null default 'chime'
              check (kind in ('chime','voice','speak','silent')),

  -- which of the built-in tunes, or 'mine' when `tune` below holds one
  preset      text not null default 'chime',
  -- a designed tune: [[hz, length_ms, gap_ms], ...]
  tune        jsonb,
  wave        text not null default 'sine'
              check (wave in ('sine','triangle','square','sawtooth')),
  repeats     smallint not null default 1 check (repeats between 1 and 3),

  -- say the customer and litres after the sound, in the browser's own voice
  say_detail  boolean not null default false,

  -- The recorded voice note, as a data: URL. A few seconds of audio is tens
  -- of kilobytes, which is small enough to sit in a row and saves standing up
  -- a storage bucket and its policies for one file. Capped below so nobody
  -- can park a podcast in here.
  clip        text check (clip is null or length(clip) <= 400000),
  clip_type   text,
  clip_ms     integer check (clip_ms is null or clip_ms between 1 and 6000),

  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- The single row. Created here so the apps never have to handle "no settings
-- yet" as a separate case.
insert into alert_settings (id) values (1) on conflict (id) do nothing;

-- --- who can see and change it ------------------------------------------
-- Everyone signed in reads it: the TV has to, and so does a phone. Only ops
-- and administrators change it, same as every other shared setting.
alter table alert_settings enable row level security;

drop policy if exists alert_settings_read on alert_settings;
create policy alert_settings_read on alert_settings
  for select to authenticated using (true);

drop policy if exists alert_settings_write on alert_settings;
create policy alert_settings_write on alert_settings for all to authenticated
  using      (current_user_role() = any (array['ops','admin']))
  with check (current_user_role() = any (array['ops','admin']));


-- ===========================================================
-- PART 3 - CHECK.
--
-- Expect exactly one row, kind 'chime', no recording yet, and 2 policies.
-- ===========================================================

select 'rows (must be 1)'     as item, count(*)::text as value from alert_settings
union all select 'kind',               coalesce(max(kind),'-')   from alert_settings
union all select 'repeats',            coalesce(max(repeats)::text,'-') from alert_settings
union all select 'voice note stored',
  case when (select clip from alert_settings where id=1) is null
       then 'none yet' else 'yes' end
union all select 'policies on the table', count(*)::text from pg_policies
  where schemaname='public' and tablename='alert_settings'
order by item;
