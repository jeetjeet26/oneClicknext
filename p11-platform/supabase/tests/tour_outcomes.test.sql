-- Local fixtures and all writes are rolled back.
BEGIN;
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin
 if passed is not true then raise exception 'FAIL: %',label; end if;
 insert into checks values(label);
end$$;
DO $$
declare p uuid:=gen_random_uuid(); other_p uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); l2 uuid:=gen_random_uuid();
 t uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid();
 late uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid(); bad_t uuid:=gen_random_uuid();
 d timestamp; r jsonb; r2 jsonb; stats jsonb; n integer; missing uuid:=gen_random_uuid();
begin
 insert into public.properties(id,name,org_id,settings) values
 (p,'Phase 5 outcome contract','22222222-2222-2222-2222-222222222222','{"timezone":"America/Los_Angeles"}'),
 (other_p,'Phase 5 unknown timezone','22222222-2222-2222-2222-222222222222','{}');
 insert into public.leads(id,property_id,first_name,last_name,status) values(l,p,'Tour','Fixture','tour_booked'),(l2,p,'Second','Fixture','tour_booked');
 insert into public.workflow_definitions(id,property_id,name,trigger_on,steps,exit_conditions) values
 (w,p,'Completion','tour_completed','[{"delay_hours":4,"action":"email","template_slug":"thanks"}]','["leased","lost"]'),
 (w2,p,'No-show','tour_no_show','[{"delay_hours":2,"action":"email","template_slug":"missed"}]','["leased","lost","tour_booked"]');
 d:=(now() at time zone 'America/Los_Angeles')-interval '3 hours';
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status) values(t,p,l,d::date,d::time,'confirmed');
 r:=public.record_tour_outcome(p,l,'tours',t,'completed','Attended');
 perform pg_temp.check(r->>'state'='applied','manual tour completion applies');
 perform pg_temp.check((select status='completed' from public.tours where id=t),'tour status saved');
 perform pg_temp.check((select status='toured' and crm_sync_status='pending' from public.leads where id=l),'lead and CRM handoff saved');
 perform pg_temp.check((select count(*)=1 from public.lead_activities where lead_id=l and type='tour_completed'),'one activity');
 perform pg_temp.check((select count(*)=1 and max(score_weight)=35 from public.lead_engagement_events where lead_id=l),'one weighted event');
 perform pg_temp.check((select count(*)=1 from public.lead_scores where lead_id=l),'score recalculated');
 perform pg_temp.check(r->'outcome'->>'followup_state'='configured' and jsonb_array_length(r->'outcome'->'workflow_ids')=1,'configured follow-up attached');
 r2:=public.record_tour_outcome(p,l,'tours',t,'completed','Changed retry');
 perform pg_temp.check(r2->>'state'='replayed' and r2->'outcome'=r->'outcome','retry returns original receipt and notes');
 perform pg_temp.check((select count(*)=1 from public.lead_workflows where lead_id=l),'retry does not duplicate workflow');
 perform pg_temp.check((select count(*)=1 from public.lead_scores where lead_id=l),'retry does not duplicate score');
 perform pg_temp.check(public.record_tour_outcome(other_p,l,'tours',t,'completed')->>'state'='not_found','property mismatch rejected');
 perform pg_temp.check(public.record_tour_outcome(p,l2,'tours',t,'completed')->>'state'='not_found','lead mismatch rejected');
 perform pg_temp.check(public.record_tour_outcome(p,l,'tours',t,'no_show')->>'state'='conflict','terminal outcome conflict rejected');
 begin update public.tours set status='scheduled' where id=t;
   raise exception 'FAIL: terminal mutation accepted'; exception when sqlstate '55000' then insert into checks values('legacy mutation cannot overwrite outcome'); end;
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status,duration_minutes)
   values(b,p,l2,d::date,d::time,'confirmed',30);
 r:=public.record_tour_outcome(p,l2,'tour_bookings',b,'no_show',null,true);
 perform pg_temp.check(r->>'state'='applied','widget no-show included');
 perform pg_temp.check((select status='contacted' from public.leads where id=l2),'eligible no-show lead becomes contacted');
 perform pg_temp.check((select count(*)=1 and max(score_weight)=-25 from public.lead_engagement_events where lead_id=l2),'no-show penalty saved once');
 stats:=public.tour_noshow_stats(p);
 perform pg_temp.check(stats->>'totalNoShows'='1' and stats->>'followupsSent'='0' and stats->>'followupsQueued'='1','statistics distinguish queued and sent');
 insert into public.workflow_actions(lead_workflow_id,step_number,action_type,status,external_id)
   values((r->'outcome'->'workflow_ids'->>0)::uuid,0,'email','sent','fixture-provider-receipt');
 perform pg_temp.check(public.tour_noshow_stats(p)->>'followupsSent'='1','sent count requires saved provider receipt');
 -- A same-day older tour is not a reschedule; a newly booked later tour is.
 insert into public.tours(property_id,lead_id,tour_date,tour_time,status,created_at) values(p,l2,(d-interval '1 day')::date,d::time,'completed',now()-interval '1 day');
 perform pg_temp.check(public.tour_noshow_stats(p)->>'rescheduled'='0','older completed tours are not reschedules');
 insert into public.tours(property_id,lead_id,tour_date,tour_time,status,created_at) values(p,l2,(d+interval '1 day')::date,d::time,'scheduled',now()+interval '1 second');
 perform pg_temp.check(public.tour_noshow_stats(p)->>'rescheduled'='1','later new booking counts once');
 -- Preserve closed/conversion state and suppress inappropriate follow-ups.
 update public.leads set status='leased' where id=l2;
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status) values(late,p,l2,d::date,d::time,'scheduled');
 r:=public.record_tour_outcome(p,l2,'tours',late,'no_show',null,true);
 perform pg_temp.check((select status='leased' from public.leads where id=l2) and r->'outcome'->>'followup_state'='suppressed','leased lead is never downgraded or followed up');
 -- Duration + one-hour grace is evaluated in the property timezone.
 d:=(now() at time zone 'America/Los_Angeles')-interval '70 minutes';
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status,duration_minutes) values(pending,p,l,d::date,d::time,'confirmed',30);
 perform pg_temp.check(public.record_tour_outcome(p,l,'tour_bookings',pending,'no_show',null,true)->>'state'='not_due','grace starts after end, not start');
 -- Replace this temporary fixture instead of bypassing the schedule change contract.
 delete from public.tour_bookings where id=pending;
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status,duration_minutes) values(pending,p,l,((now() at time zone 'America/Los_Angeles')+interval '1 day')::date,d::time,'confirmed',30);
 perform pg_temp.check(public.record_tour_outcome(p,l,'tour_bookings',pending,'completed')->>'state'='not_due','future completion rejected');
 -- Unknown timezone does not inherit the worker/server timezone.
 insert into public.leads(id,property_id,first_name) values(missing,other_p,'Unknown zone');
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status) values(missing,other_p,missing,((now() at time zone 'UTC')-interval '3 hours')::date,((now() at time zone 'UTC')-interval '3 hours')::time,'scheduled');
 perform pg_temp.check(public.record_tour_outcome(other_p,missing,'tours',missing,'no_show',null,true)->>'state'='needs_timezone','missing timezone requires review');
 perform pg_temp.check((public.list_tour_noshow_candidates()->>'needsTimezone')::int>=1,'candidate summary exposes missing timezone');
 -- A downstream workflow write error must roll back the outcome and all side effects.
 d:=(now() at time zone 'America/Los_Angeles')-interval '4 hours';
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status) values(bad_t,p,l,d::date,d::time,'scheduled');
 update public.workflow_definitions set steps='[{"delay_hours":"broken"}]' where id=w;
 select count(*) into n from public.lead_engagement_events where lead_id=l;
 begin perform public.record_tour_outcome(p,l,'tours',bad_t,'completed');
   raise exception 'FAIL: broken workflow accepted'; exception when invalid_text_representation then null; end;
 perform pg_temp.check((select status='scheduled' from public.tours where id=bad_t),'failed workflow rolls back status');
 perform pg_temp.check((select count(*)=n from public.lead_engagement_events where lead_id=l),'failed workflow rolls back engagement');
 perform pg_temp.check(not exists(select 1 from public.tour_outcomes where tour_id=bad_t),'failed workflow leaves no false receipt');
 update public.workflow_definitions set steps='[{"delay_hours":4,"action":"email","template_slug":"thanks"}]' where id=w;
 perform pg_temp.check(public.record_tour_outcome(p,l,'tours',bad_t,'completed')->>'state'='applied','repair can safely retry failed outcome');
 perform pg_temp.check((select count(*)=1 from public.lead_workflows where lead_id=l and workflow_id=w),'existing active workflow reused');
 -- Old terminal data gets acknowledged without retroactive sends or scoring.
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status) values(gen_random_uuid(),p,l,d::date,d::time,'completed') returning id into bad_t;
 select count(*) into n from public.lead_engagement_events where lead_id=l;
 perform pg_temp.check(public.record_tour_outcome(p,l,'tours',bad_t,'completed')->>'state'='legacy','legacy completion acknowledged');
 perform pg_temp.check((select count(*)=n from public.lead_engagement_events where lead_id=l),'legacy acknowledgment does not replay effects');

 -- Provider confirmation leases cannot race outcome finalization.
 delete from public.tour_bookings where id=pending;
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status,duration_minutes)values(pending,p,l,d::date,d::time,'confirmed',30);
 insert into public.luma_delivery_jobs(property_id,booking_id,payload,state,lease_token,lease_until)
   values(p,pending,'{}','running',gen_random_uuid(),now()+interval '3 minutes');
 perform pg_temp.check(public.record_tour_outcome(p,l,'tour_bookings',pending,'completed')->>'state'='delivery_busy','live confirmation lease defers outcome');
 perform pg_temp.check((select status='confirmed' from public.tour_bookings where id=pending),'busy confirmation leaves tour unchanged');
 update public.luma_delivery_jobs set lease_until=now()-interval '1 second' where booking_id=pending;
 perform pg_temp.check(public.record_tour_outcome(p,l,'tour_bookings',pending,'completed')->>'state'='delivery_review_required','expired confirmation requires explicit delivery review');
 -- Fixture reconciliation confirms no provider attempt was made, then releases ownership.
 update public.luma_delivery_jobs set state='queued',lease_token=null,lease_until=null where booking_id=pending;
 update public.leads set crm_sync_status='processing',crm_sync_next_retry_at=now()+interval '5 minutes' where id=l;
 perform pg_temp.check(public.record_tour_outcome(p,l,'tour_bookings',pending,'completed')->>'state'='applied','reconciled confirmation can be held and finalized');
 perform pg_temp.check((select state='review' and error_code='tour_finalized' and lease_token is null from public.luma_delivery_jobs where booking_id=pending),'obsolete confirmation cannot send after finalization');
 perform pg_temp.check((select crm_sync_status='processing' and crm_sync_next_retry_at>now() from public.leads where id=l),'active CRM lease preserved');
 -- Property-local time conversion includes DST rather than a fixed offset.
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status) values(gen_random_uuid(),p,l,'2026-01-15','10:00','scheduled') returning id into bad_t;
 perform pg_temp.check((public.tour_outcome_schedule(p,'tours',bad_t)->>'startsAt')::timestamptz='2026-01-15 18:00:00+00','winter offset respected');
 delete from public.tours where id=bad_t;
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status)values(bad_t,p,l,'2026-07-15','10:00','scheduled');
 perform pg_temp.check((public.tour_outcome_schedule(p,'tours',bad_t)->>'startsAt')::timestamptz='2026-07-15 17:00:00+00','summer offset respected');
 -- Both confirmed sources are candidates, with capacity bounded by the request.
 delete from public.tours where id=bad_t;
 insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status)values(bad_t,p,l,d::date,d::time,'scheduled');
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status) values(gen_random_uuid(),p,l,(d-interval '1 hour')::date,(d-interval '1 hour')::time,'confirmed') returning id into late;
 r:=public.list_tour_noshow_candidates(250);
 perform pg_temp.check(exists(select 1 from jsonb_array_elements(r->'tours') x where x->>'id'=bad_t::text),'confirmed manual tour appears in candidates');
 perform pg_temp.check(exists(select 1 from jsonb_array_elements(r->'tours') x where x->>'id'=late::text),'confirmed widget tour appears in candidates');
 perform pg_temp.check(jsonb_array_length(public.list_tour_noshow_candidates(1)->'tours')=1,'worker batch is bounded');
 -- An upcoming tour protects the lead's tour-booked state.
 update public.leads set status='tour_booked' where id=l;
 r:=public.record_tour_outcome(p,l,'tours',bad_t,'no_show',null,true);
 perform pg_temp.check((select status='tour_booked' from public.leads where id=l) and r->'outcome'->>'followup_state'='suppressed','another active tour prevents lead downgrade and no-show follow-up');
 -- Missing configuration remains explicit rather than enabling defaults.
 update public.properties set settings='{"timezone":"UTC"}' where id=other_p;
 r:=public.record_tour_outcome(other_p,missing,'tours',missing,'no_show',null,true);
 perform pg_temp.check(r->'outcome'->>'followup_state'='not_configured','missing workflow setup is reported');
 perform pg_temp.check(not exists(select 1 from public.workflow_definitions where property_id=other_p),'no workflow is enabled implicitly');
 perform pg_temp.check(not has_function_privilege('anon','public.record_tour_outcome(uuid,uuid,text,uuid,text,text,boolean)','EXECUTE')
   and not has_function_privilege('authenticated','public.record_tour_outcome(uuid,uuid,text,uuid,text,text,boolean)','EXECUTE'),'RPC is service-only');
 perform pg_temp.check((select relrowsecurity from pg_class where oid='public.tour_outcomes'::regclass)
   and not has_table_privilege('authenticated','public.tour_outcomes','SELECT'),'receipt table is private with RLS');
end$$;
select count(*) as passed from checks;
ROLLBACK;
