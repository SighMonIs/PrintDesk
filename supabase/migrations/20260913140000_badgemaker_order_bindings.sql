-- Bind BadgeMak3r inputs/layers to the linked PrintDesk category's options
-- (options.name), so PrintDesk can fill text, switch layers on a dropdown
-- value and recolour layers from a colour selector when building an order.
alter table badgemaker_inputs add column from_option text;
alter table badgemaker_layers
  add column show_when_option text,     -- dropdown option name; null = always shown
  add column show_when_value text,      -- the value that shows this layer
  add column colour_from_option text,   -- colour option name; null = template colour
  add column colour_from_index integer; -- 1-based colour slot within that option
