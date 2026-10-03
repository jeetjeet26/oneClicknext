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
 -- Keep the 30-minute fixture within one day even when this suite runs near midnight.
 wall:=date_trunc('hour',starts at time zone coalesce(tz,'UTC'));
 if source='tours' then insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status)values(t,p,l,wall::date,wall::time,'confirmed');
 else insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status)values(t,p,l,wall::date,wall::time,'confirmed');end if;
 return jsonb_build_object('property',p,'lead',l,'tour',t);
end$$;
create temp table blocked_requests(id uuid primary key);
create function pg_temp.reject_fixture_event() returns trigger language plpgsql as $$begin
 if exists(select 1 from blocked_requests where id=new.id) then raise exception 'fixture recording unavailable' using errcode='P0002';end if;return new;end$$;
create trigger fixture_event_failure before insert on public.shared_action_events for each row execute function pg_temp.reject_fixture_event();
DO $$
declare source text;f jsonb;p uuid;l uuid;t uuid;actor uuid;req uuid;correct_req uuid;r jsonb;again jsonb;input jsonb;before_id uuid;channel uuid;w jsonb;job uuid;token uuid;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 foreach source in array array['tours','tour_bookings'] loop
  f:=pg_temp.fixture(source,'UTC',now()-interval '3 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
  req:=gen_random_uuid();input:='{"outcome":"no_show","notes":"Private fixture note"}';
  perform pg_temp.check(public.apply_recorded_tour_action(p,l,source,t,gen_random_uuid(),req,'tour.outcome.recorded',input)->>'state'='forbidden',source||': rejects untrusted actor');
  perform pg_temp.check(public.apply_recorded_tour_action(p,gen_random_uuid(),source,t,actor,req,'tour.outcome.recorded',input)->>'state'='not_found',source||': rejects wrong lead');
  r:=public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded',input);
  perform pg_temp.check(r->>'state'='applied' and r->>'actionEventId'=req::text,source||': saves outcome and shared action');
  perform pg_temp.check((select actor_id=actor and product='tourspark' and phase='succeeded' and before_state->>'status'='confirmed' and after_state->>'status'='no_show' from public.shared_action_events where id=req),source||': actor and before/after states are recorded');
  perform pg_temp.check((select result->>'outcomeId'=r->'outcome'->>'id' and not training_eligible from public.shared_action_events where id=req),source||': references actual outcome, excluded from training');
  perform pg_temp.check((select position('Private fixture note' in to_jsonb(e)::text)=0 from public.shared_action_events e where id=req),source||': free-text stays in scoped product receipt');
  again:=public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded',input);
  perform pg_temp.check(again->>'state'='replayed' and again->>'actionEventId'=req::text,source||': lost acknowledgement recovers same event');
  perform pg_temp.check((select count(*)=1 from public.shared_action_events where property_id=p),source||': repeat adds no shared event');
  perform pg_temp.check(public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded',input||'{"notes":"Changed"}')->>'state'='request_conflict',source||': request cannot change intent');
  correct_req:=gen_random_uuid();
  r:=public.apply_recorded_tour_action(p,l,source,t,actor,correct_req,'tour.no_show.corrected','{"reason":"Attendance verified"}');
  perform pg_temp.check(r->>'state'='applied',source||': correction saves');
  perform pg_temp.check((select before_state->>'status'='no_show' and after_state->>'status'='completed' and result->>'correctionId'=r->'correction'->>'id' from public.shared_action_events where id=correct_req),source||': correction event links real correction and state transition');
  perform pg_temp.check((select count(distinct episode_id)=1 from public.shared_action_events where property_id=p),source||': decisions share a tour episode');
  perform pg_temp.check(public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded',input)->>'state'='conflict',source||': old no-show replay cannot undo correction');

  f:=pg_temp.fixture(source,'UTC',now()-interval '3 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;req:=gen_random_uuid();
  insert into blocked_requests values(req);
  begin perform public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded','{"outcome":"completed"}');raise exception 'FAIL: missing event accepted';
  exception when sqlstate 'P0002' then insert into checks values(source||': recording failure rejects whole mutation');end;
  perform pg_temp.check(public.tour_schedule_row(p,source,t)->>'status'='confirmed',source||': recording failure restores tour');
  perform pg_temp.check(not exists(select 1 from public.tour_outcomes where tour_id=t) and not exists(select 1 from public.lead_engagement_events where lead_id=l),source||': recording failure restores outcome and score');
  perform pg_temp.check(not exists(select 1 from public.shared_action_events where id=req),source||': rollback leaves no false event');
  delete from blocked_requests where id=req;
  insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,state,lease_until)values(p,l,source,t,1,'notice_email','running',now()+interval '5 minutes') returning id into job;
  r:=public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded','{"outcome":"completed"}');
  perform pg_temp.check(r->>'state'='delivery_busy' and (select phase='failed' and before_state=after_state from public.shared_action_events where id=(r->>'actionEventId')::uuid),source||': blocked decision is recorded without claiming completion');
  again:=public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded','{"outcome":"completed"}');
  perform pg_temp.check(again->>'actionEventId'=r->>'actionEventId' and (select count(*)=1 from public.shared_action_events where property_id=p),source||': repeated blocked request is deduplicated');
  update public.tour_schedule_work set state='completed',lease_until=null where id=job;
  r:=public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.outcome.recorded','{"outcome":"completed"}');
  perform pg_temp.check(r->>'state'='applied' and (select count(*)=2 from public.shared_action_events where property_id=p),source||': same decision succeeds after recovery while retaining failed evidence');

  f:=pg_temp.fixture(source,'UTC',date_trunc('day',now())+interval '3 days 12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;req:=gen_random_uuid();
  input:=jsonb_build_object('action','reschedule','expectedVersion',1,'date',current_date+4,'time','11:00','reason','Prospect requested new time','notify',false);
  r:=public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.rescheduled',input);
  perform pg_temp.check(r->>'state'='applied' and (select before_state->>'scheduleVersion'='1' and after_state->>'scheduleVersion'='2' from public.shared_action_events where id=req),source||': schedule versions captured');
  before_id:=gen_random_uuid();
  r:=public.apply_recorded_tour_action(p,l,source,t,actor,before_id,'tour.cancelled','{"action":"cancel","expectedVersion":2,"reason":"Changed plans","notify":false}');
  perform pg_temp.check(r->>'state'='applied' and (select action='tour.cancelled' and after_state->>'status'='cancelled' from public.shared_action_events where id=before_id),source||': cancellation recorded');
  again:=public.apply_recorded_tour_action(p,l,source,t,actor,req,'tour.rescheduled',input);
  perform pg_temp.check(again->>'state'='replayed' and again->'tour'->>'status'='cancelled',source||': old reschedule replay reports current cancelled status');
  perform pg_temp.check((select count(*)=2 from public.shared_action_events where property_id=p),source||': schedule replay adds no event');

  f:=pg_temp.fixture(source,'UTC',now()+interval '24 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;req:=gen_random_uuid();
  w:=public.prepare_tour_reminder(p,source,t,1,'reminder_24h');job:=(w->>'id')::uuid;token:=(w->>'lease_token')::uuid;
  select c.id into channel from public.tour_reminder_channels c where c.work_id=job and c.channel='email';
  perform public.start_tour_reminder_channel(channel,token,'Fixture message','Fixture','fixture@example.invalid');
  perform public.finish_tour_reminder_channel(channel,token,null);perform public.settle_tour_reminder(job,token);
  input:='{"resolution":"not_sent","reason":"Provider did not accept"}';
  r:=public.review_recorded_tour_reminder(p,l,channel,actor,req,input);
  perform pg_temp.check(r->>'state'='applied' and r->>'channelState'='queued',source||': reminder review saved');
  perform pg_temp.check((select action='tour.reminder.reviewed' and before_state->>'state'='review' and after_state->>'state'='queued' and result->>'outcomeEvidence'='operator_review' from public.shared_action_events where id=req),source||': review decision distinguished from provider delivery');
  perform pg_temp.check(public.review_recorded_tour_reminder(p,l,channel,actor,req,input)->>'state'='replayed' and (select count(*)=1 from public.shared_action_events where property_id=p),source||': reminder review replay adds no event');
  perform pg_temp.check(public.review_recorded_tour_reminder(p,l,channel,actor,req,input||'{"reason":"Changed"}')->>'state'='request_conflict',source||': changed reminder evidence cannot reuse request');
 end loop;
 perform pg_temp.check(not has_function_privilege('anon','public.apply_recorded_tour_action(uuid,uuid,text,uuid,uuid,uuid,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.review_recorded_tour_reminder(uuid,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),'recording wrappers are service-only');
end$$;
select count(*) as passed from checks;
ROLLBACK;
