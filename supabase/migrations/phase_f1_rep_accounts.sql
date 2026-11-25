-- phase_f1_rep_accounts.sql
--
-- The rep-facing Accounts view inside the rep sales app: a chase tool, not
-- an accounting system. Adnan's books stay the official record; everything
-- here is the rep's own working estimate.
--
-- Two things are added, and only two:
--
--   1. sales.invoice_ref — the reference Adnan GAVE the rep. The rep is
--      recording it, never issuing it. A sale with a ref is "invoiced" and
--      its payment countdown is live; a sale without one is "awaiting
--      invoice" and is not chaseable yet.
--
--      The ref lives on the SALE and not on the payment. A rep pays down a
--      rolling customer balance in lump sums, oldest invoice first, so a ref
--      typed into a payment box has no one sale it unambiguously belongs to.
--
--   2. rep_payments — what the rep has collected. Customer-level, not
--      sale-level, for the same reason: the money arrives against a balance,
--      not against a line.
--
-- Run this BEFORE pushing the new index.html. The app sends invoice_ref and
-- writes rep_payments; without these, every save fails.

-- ============================================================
-- PART 1 — the invoice reference on a sale
-- ============================================================

alter table sales add column if not exists invoice_ref text;

comment on column sales.invoice_ref is
  'The invoice reference Adnan issued, recorded by the rep. Not an invoice '
  'number this app generates. Null means delivered but not yet invoiced.';

-- Chasing always asks "which of my delivered sales still have no ref", so
-- index that question rather than the column on its own.
create index if not exists sales_rep_invoice_idx
  on sales (rep_id, status) where invoice_ref is null;

-- ============================================================
-- PART 2 — payments the rep has collected
-- ============================================================

create table if not exists rep_payments (
  id          bigint primary key generated always as identity,

  -- Decided on the handset before sending, exactly as sales.client_uid is.
  -- This is what stops a payment being logged twice when a slow network
  -- makes the app retry, and it only works because the id is fixed before
  -- the row leaves the phone.
  client_uid  text unique,

  rep_id      uuid not null references auth.users(id),
  rep_name    text,

  -- The canonical link when the sale carried one, and the typed name as a
  -- fallback. Reps type customer names freely, so the name alone cannot be
  -- trusted to group, but it is all we have for a sale with no customer_id.
  customer_id uuid,
  customer    text not null,

  amount      numeric not null check (amount > 0),
  method      text not null default 'cash' check (method in ('cash','transfer')),

  -- Only meaningful for a transfer. Left null for cash.
  pop_ref     text,

  paid_on     date not null,
  note        text,

  created_at  timestamptz not null default now()
);

create index if not exists rep_payments_rep_idx  on rep_payments (rep_id, paid_on desc);
create index if not exists rep_payments_cust_idx on rep_payments (customer_id);

comment on table rep_payments is
  'What a rep records having collected, for their own chasing. NOT the '
  'official payment record - that is Adnan''s accounting software.';

-- ============================================================
-- PART 3 — row level security
-- ============================================================

alter table rep_payments enable row level security;

-- A rep reads their own collections. Accounts and admin read everyone's,
-- so Adnan can see what the reps believe they have collected and reconcile
-- against it.
drop policy if exists rep_pay_read on rep_payments;
create policy rep_pay_read on rep_payments for select to authenticated
  using (auth.uid() = rep_id or current_user_role() in ('accounts','admin'));

-- A rep files their OWN collections and nobody else's. Deliberately
-- narrower than sales_insert: there is no "on behalf of" case here,
-- because this table is only ever one rep's private working record.
drop policy if exists rep_pay_insert on rep_payments;
create policy rep_pay_insert on rep_payments for insert to authenticated
  with check (auth.uid() = rep_id);

drop policy if exists rep_pay_update on rep_payments;
create policy rep_pay_update on rep_payments for update to authenticated
  using      (auth.uid() = rep_id)
  with check (auth.uid() = rep_id);

drop policy if exists rep_pay_delete on rep_payments;
create policy rep_pay_delete on rep_payments for delete to authenticated
  using (auth.uid() = rep_id or current_user_role() = 'admin');

-- ============================================================
-- PART 4 — check
-- ============================================================
-- Expect: rows 0, policies 4, invoice_ref 1, index 1.
-- A policy count of 0 means the table is readable by nobody and writable by
-- nobody, which looks like "the app saves nothing" rather than an error.

select 'rep_payments rows' as check, count(*)::text as result from rep_payments
union all
select 'policies on rep_payments', count(*)::text
  from pg_policies where tablename = 'rep_payments'
union all
select 'sales.invoice_ref column', count(*)::text
  from information_schema.columns
  where table_name = 'sales' and column_name = 'invoice_ref'
union all
select 'sales_rep_invoice_idx', count(*)::text
  from pg_indexes where indexname = 'sales_rep_invoice_idx';
