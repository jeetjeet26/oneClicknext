-- Local only: retain the latest minimal provider observation, fenced by schedule and read identity.
alter table public.calendar_events add column remote_snapshot jsonb;
alter table public.calendar_events add column observed_schedule_version integer;
create function public.record_tour_calendar_observation(p_property_id uuid,p_calendar_id uuid,p_event_id uuid,p_booking_id uuid,p_version integer,p_provider_event_id text,p_read_started_at timestamptz,p_status text,p_remote jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.calendar_events;b public.tour_bookings;
begin
 if p_status is null or p_status not in ('synced','external_drift','external_missing','external_cancelled') or p_read_started_at is null or p_read_started_at>clock_timestamp()+interval '5 seconds'
  or (p_remote is not null and (jsonb_typeof(p_remote) is distinct from 'object' or p_remote-array['id','status','startDateTime','endDateTime']<>'{}' or length(p_remote::text)>4096)) then raise exception 'Invalid calendar observation';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into b from public.tour_bookings where id=p_booking_id and property_id=p_property_id;
 if not found or b.status not in ('scheduled','confirmed') or b.schedule_version<>p_version then return 'stale';end if;
 select e1.* into e from public.calendar_events e1 join public.agent_calendars c on c.id=e1.agent_calendar_id
  where e1.id=p_event_id and e1.tour_booking_id=p_booking_id and c.id=p_calendar_id and c.property_id=p_property_id for update of e1;
 if not found then return 'not_found';end if;
 if e.sync_status='pending' or coalesce(e.provider_event_id,e.google_event_id) is distinct from p_provider_event_id or e.last_synced_at>p_read_started_at then return 'stale';end if;
 update public.calendar_events set sync_status=p_status,last_synced_at=clock_timestamp(),remote_snapshot=p_remote,observed_schedule_version=p_version where id=e.id;
 return 'recorded';
end; $$;
revoke all on function public.record_tour_calendar_observation(uuid,uuid,uuid,uuid,integer,text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_tour_calendar_observation(uuid,uuid,uuid,uuid,integer,text,timestamptz,text,jsonb) to service_role;
notify pgrst,'reload schema';
