BEGIN;
-- Use daytime fixture starts so the duration does not cross midnight as the test clock advances.
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin
 if passed is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture(source text,tz text,starts timestamptz) returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();t uuid:=gen_random_uuid();wall timestamp;
begin
 insert into public.properties(id,name,org_id,settings)values(p,'Reminder SQL fixture','22222222-2222-2222-2222-222222222222',jsonb_build_object('timezone',tz));
 insert into public.leads(id,property_id,first_name,email,phone,status)values(l,p,'Reminder','reminder@example.invalid','+15550000000','tour_booked');
 wall:=starts at time zone coalesce(tz,'UTC');
 if source='tours' then insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status)values(t,p,l,wall::date,wall::time,'confirmed');
 else insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status)values(t,p,l,wall::date,wall::time,'confirmed');end if;
 return jsonb_build_object('property',p,'lead',l,'tour',t);
end$$;
DO $$
declare f jsonb;p uuid;l uuid;t uuid;actor uuid;c uuid:=gen_random_uuid();e uuid:=gen_random_uuid();started timestamptz;r text;remote jsonb;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 f:=pg_temp.fixture('tour_bookings','UTC',date_trunc('day',now())+interval '3 days 12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 insert into public.agent_calendars(id,property_id,account_email,provider,calendar_id,timezone,sync_enabled)values(c,p,'fixture@example.invalid','google','fixture-calendar','UTC',false);
 insert into public.calendar_events(id,agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,sync_status,last_synced_at)values(e,c,t,'event','event','synced',null);
 started:=clock_timestamp();remote:='{"id":"event","status":"confirmed","startDateTime":"2026-09-20T10:00:00.000Z","endDateTime":"2026-09-20T10:30:00.000Z"}';
 perform pg_temp.check(public.record_tour_calendar_observation(p,c,e,t,1,'event',started,'external_drift',remote)='recorded','current scoped snapshot recorded');
 perform pg_temp.check((select remote_snapshot=remote and observed_schedule_version=1 and sync_status='external_drift' from public.calendar_events where id=e),'snapshot carries minimal provider evidence and schedule version');
 perform pg_temp.check(public.record_tour_calendar_observation(p,c,e,t,1,'event',started,'synced',remote)='stale','older concurrent observation cannot overwrite newer evidence');
 perform pg_temp.check(public.record_tour_calendar_observation(gen_random_uuid(),c,e,t,1,'event',clock_timestamp(),'synced',remote)='stale','wrong property rejected');
 perform pg_temp.check(public.record_tour_calendar_observation(p,gen_random_uuid(),e,t,1,'event',clock_timestamp(),'synced',remote)='not_found','wrong calendar rejected');
 perform pg_temp.check(public.record_tour_calendar_observation(p,c,e,t,1,'different-event',clock_timestamp(),'synced',remote)='stale','replaced provider identity rejected');
 update public.calendar_events set sync_status='pending' where id=e;
 perform pg_temp.check(public.record_tour_calendar_observation(p,c,e,t,1,'event',clock_timestamp(),'synced',remote)='stale','queued local calendar change retains ownership');
 -- A reconciled observation can precede an ordinary local edit; unresolved edits now require review.
 update public.calendar_events set sync_status='synced' where id=e;
 perform public.change_tour_schedule(p,l,'tour_bookings',t,actor,gen_random_uuid(),1,jsonb_build_object('action','reschedule','date',current_date+4,'time','11:00','reason','Fixture local change','notify',false));
 perform pg_temp.check(public.record_tour_calendar_observation(p,c,e,t,1,'event',clock_timestamp(),'synced',remote)='stale','old schedule observation cannot overwrite a reschedule');
 perform pg_temp.check((select remote_snapshot=remote and observed_schedule_version=1 and sync_status='pending' from public.calendar_events where id=e),'old evidence is dated while new work stays pending');
 begin perform public.record_tour_calendar_observation(p,c,e,t,2,'event',clock_timestamp(),'synced',remote||'{"privateToken":"excluded"}');raise exception 'FAIL: extra provider data accepted';
 exception when raise_exception then if SQLERRM='FAIL: extra provider data accepted' then raise;end if;insert into checks values('unnecessary provider data rejected');end;
 perform pg_temp.check(not has_function_privilege('authenticated','public.record_tour_calendar_observation(uuid,uuid,uuid,uuid,integer,text,timestamptz,text,jsonb)','EXECUTE'),'observation writes are service-only');
end$$;
select count(*) as passed from checks;
ROLLBACK;
