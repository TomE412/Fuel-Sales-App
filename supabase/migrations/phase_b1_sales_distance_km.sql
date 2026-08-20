-- Commission report fix — real per-sale distance
-- Adds a distance-from-depot column to `sales`, captured at the moment a
-- rep records the sale (see admin/index.html, SalesApp.recordSale()).
-- Replaces a 9-entry hardcoded location->km table that silently produced
-- $0 transport cost for most sales in the Commission report.
--
-- Confirmed with the user: no backfill. This column stays null for every
-- sale recorded before this ships — only new sales get a real value.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste ->
-- Run.

alter table sales add column if not exists distance_km numeric;
