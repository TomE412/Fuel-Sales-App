-- phase_c3_unlisted_customers.sql
--
-- Closes the last 3% of unattributed volume: 20 names that appeared on sales
-- but were not in customer_locations, so they belonged to nobody and could
-- not be assigned.
--
-- They sorted into three piles, decided by Tom on 29 Sep 2026:
--   1. Nine were existing customers typed differently. The SALE TEXT is
--      corrected rather than an alias being stored, because app_name holds
--      only one alias per customer and several of these are pure whitespace
--      or capitalisation - not worth spending the slot on.
--   2. Blazeworks is ONE customer that was logged under three names.
--   3. Seven are genuinely new and are added to the canonical list.
--
-- Safe to re-run: every statement matches on the old text, which no longer
-- exists after the first run, and the inserts guard on not-exists.

-- ===========================================================
-- STEP 1 - correct sale text for existing customers
-- ===========================================================

update sales s set customer = v.correct
from (values
  ('Yudao',                     'Yu Dao Bricks (Pvt) Ltd'),
  ('Trucking and construction', 'Fairclot Investements t/a Trucking & Construction'),
  ('Food lovers',               'Frugiparus Ent (Foodlovers)'),
  ('Phillip and Watson',        'Philp & Watson Plant Hire'),
  ('Wastaway',                  'Waste Away (1977) Pvt Ltd'),
  ('Dynamic  Logistics',        'Dynamic Logistics'),
  ('Agristrutures',             'The Steel Building Co. Pvt Ltd'),
  ('Mukuyu farm grainco',       'Grainco (Private) Limited'),
  ('Arnott and Son',            'P.B.Arnott & Son(Pvt) Ltd')
) as v(typed, correct)
where btrim(s.customer) = v.typed;

-- Blazeworks: one customer, three spellings
update sales set customer = 'Blazeworks'
where btrim(customer) in ('Mine A Blazeworks', 'Mine B Blazeworks', 'Blazeworks');

-- Baggy Green: same customer, two capitalisations
update sales set customer = 'Baggy Green'
where btrim(customer) in ('Baggy green', 'Baggy Green');

-- Mukuyu is a farm reference on a Grainco order, not its own account.
-- Storing it as the alias means a future "Mukuyu" resolves to Grainco.
update customer_locations set app_name = 'Mukuyu'
where id = 72 and coalesce(btrim(app_name), '') = '';


-- ===========================================================
-- STEP 2 - add the genuinely new customers, already assigned to
-- whoever has been selling to them
-- ===========================================================

insert into customer_locations (invoice_name, assigned_rep, assigned_at, assigned_by)
select v.name, v.rep, now(), 'new from unlisted sales - Tom, 29 Sep 2026'
from (values
  ('Blazeworks',   'Tom Eager CW'),
  ('Forester',     'Molly Gwatidah'),
  ('Grit Mine',    'Marshall Mukombachoto'),
  ('De Vos Farm',  'Tom Eager'),
  ('Magava Mine',  'Molly Gwatidah'),
  ('Far and Wide', 'Tom Eager'),
  ('Pamuzinda',    'Molly Gwatidah'),
  ('Baggy Green',  'Molly Gwatidah')
) as v(name, rep)
where not exists (
  select 1 from customer_locations cl
  where lower(btrim(cl.invoice_name)) = lower(btrim(v.name))
);

-- The sales still carry the reps' original spelling for three of these, so
-- point them at the names just created.
update sales set customer = 'Grit Mine'   where btrim(customer) = 'GRIT MINE';
update sales set customer = 'De Vos Farm' where btrim(customer) = 'De vos farm';


-- ===========================================================
-- STEP 3 - CHECK. Unassigned volume should now be at or near zero,
-- and nothing should remain in the unlisted list.
-- ===========================================================

select 'customers total' as measure, count(*)::text as value from customer_locations
union all
select 'customers unassigned', count(*)::text
  from customer_locations where btrim(coalesce(assigned_rep,'')) = ''
union all
select 'sale names still not in the list', count(distinct btrim(s.customer))::text
  from sales s where s.status <> 'cancelled'
   and not exists (select 1 from customer_locations cl
     where lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
        or lower(btrim(coalesce(cl.app_name,''))) = lower(btrim(s.customer)))
union all
select 'UNASSIGNED share of volume',
       round(100.0 * sum(s.litres) filter (where btrim(coalesce(cl.assigned_rep,'')) = '')
             / nullif(sum(s.litres),0), 1)::text || '%'
  from sales s
  left join customer_locations cl
    on lower(btrim(cl.invoice_name)) = lower(btrim(s.customer))
    or lower(btrim(coalesce(cl.app_name,''))) = lower(btrim(s.customer))
  where s.status <> 'cancelled';


-- ===========================================================
-- STEP 4 - three of the dormant accounts claimed by name, 29 Sep 2026.
-- The remaining 17 are left unassigned deliberately: none has ordered since
-- the app went live, so they contribute no volume, and putting a name against
-- a dead account only produces a chase list nobody believes.
-- ===========================================================

update customer_locations
set assigned_rep = v.rep, assigned_at = now(), assigned_by = 'manual - Tom, 29 Sep 2026'
from (values
  (124, 'Tom Eager'),    -- Plumes Logistics
  (126, 'Niel Martin'),  -- Pro-Distribution
  (8,   'Niel Martin')   -- Barriertech Services
) as v(id, rep)
where customer_locations.id = v.id;
