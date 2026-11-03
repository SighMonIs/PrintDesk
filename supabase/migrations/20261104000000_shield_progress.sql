-- Shields — progress marks for the shield design library (Shields/index.html).
-- One row per shield the user has marked; shield_id is the LDraw part id
-- (e.g. 3846p4c). Same RLS shape as the other maker tables: any
-- authenticated user, full access.

create table shield_progress (
  shield_id text primary key,
  want_model boolean not null default false,
  completed boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table shield_progress enable row level security;

create policy "authenticated full access" on shield_progress
  for all to authenticated using (true) with check (true);
