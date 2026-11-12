-- Read-only. Changes nothing: every statement is a SELECT.
--
-- Run through the "Apply migration" workflow so the policy migration can be
-- written against the real state of the database rather than a guess. The
-- repo is public, so this deliberately prints no names, emails or addresses —
-- only counts, table names and uuids.

\echo ''
\echo '=== 1. which public tables have row level security on? ==='
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relrowsecurity, c.relname;

\echo ''
\echo '=== 2. the policies that already exist ==='
select tablename, policyname, cmd, roles::text, qual, with_check
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

\echo ''
\echo '=== 3. does a staff table exist, and what is in it? ==='
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'staff'
 order by ordinal_position;

select count(*) as staff_rows from staff;

\echo ''
\echo '=== 4. auth users, split by whether they are a shop customer ==='
-- A shop signup writes customers.auth_user_id on first sign-in, so an auth
-- user with no matching customers row is almost certainly a staff account.
select (select count(*) from auth.users) as auth_users,
       (select count(*) from customers where auth_user_id is not null) as linked_shop_customers,
       (select count(*) from auth.users u
         where not exists (select 1 from customers c where c.auth_user_id = u.id)) as unlinked_users;

\echo ''
\echo '=== 5. the unlinked (candidate staff) accounts, by id only ==='
select u.id, u.created_at, u.last_sign_in_at
  from auth.users u
 where not exists (select 1 from customers c where c.auth_user_id = u.id)
 order by u.created_at;

\echo ''
\echo '=== 6. how orders link to a customer ==='
select table_name, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'orders'    and column_name in ('id', 'order_id', 'customer_id'))
     or (table_name = 'customers' and column_name in ('id', 'auth_user_id')))
 order by table_name, column_name;

-- How many orders could be matched back to a shop customer at all.
select count(*) filter (where customer_id is null)                           as orders_without_customer_id,
       count(*) filter (where customer_id is not null)                       as orders_with_customer_id,
       count(*) filter (where customer_id in (select id from customers
                                               where auth_user_id is not null)) as orders_owned_by_a_shop_login
  from orders;
