BEGIN;
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin
 if passed is not true then raise exception 'FAIL: %',label; end if;
 insert into checks values(label);
end$$;
DO $$
declare p uuid:=gen_random_uuid(); other_p uuid:=gen_random_uuid(); actor uuid;
 l uuid; t uuid; request_id uuid; correction_id uuid; no_show_w uuid:=gen_random_uuid(); completed_w uuid:=gen_random_uuid();
 unrelated_w uuid:=gen_random_uuid(); live_workflow uuid; old_receipt uuid; original_event uuid; other_event uuid;
 source text; r jsonb; replay jsonb; old_score integer; manual_score integer; widget_score integer; n integer;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 if actor is null then raise exception 'Local fixture operator is required'; end if;
 insert into public.properties(id,name,org_id,settings) values(p,'Tour correction contract','22222222-2222-2222-2222-222222222222','{"timezone":"UTC"}'),
   (other_p,'Tour correction forbidden',null,'{"timezone":"UTC"}');
 insert into public.workflow_definitions(id,property_id,name,trigger_on,steps,exit_conditions) values
 (no_show_w,p,'No-show fixture','tour_no_show','[{"delay_hours":24,"action":"email","template_slug":"missed"}]','["leased","lost"]'),
 (completed_w,p,'Completed fixture','tour_completed','[{"delay_hours":24,"action":"email","template_slug":"thanks"}]','["leased","lost"]'),
 (unrelated_w,p,'Other fixture','lead_created','[{"delay_hours":24,"action":"email","template_slug":"welcome"}]','["leased","lost"]');
 foreach source in array array['tours','tour_bookings'] loop
   l:=gen_random_uuid();t:=gen_random_uuid();request_id:=gen_random_uuid();other_event:=gen_random_uuid();
   insert into public.leads(id,property_id,first_name,last_name,source,status) values(l,p,'Correction','Fixture','manual','tour_booked');
   if source='tours' then insert into public.tours(id,lead_id,property_id,tour_date,tour_time,status) values(t,l,p,((now() at time zone 'UTC')-interval '3 hours')::date,((now() at time zone 'UTC')-interval '3 hours')::time,'confirmed');
   else insert into public.tour_bookings(id,lead_id,property_id,scheduled_date,scheduled_time,status) values(t,l,p,((now() at time zone 'UTC')-interval '3 hours')::date,((now() at time zone 'UTC')-interval '3 hours')::time,'confirmed'); end if;
   r:=public.record_tour_outcome(p,l,source,t,'no_show','Original no-show',true);
   old_receipt:=(r->'outcome'->>'id')::uuid;
   perform pg_temp.check(r->>'state'='applied',source||': no-show fixture recorded');
   select id into original_event from public.lead_engagement_events where lead_id=l;
   select id into live_workflow from public.lead_workflows where lead_id=l and workflow_id=no_show_w;
   insert into public.lead_workflows(lead_id,workflow_id,status,current_step,next_action_at) values(l,unrelated_w,'active',0,now()+interval '1 day');
   insert into public.lead_engagement_events(id,property_id,lead_id,event_type,score_weight,metadata) values(other_event,p,l,'tour_no_show',-25,jsonb_build_object('tour_id',gen_random_uuid()));
   select total_score into old_score from public.lead_scores where lead_id=l order by scored_at desc,id limit 1;
   r:=public.correct_tour_no_show(p,l,source,t,request_id,actor,'Agent confirmed attendance');
   correction_id:=(r->'correction'->>'id')::uuid;
   perform pg_temp.check(r->>'state'='applied',source||': correction applies');
   perform pg_temp.check(r->'outcome'->>'outcome'='completed' and r->'outcome'->>'notes'='Agent confirmed attendance',source||': completion receipt saved');
   perform pg_temp.check((select status='toured' from public.leads where id=l),source||': lead is toured');
   perform pg_temp.check((select score_weight=0 and metadata->>'previous_score_weight'='-25' from public.lead_engagement_events where id=original_event),source||': original penalty reversed with evidence');
   perform pg_temp.check((select score_weight=-25 from public.lead_engagement_events where id=other_event),source||': unrelated penalty retained');
   perform pg_temp.check((select count(*)=1 and max(score_weight)=35 from public.lead_engagement_events where lead_id=l and event_type='tour_completed'),source||': one completion event');
   perform pg_temp.check((select status='stopped' and next_action_at is null from public.lead_workflows where id=live_workflow),source||': no-show follow-up stopped');
   perform pg_temp.check((select status='active' from public.lead_workflows where lead_id=l and workflow_id=unrelated_w),source||': other workflow retained');
   perform pg_temp.check((select count(*)=1 from public.lead_workflows where lead_id=l and workflow_id=completed_w),source||': completion follow-up queued once');
   perform pg_temp.check((select previous_outcome->>'id'=old_receipt::text and previous_outcome->>'notes'='Original no-show'
      and jsonb_array_length(previous_events)=1 and actor_id=actor from public.tour_outcome_corrections where id=correction_id),source||': immutable audit preserves original and actor');
   perform pg_temp.check((select count(*)=1 from public.lead_activities where lead_id=l and type='tour_outcome_corrected' and created_by=actor),source||': operator activity recorded');
   perform pg_temp.check(r->'correction'->>'previousDelivery'='none',source||': unattempted delivery is not reported sent');
   select count(*) into n from public.lead_scores where lead_id=l;
   replay:=public.correct_tour_no_show(p,l,source,t,request_id,actor,'Agent confirmed attendance');
   perform pg_temp.check(replay->>'state'='replayed' and replay->'correction'=r->'correction',source||': same request replays');
   perform pg_temp.check((select count(*)=n from public.lead_scores where lead_id=l),source||': replay does not score again');
   perform pg_temp.check(public.correct_tour_no_show(p,l,source,t,request_id,actor,'Changed reason')->>'state'='request_conflict',source||': changed request rejected');
   perform pg_temp.check(public.correct_tour_no_show(p,l,source,t,gen_random_uuid(),actor,'Another correction')->>'state'='conflict',source||': duplicate correction rejected');
   update public.leads set status='leased' where id=l;
   perform pg_temp.check(public.correct_tour_no_show(p,l,source,t,request_id,actor,'Agent confirmed attendance')->>'leadStatus'='leased',source||': replay returns current lead status');
   begin update public.tour_outcome_corrections set reason='overwrite' where id=correction_id; raise exception 'FAIL: audit changed';
     exception when sqlstate '55000' then insert into checks values(source||': audit cannot be overwritten'); end;
   begin delete from public.tour_outcome_corrections where id=correction_id; raise exception 'FAIL: audit deleted';
     exception when sqlstate '55000' then insert into checks values(source||': audit cannot be deleted directly'); end;
 end loop;
 -- An invalid follow-up rolls back the entire correction, including stopped work and reversed scores.
 l:=gen_random_uuid();t:=gen_random_uuid();request_id:=gen_random_uuid();
 insert into public.leads(id,property_id,first_name,status) values(l,p,'Rollback fixture','tour_booked');
 insert into public.tours(id,lead_id,property_id,tour_date,tour_time,status) values(t,l,p,((now() at time zone 'UTC')-interval '3 hours')::date,((now() at time zone 'UTC')-interval '3 hours')::time,'confirmed');
 perform public.record_tour_outcome(p,l,'tours',t,'no_show',null,true);
 select id into live_workflow from public.lead_workflows where lead_id=l and workflow_id=no_show_w;
 update public.workflow_definitions set steps='[{"delay_hours":"invalid"}]' where id=completed_w;
 begin perform public.correct_tour_no_show(p,l,'tours',t,request_id,actor,'Attended');raise exception 'FAIL: broken completion accepted';
   exception when invalid_text_representation then null;end;
 perform pg_temp.check((select status='no_show' from public.tours where id=t),'failed completion rolls back tour');
 perform pg_temp.check((select status='active' from public.lead_workflows where id=live_workflow),'failed completion restores queued no-show');
 perform pg_temp.check((select count(*)=1 and max(score_weight)=-25 from public.lead_engagement_events where lead_id=l),'failed completion restores penalty');
 perform pg_temp.check(not exists(select 1 from public.tour_outcome_corrections where tour_id=t),'failure leaves no false audit success');
 update public.workflow_definitions set steps='[{"delay_hours":24,"action":"email","template_slug":"thanks"}]' where id=completed_w;
 -- Stopping a workflow must retain the lease; even a stopped in-flight send blocks correction.
 update public.lead_workflows set status='stopped',processing_started_at=now(),processing_expires_at=now()+interval '1 minute' where id=live_workflow;
 perform pg_temp.check(public.correct_tour_no_show(p,l,'tours',t,request_id,actor,'Attended')->>'state'='delivery_busy','stopped but live send defers correction');
 update public.lead_workflows set processing_expires_at=now()-interval '1 minute' where id=live_workflow;
 perform pg_temp.check(public.correct_tour_no_show(p,l,'tours',t,request_id,actor,'Attended')->>'state'='delivery_review_required','expired lease requires delivery review');
 perform pg_temp.check((select status='no_show' from public.tours where id=t),'deferred correction makes no changes');
 update public.lead_workflows set processing_started_at=null,processing_expires_at=null,status='paused' where id=live_workflow;
 insert into public.workflow_actions(lead_workflow_id,step_number,action_type,status,external_id) values(live_workflow,0,'email','sent','provider-fixture');
 r:=public.correct_tour_no_show(p,l,'tours',t,request_id,actor,'Attended');
 perform pg_temp.check(r->>'state'='applied' and r->'correction'->>'previousDelivery'='sent','retry succeeds and discloses earlier accepted message');
 perform pg_temp.check((select status='stopped' from public.lead_workflows where id=live_workflow),'paused follow-up is stopped');
 -- Tenant and lead scope checks precede mutation.
 perform pg_temp.check(public.correct_tour_no_show(other_p,l,'tours',t,gen_random_uuid(),actor,'Wrong community')->>'state'='forbidden','cross-tenant correction rejected');
 perform pg_temp.check(public.correct_tour_no_show(p,gen_random_uuid(),'tours',t,gen_random_uuid(),actor,'Wrong lead')->>'state'='not_found','wrong lead rejected');
 -- Historical no-show: retain ambiguity about old sends, reverse attributable events.
 l:=gen_random_uuid();t:=gen_random_uuid();request_id:=gen_random_uuid();
 insert into public.leads(id,property_id,first_name,status,crm_sync_status,crm_sync_next_retry_at) values(l,p,'Legacy fixture','leased','processing',now()+interval '5 minutes');
 insert into public.tour_bookings(id,lead_id,property_id,scheduled_date,scheduled_time,status) values(t,l,p,current_date-1,'10:00','no_show');
 insert into public.lead_engagement_events(lead_id,property_id,event_type,score_weight,metadata) values(l,p,'tour_no_show',-25,jsonb_build_object('tour_id',t));
 r:=public.correct_tour_no_show(p,l,'tour_bookings',t,request_id,actor,'Confirmed with agent');
 perform pg_temp.check(r->>'state'='applied' and r->'correction'->>'previousDelivery'='unknown','legacy delivery stays unconfirmed');
 perform pg_temp.check(r->>'leadStatus'='leased' and r->'outcome'->>'followup_state'='suppressed','leased status and suppression preserved');
 perform pg_temp.check((select crm_sync_status='processing' and crm_sync_next_retry_at>now() from public.leads where id=l),'CRM lease preserved');
 perform pg_temp.check((select sum(score_weight)=35 from public.lead_engagement_events where lead_id=l),'legacy penalty reversed before completion score');
 -- Equal completed visits have equal behavior factors for both sources.
 foreach source in array array['tours','tour_bookings'] loop
   l:=gen_random_uuid();t:=gen_random_uuid();
   insert into public.leads(id,property_id,first_name,source,status) values(l,p,'Parity','manual','toured');
   if source='tours' then insert into public.tours(id,lead_id,property_id,tour_date,tour_time,status) values(t,l,p,current_date-1,'10:00','completed');
   else insert into public.tour_bookings(id,lead_id,property_id,scheduled_date,scheduled_time,status) values(t,l,p,current_date-1,'10:00','completed');end if;
   perform public.score_lead(l);
   if source='tours' then select total_score into manual_score from public.lead_scores where lead_id=l;
   else select total_score into widget_score from public.lead_scores where lead_id=l;end if;
   perform pg_temp.check((select behavior_score=10 and model_version='rules-v3.0-evidence' from public.lead_scores where lead_id=l),source||': completion behavior factor correct');
 end loop;
 perform pg_temp.check(manual_score=widget_score,'manual and widget scoring parity');
 perform pg_temp.check(not has_function_privilege('anon','public.correct_tour_no_show(uuid,uuid,text,uuid,uuid,uuid,text)','execute')
    and not has_function_privilege('authenticated','public.correct_tour_no_show(uuid,uuid,text,uuid,uuid,uuid,text)','execute'),'correction RPC service-only');
 perform pg_temp.check(not has_table_privilege('authenticated','public.tour_outcome_corrections','select')
    and (select relrowsecurity from pg_class where oid='public.tour_outcome_corrections'::regclass),'correction history private with RLS');
end$$;
select count(*) as passed from checks;
ROLLBACK;
