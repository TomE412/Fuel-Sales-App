-- ============================================================================
-- phase_d5: "Round trip" reference marker on a sale
-- ============================================================================
-- A tick box on the record page so the rep can mark whether the truck ran out
-- and back for this load on its own, or whether the load was paired with
-- another.
--
-- IMPORTANT: this is a REFERENCE ONLY. It changes no price, no transport
-- cost and no commission. The Commission report's transport formula still
-- charges two legs on every sale exactly as it always has
-- (Distance x price-per-km x 2 / Volume). The marker simply appears as a
-- column on that report so the workings can be followed.
--
-- Nullable on purpose, with NO default. Existing sales become NULL, meaning
-- "nobody was ever asked" - which is true. Stamping them all 'false' would
-- be putting a claim in the record that no rep ever made.
-- ============================================================================

alter table sales
  add column if not exists round_trip boolean;

comment on column sales.round_trip is
  'Rep marked this load as a round trip (truck out and back for this load '
  'alone). Reference only - deliberately does not feed any price, transport '
  'or commission calculation. NULL means it predates the tick box.';

-- ---------------------------------------------------------------------------
-- CHECK: the column exists, is nullable, and no historical row was stamped.
-- Expect: data_type = boolean, is_nullable = YES, and
--         marked_yes = 0, marked_no = 0, not_recorded = (all your sales)
-- ---------------------------------------------------------------------------
select
  (select data_type   from information_schema.columns
    where table_name = 'sales' and column_name = 'round_trip')  as data_type,
  (select is_nullable from information_schema.columns
    where table_name = 'sales' and column_name = 'round_trip')  as is_nullable,
  count(*) filter (where round_trip is true)   as marked_yes,
  count(*) filter (where round_trip is false)  as marked_no,
  count(*) filter (where round_trip is null)   as not_recorded
from sales;
