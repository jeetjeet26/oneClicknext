create function public.read_calendar_sync_summary(p_property_id uuid,p_calendar_id uuid,p_actor_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare result jsonb;missing bigint;
begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id)then return '{"state":"forbidden"}';end if;
 if not exists(select 1 from public.agent_calendars c where c.id=p_calendar_id and c.property_id=p_property_id and c.retired_at is null)then return '{"state":"not_found"}';end if;
 select jsonb_build_object('total_events',count(*),'synced_events',count(*)filter(where sync_status='synced'),'failed_events',count(*)filter(where sync_status='failed'),'external_drift_events',count(*)filter(where sync_status='external_drift'),'external_missing_events',count(*)filter(where sync_status='external_missing'),'external_cancelled_events',count(*)filter(where sync_status='external_cancelled'),'other_events',count(*)filter(where sync_status is null or sync_status not in('synced','failed','external_drift','external_missing','external_cancelled')),'degraded',count(*)filter(where sync_status in('failed','external_drift','external_missing','external_cancelled'))>0)into result from public.calendar_events where agent_calendar_id=p_calendar_id;
 select count(*)into missing from public.tour_bookings b where b.property_id=p_property_id and b.status in('scheduled','confirmed')and not exists(select 1 from public.calendar_events e where e.agent_calendar_id=p_calendar_id and e.tour_booking_id=b.id);
 return jsonb_build_object('state','ready','summary',result||jsonb_build_object('missing_event_bookings',missing,'degraded',(result->>'degraded')::boolean or missing>0));
end;$$;
revoke all on function public.read_calendar_sync_summary(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.read_calendar_sync_summary(uuid,uuid,uuid)to service_role;
notify pgrst,'reload schema';
