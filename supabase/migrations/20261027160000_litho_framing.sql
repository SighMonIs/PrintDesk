-- LithoMak3r — per-photo framing, and a pinned band height.
--
-- band_deg pins how much latitude the photos cover so the rest of the shell
-- stays plain; 0 keeps the old behaviour of fitting the band to the photo.
-- The photo columns are the framing inside that panel.

alter table litho_models add column if not exists band_deg numeric not null default 0;

alter table litho_photos add column if not exists zoom numeric not null default 1;
alter table litho_photos add column if not exists rot_deg numeric not null default 0;
alter table litho_photos add column if not exists off_x numeric not null default 0;
alter table litho_photos add column if not exists off_y numeric not null default 0;
