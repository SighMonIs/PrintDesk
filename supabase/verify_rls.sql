-- Read-only. Changes nothing: every statement is a SELECT or a role switch,
-- and the whole file runs inside the workflow's single transaction.
--
-- Checks the lockdown from the inside by impersonating each kind of caller,
-- so the signed-in paths can be proven without anybody's password. The repo
-- is public, so this prints counts and booleans only — no names, emails,
-- addresses or uuids.

\set ON_ERROR_STOP on

-- Pick one real uid of each kind. A staff member is a row in staff; a shop
-- customer is an auth user linked from customers.auth_user_id — and must NOT
-- also be staff, or the test proves nothing. At least one account here is
-- both: a staff login that has also been through the shop.
select set_config('v.staff', (select user_id::text from staff
                               order by user_id limit 1), false) is not null as got_staff,
       set_config('v.shopper', coalesce((select c.auth_user_id::text from customers c
                                 where c.auth_user_id is not null
                                   and not exists (select 1 from staff s
                                                    where s.user_id = c.auth_user_id)
                                 order by c.auth_user_id limit 1),
                                 -- Both shop-linked logins are also staff, so
                                 -- there is no pure customer to borrow. A uid
                                 -- that is in neither table is the stricter
                                 -- test anyway: signed in, entitled to nothing.
                                 gen_random_uuid()::text), false) is not null as got_shopper,
       (select count(*) from customers c
         where c.auth_user_id is not null
           and exists (select 1 from staff s where s.user_id = c.auth_user_id))
         as accounts_that_are_both;

\echo ''
\echo '=== as a STAFF member: should see everything ==='
set local role authenticated;
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('v.staff'),
                                    'role', 'authenticated')::text, true);
select (select count(*) from orders)                as orders,
       (select count(*) from customers)             as customers,
       (select count(*) from colours)               as colours,
       (select count(*) from categories)            as categories,
       (select count(*) from options)               as options,
       (select count(*) from app_settings)          as app_settings,
       (select count(*) from inventory_items)       as inventory_items,
       (select count(*) from inventory_receipts)    as inventory_receipts,
       (select count(*) from inventory_consumption) as inventory_consumption;

-- Can staff actually write? pg_catalog can answer without writing anything:
-- run the policy's own check expression as this role.
select exists (select 1 from staff where staff.user_id = auth.uid()) as staff_write_check_passes;

reset role;
select set_config('request.jwt.claims', null, true);

\echo ''
\echo '=== as a SIGNED-IN NON-STAFF user: nothing but the catalogue ==='
set local role authenticated;
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('v.shopper'),
                                    'role', 'authenticated')::text, true);
select (select count(*) from customers)       as customers_should_be_0,
       (select count(*) from orders)          as orders_should_be_0,
       (select count(*) from colours)         as colours_should_be_all,
       (select count(*) from app_settings)    as app_settings_should_be_0,
       (select count(*) from inventory_items) as inventory_should_be_0,
       exists (select 1 from staff where staff.user_id = auth.uid()) as is_staff_should_be_false;

reset role;
select set_config('request.jwt.claims', null, true);

\echo ''
\echo '=== what the own-orders policy would expose, per shop login ==='
-- Checked as the owner rather than by impersonation, because every shop-linked
-- login here is also staff. 0 everywhere means no order has ever been claimed
-- by a shop account, so the policy is correct but currently exposes nothing.
select count(*) filter (where o.customer_id is not null) as orders_claimable,
       (select count(*) from customers where auth_user_id is not null) as shop_logins,
       (select count(*) from customers c
         where c.auth_user_id is not null
           and exists (select 1 from staff s where s.user_id = c.auth_user_id))
         as of_which_also_staff
  from orders o
 where o.customer_id in (select id from customers where auth_user_id is not null);

\echo ''
\echo '=== as ANON (signed out shop): catalogue only ==='
set local role anon;
select (select count(*) from categories)       as categories_should_be_all,
       (select count(*) from colours)          as colours_should_be_all,
       (select count(*) from options)          as options_should_be_all,
       (select count(*) from delivery_options) as delivery_should_be_all,
       (select count(*) from payment_options)  as payment_should_be_all,
       (select count(*) from orders)           as orders_should_be_0,
       (select count(*) from customers)        as customers_should_be_0,
       (select count(*) from app_settings)     as app_settings_should_be_0,
       (select count(*) from inventory_items)  as inventory_should_be_0;

reset role;

\echo ''
\echo '=== anything still reachable by anon or by every signed-in user ==='
-- A policy to public/anon that is not SELECT-only, or any policy whose
-- condition is just `true` for authenticated, is a hole like the ones this
-- lockdown closed. The catalogue SELECTs are the only expected rows.
select tablename, policyname, cmd, roles::text, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and (('public' = any (roles) or 'anon' = any (roles))
         and cmd <> 'SELECT'
     or (coalesce(qual, 'true') = 'true' and coalesce(with_check, 'true') = 'true'))
 order by tablename, policyname;

\echo ''
\echo '=== tables with RLS on but no policy at all (nobody can touch them) ==='
select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
   and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname)
 order by c.relname;
