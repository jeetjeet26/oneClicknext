-- Measured on 100,000 synthetic events: rare product/confirmed filters scanned
-- 2,942 buffers before these indexes, versus 51-53 afterward. No event rewrite.
create index shared_action_events_property_product_time_idx
 on public.shared_action_events(property_id,product,created_at desc,id desc);
create index shared_action_events_property_confirmed_time_idx
 on public.shared_action_events(property_id,created_at desc,id desc)
 where evidence='server_confirmed';
