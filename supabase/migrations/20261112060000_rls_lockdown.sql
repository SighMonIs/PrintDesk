-- Close the public hole in row level security.
--
-- RLS was already enabled on every table, and the correct narrow policies
-- already existed (staff full access, customers see own row, public read of
-- the catalogue). What made the whole database readable AND writable with the
-- public anon key was a handful of legacy catch-all policies sitting beside
-- them: policies are OR'd together, so one `using (true)` to `public` cancels
-- every careful policy on the same table.
--
-- Verified 2026-11-12 with the anon key from config.js: a duplicate-key insert
-- into customers and app_settings returned 23505, not 42501 — the statements
-- reached the table.
--
-- This migration drops the catch-alls and replaces them, where something is
-- still needed, with the pattern the newer tables already use:
--   public  → select only, and only on the catalogue the shop browses signed out
--   staff   → everything, via the existing `staff` table
--   a shop customer → their own customers row and their own orders, nothing else
--
-- `authenticated` on its own is NOT a staff check: shop customers sign in to
-- the same Supabase project, so `to authenticated using (true)` handed every
-- shop login the full order book.

-- No begin/commit here: the workflow runs psql with --single-transaction, so
-- the whole file is already one transaction and any error rolls all of it back.

-- ── 1. Orders ─────────────────────────────────────────────────────────
-- Leaves: "staff full access" (ALL) and "customers see own orders" (SELECT).
drop policy if exists "Public access"      on orders;
drop policy if exists "authenticated only" on orders;

-- ── 2. Customers ──────────────────────────────────────────────────────
-- Leaves: "staff full access", plus own-row select/insert/update for a shop
-- login, which is what shop/auth.js needs on first sign-in.
drop policy if exists "Public access"      on customers;
drop policy if exists "authenticated only" on customers;

-- ── 3. The catalogue: categories, colours, options ────────────────────
-- The shop reads these before anyone signs in, so public SELECT stays —
-- but only SELECT. Writing becomes staff-only, matching delivery_options
-- and payment_options, which were already done this way.
drop policy if exists "Public access"      on categories;
drop policy if exists "authenticated only" on categories;
create policy "public read categories" on categories
  for select to public using (true);
create policy "staff write categories" on categories
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

drop policy if exists "Public access"      on colours;
drop policy if exists "authenticated only" on colours;
create policy "public read colours" on colours
  for select to public using (true);
create policy "staff write colours" on colours
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

drop policy if exists "Public access"      on options;
drop policy if exists "authenticated only" on options;
create policy "public read options" on options
  for select to public using (true);
create policy "staff write options" on options
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

-- ── 4. Settings ───────────────────────────────────────────────────────
-- "anon read/update/write" let anyone change the notification address the
-- alert emails are sent to. Staff only now; the two notify workflows move
-- off the anon key and onto the database URL they already have.
drop policy if exists "anon read"   on app_settings;
drop policy if exists "anon update" on app_settings;
drop policy if exists "anon write"  on app_settings;
create policy "staff full access" on app_settings
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

-- ── 5. Stock ──────────────────────────────────────────────────────────
-- These were `auth.role() = 'authenticated'`, which includes shop customers.
drop policy if exists "Authenticated users can manage inventory_items"       on inventory_items;
drop policy if exists "Authenticated users can manage inventory_consumption" on inventory_consumption;
drop policy if exists "Authenticated users can manage inventory_receipts"    on inventory_receipts;
create policy "staff manage inventory_items" on inventory_items
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));
create policy "staff manage inventory_consumption" on inventory_consumption
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));
create policy "staff manage inventory_receipts" on inventory_receipts
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

-- ── 6. Saved preferences ──────────────────────────────────────────────
-- Both tables already have a correct own-row policy; the blanket one beside
-- it let any signed-in user read everyone's.
drop policy if exists "authenticated only" on user_preferences;
drop policy if exists "authenticated only" on badge_user_preferences;

-- ── 7. Make sure nobody who works here is locked out ──────────────────
-- Everything above keys off the `staff` table, which has 2 rows against 5
-- auth users who are not shop customers. Anyone who has actually signed in
-- and is not a shop customer gets a staff row, so no working account loses
-- access the moment this lands. Prune it afterwards from the Users page —
-- tightening the list later is safe, being locked out now is not.
insert into staff (user_id)
select u.id
  from auth.users u
 where u.last_sign_in_at is not null
   and not exists (select 1 from customers c where c.auth_user_id = u.id)
   and not exists (select 1 from staff     s where s.user_id      = u.id);

-- What the policy set looks like afterwards, for the run log.
select tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public'
   and tablename in ('orders','customers','categories','colours','options',
                     'app_settings','inventory_items','inventory_consumption',
                     'inventory_receipts','user_preferences','badge_user_preferences')
 order by tablename, policyname;

select count(*) as staff_rows_after from staff;
