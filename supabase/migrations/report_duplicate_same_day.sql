-- ============================================================================
-- DOUBLE ENTRIES, round 2: the same load typed in twice, by ANYONE
-- ============================================================================
-- The first query only compared Tom against Niel, so it was blind to a rep
-- duplicating their own entry - which is where the clearest double entry in
-- August actually is (sales 437 and 438, logged 60 seconds apart).
--
-- This one asks a simpler question of every rep at once: is there more than
-- one sale for the same customer, on the same day, for the same number of
-- litres? That is the shape a genuine double entry takes.
--
-- READ ONLY. Nothing is changed or deleted.
-- ============================================================================

with s as (
  select
    id, sale_date, rep_name, customer, customer_id, litres,
    price_per_litre, price_tba, location, created_at, delivered_at,
    coalesce(customer_id::text,
             lower(regexp_replace(btrim(customer), '\s+', ' ', 'g'))) as cust_key
  from sales
  where sale_date >= date '2026-08-01'
    and sale_date <  date '2026-10-01'
)
select
  case
    when a.rep_name = b.rep_name
     and lower(btrim(coalesce(a.location,''))) = lower(btrim(coalesce(b.location,'')))
      then '1 - same rep, same place, same day, same litres'
    when a.rep_name = b.rep_name
      then '2 - same rep, same day, same litres, different place'
    when lower(btrim(coalesce(a.location,''))) = lower(btrim(coalesce(b.location,'')))
      then '3 - TWO REPS, same place, same day, same litres'
    else '4 - two reps, same day and litres, different place'
  end                                                   as verdict,
  a.customer,
  to_char(a.sale_date, 'DD/MM/YYYY')                    as sale_date,
  a.litres,
  a.rep_name                                            as rep_a,
  b.rep_name                                            as rep_b,
  a.location                                            as place_a,
  b.location                                            as place_b,
  a.price_per_litre                                     as price_a,
  b.price_per_litre                                     as price_b,
  a.price_tba                                           as tba_a,
  b.price_tba                                           as tba_b,
  to_char(a.created_at, 'DD/MM/YYYY HH24:MI')           as logged_a,
  to_char(b.created_at, 'DD/MM/YYYY HH24:MI')           as logged_b,
  round(extract(epoch from (b.created_at - a.created_at)) / 60.0)
                                                        as minutes_apart,
  a.id                                                  as id_a,
  b.id                                                  as id_b
from s a
join s b
  on  b.cust_key   = a.cust_key
  and b.sale_date  = a.sale_date
  and b.litres     = a.litres
  and b.id > a.id            -- each pair once, not twice
order by verdict, abs(extract(epoch from (b.created_at - a.created_at))), a.sale_date;
