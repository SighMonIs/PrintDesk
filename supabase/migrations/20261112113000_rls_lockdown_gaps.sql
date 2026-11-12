-- Finish the lockdown. 20261112060000_rls_lockdown.sql only partly committed:
-- pg_policies on 2026-11-12 11:22 showed every drop had landed, and the new
-- policies existed for categories and app_settings, but
--   colours, options      → still had "Public access" + "authenticated only"
--   inventory_items,
--   inventory_consumption,
--   inventory_receipts     → had ZERO policies, so RLS denied everyone,
--                            staff included (the stock screens were broken)
-- Verified with the anon key: an insert into colours succeeded (the probe row
-- was deleted again straight away).
--
-- Every create is preceded by its own drop, so this file is safe to re-run.

-- ── colours ───────────────────────────────────────────────────────────
drop policy if exists "Public access"        on colours;
drop policy if exists "authenticated only"   on colours;
drop policy if exists "public read colours"  on colours;
drop policy if exists "staff write colours"  on colours;
create policy "public read colours" on colours
  for select to public using (true);
create policy "staff write colours" on colours
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

-- ── options ───────────────────────────────────────────────────────────
drop policy if exists "Public access"        on options;
drop policy if exists "authenticated only"   on options;
drop policy if exists "public read options"  on options;
drop policy if exists "staff write options"  on options;
create policy "public read options" on options
  for select to public using (true);
create policy "staff write options" on options
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

-- ── stock ─────────────────────────────────────────────────────────────
-- Nothing reads these signed out, so there is no public policy at all.
drop policy if exists "Authenticated users can manage inventory_items" on inventory_items;
drop policy if exists "staff manage inventory_items"                   on inventory_items;
create policy "staff manage inventory_items" on inventory_items
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

drop policy if exists "Authenticated users can manage inventory_consumption" on inventory_consumption;
drop policy if exists "staff manage inventory_consumption"                   on inventory_consumption;
create policy "staff manage inventory_consumption" on inventory_consumption
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

drop policy if exists "Authenticated users can manage inventory_receipts" on inventory_receipts;
drop policy if exists "staff manage inventory_receipts"                   on inventory_receipts;
create policy "staff manage inventory_receipts" on inventory_receipts
  for all to authenticated
  using       (exists (select 1 from staff where staff.user_id = auth.uid()))
  with check  (exists (select 1 from staff where staff.user_id = auth.uid()));

-- Confirm it landed, for the run log.
select tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public'
   and tablename in ('colours','options','inventory_items',
                     'inventory_consumption','inventory_receipts')
 order by tablename, policyname;
