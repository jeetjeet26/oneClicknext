begin;
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin if passed is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture() returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();w uuid:=gen_random_uuid();definition uuid:=gen_random_uuid();template uuid:=gen_random_uuid();begin
 insert into public.properties(id,name,org_id,settings) values(p,'Follow-up SQL fixture','22222222-2222-2222-2222-222222222222','{"timezone":"UTC","tour_booking_url":"https://example.invalid/tours"}');
 insert into public.leads(id,property_id,first_name,email,phone,status)values(l,p,'Followup','followup@example.invalid','+15550000000','new');
 insert into public.follow_up_templates(id,property_id,slug,name,channel,body,subject,is_active)values(template,p,'fixture','Fixture','email','Hi {first_name}','Fixture subject',true);
 insert into public.workflow_definitions(id,property_id,name,trigger_on,steps,exit_conditions,is_active)values(definition,p,'Fixture','lead_created','[{"id":0,"delay_hours":0,"action":"email","template_slug":"fixture"},{"id":1,"delay_hours":24,"action":"wait"}]','["leased","lost"]',true);
 insert into public.lead_workflows(id,lead_id,workflow_id,current_step,status,next_action_at)values(w,l,definition,0,'active',now()-interval '1 minute');
 return jsonb_build_object('p',p,'l',l,'w',w,'definition',definition,'template',template);
end$$;
DO $$
declare f jsonb;p uuid;l uuid;w uuid;d jsonb;delivery uuid;token uuid;oldtoken uuid;actor uuid;request uuid;input jsonb;result jsonb;due timestamptz;i integer;scenario text;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 f:=pg_temp.fixture();p:=(f->>'p')::uuid;l:=(f->>'l')::uuid;w:=(f->>'w')::uuid;
 select next_action_at into due from public.lead_workflows where id=w;
 perform pg_temp.check(public.control_lead_workflow(p,l,w,gen_random_uuid(),'pause')->>'state'='forbidden','control requires organization actor');
 perform pg_temp.check(public.control_lead_workflow(p,gen_random_uuid(),w,actor,'pause')->>'state'='not_found','control requires matching lead');
 d:=public.prepare_workflow_delivery(w);delivery:=(d->>'id')::uuid;token:=(d->>'lease_token')::uuid;
 perform pg_temp.check(d->>'state'='running' and d->>'attempts'='0','claim saves intent before transport');
 perform pg_temp.check(public.prepare_workflow_delivery(w) is null,'overlapping claim cannot send');
 perform pg_temp.check(public.start_workflow_delivery(delivery,gen_random_uuid(),'body','subject','from@example.invalid') is null,'start requires claim token');
 perform pg_temp.check(public.start_workflow_delivery(delivery,token,'body','subject','from@example.invalid')->>'attempts'='1','attempt durably checkpointed');
 perform pg_temp.check(public.start_workflow_delivery(delivery,token,'body','subject','from@example.invalid') is null,'duplicate start denied');
 perform pg_temp.check(public.control_lead_workflow(p,l,w,actor,'pause')->>'state'='applied','pause works with service-authorized boundary');
 perform pg_temp.check((select processing_started_at is not null and next_action_at=due from public.lead_workflows where id=w),'pause preserves in-flight ownership and due time');
 update public.leads set status='leased' where id=l;
 perform pg_temp.check(public.finish_workflow_delivery(delivery,token,'fixture-receipt'),'receipt saved while paused');
 perform pg_temp.check((select status='paused' and current_step=0 and processing_started_at is null from public.lead_workflows where id=w),'receipt does not advance paused workflow');
 perform pg_temp.check((select status='leased' from public.leads where id=l),'receipt cannot overwrite newer lead status');
 perform pg_temp.check((select count(*)=1 from public.workflow_actions where lead_workflow_id=w and external_id='fixture-receipt'),'legacy action evidence saved atomically');
 perform pg_temp.check(public.finish_workflow_delivery(delivery,token,'fixture-receipt'),'lost receipt response safely replays');
 perform pg_temp.check(not public.finish_workflow_delivery(delivery,token,null),'failure cannot replace accepted receipt');
 perform public.control_lead_workflow(p,l,w,actor,'resume');perform public.prepare_workflow_delivery(w);
 perform pg_temp.check((select status='converted' from public.lead_workflows where id=w),'resume reconciles receipt and respects lead exit without sending');
 perform pg_temp.check((select count(*)=1 from public.workflow_actions where lead_workflow_id=w),'recovery never duplicates action');
 -- Unknown provider outcomes require evidence; bounded retry retains content and sender.
 f:=pg_temp.fixture();p:=(f->>'p')::uuid;l:=(f->>'l')::uuid;w:=(f->>'w')::uuid;
 d:=public.prepare_workflow_delivery(w);delivery:=(d->>'id')::uuid;token:=(d->>'lease_token')::uuid;
 perform public.start_workflow_delivery(delivery,token,'body','subject','from@example.invalid');
 perform pg_temp.check(public.review_workflow_delivery(p,l,delivery,actor,gen_random_uuid(),'{"resolution":"accepted","providerId":"r","reason":"fixture"}')->>'state'='busy','review cannot overtake active send');
 perform public.finish_workflow_delivery(delivery,token,null);
 perform pg_temp.check(public.prepare_workflow_delivery(w)->>'state'='review','uncertain provider outcome never automatically retries');
 perform pg_temp.check((select processing_started_at is not null from public.lead_workflows where id=w),'uncertain send retains legacy correction fence');
 update public.workflow_deliveries set lease_until=now()-interval '1 second' where workflow_deliveries.id=delivery;
 request:=gen_random_uuid();input:='{"resolution":"not_sent","reason":"Fixture provider confirms no acceptance"}';
 perform pg_temp.check(public.review_workflow_delivery(p,l,delivery,gen_random_uuid(),request,input)->>'state'='forbidden','review actor must belong to property');
 perform pg_temp.check(public.review_workflow_delivery(p,gen_random_uuid(),delivery,actor,request,input)->>'state'='not_found','review must match lead');
 result:=public.review_workflow_delivery(p,l,delivery,actor,request,input);
 perform pg_temp.check(result->>'deliveryState'='queued','verified unsent current delivery can requeue');
 perform pg_temp.check(public.review_workflow_delivery(p,l,delivery,actor,request,input)->>'state'='replayed','lost review acknowledgement replays same request');
 perform pg_temp.check(public.review_workflow_delivery(p,l,delivery,actor,request,input||'{"reason":"Changed"}')->>'state'='request_conflict','altered review identity rejected');
 perform pg_temp.check(not public.finish_workflow_delivery(delivery,token,'late-worker'),'review fences old sender');
 d:=public.prepare_workflow_delivery(w);token:=(d->>'lease_token')::uuid;
 perform pg_temp.check(public.start_workflow_delivery(delivery,token,'altered','subject','from@example.invalid') is null,'retry cannot change pinned content');
 perform pg_temp.check((select state='review' and attempts=1 from public.workflow_deliveries x where x.id=delivery),'changed retry did not cross provider boundary');
 perform public.review_workflow_delivery(p,l,delivery,actor,gen_random_uuid(),input);
 for i in 2..3 loop
  d:=public.prepare_workflow_delivery(w);token:=(d->>'lease_token')::uuid;
  perform pg_temp.check((public.start_workflow_delivery(delivery,token,'body','subject','from@example.invalid')->>'attempts')::integer=i,'reviewed retry attempt '||i);
  perform public.finish_workflow_delivery(delivery,token,null);
  update public.workflow_deliveries x set lease_until=now()-interval '1 second' where x.id=delivery;
  result:=public.review_workflow_delivery(p,l,delivery,actor,gen_random_uuid(),input);
 end loop;
 perform pg_temp.check(result->>'deliveryState'='skipped','third unaccepted attempt stops sequence');
 perform pg_temp.check((select status='stopped' from public.lead_workflows where id=w),'retry limit cannot advance into next automated step');
 -- Expired claims with no attempted transport can recover; attempted claims cannot.
 foreach scenario in array array['unattempted','attempted','backlog','legacy','recipient','template','definition','wait','missing','stop'] loop
  f:=pg_temp.fixture();p:=(f->>'p')::uuid;l:=(f->>'l')::uuid;w:=(f->>'w')::uuid;
  if scenario='backlog' then update public.lead_workflows set next_action_at=now()-interval '24 hours' where id=w;end if;
  if scenario='legacy' then insert into public.workflow_actions(lead_workflow_id,step_number,action_type,status)values(w,0,'email','failed');end if;
  if scenario='wait' then update public.workflow_definitions set steps='[{"id":0,"delay_hours":0,"action":"wait"}]' where id=(f->>'definition')::uuid;end if;
  if scenario='missing' then update public.leads set email=null where id=l;end if;
  d:=public.prepare_workflow_delivery(w);delivery:=(d->>'id')::uuid;token:=(d->>'lease_token')::uuid;oldtoken:=token;
  if scenario in ('backlog','legacy','missing') then
   perform pg_temp.check(d->>'state'='review',scenario||' is held');
   if scenario='legacy' then
    perform pg_temp.check((select processing_started_at is not null from public.lead_workflows where id=w),'legacy uncertainty blocks correction');
    result:=public.review_workflow_delivery(p,l,delivery,actor,gen_random_uuid(),input);
    perform pg_temp.check(result->>'deliveryState'='skipped','known unsent legacy cannot replay automatically');
   end if;continue;
  end if;
  if scenario='wait' then perform pg_temp.check((select status='completed' from public.lead_workflows where id=w),'wait step completes without requiring template or provider');continue;end if;
  if scenario='recipient' then update public.leads set email='different@example.invalid' where id=l;end if;
  if scenario='template' then update public.follow_up_templates set body='Changed' where id=(f->>'template')::uuid;end if;
  if scenario='definition' then update public.workflow_definitions set is_active=false where id=(f->>'definition')::uuid;end if;
  if scenario='stop' then perform public.control_lead_workflow(p,l,w,actor,'stop');end if;
  if scenario in ('recipient','template','definition','stop') then
   perform pg_temp.check(public.start_workflow_delivery(delivery,token,'body','subject','from@example.invalid') is null,scenario||' change before send is held');continue;
  end if;
  if scenario='attempted' then perform public.start_workflow_delivery(delivery,token,'body','subject','from@example.invalid');end if;
  update public.workflow_deliveries x set lease_until=now()-interval '1 minute' where x.id=delivery;
  d:=public.prepare_workflow_delivery(w);
  perform pg_temp.check(d->>'state'=case scenario when 'attempted' then 'review' else 'running' end,scenario||' expiry classified safely');
  if scenario='attempted' then
   perform pg_temp.check(public.review_workflow_delivery(p,l,delivery,actor,gen_random_uuid(),'{"resolution":"skip","reason":"fixture"}')->>'state'='evidence_required','uncertainty cannot be skipped without provider evidence');
   result:=public.review_workflow_delivery(p,l,delivery,actor,gen_random_uuid(),'{"resolution":"accepted","providerId":"reconciled","reason":"fixture receipt"}');
   perform pg_temp.check(result->>'deliveryState'='accepted','late acceptance reconciled');
   perform pg_temp.check((select current_step=1 from public.lead_workflows where id=w),'reconciled acceptance advances once');
   perform pg_temp.check(not public.finish_workflow_delivery(delivery,oldtoken,'stale'),'reconciled receipt fences old attempt');
  else perform pg_temp.check(d->>'lease_token'<>oldtoken::text,'unattempted recovery rotates claim token');end if;
 end loop;
 perform pg_temp.check(not public.valid_followup_steps('[{"action":"email","delay_hours":-1}]'),'negative wait rejected');
 perform pg_temp.check(not public.valid_followup_steps('{}'),'malformed steps rejected');
 perform pg_temp.check(not has_table_privilege('authenticated','public.workflow_deliveries','select'),'private ledger not exposed to client role');
 perform pg_temp.check(not has_function_privilege('authenticated','public.review_workflow_delivery(uuid,uuid,uuid,uuid,uuid,jsonb)','execute'),'review RPC is service-only');
end$$;
select count(*) as assertions from checks;
rollback;
