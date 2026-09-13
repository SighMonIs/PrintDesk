-- Manual ordering for Settings > Categories (Reorder mode). Existing rows all
-- get 0, so the order= sort_order.asc,id.asc fallback keeps today's id order.
alter table categories add column sort_order integer not null default 0;
