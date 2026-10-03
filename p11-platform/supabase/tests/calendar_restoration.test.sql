BEGIN;
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin
 if passed is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture() returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();e uuid:=gen_random_uuid();remote jsonb;at timestamptz:=clock_timestamp();actor uuid;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 insert into public.properties(id,name,org_id,settings)values(p,'Calendar review SQL fixture','22222222-2222-2222-2222-222222222222','{"timezone":"America/Chicago"}');
 insert into public.leads(id,property_id,first_name,status,email)values(l,p,'Calendar review','tour_booked','calendar-guest@example.invalid');
 insert into public.agent_calendars(id,property_id,profile_id,provider,account_email,calendar_id,timezone,sync_enabled,token_status,buffer_minutes,scopes,provider_metadata)values(c,p,actor,'google','fixture@example.invalid','fixture-calendar','America/Chicago',true,'healthy',0,array['https://www.googleapis.com/auth/calendar'],'{"scopeEvidence":"provider_response"}');
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,duration_minutes,status,schedule_timezone)values(b,p,l,current_date+4,'10:00',30,'confirmed','America/Chicago');
 remote:=jsonb_build_object('id','event','status','confirmed','startDateTime',to_char(((current_date+4)+time '11:00') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endDateTime',to_char(((current_date+4)+time '11:30') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 insert into public.calendar_events(id,agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,sync_status,last_synced_at,remote_snapshot,observed_schedule_version)values(e,c,b,'event','event','external_drift',at,remote,1);
 return jsonb_build_object('p',p,'l',l,'b',b,'c',c,'e',e,'actor',actor,'at',at,'remote',remote,'identity',jsonb_build_object('id',c,'provider','google','calendarId','fixture-calendar','accountEmail','fixture@example.invalid','credentialVersion',1));
end$$;
create function pg_temp.review(f jsonb,decision_id uuid,verified boolean default true,reason text default 'Operator checked the calendar') returns jsonb language sql as $$
 select public.review_tour_calendar_change((f->>'p')::uuid,(f->>'b')::uuid,(f->>'e')::uuid,(f->>'actor')::uuid,decision_id,1,(f->>'at')::timestamptz,reason,case when verified then clock_timestamp() end,nullif(f->'remote','null'),f->'identity');
$$;

create function pg_temp.restore(f jsonb,decision_id uuid,verified boolean default true) returns jsonb language sql as $$
 select public.review_tour_calendar_change((f->>'p')::uuid,(f->>'b')::uuid,(f->>'e')::uuid,(f->>'actor')::uuid,decision_id,1,(f->>'at')::timestamptz,'Keep the reviewed console schedule',case when verified then clock_timestamp() end,nullif(f->'remote','null'),f->'identity','restore');
$$;
DO $$declare f jsonb;r jsonb;decision_id uuid;w public.tour_schedule_work;claim jsonb;before_event text;
begin
 f:=pg_temp.fixture();decision_id:=gen_random_uuid();
 perform pg_temp.check(pg_temp.restore(f,decision_id,false)->>'state'='verification_required','restoration requires a fresh provider read');
 r:=pg_temp.restore(f,decision_id);
 perform pg_temp.check(r->>'state'='applied' and r->>'action'='restore' and r->>'queued'='1','restore queues one update');
 perform pg_temp.check((select scheduled_time='10:00' and duration_minutes=30 and status='confirmed' and schedule_version=2 from public.tour_bookings where id=(f->>'b')::uuid),'restore preserves booking schedule and fences earlier workers');
 perform pg_temp.check((select sync_status='pending' from public.calendar_events where id=(f->>'e')::uuid),'restoration is pending rather than synced');
 select * into w from public.tour_schedule_work where tour_id=(f->>'b')::uuid and kind='calendar';
 perform pg_temp.check(w.state='queued' and w.payload->>'eventId'='event' and w.receipt is null,'moved event queues update of same identity without receipt');
 perform pg_temp.check((select count(*)=1 from public.tour_schedule_work where tour_id=(f->>'b')::uuid),'no extra prospect notice is queued');
 perform pg_temp.check((select before_state->>'time'='10:00:00' and after_state->>'time'='10:00:00' and after_state->>'calendarStatus'='pending' and not training_eligible from public.shared_action_events where id=decision_id),'restoration history is atomic and does not claim provider success');
 perform pg_temp.check(pg_temp.restore(f,decision_id,false)->>'state'='replayed','restore response loss recovers without provider access');
 perform pg_temp.check(pg_temp.review(f,decision_id,false)->>'state'='request_conflict','same decision_id cannot switch restore to adopt');
 f:=pg_temp.fixture();decision_id:=gen_random_uuid();
 update public.calendar_events set sync_status='external_missing',remote_snapshot=null where id=(f->>'e')::uuid;f:=jsonb_set(f,'{remote}','null');
 r:=pg_temp.restore(f,decision_id);
 select * into w from public.tour_schedule_work where tour_id=(f->>'b')::uuid and kind='calendar';
 perform pg_temp.check(r->>'action'='restore' and not w.payload ? 'eventId' and w.payload->>'replacesEventId'='event','missing event recreates with a new identity and preserved prior binding');
 claim:=public.claim_tour_schedule_work(w.id);
 perform pg_temp.check(claim->>'state'='running','restoration uses the bounded delivery claim');
 perform public.start_tour_schedule_delivery(w.id,(claim->>'lease_token')::uuid,'{}');
 perform pg_temp.check(public.finish_tour_schedule_work(w.id,(claim->>'lease_token')::uuid,'{"eventId":"restored-fixture","htmlLink":"https://calendar.example.invalid/event"}',true),'confirmed restoration receipt saves');
 perform pg_temp.check((select sync_status='synced' and provider_event_id='restored-fixture' and google_event_id='restored-fixture' and observed_schedule_version=2 and remote_snapshot is null from public.calendar_events where id=(f->>'e')::uuid),'restored receipt updates the bound event and clears old observation');
 perform pg_temp.check(public.finish_tour_schedule_work(w.id,(claim->>'lease_token')::uuid,'{"eventId":"restored-fixture","htmlLink":"https://calendar.example.invalid/event"}',true),'restoration receipt replay is idempotent');
 perform pg_temp.check((select count(*)=1 from public.calendar_events where tour_booking_id=(f->>'b')::uuid),'restoration does not duplicate local event bindings');
 f:=pg_temp.fixture();update public.leads set email=null where id=(f->>'l')::uuid;
 perform pg_temp.check(pg_temp.restore(f,gen_random_uuid())->>'state'='missing_recipient','missing invite recipient has actionable hold');
 f:=pg_temp.fixture();update public.agent_calendars set scopes=array['https://www.googleapis.com/auth/calendar.readonly'] where id=(f->>'c')::uuid;
 perform pg_temp.check(pg_temp.restore(f,gen_random_uuid())->>'state'='calendar_unavailable','insufficient current permissions hold restoration');
 f:=pg_temp.fixture();update public.agent_calendars set access_token='new-version' where id=(f->>'c')::uuid;
 perform pg_temp.check(pg_temp.restore(f,gen_random_uuid())->>'state'='binding_conflict','credential revision change invalidates earlier read');
 f:=pg_temp.fixture();
 -- Same start, changed duration: still a real schedule change, with capacity checked over the full interval.
 f:=jsonb_set(jsonb_set(f,'{remote,startDateTime}',to_jsonb(to_char(((current_date+4)+time '10:00') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'{remote,endDateTime}',to_jsonb(to_char(((current_date+4)+time '10:45') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 update public.calendar_events set remote_snapshot=f->'remote' where id=(f->>'e')::uuid;
 decision_id:=gen_random_uuid();r:=pg_temp.review(f,decision_id);
 perform pg_temp.check(r->>'state'='applied','duration-only adoption is a real change');
 perform pg_temp.check((select duration_minutes=45 and scheduled_time='10:00' and schedule_version=2 from public.tour_bookings where id=(f->>'b')::uuid),'adopted duration persists on booking');
 perform pg_temp.check((select before_state->>'durationMinutes'='30' and after_state->>'durationMinutes'='45' from public.shared_action_events where id=decision_id),'duration before and after captured');
 f:=pg_temp.fixture();
 f:=jsonb_set(f,'{remote,endDateTime}',to_jsonb(to_char(((current_date+4)+time '11:45') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));update public.calendar_events set remote_snapshot=f->'remote' where id=(f->>'e')::uuid;
 insert into public.tours(property_id,lead_id,tour_date,tour_time,duration_minutes,status,schedule_timezone)values((f->>'p')::uuid,(f->>'l')::uuid,current_date+4,'11:30',30,'confirmed','America/Chicago');
 perform pg_temp.check(pg_temp.review(f,gen_random_uuid())->>'state'='unavailable','longer duration cannot overlap another tour');
 perform pg_temp.check((select duration_minutes=30 and schedule_version=1 from public.tour_bookings where id=(f->>'b')::uuid),'capacity rejection leaves schedule unchanged');
end$$;
select count(*) as passed from checks;
ROLLBACK;
