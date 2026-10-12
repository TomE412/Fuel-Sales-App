-- WEEKLY FORECAST — accuracy sanity check
-- Read-only. Nothing is written, changed or deleted.
--
-- The main pull showed the forecast landing within a few percent on total
-- litres, but naming the right customers only 10 times out of 193. Before
-- that goes in a report it has to be established whether the customer score
-- is real or an artefact of how it is measured:
--
--   A  The app scores a hit when the customer took DELIVERY inside the week.
--      But the forecast predicts an ORDER. Someone who orders on Tuesday for
--      delivery the following Monday scores zero. This re-scores both ways.
--   B  A predicted name that does not appear in sales at all means the two
--      lists use different spellings and no hit was ever possible.
--   C  Who actually bought last week, whether they were predicted, and how
--      often they buy - to test whether the forecast's 14-day minimum cycle
--      is skipping the customers who really do order every week.
--   D  "Sheingxing" and "Shengxiang Investments" are both predicted this
--      week, 50,000 L between them. If they are one customer, the forecast
--      is double counting.
--   E  Confirms which account is the condemned Fairhill one.
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste the
-- whole thing -> Run -> Download CSV -> send me the file.

with weeks as (
  select week_start, week_start + 4 as week_end
  from weekly_forecast_snapshots
),
lastweek as (
  select max(week_start) as ws, max(week_start) + 4 as we
  from weekly_forecast_snapshots
  where week_start + 4 < current_date
),
chk as (
  select fp.week_start, fp.customer, lower(btrim(fp.customer)) as ckey,
    exists (select 1 from sales s
             where lower(btrim(s.customer)) = lower(btrim(fp.customer))
               and s.sale_date::date between w.week_start and w.week_end
               and coalesce(s.status,'') <> 'cancelled')      as ordered_that_week,
    exists (select 1 from sales s
             where lower(btrim(s.customer)) = lower(btrim(fp.customer))
               and s.delivery_date::date between w.week_start and w.week_end
               and coalesce(s.status,'') <> 'cancelled')      as delivered_that_week,
    exists (select 1 from sales s
             where lower(btrim(s.customer)) = lower(btrim(fp.customer))
               and s.sale_date::date between w.week_start and w.week_end + 14
               and coalesce(s.status,'') <> 'cancelled')      as ordered_within_3_weeks,
    exists (select 1 from sales s
             where lower(btrim(s.customer)) = lower(btrim(fp.customer)))
                                                              as name_exists_in_sales
  from weekly_forecast_predictions fp
  join weeks w on w.week_start = fp.week_start
),
actual_buyers as (
  select lower(btrim(s.customer)) as ckey,
         min(s.customer) as customer,
         sum(s.litres)   as litres
  from sales s cross join lastweek lw
  where s.sale_date::date between lw.ws and lw.we
    and coalesce(s.status,'') <> 'cancelled'
  group by lower(btrim(s.customer))
)

select section, item, detail, num_1, num_2, note
from (

  select 1 as ord, to_char(week_start,'YYYY-MM-DD') as sk,
         'A SCORED BOTH WAYS'::text as section,
         to_char(week_start,'DD Mon YYYY')::text    as item,
         (count(*) || ' customers predicted')::text as detail,
         count(*) filter (where ordered_that_week)::numeric    as num_1,
         count(*) filter (where delivered_that_week)::numeric  as num_2,
         ('num_1 = ordered that week, num_2 = took delivery that week. Ordered within 3 weeks: '
           || count(*) filter (where ordered_within_3_weeks)
           || '. Names that exist in sales at all: '
           || count(*) filter (where name_exists_in_sales))::text as note
  from chk group by week_start

  union all
  select 2, min(customer), 'B NAME NEVER MATCHES', customer,
         'predicted but no sale under this exact name'::text,
         count(*)::numeric, null::numeric,
         'spelling differs between the customer list and what reps type'::text
  from chk where not name_exists_in_sales group by customer

  union all
  select 3, lpad((1000000 - ab.litres)::text, 9, '0'),
         'C WHO ACTUALLY BOUGHT LAST WEEK', ab.customer,
         (case when coalesce(r.avg_cycle_days,0) > 0
               then 'buys every ' || round(r.avg_cycle_days) || ' days'
               else 'no cycle on file' end)::text,
         ab.litres,
         round(coalesce(r.avg_cycle_days,0))::numeric,
         ((case when exists (select 1 from weekly_forecast_predictions fp cross join lastweek lw2
                              where fp.week_start = lw2.ws
                                and lower(btrim(fp.customer)) = ab.ckey)
                then 'WAS predicted' else 'was NOT predicted' end)
          || (case when coalesce(r.avg_cycle_days,0) > 0 and r.avg_cycle_days < 14
                   then ' - under the 14-day floor, so the forecast can never pick them'
                   else '' end))::text
  from actual_buyers ab
  left join app_customer_retention r on lower(btrim(r.customer)) = ab.ckey

  union all
  select 4, to_char(s.sale_date,'YYYY-MM-DD'), 'D SHENG NAME CHECK', s.customer,
         to_char(s.sale_date,'DD Mon YYYY')::text,
         s.litres, null::numeric,
         (coalesce(s.location,'') || ' / ' || coalesce(s.rep_name,''))::text
  from sales s
  where s.customer ilike '%ngx%'

  union all
  select 5, coalesce(to_char(s.sale_date,'YYYY-MM-DD'),'z'), 'E FAIRHILL CHECK', s.customer,
         coalesce(to_char(s.sale_date,'DD Mon YYYY'),'-')::text,
         s.litres, null::numeric,
         ('sales record / ' || coalesce(s.location,''))::text
  from sales s
  where s.customer ilike '%fairhill%' or s.customer ilike '%fair hill%'
     or s.customer ilike '%chick%' or s.customer ilike '%flowell%'

  union all
  select 6, cl.invoice_name, 'E FAIRHILL CHECK', cl.invoice_name,
         'customer list entry'::text,
         null::numeric, null::numeric,
         ('customer_locations id ' || cl.id)::text
  from customer_locations cl
  where cl.invoice_name ilike '%fairhill%' or cl.invoice_name ilike '%fair hill%'
     or cl.invoice_name ilike '%chick%' or cl.invoice_name ilike '%flowell%'

) x
order by ord, sk, item;
