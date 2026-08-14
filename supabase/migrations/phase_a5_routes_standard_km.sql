-- Driver Bonus Calculator — Phase A, part 5
-- Adds a reference distance to the existing `routes` table. `routes`
-- currently has no km/distance field at all — this is what Phase D's
-- odometer-vs-standard-km tolerance check will compare a driver's actual
-- logged distance against, and it comes from the same "Running KM"
-- column as the bonus rate sheet. From now on this gets filled in (and
-- kept up to date) by the Settings-tab rate-sheet importer rather than
-- by hand.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run. Independent of the other Phase A files; run any time.

alter table routes add column if not exists standard_km numeric;
