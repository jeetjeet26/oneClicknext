begin;
create temp table assertions(label text);
create function pg_temp.check_it(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;insert into assertions values(label);end$$;
create function pg_temp.fixture(step_count integer default 1,write_limit integer default 2)returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();lead uuid:=gen_random_uuid();alert uuid:=gen_random_uuid();draft uuid:=gen_random_uuid();plan uuid:=gen_random_uuid();actor uuid:='11111111-1111-1111-1111-111111111111';org uuid:='22222222-2222-2222-2222-222222222222';body jsonb;steps jsonb;r jsonb;
begin
 insert into public.properties(id,org_id,name)values(p,org,'Agency execution rollback fixture');
 insert into public.leads(id,property_id,first_name,last_name,status)values(lead,p,'Disposable','Rehearsal','new');
 r:=public.create_marketvision_alert(alert,p,actor,'{"title":"Disposable alert","description":"Synthetic local report","severity":"warning","competitorId":null,"reason":"Local qualification fixture"}');
 perform pg_temp.check_it(r->>'state'='saved','native alert created');
 body:=jsonb_build_object('operation','save','product','tourspark','previousId',null,'sourceHash',public.agency_observation_evidence(p,org,'tourspark')->>'sourceHash','status','draft','reason','Qualify a bounded local plan','plan',jsonb_build_object('goal','Review a disposable lead and reported alert','successMeasure','Native effects and reversals match the exact authorized targets','steps',jsonb_build_array(jsonb_build_object('action','inspect_work','detail','Inspect these disposable records'))));
 r:=public.save_agency_plan(draft,p,actor,body);perform pg_temp.check_it(r->>'state'='saved','plan draft saved');
 r:=public.save_agency_plan(plan,p,actor,body||jsonb_build_object('previousId',draft,'status','reviewed'));perform pg_temp.check_it(r->>'state'='saved','exact plan reviewed');
 perform public.register_agency_rehearsal(p,org,jsonb_build_array(jsonb_build_object('action','lead.note.add','targetId',lead),jsonb_build_object('action','market.alert.dismiss','targetId',alert)),write_limit);
 steps:=jsonb_build_array(jsonb_build_object('action','lead.note.add','targetId',lead,'sourceHash',public.agency_execution_source(p,org,'lead.note.add',lead),'content','Private disposable follow-up note'));
 if step_count=2 then steps:=steps||jsonb_build_array(jsonb_build_object('action','market.alert.dismiss','targetId',alert,'sourceHash',public.agency_execution_source(p,org,'market.alert.dismiss',alert)));end if;
 return jsonb_build_object('property',p,'lead',lead,'alert',alert,'plan',plan,'input',jsonb_build_object('operation','prepare','planRevision',plan,'steps',steps,'reason','Authorize only these local targets'));
end$$;
create function pg_temp.prepare(f jsonb,i uuid default gen_random_uuid())returns jsonb language sql as $$select public.operate_agency_execution(i,(f->>'property')::uuid,'11111111-1111-1111-1111-111111111111',f->'input')$$;
create function pg_temp.command(f jsonb,r jsonb,op text,i uuid default gen_random_uuid())returns jsonb language sql as $$select public.operate_agency_execution(i,(f->>'property')::uuid,'11111111-1111-1111-1111-111111111111',jsonb_build_object('operation',op,'runId',r->'record'->'result'->>'runId','expectedVersion',(r->'record'->'result'->>'version')::integer,'specHash',(select spec_hash from public.agency_execution_runs where id=(r->'record'->'result'->>'runId')::uuid),'reason','Local qualification command'))$$;
create function pg_temp.fail_event()returns trigger language plpgsql as $$begin if new.action=current_setting('p11.fixture.failure',true)then raise exception 'Injected agency recording failure';end if;return new;end$$;
create trigger agency_fixture_recording_failure before insert on public.shared_action_events for each row execute function pg_temp.fail_event();
-- First qualify one actual native effect and its compensating action.
do $$declare f jsonb:=pg_temp.fixture();r jsonb;before jsonb;i uuid:=gen_random_uuid();undo uuid;begin
 r:=pg_temp.prepare(f,i);perform pg_temp.check_it(r->'record'->'result'->>'status'='prepared','preparation reserves no effect');
 perform pg_temp.check_it(not exists(select 1 from public.lead_note_records where property_id=(f->>'property')::uuid),'no native note before authorization');
 perform pg_temp.check_it(pg_temp.prepare(f,i)->>'state'='replayed','prepared lost response recovered');
 perform pg_temp.check_it(pg_temp.command(f,r,'advance')->>'state'='state_changed','reviewed plan cannot execute before separate authorization');
 r:=pg_temp.command(f,r,'authorize');perform pg_temp.check_it(r->'record'->'result'->>'status'='authorized','exact spec authorized');before:=r;
 r:=pg_temp.command(f,r,'advance',gen_random_uuid());
 perform pg_temp.check_it(r->'record'->'result'->>'status'='completed'and r->'record'->'result'->'nativeEffect'='true','single native effect completed');
 perform pg_temp.check_it((select count(*)=1 from public.lead_note_records where property_id=(f->>'property')::uuid and state='active'),'actual note exists once');
 perform pg_temp.check_it(pg_temp.command(f,before,'advance',(r->>'decisionId')::uuid)->>'state'='replayed','lost effect reply replays without duplicate native effect');
 perform pg_temp.check_it((select count(*)=1 from public.lead_note_records where property_id=(f->>'property')::uuid),'one note after retry');
 perform pg_temp.check_it((select result->>'actorKind'='system'and not training_eligible from public.shared_action_events where id=(r->>'decisionId')::uuid),'system effect is explicitly distinguished from human authorization');
 perform pg_temp.check_it(public.read_agency_execution((f->>'property')::uuid,'11111111-1111-1111-1111-111111111111',jsonb_build_object('kind','decision','decisionId',r->>'decisionId'))->>'state'='ready','exact command receipt recoverable');
 r:=pg_temp.command(f,r,'reverse');perform pg_temp.check_it(r->'record'->'result'->>'status'='reversed','single effect compensated');
 perform pg_temp.check_it((select state='withdrawn'from public.lead_note_records where property_id=(f->>'property')::uuid),'native note withdrawal confirmed');
 perform pg_temp.check_it((select used_actions=1 and used_reversals=1 from public.agency_execution_scopes where property_id=(f->>'property')::uuid),'compensation does not replenish effect budget');
 perform pg_temp.check_it(r->'record'->'result'->>'businessOutcome'='unmeasured'and r->'record'->'result'->>'providerCalls'='0','technical completion creates no business reward');
end$$;
-- Then a two-product sequence, pause, resumed progress, and reverse ordering.
do $$declare f jsonb:=pg_temp.fixture(2);r jsonb;begin
 r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');r:=pg_temp.command(f,r,'advance');
 perform pg_temp.check_it(r->'record'->'result'->>'status'='running'and r->'record'->'result'->>'ordinal'='0','first product completes before the second');
 r:=pg_temp.command(f,r,'pause');perform pg_temp.check_it(pg_temp.command(f,r,'advance')->>'state'='state_changed','pause prevents next effect');
 r:=pg_temp.command(f,r,'resume');r:=pg_temp.command(f,r,'advance');
 perform pg_temp.check_it(r->'record'->'result'->>'status'='completed'and(select is_dismissed from public.market_alerts where id=(f->>'alert')::uuid),'second product effect confirmed');
 r:=pg_temp.command(f,r,'reverse');perform pg_temp.check_it(r->'record'->'result'->>'ordinal'='1'and not(select is_dismissed from public.market_alerts where id=(f->>'alert')::uuid),'last effect reversed first');
 r:=pg_temp.command(f,r,'reverse');perform pg_temp.check_it(r->'record'->'result'->>'status'='reversed'and r->'record'->'result'->>'ordinal'='0','first effect reversed last');
 perform pg_temp.check_it((select used_actions=2 and used_reversals=2 from public.agency_execution_scopes where property_id=(f->>'property')::uuid),'exact effect and inverse counts');
 perform pg_temp.check_it(not exists(select 1 from public.shared_jobs where property_id=(f->>'property')::uuid),'cross-product sequence creates no outbound jobs');
end$$;
-- Durable cancellation, stale identity, immutable authority, strict commands and boundaries.
do $$declare f jsonb:=pg_temp.fixture();r jsonb;i uuid:=gen_random_uuid();p uuid:=(f->>'property')::uuid;body jsonb;begin
 r:=public.operate_agency_execution(i,p,'11111111-1111-1111-1111-111111111111',jsonb_build_object('operation','cancel_unused','inputHash',repeat('a',64)));
 perform pg_temp.check_it(r->>'state'='saved'and pg_temp.prepare(f,i)->>'state'='decision_cancelled','closed request fences late prepare');
 r:=pg_temp.prepare(f);i:=(r->>'decisionId')::uuid;
 perform pg_temp.check_it(public.operate_agency_execution(i,p,'11111111-1111-1111-1111-111111111111',jsonb_build_object('operation','cancel_unused','inputHash',repeat('a',64)))->'record'->'input'->>'operation'='prepare','cancel recovers a committed command');
 perform pg_temp.check_it(pg_temp.prepare(jsonb_set(f,'{input,reason}','"Changed reason"'),i)->>'state'='request_conflict','same request identity cannot change input');
 perform pg_temp.check_it(pg_temp.prepare(jsonb_set(f,'{input,steps,0,action}','"email.send"'))->>'state'='invalid','unapproved action denied');
 perform pg_temp.check_it(pg_temp.prepare(jsonb_set(f,'{input,steps,0,targetId}',to_jsonb(gen_random_uuid())))->>'state'='target_denied','out of scope target denied');
 perform pg_temp.check_it(pg_temp.prepare(jsonb_set(f,'{input,steps,0,sourceHash}',to_jsonb(repeat('a',64))))->>'state'='source_changed','forged source rejected');
 perform pg_temp.check_it(pg_temp.prepare(jsonb_set(f,'{input,steps,0,executeNow}','true'))->>'state'='invalid','model cannot add authority');
 perform pg_temp.check_it(public.read_agency_execution(p,gen_random_uuid(),'{}')->>'state'='forbidden','read current membership required');
 perform pg_temp.check_it(public.operate_agency_execution(gen_random_uuid(),p,gen_random_uuid(),f->'input')->>'state'='forbidden','write current manager required');
 body:=jsonb_build_object('operation','authorize','runId',i,'expectedVersion',1.5,'specHash',(select spec_hash from public.agency_execution_runs where id=i),'reason','Invalid fractional version');
 perform pg_temp.check_it(public.operate_agency_execution(gen_random_uuid(),p,'11111111-1111-1111-1111-111111111111',body)->>'state'='invalid','fractional versions rejected');
 perform pg_temp.check_it(public.operate_agency_execution(gen_random_uuid(),p,'11111111-1111-1111-1111-111111111111',jsonb_set(body,'{expectedVersion}','2'))->>'state'='run_changed','stale version rejected');
 begin update public.agency_execution_runs set spec='{}'where id=i;raise exception 'MISSING spec guard';exception when sqlstate'55000'then perform pg_temp.check_it(true,'authorized spec immutable');end;
 begin update public.agency_execution_steps set target_id=gen_random_uuid()where run_id=i;raise exception 'MISSING target guard';exception when sqlstate'55000'then perform pg_temp.check_it(true,'authorized targets immutable');end;
 begin update public.agency_execution_commands set input='{}'where id=i;raise exception 'MISSING history guard';exception when sqlstate'55000'then perform pg_temp.check_it(true,'command history immutable');end;
 perform pg_temp.check_it(not has_function_privilege('service_role','public.register_agency_rehearsal(uuid,uuid,jsonb,integer)','EXECUTE')and not has_table_privilege('service_role','public.agency_execution_scopes','INSERT'),'application cannot register an execution scope');
 perform pg_temp.check_it(not has_column_privilege('service_role','public.agency_execution_scopes','allowed_targets','UPDATE'),'application cannot expand target scope');
 perform pg_temp.check_it(not has_function_privilege('authenticated','public.operate_agency_execution(uuid,uuid,uuid,jsonb)','EXECUTE')and not has_table_privilege('anon','public.agency_execution_runs','SELECT'),'no browser direct execution access');
end$$;
-- Limits, stale sources, expiry, stop and safe attention on human edits.
do $$declare f jsonb;r jsonb;body jsonb;p uuid;i uuid;begin
 f:=pg_temp.fixture(2,1);r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');r:=pg_temp.command(f,r,'advance');r:=pg_temp.command(f,r,'advance');
 perform pg_temp.check_it(r->'record'->'result'->>'issue'='budget_exhausted'and not(select is_dismissed from public.market_alerts where id=(f->>'alert')::uuid),'global scope write limit stops second action');
 r:=pg_temp.command(f,r,'reverse');perform pg_temp.check_it(r->'record'->'result'->>'status'='reversed','budget exhaustion does not block safe undo');
 f:=pg_temp.fixture();r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');update public.leads set first_name='Edited by person'where id=(f->>'lead')::uuid;
 r:=pg_temp.command(f,r,'advance');perform pg_temp.check_it(r->'record'->'result'->>'issue'='source_changed'and not exists(select 1 from public.lead_note_records where property_id=(f->>'property')::uuid),'source edit after authorization stops effects');
 f:=pg_temp.fixture();r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');update public.agency_execution_scopes set expires_at=clock_timestamp()-interval'1 second'where property_id=(f->>'property')::uuid;
 r:=pg_temp.command(f,r,'advance');perform pg_temp.check_it(r->'record'->'result'->>'issue'='scope_expired','expired scope stops effects');
 f:=pg_temp.fixture();r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');r:=pg_temp.command(f,r,'stop');perform pg_temp.check_it(pg_temp.command(f,r,'advance')->>'state'='state_changed','stop persists across later commands');
 f:=pg_temp.fixture(2);r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');r:=pg_temp.command(f,r,'advance');r:=pg_temp.command(f,r,'advance');
 perform public.review_marketvision_alerts(gen_random_uuid(),(f->>'property')::uuid,'11111111-1111-1111-1111-111111111111',jsonb_build_object('action','restore','alerts',jsonb_build_array(jsonb_build_object('id',f->>'alert','expectedVersion',2)),'reason','Person reviewed after execution'));
 r:=pg_temp.command(f,r,'reverse');perform pg_temp.check_it(r->'record'->'result'->>'issue'='compensation_conflict'and(select not is_dismissed from public.market_alerts where id=(f->>'alert')::uuid),'undo preserves intervening human work');
 perform pg_temp.check_it((select count(*)=1 from public.lead_note_records where property_id=(f->>'property')::uuid and state='active'),'conflicting final step does not silently skip to earlier undo');
end$$;
-- Source-plan revision and role changes invalidate outstanding authority.
do $$declare f jsonb:=pg_temp.fixture();r jsonb;body jsonb;begin
 r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');
 -- Plans store the goal separately from the exact command; build the next draft explicitly.
 select jsonb_build_object('operation','save','product',product,'previousId',id,'sourceHash',public.agency_observation_evidence(property_id,org_id,product)->>'sourceHash','status','draft','reason','Person changed the plan','plan',plan)into body from public.agency_plan_revisions where id=(f->>'plan')::uuid;
 perform public.save_agency_plan(gen_random_uuid(),(f->>'property')::uuid,'11111111-1111-1111-1111-111111111111',body);
 r:=pg_temp.command(f,r,'advance');perform pg_temp.check_it(r->'record'->'result'->>'issue'='plan_changed','new plan revision requires new authority');
 f:=pg_temp.fixture();r:=pg_temp.prepare(f);update public.profiles set role='viewer'where id='11111111-1111-1111-1111-111111111111';
 perform pg_temp.check_it(pg_temp.command(f,r,'authorize')->>'state'='forbidden','role loss prevents authorization and recovery writes');
 update public.profiles set role='admin'where id='11111111-1111-1111-1111-111111111111';
end$$;
-- An agency recording failure rolls back native effect, receipt and budget together.
do $$declare f jsonb:=pg_temp.fixture();r jsonb;command_id uuid:=gen_random_uuid();begin
 r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');perform set_config('p11.fixture.failure','agency.execution.advanced',true);
 begin perform pg_temp.command(f,r,'advance',command_id);raise exception 'MISSING atomic failure'using errcode='P0002';exception when sqlstate'P0001'then perform pg_temp.check_it(sqlerrm='Injected agency recording failure','recording failure surfaced');end;
 perform set_config('p11.fixture.failure','',true);
 perform pg_temp.check_it(not exists(select 1 from public.lead_note_records where property_id=(f->>'property')::uuid)and not exists(select 1 from public.agency_execution_commands where id=command_id),'unrecorded effect and receipt rolled back');
 perform pg_temp.check_it((select used_actions=0 from public.agency_execution_scopes where property_id=(f->>'property')::uuid),'budget rolls back with recording failure');
 r:=pg_temp.command(f,r,'advance',command_id);perform pg_temp.check_it(r->'record'->'result'->>'status'='completed','same identity can retry proven rollback');
end$$;
-- Test the actual service role, explicit native failure, adapter changes and expired-scope undo.
grant select,insert on assertions to service_role;
do $$declare f jsonb:=pg_temp.fixture();r jsonb;definition text;begin
 execute 'set local role service_role';
 r:=pg_temp.prepare(f);perform pg_temp.check_it(r->>'state'='saved','application service can prepare without wider grants');r:=pg_temp.command(f,r,'authorize');r:=pg_temp.command(f,r,'advance');
 perform pg_temp.check_it(r->'record'->'result'->>'status'='completed','native effect works under actual service role');
 execute 'reset role';
 update public.agency_execution_scopes set expires_at=clock_timestamp()-interval'1 second'where property_id=(f->>'property')::uuid;
 r:=pg_temp.command(f,r,'reverse');perform pg_temp.check_it(r->'record'->'result'->>'status'='reversed','expired permission still allows conflict-checked compensation');
 f:=pg_temp.fixture();r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');perform set_config('p11.fixture.failure','lead.note.created',true);r:=pg_temp.command(f,r,'advance');perform set_config('p11.fixture.failure','',true);
 perform pg_temp.check_it(r->'record'->'result'->>'issue'='native_effect_failed'and not exists(select 1 from public.lead_note_records where property_id=(f->>'property')::uuid),'native receipt failure stops and rolls back effect');
 f:=pg_temp.fixture();r:=pg_temp.prepare(f);r:=pg_temp.command(f,r,'authorize');
 definition:=pg_get_functiondef('public.agency_execution_contract()'::regprocedure);
 execute $changed$create or replace function public.agency_execution_contract()returns text language sql stable security invoker set search_path=''as 'select repeat(''f'',64)'$changed$;
 r:=pg_temp.command(f,r,'advance');perform pg_temp.check_it(r->'record'->'result'->>'issue'='adapter_changed','changed tool contract invalidates authority');
 execute definition;
 perform pg_temp.check_it(public.read_agency_execution((f->>'property')::uuid,'11111111-1111-1111-1111-111111111111','{"kind":"history","before":"0"}')->>'state'='invalid','nonpositive cursor rejected in native boundary');
 perform pg_temp.check_it(public.read_agency_execution((f->>'property')::uuid,'11111111-1111-1111-1111-111111111111','{}')->'mode'='"local_rehearsal_only"','board identifies rehearsal mode');
 perform pg_temp.check_it(public.read_agency_execution((f->>'property')::uuid,'11111111-1111-1111-1111-111111111111',jsonb_build_object('kind','run','runId',r->'record'->>'run_id'))->'steps'->0->>'status'='pending','run detail exposes exact unexecuted step');
end$$;
-- New source evidence must be reviewed before initial authorization. Later steps
-- still validate their exact target; the runner's own recorded actions do not stale itself.
do $$declare f jsonb:=pg_temp.fixture();r jsonb;i uuid:=gen_random_uuid();begin
 r:=pg_temp.prepare(f);
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(i,'22222222-2222-2222-2222-222222222222',(f->>'property')::uuid,'11111111-1111-1111-1111-111111111111','console');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,result)values(i,i,'22222222-2222-2222-2222-222222222222',(f->>'property')::uuid,'11111111-1111-1111-1111-111111111111','tourspark','tour.fixture.changed','server_confirmed','failed','{}','{}');
 perform pg_temp.check_it(pg_temp.prepare(f)->>'state'='evidence_changed','new evidence blocks preparation with an old reviewed plan');
 r:=pg_temp.command(f,r,'authorize');perform pg_temp.check_it(r->'record'->'result'->>'issue'='evidence_changed','new evidence between prepare and authorize requires another review');
end$$;
select count(*)as passed_execution_assertions from assertions;
rollback;
