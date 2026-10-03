BEGIN;
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin
 if passed is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
DO $$
declare p uuid:=gen_random_uuid();actor uuid;l uuid;t uuid;source text;old_slot uuid:=gen_random_uuid();new_slot uuid:=gen_random_uuid();
 req uuid;input jsonb;r jsonb;replay jsonb;job uuid;claim jsonb;next_t uuid;other_l uuid;old_n integer;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 insert into public.properties(id,name,org_id,settings)values(p,'Tour scheduling contract','22222222-2222-2222-2222-222222222222','{"timezone":"UTC"}');
 insert into public.tour_slots(id,property_id,slot_date,start_time,end_time,max_bookings,current_bookings,is_available)values
  (old_slot,p,current_date+3,'10:00','10:30',1,0,true),(new_slot,p,current_date+4,'11:00','11:30',1,0,true);
 foreach source in array array['tours','tour_bookings'] loop
  l:=gen_random_uuid();t:=gen_random_uuid();req:=gen_random_uuid();
  insert into public.leads(id,property_id,first_name,email,phone,status,crm_sync_status,crm_sync_next_retry_at)values(l,p,'Schedule fixture','fixture@example.invalid','+15550000000','tour_booked','processing',now()+interval '5 minutes');
  if source='tours' then insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status,slot_id,reminder_sent_at)values(t,p,l,current_date+3,'10:00','confirmed',old_slot,now());
  else insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status,slot_id,reminder_1h_sent_at)values(t,p,l,current_date+3,'10:00','confirmed',old_slot,now());
   insert into public.luma_delivery_jobs(property_id,booking_id,payload) values(p,t,jsonb_build_object('calendarId',gen_random_uuid(),'providerCalendarId','primary','provider','google'));end if;
  perform pg_temp.check((select current_bookings=1 from public.tour_slots where id=old_slot),source||': insert occupies one slot');
  input:=jsonb_build_object('action','reschedule','date',current_date+4,'time','11:00','reason','Prospect requested a new time','notify',true);
  insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind)values(p,l,source,t,1,'reminder_24h')returning id into job;
  r:=public.change_tour_schedule(p,l,source,t,actor,req,1,input);
  perform pg_temp.check(r->>'state'='applied',source||': reschedule applies');
  perform pg_temp.check(r->'tour'->>'schedule_version'='2' and r->'tour'->>'tour_date'=(current_date+4)::text,source||': version and schedule saved');
  perform pg_temp.check((select current_bookings=0 from public.tour_slots where id=old_slot) and (select current_bookings=1 from public.tour_slots where id=new_slot),source||': capacity moved atomically');
  perform pg_temp.check((select previous_schedule->>'schedule_version'='1' and next_schedule->>'schedule_version'='2' and actor_id=actor from public.tour_schedule_changes where tour_id=t),source||': previous schedule and operator audited');
  perform pg_temp.check((select state='superseded' from public.tour_schedule_work where id=job),source||': queued old reminder superseded');
  perform pg_temp.check(public.claim_tour_schedule_work(job) is null,source||': old queued work cannot claim');
  perform pg_temp.check(public.claim_tour_legacy_delivery(p,source,t,1,'reminder_1h') is null,source||': stale sender snapshot cannot claim');
  perform pg_temp.check(coalesce(r->'tour'->>'reminder_1h_sent_at',r->'tour'->>'reminder_sent_at') is null,source||': new version resets sent markers');
  perform pg_temp.check((select status='tour_booked' and crm_sync_status='processing' and crm_sync_next_retry_at=now()+interval '5 minutes' from public.leads where id=l),source||': lead and CRM ownership preserved');
  perform pg_temp.check((select count(*)=2 from public.tour_schedule_work where tour_id=t and schedule_version=2 and kind like 'notice_%'),source||': requested messages queued once');
  replay:=public.change_tour_schedule(p,l,source,t,actor,req,1,input);
  perform pg_temp.check(replay->>'state'='replayed' and replay->>'changeId'=r->>'changeId',source||': lost-response retry replays');
  perform pg_temp.check((select count(*)=1 from public.tour_schedule_changes where tour_id=t),source||': replay adds no audit');
  perform pg_temp.check(public.change_tour_schedule(p,l,source,t,actor,req,1,input||'{"reason":"changed"}')->>'state'='request_conflict',source||': request reuse mismatch rejected');
  perform pg_temp.check(public.change_tour_schedule(p,l,source,t,actor,gen_random_uuid(),1,input)->>'state'='stale',source||': stale editor rejected');
  begin
   if source='tours' then update public.tours set tour_time='13:00' where id=t;else update public.tour_bookings set scheduled_time='13:00' where id=t;end if;
   raise exception 'FAIL: direct update accepted';exception when sqlstate '55000' then insert into checks values(source||': direct schedule bypass rejected');end;
  -- Active and uncertain delivery claims block schedule changes before any mutation.
  select id into job from public.tour_schedule_work where tour_id=t and kind='notice_email' and schedule_version=2;
  claim:=public.claim_tour_schedule_work(job);
  perform pg_temp.check(claim->>'id'=job::text,source||': current work can claim');
  perform pg_temp.check(public.change_tour_schedule(p,l,source,t,actor,gen_random_uuid(),2,'{"action":"cancel","reason":"Changed plans","notify":false}')->>'state'='delivery_busy',source||': live delivery holds cancellation');
  perform public.start_tour_schedule_work(job,(claim->>'lease_token')::uuid);
  update public.tour_schedule_work set lease_until=now()-interval '1 minute' where id=job;
  perform pg_temp.check(public.change_tour_schedule(p,l,source,t,actor,gen_random_uuid(),2,'{"action":"cancel","reason":"Changed plans","notify":false}')->>'state'='delivery_review_required',source||': expired attempt needs review');
  perform pg_temp.check(public.finish_tour_schedule_work(job,gen_random_uuid(),'{"messageId":"wrong"}',true)=false,source||': wrong completion token rejected');
  perform pg_temp.check(public.finish_tour_schedule_work(job,(claim->>'lease_token')::uuid,'{"messageId":"local-receipt"}',true),source||': late owner can reconcile receipt');
  update public.leads set status='leased' where id=l;
  r:=public.change_tour_schedule(p,l,source,t,actor,gen_random_uuid(),2,'{"action":"cancel","reason":"Changed plans","notify":false}');
  perform pg_temp.check(r->>'state'='applied' and r->'tour'->>'status'='cancelled',source||': cancellation saved');
  perform pg_temp.check((select current_bookings=0 from public.tour_slots where id=new_slot),source||': cancellation releases slot');
  perform pg_temp.check(r->>'leadStatus'='leased',source||': cancellation preserves leased lead');
  perform pg_temp.check((select count(*)=0 from public.tour_schedule_work where tour_id=t and schedule_version=2 and state='queued'),source||': superseded updates cannot send');
  perform pg_temp.check(public.change_tour_schedule(p,l,source,t,actor,gen_random_uuid(),3,input)->>'state'='conflict',source||': cancelled tour cannot silently reopen');
  replay:=public.change_tour_schedule(p,l,source,t,actor,req,1,input);
  perform pg_temp.check(replay->'tour'->>'status'='cancelled' and replay->>'leadStatus'='leased',source||': old retry reports latest state');
 end loop;
 -- Capacity is shared between sources and failure has no side effects.
 l:=gen_random_uuid();t:=gen_random_uuid();other_l:=gen_random_uuid();next_t:=gen_random_uuid();
 insert into public.leads(id,property_id,first_name,status)values(l,p,'Manual capacity','tour_booked'),(other_l,p,'Widget capacity','tour_booked');
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status,slot_id)values(t,p,l,current_date+3,'10:00','confirmed',old_slot);
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status,slot_id)values(next_t,p,other_l,current_date+4,'11:00','confirmed',new_slot);
 input:=jsonb_build_object('action','reschedule','date',current_date+4,'time','11:00','reason','Try occupied time','notify',true);
 r:=public.change_tour_schedule(p,l,'tours',t,actor,gen_random_uuid(),1,input);
 perform pg_temp.check(r->>'state'='unavailable','manual change respects widget capacity');
 perform pg_temp.check((select tour_date=current_date+3 and schedule_version=1 from public.tours where id=t),'capacity failure preserves original schedule');
 perform pg_temp.check(not exists(select 1 from public.tour_schedule_changes where tour_id=t),'capacity failure saves no false audit');
 perform pg_temp.check(not exists(select 1 from public.tour_schedule_work where tour_id=t),'capacity failure queues nothing');
 begin insert into public.tours(property_id,lead_id,tour_date,tour_time,status)values(p,l,current_date+4,'11:15','scheduled');raise exception 'FAIL: overlap accepted';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise;end if;insert into checks values('new manual booking respects widget overlap');end;
 perform pg_temp.check(public.change_tour_schedule(p,l,'tours',t,gen_random_uuid(),gen_random_uuid(),1,input)->>'state'='forbidden','untrusted actor rejected');
 perform pg_temp.check(public.change_tour_schedule(p,other_l,'tours',t,actor,gen_random_uuid(),1,input)->>'state'='not_found','wrong lead rejected');
 -- No-show and completed outcomes remain terminal.
 perform public.record_tour_outcome(p,l,'tours',t,'completed',null,false); -- expected not due, so seed a separate historical terminal record
 next_t:=gen_random_uuid();insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status)values(next_t,p,l,current_date-1,'09:00','completed');
 perform pg_temp.check(public.change_tour_schedule(p,l,'tours',next_t,actor,gen_random_uuid(),1,input)->>'state'='conflict','completed tour schedule remains immutable');
 -- Missing timezone, invalid DST times and past times make no mutation.
 update public.properties set settings='{}' where id=p;
 perform pg_temp.check(public.change_tour_schedule(p,l,'tours',t,actor,gen_random_uuid(),1,input)->>'state'='needs_timezone','unknown timezone never guessed');
 update public.properties set settings='{"timezone":"America/Los_Angeles"}' where id=p;
 input:=input||'{"date":"2099-03-08","time":"02:30"}';
 perform pg_temp.check(public.change_tour_schedule(p,l,'tours',t,actor,gen_random_uuid(),1,input)->>'state'='ambiguous_time','DST skipped local time rejected');
 input:=input||'{"date":"2099-11-01","time":"01:30"}';
 perform pg_temp.check(public.change_tour_schedule(p,l,'tours',t,actor,gen_random_uuid(),1,input)->>'state'='ambiguous_time','DST repeated local time rejected');
 input:=input||jsonb_build_object('date',current_date-1,'time','10:00');
 perform pg_temp.check(public.change_tour_schedule(p,l,'tours',t,actor,gen_random_uuid(),1,input)->>'state'='not_future','past reschedule rejected');
 perform pg_temp.check(not has_function_privilege('authenticated','public.change_tour_schedule(uuid,uuid,text,uuid,uuid,uuid,integer,jsonb)','execute'),'authenticated cannot bypass API');
 perform pg_temp.check(not has_table_privilege('anon','public.tour_schedule_work','select'),'private delivery queue');
 perform pg_temp.check(not has_table_privilege('authenticated','public.tour_schedule_changes','select'),'private schedule audit');
end$$;
create function pg_temp.fail_scheduling_activity() returns trigger language plpgsql as $$begin raise exception 'Forced activity failure' using errcode='23514';end$$;
create trigger test_schedule_atomic_failure before insert on public.lead_activities for each row when (new.description like '%ROLLBACK FIXTURE%') execute function pg_temp.fail_scheduling_activity();
DO $$
declare p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();t uuid:=gen_random_uuid();b uuid:=gen_random_uuid();actor uuid;slot uuid:=gen_random_uuid();r jsonb;change_id uuid;work uuid;claim jsonb;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 insert into public.properties(id,name,org_id,settings)values(p,'Schedule additional contracts','22222222-2222-2222-2222-222222222222','{"timezone":"UTC"}');
 insert into public.leads(id,property_id,first_name,email,status)values(l,p,'Additional contract','fixture@example.invalid','tour_booked');
 insert into public.tour_slots(id,property_id,slot_date,start_time,end_time,max_bookings,is_available)values(slot,p,current_date+10,'10:00','10:30',1,true);
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status,slot_id)values(t,p,l,current_date+10,'10:00','confirmed',slot);
 begin perform public.change_tour_schedule(p,l,'tours',t,actor,gen_random_uuid(),1,'{"action":"cancel","reason":"ROLLBACK FIXTURE","notify":true}');raise exception 'FAIL: failure not forced';
 exception when check_violation then insert into checks values('activity failure rolls back entire operation');end;
 perform pg_temp.check((select status='confirmed' and schedule_version=1 from public.tours where id=t),'rollback restores tour and version');
 perform pg_temp.check((select current_bookings=1 from public.tour_slots where id=slot),'rollback restores capacity');
 perform pg_temp.check((select status='tour_booked' from public.leads where id=l),'rollback restores lead');
 perform pg_temp.check(not exists(select 1 from public.tour_schedule_changes where tour_id=t),'rollback removes audit');
 perform pg_temp.check(not exists(select 1 from public.tour_schedule_work where tour_id=t),'rollback removes queued sends');
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status)values(b,p,l,current_date+11,'11:00','confirmed');
 r:=public.change_tour_schedule(p,l,'tours',t,actor,gen_random_uuid(),1,'{"action":"cancel","reason":"Cancel one","notify":true}');
 change_id:=(r->>'changeId')::uuid;
 perform pg_temp.check(r->>'leadStatus'='tour_booked','another active tour preserves booked lead');
 begin update public.tour_schedule_changes set action='reschedule' where id=change_id;raise exception 'FAIL: audit mutated';
 exception when sqlstate '55000' then insert into checks values('schedule audit is immutable');end;
 insert into public.tours(property_id,lead_id,tour_date,tour_time,status)values(p,l,current_date-1,'10:00','completed');
 r:=public.change_tour_schedule(p,l,'tour_bookings',b,actor,gen_random_uuid(),1,'{"action":"cancel","reason":"Cancel last","notify":false}');
 perform pg_temp.check(r->>'leadStatus'='toured','last cancellation preserves previous completed attendance');
 select id into work from public.tour_schedule_work where tour_id=t and kind='notice_email';
 update public.tour_schedule_work set created_at=now()-interval '2 days' where id=work;
 perform pg_temp.check(public.claim_tour_schedule_work(work) is null,'old queued notification is not replayed after a pause');
 perform pg_temp.check((select state='review' and error_code='delivery_window_expired' from public.tour_schedule_work where id=work),'old notification has an explicit review state');
 b:=gen_random_uuid();insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status)values(b,p,l,current_date+12,'12:00','confirmed');
 insert into public.luma_delivery_jobs(property_id,booking_id,payload,state,attempts,lease_token,lease_until)values(p,b,'{}','running',1,gen_random_uuid(),now()+interval '1 minute');
 perform pg_temp.check(public.change_tour_schedule(p,l,'tour_bookings',b,actor,gen_random_uuid(),1,'{"action":"cancel","reason":"Cancelled","notify":false}')->>'state'='delivery_busy','live widget confirmation holds cancellation');
 update public.luma_delivery_jobs set lease_until=now()-interval '1 minute' where booking_id=b;
 perform pg_temp.check(public.change_tour_schedule(p,l,'tour_bookings',b,actor,gen_random_uuid(),1,'{"action":"cancel","reason":"Cancelled","notify":false}')->>'state'='delivery_review_required','expired widget confirmation needs review');
 perform pg_temp.check(public.claim_tour_legacy_delivery(p,'tour_bookings',b,1,'calendar_reconcile') is null,'calendar repair cannot duplicate initial confirmation');
 perform pg_temp.check((select status='confirmed' and schedule_version=1 from public.tour_bookings where id=b),'blocked widget change preserves booking');
end$$;
select count(*) as passed from checks;
ROLLBACK;
