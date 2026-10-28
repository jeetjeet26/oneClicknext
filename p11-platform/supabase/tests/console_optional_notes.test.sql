-- The API normalizes an omitted routine note to this explicit absence marker.
-- Verify existing atomic history and retry guarantees without changing the schema.
begin;
do $$
declare
 property uuid := gen_random_uuid(); test_request_id uuid := gen_random_uuid();
 actor uuid := '11111111-1111-1111-1111-111111111111';
 payload jsonb := '{"expectedVersion":0,"values":{"is_enabled":false,"scrape_frequency":"weekly","radius_miles":4.5,"max_competitors":20,"auto_add":false},"reason":"No additional note."}';
 result jsonb;
begin
 insert into public.properties(id,org_id,name) values(property,'22222222-2222-2222-2222-222222222222','Optional note rollback fixture');
 result := public.save_marketvision_configuration(test_request_id,property,actor,payload);
 if result->>'state' <> 'saved' then raise exception 'Routine save failed: %',result; end if;
 if not exists(select 1 from public.marketvision_decisions where id=test_request_id and property_id=property and actor_id=actor and input->>'reason'='No additional note.' and (after_state->>'radius_miles')::numeric=4.5) then raise exception 'Attributed before/after history was not retained';end if;
 if not exists(select 1 from public.shared_action_events where id=test_request_id and property_id=property) then raise exception 'Shared history was not retained';end if;
 if public.save_marketvision_configuration(test_request_id,property,actor,payload)->>'state' <> 'replayed' then raise exception 'Retry duplicated a save';end if;
 if public.save_marketvision_configuration(gen_random_uuid(),property,actor,payload)->>'state' <> 'stale_configuration' then raise exception 'Stale protection was lost';end if;
 raise notice 'PASS: optional note saves retain attributed history, shared events, retry recovery and stale protection';
end $$;
rollback;
