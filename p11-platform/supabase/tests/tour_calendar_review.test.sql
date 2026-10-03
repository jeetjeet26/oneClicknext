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
 remote:=jsonb_build_object('id','event','status','confirmed','startDateTime',to_char(((current_date+4)+time '11:00') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endDateTime',to_char(((current_date+4)+time '11:30') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 insert into public.calendar_events(id,agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,sync_status,last_synced_at,remote_snapshot,observed_schedule_version)values(e,c,b,'event','event','external_drift',at,remote,1);
 return jsonb_build_object('p',p,'l',l,'b',b,'c',c,'e',e,'actor',actor,'at',at,'remote',remote,'identity',jsonb_build_object('id',c,'provider','google','calendarId','fixture-calendar','accountEmail','fixture@example.invalid','credentialVersion',1));
end$$;
create function pg_temp.review(f jsonb,decision_id uuid,verified boolean default true,reason text default 'Operator checked the calendar') returns jsonb language sql as $$
 select public.review_tour_calendar_change((f->>'p')::uuid,(f->>'b')::uuid,(f->>'e')::uuid,(f->>'actor')::uuid,decision_id,1,(f->>'at')::timestamptz,reason,case when verified then clock_timestamp() end,nullif(f->'remote','null'),f->'identity');
$$;
DO $$
declare f jsonb;r jsonb;decision_id uuid:=gen_random_uuid();before_count integer;other uuid;
begin
 f:=pg_temp.fixture();
 perform pg_temp.check(pg_temp.review(f,decision_id,false)->>'state'='verification_required','requires a fresh provider read before mutation');
 perform pg_temp.check((select schedule_version=1 from public.tour_bookings where id=(f->>'b')::uuid),'probe does not change booking');
 perform pg_temp.check(not exists(select 1 from public.shared_action_events where property_id=(f->>'p')::uuid),'probe is not a completed action');
 perform pg_temp.check(public.change_tour_schedule((f->>'p')::uuid,(f->>'l')::uuid,'tour_bookings',(f->>'b')::uuid,(f->>'actor')::uuid,gen_random_uuid(),1,'{"action":"cancel","reason":"generic must not overwrite","notify":false}')->>'state'='calendar_review_required','ordinary schedule changes hold unresolved provider edits');
 r:=pg_temp.review(f,decision_id);
 perform pg_temp.check(r->>'state'='applied' and r->>'action'='reschedule' and r->>'queued'='0','adoption commits a schedule change without external work');
 perform pg_temp.check((select scheduled_time='11:00' and schedule_version=2 and schedule_timezone='America/Chicago' from public.tour_bookings where id=(f->>'b')::uuid),'adoption uses the pinned timezone and increments version');
 perform pg_temp.check((select state='skipped' and receipt is null and started_at is null and error_code='external_change_adopted' from public.tour_schedule_work where tour_id=(f->>'b')::uuid and kind='calendar'),'redundant provider work skipped without invented receipt');
 perform pg_temp.check((select sync_status='synced' and observed_schedule_version=2 from public.calendar_events where id=(f->>'e')::uuid),'calendar observation tied to adopted schedule');
 perform pg_temp.check((select count(*)=1 from public.shared_action_events where id=decision_id and action='tour.calendar_change.reviewed' and phase='succeeded' and evidence='server_confirmed' and not training_eligible),'one trusted decision recorded and excluded from training');
 perform pg_temp.check((select before_state->>'time'='10:00:00' and after_state->>'time'='11:00:00' and before_state->'remote'=f->'remote' from public.shared_action_events where id=decision_id),'history preserves schedule and minimal observed evidence');
 perform pg_temp.check(pg_temp.review(f,decision_id,false)->>'state'='replayed','lost response recovered without another provider read');
 perform pg_temp.check(pg_temp.review(f,decision_id,false,'Different decision')->>'state'='request_conflict','decision_id reuse cannot change decision');
 perform pg_temp.check((select count(*)=1 from public.tour_schedule_changes where property_id=(f->>'p')::uuid),'retry does not duplicate schedule history');
 perform pg_temp.check(pg_temp.review(f,gen_random_uuid())->>'state'='stale','older version cannot overwrite adopted schedule');
 f:=pg_temp.fixture();decision_id:=gen_random_uuid();
 r:=pg_temp.review(jsonb_set(f,'{remote,startDateTime}','"2099-01-01T10:00:00.000Z"'),decision_id);
 perform pg_temp.check(r->>'state'='provider_changed','changed provider read rejected');
 perform pg_temp.check((select schedule_version=1 from public.tour_bookings where id=(f->>'b')::uuid),'provider change does not mutate booking');
 perform pg_temp.check((select phase='failed' from public.shared_action_events where id=(r->>'actionEventId')::uuid),'blocked decision recorded separately from success');
 perform pg_temp.check(pg_temp.review(f,decision_id)->>'state'='applied','same blocked decision_id can succeed after fresh matching read');
 f:=pg_temp.fixture();
 update public.calendar_events set last_synced_at=clock_timestamp() where id=(f->>'e')::uuid;
 perform pg_temp.check(pg_temp.review(f,gen_random_uuid())->>'state'='stale','newer observation invalidates old decision');
 f:=pg_temp.fixture();
 perform pg_temp.check(pg_temp.review(jsonb_set(f,'{identity,calendarId}','"different"'),gen_random_uuid())->>'state'='binding_conflict','changed provider calendar rejected');
 perform pg_temp.check(pg_temp.review(jsonb_set(f,'{actor}',to_jsonb(gen_random_uuid())),gen_random_uuid())->>'state'='forbidden','unknown actor rejected');
 perform pg_temp.check(pg_temp.review(jsonb_set(f,'{p}',to_jsonb(gen_random_uuid())),gen_random_uuid())->>'state'='forbidden','cross-property decision_id rejected');
 f:=pg_temp.fixture();
 update public.calendar_events set sync_status='external_missing',remote_snapshot=null where id=(f->>'e')::uuid;
 f:=jsonb_set(f,'{remote}','null');r:=pg_temp.review(f,gen_random_uuid());
 perform pg_temp.check(r->>'state'='applied' and r->>'action'='cancel','missing event can explicitly cancel booking');
 perform pg_temp.check((select status='cancelled' from public.tour_bookings where id=(f->>'b')::uuid),'missing adoption cancels the local booking');
 perform pg_temp.check((select status='contacted' from public.leads where id=(f->>'l')::uuid),'cancellation updates lead lifecycle consistently');
 f:=pg_temp.fixture();
 f:=jsonb_set(f,'{remote,status}','"cancelled"');update public.calendar_events set sync_status='external_cancelled',remote_snapshot=f->'remote' where id=(f->>'e')::uuid;
 perform pg_temp.check(pg_temp.review(f,gen_random_uuid())->>'action'='cancel','cancelled provider event can be adopted');
 f:=pg_temp.fixture();
 f:=jsonb_set(f,'{remote,endDateTime}',to_jsonb(to_char(((current_date+4)+time '11:45') at time zone 'America/Chicago' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 update public.calendar_events set remote_snapshot=f->'remote' where id=(f->>'e')::uuid;
 perform pg_temp.check(pg_temp.review(f,gen_random_uuid())->>'state'='applied','reviewed duration changes are adopted');
 f:=pg_temp.fixture();
 insert into public.tours(property_id,lead_id,tour_date,tour_time,duration_minutes,status,schedule_timezone)values((f->>'p')::uuid,(f->>'l')::uuid,current_date+4,'11:00',30,'confirmed','America/Chicago');
 perform pg_temp.check(pg_temp.review(f,gen_random_uuid())->>'state'='unavailable','adoption respects occupied capacity');
 f:=pg_temp.fixture();
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,state,started_at,lease_until)values((f->>'p')::uuid,(f->>'l')::uuid,'tour_bookings',(f->>'b')::uuid,1,'notice_email','running',now(),now()+interval '1 minute');
 perform pg_temp.check(pg_temp.review(f,gen_random_uuid())->>'state'='delivery_busy','running delivery blocks adoption');
 perform pg_temp.check(not has_function_privilege('authenticated','public.review_tour_calendar_change(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,timestamptz,jsonb,jsonb,text)','EXECUTE'),'decisions are service-only');
 perform pg_temp.check(not has_function_privilege('anon','public.tour_calendar_review_context(uuid,uuid)','EXECUTE'),'review context is service-only');
end$$;
create function pg_temp.reject_action() returns trigger language plpgsql as $$begin raise exception 'Fixture action history unavailable';end$$;
create trigger fixture_reject_calendar_action before insert on public.shared_action_events for each row when (new.action='tour.calendar_change.reviewed') execute function pg_temp.reject_action();
DO $$
declare f jsonb;r jsonb;
begin
 f:=pg_temp.fixture();
 begin
  r:=pg_temp.review(f,gen_random_uuid());raise exception 'FAIL: action history failure was ignored';
 exception when raise_exception then if SQLERRM<>'Fixture action history unavailable' then raise;end if;end;
 perform pg_temp.check((select schedule_version=1 and scheduled_time='10:00' from public.tour_bookings where id=(f->>'b')::uuid),'action history failure rolls back booking changes');
 perform pg_temp.check(not exists(select 1 from public.tour_schedule_changes where property_id=(f->>'p')::uuid),'action history failure rolls back schedule history');
 perform pg_temp.check(not exists(select 1 from public.tour_schedule_work where property_id=(f->>'p')::uuid),'action history failure rolls back queued work');
 perform pg_temp.check((select sync_status='external_drift' and observed_schedule_version=1 from public.calendar_events where id=(f->>'e')::uuid),'action history failure preserves unresolved observation');
end$$;
drop trigger fixture_reject_calendar_action on public.shared_action_events;
select count(*) as passed from checks;
ROLLBACK;
