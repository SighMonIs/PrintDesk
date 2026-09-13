-- Links a BadgeMak3r model to a PrintDesk category (categories.id, text like
-- 'C0001'): orders in that category download this model instead of the old
-- badge generator's. Nullable; one model per category is enforced in the UI.
alter table badgemaker_models add column category_id text;
