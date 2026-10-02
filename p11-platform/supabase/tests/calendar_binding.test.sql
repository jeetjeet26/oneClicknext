BEGIN;
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin
 if passed is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture() returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();e uuid:=gen_random_uuid();remote jsonb;at timestamptz:=clock_timestamp();actor uuid;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 insert into public.properties(id,name,org_id,settings)values(p,'Calendar review SQL fixture','22222222-2222-2222-2222-222222222222','{"timezone":"America/Chicago"}');
 insert into public.leads(id,property_id,first_name,status)values(l,p,'Calendar review','tour_booked');
 insert into public.agent_calendars(id,property_id,profile_id,provider,account_email,calendar_id,timezone,sync_enabled,token_status,buffer_minutes,scopes,provider_metadata)values(c,p,actor,'google','fixture@example.invalid','fixture-calendar','America/Chicago',true,'healthy',0,array['https://www.googleapis.com/auth/calendar'],'{"scopeEvidence":"provider_response"}');
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,duration_minutes,status,schedule_timezone)values(b,p,l,current_date+4,'10:00',30,'confirmed','America/Chicago');
 remote:=jsonb_build_object('id','event','status','confirmed','startDateTime',to_char(((current_date+4)+time '10:00') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endDateTime',to_char(((current_date+4)+time '10:30') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 return jsonb_build_object('p',p,'l',l,'b',b,'c',c,'e',e,'actor',actor,'at',at,'remote',remote,'identity',jsonb_build_object('id',c,'provider','google','calendarId','fixture-calendar','accountEmail','fixture@example.invalid','credentialVersion',1));
end$$;

create function pg_temp.bind(f jsonb,decision_id uuid,verified boolean default true) returns jsonb language sql as $$select public.bind_tour_calendar_event((f->>'p')::uuid,(f->>'b')::uuid,(f->>'actor')::uuid,decision_id,1,(f->>'c')::uuid,1,'event','Reviewed the existing event',case when verified then clock_timestamp() end,f->'remote')$$;
DO $$declare f jsonb;r jsonb;decision_id uuid;work_id uuid;
begin
 f:=pg_temp.fixture();decision_id:=gen_random_uuid();
 perform pg_temp.check(pg_temp.bind(f,decision_id,false)->>'state'='verification_required','link requires fresh provider verification');
 perform pg_temp.check(not exists(select 1 from public.calendar_events where tour_booking_id=(f->>'b')::uuid),'probe does not create binding');
 r:=pg_temp.bind(f,decision_id);
 perform pg_temp.check(r->>'state'='applied' and r->>'queued'='0','existing event linked without new provider work');
 perform pg_temp.check((select count(*)=1 from public.calendar_events where tour_booking_id=(f->>'b')::uuid and provider_event_id='event' and observed_schedule_version=1),'one scoped event binding persisted');
 perform pg_temp.check((select action='tour.calendar_event.bound' and phase='succeeded' and before_state->>'calendarStatus'='unbound' and after_state->>'calendarStatus'='synced' and not training_eligible from public.shared_action_events where id=decision_id),'link decision and before/after history commit together');
 perform pg_temp.check(pg_temp.bind(f,decision_id,false)->>'state'='replayed','lost save reply recovered without provider read');
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='binding_conflict','duplicate binding held');
 perform pg_temp.check((select schedule_version=1 and scheduled_time='10:00' from public.tour_bookings where id=(f->>'b')::uuid),'link does not silently reschedule booking');
 f:=pg_temp.fixture();
 perform pg_temp.check(pg_temp.bind(jsonb_set(f,'{actor}',to_jsonb(gen_random_uuid())),gen_random_uuid())->>'state'='forbidden','unknown actor rejected');
 perform pg_temp.check(pg_temp.bind(jsonb_set(f,'{p}',to_jsonb(gen_random_uuid())),gen_random_uuid())->>'state'='forbidden','cross-property rejected');
 f:=pg_temp.fixture();
 perform pg_temp.check(pg_temp.bind(jsonb_set(f,'{remote,status}','"cancelled"'),gen_random_uuid())->>'state'='provider_changed','cancelled event cannot be linked');
 perform pg_temp.check(pg_temp.bind(jsonb_set(f,'{remote,endDateTime}','"2099-01-01T01:00:00Z"'),gen_random_uuid())->>'state'='provider_changed','changed duration cannot be silently adopted during linking');
 perform pg_temp.check(not exists(select 1 from public.calendar_events where tour_booking_id=(f->>'b')::uuid),'rejected event leaves booking unbound');
 f:=pg_temp.fixture();update public.agent_calendars set access_token='new-version' where id=(f->>'c')::uuid;
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='stale_connection','connection version fence enforced');
 f:=pg_temp.fixture();update public.agent_calendars set scopes=array[]::text[] where id=(f->>'c')::uuid;
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='calendar_unavailable','missing grants cannot bind');
 f:=pg_temp.fixture();insert into public.calendar_events(agent_calendar_id,google_event_id,provider_event_id,sync_status)values((f->>'c')::uuid,'event','event','synced');
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='binding_conflict','one provider event cannot gain an unrelated second link');
 f:=pg_temp.fixture();insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,state)values((f->>'p')::uuid,(f->>'l')::uuid,'tour_bookings',(f->>'b')::uuid,1,'calendar','queued') returning id into work_id;
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='applied','unattempted calendar work can be resolved by observed existing event');
 perform pg_temp.check((select state='skipped' and receipt is null and error_code='existing_calendar_event_bound' from public.tour_schedule_work where id=work_id),'superseded unsent work gains no fake send receipt');
 f:=pg_temp.fixture();insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,state,started_at,lease_until)values((f->>'p')::uuid,(f->>'l')::uuid,'tour_bookings',(f->>'b')::uuid,1,'calendar','running',now(),now()+interval '1 minute');
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='delivery_busy','in-flight provider work blocks linking');
 f:=pg_temp.fixture();insert into public.luma_delivery_jobs(property_id,booking_id,payload,state,attempts)values((f->>'p')::uuid,(f->>'b')::uuid,jsonb_build_object('calendarId',f->>'c','providerCalendarId','fixture-calendar','provider','google'),'review',1);
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='delivery_review_required','uncertain legacy delivery requires review');
 f:=pg_temp.fixture();insert into public.luma_delivery_jobs(property_id,booking_id,payload,state)values((f->>'p')::uuid,(f->>'b')::uuid,jsonb_build_object('calendarId',f->>'c','providerCalendarId','fixture-calendar','provider','google'),'queued');
 perform pg_temp.check(pg_temp.bind(f,gen_random_uuid())->>'state'='applied','unattempted same-calendar confirmation recognizes existing event');
 perform pg_temp.check((select calendar_confirmed and not email_confirmed and state='queued' and email_receipt is null from public.luma_delivery_jobs where booking_id=(f->>'b')::uuid),'manual link neither sends nor confirms email');
 perform pg_temp.check(not has_function_privilege('authenticated','public.bind_tour_calendar_event(uuid,uuid,uuid,uuid,integer,uuid,bigint,text,text,timestamptz,jsonb)','EXECUTE'),'link operation service-only');
end$$;
create function pg_temp.reject_link() returns trigger language plpgsql as $$begin raise exception 'Fixture link history failure';end$$;
create trigger fixture_reject_link before insert on public.shared_action_events for each row when(new.action='tour.calendar_event.bound') execute function pg_temp.reject_link();
DO $$declare f jsonb;begin
 f:=pg_temp.fixture();
 begin perform pg_temp.bind(f,gen_random_uuid());raise exception 'FAIL: history failure ignored';exception when raise_exception then if SQLERRM<>'Fixture link history failure' then raise;end if;end;
 perform pg_temp.check(not exists(select 1 from public.calendar_events where tour_booking_id=(f->>'b')::uuid),'history failure rolls back new binding');
end$$;
drop trigger fixture_reject_link on public.shared_action_events;
select count(*) as passed from checks;ROLLBACK;
