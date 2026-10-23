-- ============================================================================
-- DOUBLE ENTRIES: Tom Eager vs Niel Martin, August + September 2026
-- ============================================================================
-- Niel was away, Tom covered some of his customers, and Niel may have logged
-- the same orders anyway. This looks for the same customer buying the same
-- volume at about the same time under BOTH names.
--
-- READ ONLY. Nothing is changed or deleted by this file.
--
-- Note on rep names: "Tom Eager CW" is Carrie Watson, a DIFFERENT person.
-- Every filter below matches 'Tom Eager' exactly so her sales stay out of it.
--
-- Note on ZWG: customer names carrying "zwg" are a separate currency account
-- and are deliberately NOT collapsed into the plain-name customer.
-- ============================================================================

with window_sales as (
  select
    s.id,
    s.sale_date,
    s.rep_name,
    s.customer,
    s.customer_id,
    s.litres,
    s.price_per_litre,
    s.price_tba,
    s.location,
    s.delivered_at,
    s.created_at,
    s.back_entered,
    -- match on the canonical customer where one is linked, otherwise on the
    -- typed name with casing and stray spaces levelled out
    coalesce(s.customer_id::text,
             lower(regexp_replace(btrim(s.customer), '\s+', ' ', 'g'))) as cust_key
  from sales s
  where s.sale_date >= date '2026-08-01'
    and s.sale_date <  date '2026-10-01'
    and s.rep_name in ('Tom Eager', 'Niel Martin')
),

-- every Tom sale paired against every Niel sale for the same customer
pairs as (
  select
    t.id            as tom_id,
    n.id            as niel_id,
    t.customer      as tom_typed_name,
    n.customer      as niel_typed_name,
    t.sale_date     as tom_date,
    n.sale_date     as niel_date,
    abs(n.sale_date - t.sale_date)              as days_apart,
    t.litres        as tom_litres,
    n.litres        as niel_litres,
    t.price_per_litre as tom_price,
    n.price_per_litre as niel_price,
    t.location      as tom_location,
    n.location      as niel_location,
    t.delivered_at  as tom_delivered,
    n.delivered_at  as niel_delivered,
    t.created_at    as tom_logged,
    n.created_at    as niel_logged,
    t.back_entered  as tom_back_entered,
    n.back_entered  as niel_back_entered,
    case
      when t.litres = n.litres and abs(n.sale_date - t.sale_date) <= 2
        then '1 - almost certainly the same order'
      when t.litres = n.litres and abs(n.sale_date - t.sale_date) <= 7
        then '2 - same volume, same week'
      when abs(t.litres - n.litres) <= greatest(t.litres, n.litres) * 0.05
           and abs(n.sale_date - t.sale_date) <= 3
        then '3 - volume within 5 percent, same few days'
      else '4 - same customer only, probably two real orders'
    end as verdict
  from window_sales t
  join window_sales n
    on n.cust_key = t.cust_key
   and t.rep_name = 'Tom Eager'
   and n.rep_name = 'Niel Martin'
)

select
  verdict,
  tom_typed_name,
  niel_typed_name,
  to_char(tom_date,  'DD/MM/YYYY') as tom_date,
  to_char(niel_date, 'DD/MM/YYYY') as niel_date,
  days_apart,
  tom_litres,
  niel_litres,
  tom_price,
  niel_price,
  tom_location,
  niel_location,
  case when tom_delivered  is null then 'pending' else 'delivered' end as tom_status,
  case when niel_delivered is null then 'pending' else 'delivered' end as niel_status,
  tom_back_entered,
  niel_back_entered,
  to_char(tom_logged,  'DD/MM/YYYY HH24:MI') as tom_logged,
  to_char(niel_logged, 'DD/MM/YYYY HH24:MI') as niel_logged,
  tom_id,
  niel_id
from pairs
order by verdict, days_apart, tom_date;
