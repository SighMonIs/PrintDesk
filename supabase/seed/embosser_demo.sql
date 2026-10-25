-- Two demo EmbossMak3r designs, so there's something to export without
-- drawing one first. Re-running is a no-op.

-- Reports what is actually there, so a run says so in its own log rather
-- than leaving you to take exit code 0 on trust.
create or replace function report_demo_counts() returns void language plpgsql as $f$
declare m int; e int;
begin
  select count(*) into m from embosser_models where name like 'Demo - %';
  select count(*) into e from embosser_elements el
    join embosser_models mo on mo.id = el.model_id where mo.name like 'Demo - %';
  raise notice 'DEMO CHECK: models=% elements=%', m, e;
end $f$;

do $$
declare mid bigint;
begin
  if exists (select 1 from embosser_models where name like 'Demo - %') then
    raise notice 'Demo designs already present - nothing inserted.';
    perform report_demo_counts();
    return;
  end if;

  -- One card per revolution: 85.6 mm wrap gives a 27.25 mm roller.
  insert into embosser_models (name, wrap_mm, width_mm, repeat_count)
  values ('Demo - business card', 85.6, 54, 1) returning id into mid;

  insert into embosser_elements
    (model_id, el_order, kind, name, content, font_size, pos_u, pos_v, size_w, size_h) values
    (mid, 0, 'text',   'Company', 'ACME LTD',      12, 34, 34, 40, 12),
    (mid, 1, 'text',   'Email',   'hello@acme.co',  5, 34, 20, 40,  6),
    (mid, 2, 'circle', 'Dot',     '',              10, 72, 28, 14, 14);

  -- Small roller, pattern tiled six times around.
  insert into embosser_models (name, wrap_mm, width_mm, repeat_count)
  values ('Demo - pattern roller', 62.83, 20, 6) returning id into mid;

  insert into embosser_elements
    (model_id, el_order, kind, name, content, font_size, pos_u, pos_v, size_w, size_h, rotation) values
    (mid, 0, 'circle', 'Spot',    '', 10, 5.2, 13, 5, 5,  0),
    (mid, 1, 'rect',   'Diamond', '', 10, 5.2,  6, 3, 3, 45);

  perform report_demo_counts();
end $$;

-- Don't leave the helper behind: anything in public shows up as a PostgREST
-- RPC endpoint.
drop function report_demo_counts();
