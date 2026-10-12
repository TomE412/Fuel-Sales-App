-- WEEKLY FORECAST — full pull for the Monday review
-- Read-only. Nothing is written, changed or deleted by this query.
--
-- Replicates exactly what the Weekly Forecast tab computes in the browser,
-- so the report and the app can never disagree:
--   * expected order    = projected ripeness reaches 85% on a Mon-Fri day
--   * recency band      = last order at least min(7, half their cycle)
--                         days ago, and no more than 84
--   * cycle band        = average gap between orders 3 to 90 days
--   * size check        = last order between 0.4x and 1.8x their average
--   * gone_quiet        = excluded outright
-- and adds three things the tab does not show:
--   * the OVERDUE backlog (undelivered orders whose date has already passed,
--     which still have to be supplied out of stock)
--   * every customer the forecast held back, with the reason in plain words
--   * the forecast-vs-actual accuracy record, week by week
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste the
-- whole thing -> Run. Then click "Download CSV" and send me the file.

with params as (
  select (date_trunc('week', current_date))::date      as week_start,
         (date_trunc('week', current_date))::date + 4  as week_end,
         current_date                                   as today
),

-- The single most recent live order per customer. The forecast uses this
-- one order as the stand-in for their next one: its size, fuel and price.
recent as (
  select distinct on (lower(btrim(customer)))
         lower(btrim(customer)) as ckey,
         customer, litres, fuel_type, location, payment_term,
         price_per_litre, price_tba, sale_date
  from sales
  where sale_date >= current_date - 400
    and coalesce(status,'') <> 'cancelled'
  order by lower(btrim(customer)), sale_date desc, id desc
),

base as (
  select r.customer, r.status, r.last_order, r.days_since_last,
         r.avg_cycle_days, r.avg_litres, r.total_litres, r.ripeness_pct,
         rc.litres as recent_litres, rc.fuel_type, rc.location,
         rc.payment_term, rc.price_per_litre, rc.price_tba,
         p.week_start, p.week_end, p.today
  from app_customer_retention r
  cross join params p
  left join recent rc on rc.ckey = lower(btrim(r.customer))
),

scored as (
  select b.*,
    (coalesce(b.avg_cycle_days,0) between 3 and 90)   as cycle_ok,
    (coalesce(b.days_since_last,-1) >= least(7, coalesce(b.avg_cycle_days,0) * 0.5)
     and coalesce(b.days_since_last,-1) <= 84)        as recency_ok,
    case
      when coalesce(b.recent_litres,0) = 0 then coalesce(b.avg_litres,0) > 0
      when coalesce(b.avg_litres,0) > 0
        then b.recent_litres >= b.avg_litres * 0.4
         and b.recent_litres <= b.avg_litres * 1.8
      else true
    end                                                as size_ok,
    (coalesce(b.status,'') = 'gone_quiet')             as is_quiet,
    (b.customer ilike '%fairhill%' or b.customer ilike '%fair hill%') as is_condemned,
    -- Days until projected ripeness crosses 85%, counted from the Monday
    -- of the forecast week. 0 means they are already due today.
    case when coalesce(b.avg_cycle_days,0) > 0 and b.ripeness_pct is not null
      then greatest(0, ceil((85 - b.ripeness_pct) * b.avg_cycle_days / 100.0)
                       - (b.week_start - b.today))
      else null end                                    as n_needed,
    coalesce(nullif(b.recent_litres,0), b.avg_litres, 0) as fc_litres
  from base b
),

predicted as (
  select * from scored
  where not is_quiet and not is_condemned
    and cycle_ok and recency_ok and size_ok
    and n_needed is not null and n_needed <= 4
),

-- Orders already on the books for this week, still to be delivered.
booked as (
  select s.customer, s.delivery_date::date as del, s.fuel_type, s.litres,
         s.location, s.price_per_litre, s.price_tba
  from sales s cross join params p
  where s.delivery_date::date between p.week_start and p.week_end
    and coalesce(s.status,'') not in ('cancelled','delivered')
    and s.customer not ilike '%fairhill%'
    and s.customer not ilike '%fair hill%'
),

-- Orders whose delivery date has already gone by and were never marked
-- delivered. Still owed, so this fuel still has to come out of stock.
overdue as (
  select s.customer, s.delivery_date::date as del, s.fuel_type, s.litres,
         s.location, (p.today - s.delivery_date::date) as days_late
  from sales s cross join params p
  where s.delivery_date::date < p.week_start
    and coalesce(s.status,'') not in ('cancelled','delivered')
    and s.customer not ilike '%fairhill%'
    and s.customer not ilike '%fair hill%'
),

accuracy as (
  select sn.week_start,
         sn.scheduled_litres, sn.predicted_litres, sn.potential_count,
         (select coalesce(sum(x.litres),0) from sales x
           where x.delivery_date::date between sn.week_start and sn.week_start + 4
             and coalesce(x.status,'') <> 'cancelled') as actual_litres,
         (select count(*) from weekly_forecast_predictions fp
           where fp.week_start = sn.week_start)        as expected_customers,
         (select count(*) from weekly_forecast_predictions fp
           where fp.week_start = sn.week_start
             and exists (select 1 from sales x
                          where lower(btrim(x.customer)) = lower(btrim(fp.customer))
                            and x.delivery_date::date between sn.week_start and sn.week_start + 4
                            and coalesce(x.status,'') <> 'cancelled')) as customers_bought
  from weekly_forecast_snapshots sn
)

select section, item, detail, fuel_or_status, litres, dollars, note
from (

  select 1 as ord, null::date as sortkey,
         '1 WEEK'::text as section,
         'Forecast week'::text as item,
         (to_char(week_start,'DD Mon YYYY') || ' to ' || to_char(week_end,'DD Mon YYYY'))::text as detail,
         to_char(today,'Dy DD Mon')::text as fuel_or_status,
         null::numeric as litres, null::numeric as dollars,
         'Monday to Friday working week'::text as note
  from params

  union all
  select 2, del, '2 BOOKED', customer,
         to_char(del,'Dy DD Mon'), coalesce(fuel_type,'Diesel'),
         litres,
         case when price_tba then null::numeric
              else litres * coalesce(price_per_litre,0) end,
         coalesce(location,'')::text
  from booked

  union all
  select 3, del, '3 OVERDUE', customer,
         to_char(del,'Dy DD Mon'), coalesce(fuel_type,'Diesel'),
         litres, null::numeric,
         (days_late || ' days late - still owed, still comes out of stock')::text
  from overdue

  union all
  select 4, (week_start + n_needed::int), '4 PREDICTED', customer,
         to_char(week_start + n_needed::int,'Dy DD Mon'),
         coalesce(fuel_type,'Diesel'),
         fc_litres,
         case when price_tba then null::numeric
              else fc_litres * coalesce(price_per_litre,0) end,
         ('ripeness ' || round(ripeness_pct) || '%, buys every ' ||
          round(avg_cycle_days) || 'd, last order ' || days_since_last || 'd ago')::text
  from predicted

  union all
  -- Only the customers the forecast deliberately held back. Customers who
  -- simply are not due until a later week are normal and left out.
  select 5, last_order, '5 HELD BACK', customer,
         coalesce(to_char(last_order,'DD Mon YYYY'),'never'),
         coalesce(status,'')::text,
         fc_litres, null::numeric,
         (case
            when is_condemned     then 'CONDEMNED - removed on your instruction'
            when is_quiet         then 'gone quiet - dropped by the forecast'
            when not recency_ok and coalesce(days_since_last,0) > 84
                                  then 'silent ' || days_since_last || ' days - too long to call'
            when not recency_ok   then 'only ordered ' || days_since_last || ' days ago - too soon for their ' || round(coalesce(avg_cycle_days,0)) || ' day cycle'
            when not cycle_ok     then 'irregular buyer (averages every ' || round(coalesce(avg_cycle_days,0)) || ' days)'
            when not size_ok      then 'last order was out of pattern for them'
            else 'not enough order history to call'
          end)::text
  from scored
  where is_condemned or is_quiet or not cycle_ok or not recency_ok
     or not size_ok or n_needed is null

  union all
  select 6, week_start, '6 ACCURACY',
         to_char(week_start,'DD Mon YYYY'),
         (customers_bought || ' of ' || expected_customers || ' expected customers bought')::text,
         'forecast vs actual'::text,
         (scheduled_litres + predicted_litres),
         actual_litres,
         (case when (scheduled_litres + predicted_litres) > 0
               then 'actual was ' || round(100.0 * actual_litres / (scheduled_litres + predicted_litres)) || '% of forecast'
               else 'no forecast recorded that week' end)::text
  from accuracy

  union all
  select 7, null::date, '7 STATUS MIX', coalesce(status,'(none)'),
         count(*)::text, 'customers'::text,
         sum(coalesce(total_litres,0)), null::numeric,
         'how the retention view labels every customer'::text
  from scored group by status

) x
order by ord, sortkey nulls last, litres desc nulls last, item;
