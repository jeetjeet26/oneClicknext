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
create temp table blocked_requests(id uuid primary key);
create function pg_temp.reject_fixture_event() returns trigger language plpgsql as $$begin
 if exists(select 1 from blocked_requests where id=new.id) then raise exception 'fixture recording unavailable' using errcode='P0002';end if;return new;end$$;
create trigger fixture_event_failure before insert on public.shared_action_events for each row execute function pg_temp.reject_fixture_event();
DO $$
declare source text;f jsonb;p uuid;l uuid;t uuid;actor uuid;req uuid;r jsonb;w jsonb;job uuid;token uuid;input jsonb;dispatch jsonb;old_token uuid;iteration integer;other uuid;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 dispatch:='{"to":"reminder@example.invalid","from":"sender@example.invalid","subject":"Saved subject","body":"Saved message"}';
 foreach source in array array['tours','tour_bookings'] loop
  f:=pg_temp.fixture(source,'UTC',date_trunc('day',now())+interval '3 days 12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
  insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
   values(p,l,source,t,1,'notice_email',jsonb_build_object('action','reschedule','date',(date_trunc('day',now())+interval '3 days 12 hours')::date,'time','12:00','timezone','UTC','email','reminder@example.invalid')) returning id into job;
  w:=public.claim_tour_schedule_work(job);token:=(w->>'lease_token')::uuid;
  perform pg_temp.check(w->>'state'='running' and (w->>'attempts')::integer=1,source||': bounded claim acquired');
  perform pg_temp.check(not exists(select 1 from jsonb_array_elements(public.pending_tour_schedule_work(20)) q where q->>'id'=job::text),source||': active work is filtered before batching');
  perform pg_temp.check(public.claim_tour_schedule_work(job) is null,source||': same delivery cannot be claimed twice');
  req:=gen_random_uuid();input:='{"resolution":"not_sent","reason":"Verified provider history"}';
  perform pg_temp.check(public.review_tour_schedule_delivery(p,l,job,actor,req,input)->>'state'='busy',source||': active review rejected');
  perform pg_temp.check((select phase='failed' from public.shared_action_events where request->>'requestId'=req::text),source||': blocked operator decision recorded');
  perform pg_temp.check(public.start_tour_schedule_delivery(job,gen_random_uuid(),dispatch) is null,source||': wrong token cannot start');
  w:=public.start_tour_schedule_delivery(job,token,dispatch);
  perform pg_temp.check(w->'dispatch'=dispatch and w->>'started_at' is not null,source||': content pinned before provider crossing');
  perform pg_temp.check(public.start_tour_schedule_delivery(job,token,dispatch) is null,source||': duplicate start rejected');
  perform pg_temp.check(public.finish_tour_schedule_work(job,token,'{"error":"unknown"}',false),source||': ambiguous send held');
  perform pg_temp.check(public.review_tour_schedule_delivery(p,l,job,gen_random_uuid(),req,input)->>'state'='forbidden',source||': untrusted operator rejected');
  perform pg_temp.check(public.review_tour_schedule_delivery(p,gen_random_uuid(),job,actor,req,input)->>'state'='not_found',source||': wrong lead rejected');
  r:=public.review_tour_schedule_delivery(p,l,job,actor,req,input);
  perform pg_temp.check(r->>'state'='applied' and r->>'workState'='queued',source||': confirmed unaccepted delivery requeued');
  perform pg_temp.check((select count(*)=2 from public.shared_action_events where request->>'requestId'=req::text),source||': blocked and successful decisions retained');
  perform pg_temp.check((select not training_eligible and before_state->>'state'='review' and after_state->>'state'='queued' and result->>'outcomeEvidence'='operator_review' from public.shared_action_events where id=req),source||': review lineage and training exclusion');
  perform pg_temp.check(public.review_tour_schedule_delivery(p,l,job,actor,req,input)->>'state'='replayed',source||': lost review reply replays');
  perform pg_temp.check(public.review_tour_schedule_delivery(p,l,job,actor,req,input||'{"reason":"Changed"}')->>'state'='request_conflict',source||': review intent cannot change');
  perform pg_temp.check(not public.finish_tour_schedule_work(job,token,'{"messageId":"late-old-owner"}',true),source||': old owner fenced after review');
  old_token:=token;w:=public.claim_tour_schedule_work(job);token:=(w->>'lease_token')::uuid;
  perform pg_temp.check(token<>old_token and (w->>'attempts')::integer=2,source||': retry rotates owner and counts attempt');
  begin perform public.start_tour_schedule_delivery(job,token,dispatch||'{"body":"Changed"}');raise exception 'FAIL: content changed';
  exception when raise_exception then if SQLERRM='FAIL: content changed' then raise;end if;insert into checks values(source||': pinned content cannot change');end;
  perform public.start_tour_schedule_delivery(job,token,dispatch);
  perform pg_temp.check(public.finish_tour_schedule_work(job,token,'{"messageId":"receipt-1"}',true),source||': receipt saved');
  perform pg_temp.check(public.finish_tour_schedule_work(job,token,'{"messageId":"receipt-1"}',true),source||': lost completion reply replays receipt');
  perform pg_temp.check(not public.finish_tour_schedule_work(job,token,'{"error":"generic failure"}',false),source||': accepted receipt cannot be overwritten by failure');
  perform pg_temp.check(public.review_tour_schedule_delivery(p,l,job,actor,req,input)->>'workState'='completed',source||': old review replay reports current delivery state');

  -- Expired attempt ownership and explicit provider acceptance recovery.
  insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
   values(p,l,source,t,1,'notice_sms',jsonb_build_object('action','reschedule','timezone','UTC','phone','+15550000000')) returning id into job;
  w:=public.claim_tour_schedule_work(job);token:=(w->>'lease_token')::uuid;
  perform public.start_tour_schedule_delivery(job,token,dispatch||'{"to":"+15550000000"}');
  update public.tour_schedule_work set lease_until=now()-interval '1 second' where id=job;
  w:=public.claim_tour_schedule_work(job);
  perform pg_temp.check(w is null and (select state='review' from public.tour_schedule_work where id=job),source||': expired lease held rather than resent');
  req:=gen_random_uuid();input:='{"resolution":"accepted","reason":"Provider receipt verified","providerId":"provider-accepted"}';
  insert into blocked_requests values(req);
  begin perform public.review_tour_schedule_delivery(p,l,job,actor,req,input);raise exception 'FAIL: missing event accepted';
  exception when sqlstate 'P0002' then insert into checks values(source||': recorder failure rejects review');end;
  perform pg_temp.check((select state='review' and receipt is null from public.tour_schedule_work where id=job),source||': recorder failure rolls back receipt');
  delete from blocked_requests where id=req;
  r:=public.review_tour_schedule_delivery(p,l,job,actor,req,input);
  perform pg_temp.check(r->>'workState'='completed' and (select receipt->>'messageId'='provider-accepted' from public.tour_schedule_work where id=job),source||': accepted review reconciles receipt without sending');
  begin update public.tour_schedule_reviews set input='{}' where request_id=req;raise exception 'FAIL: mutable review';
  exception when sqlstate '55000' then insert into checks values(source||': review evidence immutable');end;

  f:=pg_temp.fixture(source,'UTC',date_trunc('day',now())+interval '3 days 12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
  insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
   values(p,l,source,t,1,'notice_email','{"action":"reschedule","timezone":"UTC","email":"reminder@example.invalid"}') returning id into job;
  for iteration in 1..3 loop
   w:=public.claim_tour_schedule_work(job);token:=(w->>'lease_token')::uuid;
   perform public.finish_tour_schedule_work(job,token,'{"error":"not configured"}',false);
   perform pg_temp.check(public.review_tour_schedule_delivery(p,l,job,actor,gen_random_uuid(),'{"resolution":"accepted","reason":"No evidence","providerId":"invented"}')->>'state'='not_attempted',source||': cannot invent acceptance before provider attempt '||iteration);
   r:=public.review_tour_schedule_delivery(p,l,job,actor,gen_random_uuid(),'{"resolution":"not_sent","reason":"No provider call"}');
   perform pg_temp.check(r->>'workState'=case when iteration<3 then 'queued' else 'skipped' end,source||': bounded retry '||iteration);
  end loop;
  perform pg_temp.check(public.claim_tour_schedule_work(job) is null,source||': fourth attempt blocked');
  perform pg_temp.check(public.tour_delivery_block(p,source,t) is null,source||': verified unsent terminal work releases future tour actions');

  f:=pg_temp.fixture(source,'UTC',date_trunc('day',now())+interval '3 days 12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
  insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload,created_at)
   values(p,l,source,t,1,'notice_email','{"action":"reschedule","timezone":"UTC","email":"reminder@example.invalid"}',now()-interval '24 hours') returning id into job;
  w:=public.claim_tour_schedule_work(job);
  perform pg_temp.check(w is null and (select state='review' and attempts=0 from public.tour_schedule_work where id=job),source||': stale backlog held without attempting');
  r:=public.review_tour_schedule_delivery(p,l,job,actor,gen_random_uuid(),'{"resolution":"not_sent","reason":"Unsent backlog closed"}');
  perform pg_temp.check(r->>'workState'='skipped',source||': expired backlog cannot be requeued');
 end loop;
 perform pg_temp.check(not has_table_privilege('authenticated','public.tour_schedule_reviews','SELECT'),'reviews are private');
 perform pg_temp.check(not has_function_privilege('anon','public.review_tour_schedule_delivery(uuid,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),'review transaction is service-only');
 perform pg_temp.check(not has_function_privilege('authenticated','public.pending_tour_schedule_work(integer)','EXECUTE'),'queue is service-only');
end$$;
DO $$
declare f jsonb;p uuid;l uuid;t uuid;actor uuid;calendar uuid:=gen_random_uuid();job uuid;token uuid;w jsonb;r jsonb;req uuid;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 f:=pg_temp.fixture('tour_bookings','UTC',date_trunc('day',now())+interval '3 days 12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 insert into public.agent_calendars(id,property_id,profile_id,account_email,provider,calendar_id,timezone,sync_enabled)values(calendar,p,actor,'calendar@example.invalid','google','fixture-calendar','UTC',false);
 insert into public.calendar_events(agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,sync_status)values(calendar,t,'pinned-event','pinned-event','pending');
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
 values(p,l,'tour_bookings',t,1,'calendar',jsonb_build_object('action','reschedule','timezone','UTC','calendarId',calendar,'eventId','pinned-event')) returning id into job;
 w:=public.claim_tour_schedule_work(job);token:=(w->>'lease_token')::uuid;
 perform public.start_tour_schedule_delivery(job,token,'{}');perform public.finish_tour_schedule_work(job,token,'{"error":"unknown"}',false);
 r:=public.review_tour_schedule_delivery(p,l,job,actor,gen_random_uuid(),'{"resolution":"accepted","reason":"Wrong event","providerId":"different-event"}');
 perform pg_temp.check(r->>'state'='receipt_conflict','calendar receipt must match pinned event');
 req:=gen_random_uuid();insert into blocked_requests values(req);
 begin perform public.review_tour_schedule_delivery(p,l,job,actor,req,'{"resolution":"accepted","reason":"Saved calendar inspected","providerId":"pinned-event"}');raise exception 'FAIL: missing event accepted';
 exception when sqlstate 'P0002' then insert into checks values('calendar recorder failure rejects receipt');end;
 perform pg_temp.check((select sync_status='pending' from public.calendar_events where tour_booking_id=t),'calendar binding rolls back with recorder');
 delete from blocked_requests where id=req;
 r:=public.review_tour_schedule_delivery(p,l,job,actor,req,'{"resolution":"accepted","reason":"Saved calendar inspected","providerId":"pinned-event"}');
 perform pg_temp.check(r->>'workState'='completed' and (select sync_status='synced' from public.calendar_events where tour_booking_id=t),'calendar review reconciles pinned binding');
 perform pg_temp.check((select count(*)=1 from public.calendar_events where tour_booking_id=t),'calendar review never creates duplicate binding');

 f:=pg_temp.fixture('tours','UTC',date_trunc('day',now())+interval '3 days 12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
 values(p,l,'tours',t,1,'notice_email','{"action":"reschedule","timezone":"UTC","email":"reminder@example.invalid"}') returning id into job;
 update public.leads set email='corrected@example.invalid' where id=l;
 perform pg_temp.check(public.claim_tour_schedule_work(job) is null,'corrected contact blocks obsolete recipient');
 r:=public.review_tour_schedule_delivery(p,l,job,actor,gen_random_uuid(),'{"resolution":"not_sent","reason":"Contact was corrected"}');
 perform pg_temp.check(r->>'workState'='skipped','review cannot requeue obsolete recipient');

 f:=pg_temp.fixture('tours','UTC',date_trunc('day',now())-interval '12 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
 values(p,l,'tours',t,1,'notice_email','{"action":"reschedule","timezone":"UTC","email":"reminder@example.invalid"}') returning id into job;
 perform pg_temp.check(public.claim_tour_schedule_work(job) is null,'reschedule notice cannot send after tour start');
end$$;
select count(*) as passed from checks;
ROLLBACK;
