alter table badgemaker_layers add column line_offsets_mm jsonb not null default '[]'::jsonb;
