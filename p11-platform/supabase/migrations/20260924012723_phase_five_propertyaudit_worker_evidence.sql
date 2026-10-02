create or replace function public.record_geo_service(p_property_id uuid,p_run_id uuid,p_invocation_id uuid,p_kind text,p_detail jsonb)returns uuid language plpgsql security invoker set search_path=''as $$
declare event_id uuid:=gen_random_uuid();organization uuid;
begin
 select org_id into organization from public.properties where id=p_property_id;
 if organization is null or(p_run_id is not null and not exists(select 1 from public.geo_runs where id=p_run_id and property_id=p_property_id))or(p_invocation_id is not null and not exists(select 1 from public.geo_provider_invocations where id=p_invocation_id and run_id=p_run_id and property_id=p_property_id))or p_kind not in('invocation_started','response_retained','response_applied','execution_claimed','execution_finished','execution_held','crawl_claimed','crawl_checkpoint','crawl_completed','crawl_failed','evaluation_prepared','analysis_requested','analysis_claimed','analysis_held','analysis_invocation_started','analysis_response_retained','analysis_prepared','crawl_payload_retained','crawl_payload_applied','crawl_payload_held')or jsonb_typeof(p_detail)is distinct from'object'then raise exception 'Invalid audit worker evidence';end if;
 perform set_config('p11.geo_service_scope',p_property_id::text,true);
 insert into public.geo_service_events(id,property_id,org_id,run_id,invocation_id,kind,detail)values(event_id,p_property_id,organization,p_run_id,p_invocation_id,p_kind,p_detail);
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(event_id,organization,p_property_id,'propertyaudit.worker','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(event_id,event_id,organization,p_property_id,'propertyaudit.worker','propertyaudit','audit.worker.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('runId',p_run_id,'invocationId',p_invocation_id),jsonb_build_object('serviceEventId',event_id));
 return event_id;
end$$;
create function public.geo_execution_authorized(p_run_id uuid)returns boolean language sql stable security invoker set search_path=''as $$
 select exists(select 1 from public.geo_runs r join public.properties p on p.id=r.property_id join public.profiles u on u.id=r.requested_by and u.org_id=p.org_id join public.geo_operator_commands c on c.id=r.operator_request_id and c.property_id=r.property_id and c.org_id=p.org_id and c.actor_id=r.requested_by and c.operation in('run_request','run_retry')where r.id=p_run_id and u.role in('admin','manager'));
$$;
create function public.hold_geo_execution(p_run_id uuid,p_reason text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare j public.geo_execution_jobs;v_run public.geo_runs;total integer;done integer;
begin
 if p_reason not in('authorization_changed','reviewed_request_required','recovery_limit')then raise exception 'Invalid execution hold';end if;
 select*into j from public.geo_execution_jobs where run_id=p_run_id for update;if not found then return'{"state":"not_found"}';end if;
 select*into v_run from public.geo_runs where id=p_run_id for update;
 if v_run.status not in('queued','running')then return jsonb_build_object('state','held','reason',p_reason);end if;
 update public.geo_execution_items set state='failed',error_code=p_reason where run_id=p_run_id and state in('queued','running');
 select count(*),count(*)filter(where state='completed')into total,done from public.geo_execution_items where run_id=p_run_id;
 update public.geo_execution_jobs set state='failed',lease_token=null,lease_until=null,finished_at=clock_timestamp()where run_id=p_run_id;
 update public.geo_runs set status='failed',finished_at=clock_timestamp(),last_updated_at=clock_timestamp(),provider_failure_reason=p_reason,error_message=case when p_reason='authorization_changed'then'The requesting account no longer has audit access. Saved responses remain retained.'when p_reason='reviewed_request_required'then'This older execution needs a recorded request before it can continue.'else'Execution recovery limit reached. Review saved results before a linked retry.'end,run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('measurement_state','held','expected_executions',total,'successful_executions',done,'failed_executions',total-done,'coverage_pct',case when total>0 then round(100.0*done/total,1)else 0 end)where id=p_run_id;
 perform public.record_geo_service(j.property_id,p_run_id,null,'execution_held',jsonb_build_object('reason',p_reason,'savedAnswers',done,'expectedExecutions',total));
 return jsonb_build_object('state',p_reason,'runId',p_run_id,'responseRetained',exists(select 1 from public.geo_provider_invocations where run_id=p_run_id and state='returned'));
end$$;

create or replace function public.claim_geo_execution(p_run_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.geo_execution_jobs;candidate public.geo_execution_jobs; token uuid := gen_random_uuid();
begin
  -- Serialize admission, not provider work. At most four workers and one per surface.
  perform pg_advisory_xact_lock(401904);
  for candidate in select x.*from public.geo_execution_jobs x join public.geo_runs r on r.id=x.run_id where(p_run_id is null or x.run_id=p_run_id)and x.state in('queued','running')and r.status in('queued','running')and not public.geo_execution_authorized(x.run_id)for update of x skip locked loop
   perform public.hold_geo_execution(candidate.run_id,case when exists(select 1 from public.geo_runs where id=candidate.run_id and(requested_by is null or operator_request_id is null))then'reviewed_request_required'else'authorization_changed'end);
  end loop;
  update public.geo_execution_jobs expired_job set state='failed',finished_at=now(),lease_until=null,lease_token=null
    where expired_job.state in ('queued','running') and exists(select 1 from public.geo_runs r where r.id=expired_job.run_id and r.status not in ('queued','running'));
  -- Bound crashes before an item can even be claimed, in addition to item retries.
  for candidate in select x.*from public.geo_execution_jobs x join public.geo_runs r on r.id=x.run_id where r.status in('queued','running')and x.claim_count>=1000 and(x.lease_until is null or x.lease_until<=now())for update of x skip locked loop
   perform public.hold_geo_execution(candidate.run_id,'recovery_limit');
  end loop;
  if (select count(*) from public.geo_execution_jobs where state='running' and lease_until>now()) >= 4 then return null; end if;
  select * into j from public.geo_execution_jobs x
    where (p_run_id is null or x.run_id=p_run_id) and x.state in ('queued','running') and x.available_at<=now()
      and (x.lease_until is null or x.lease_until<=now())
      and exists(select 1 from public.geo_runs r where r.id=x.run_id and r.status in ('queued','running')and not r.stopped_by_operator and r.archived_at is null and(p_run_id is not null or r.measurement_mode<>'local_fixture')and public.geo_execution_authorized(r.id))
      and not exists(select 1 from public.geo_execution_jobs y where y.surface=x.surface and y.state='running' and y.lease_until>now())
    order by x.created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.geo_execution_jobs set state='running',lease_token=token,lease_until=now()+interval '3 minutes',claim_count=claim_count+1 where run_id=j.run_id returning * into j;
  update public.geo_runs set status='running',last_updated_at=now() where id=j.run_id;
  -- A interrupted provider call counts as an attempt; completed items never run again.
  update public.geo_execution_items set state=case when attempts>=3 then 'failed' else 'queued' end,error_code='worker_interrupted'
    where run_id=j.run_id and state='running';
  perform public.record_geo_service(j.property_id,j.run_id,null,'execution_claimed',jsonb_build_object('claimCount',j.claim_count));
  return to_jsonb(j);
end; $$;

create or replace function public.start_geo_provider_invocation(p_run_id uuid,p_token uuid,p_item_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare j public.geo_execution_jobs;i public.geo_execution_items;v public.geo_provider_invocations;organization uuid;
begin
 select*into j from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>statement_timestamp()and state='running'for update;
 if not found or not exists(select 1 from public.geo_runs where id=p_run_id and status='running'and not stopped_by_operator)then return'{"state":"lease_lost"}';end if;
 if not public.geo_execution_authorized(p_run_id)then return public.hold_geo_execution(p_run_id,case when exists(select 1 from public.geo_runs where id=p_run_id and(requested_by is null or operator_request_id is null))then'reviewed_request_required'else'authorization_changed'end);end if;
 select*into i from public.geo_execution_items where id=p_item_id and run_id=p_run_id and state='running'for update;if not found then return'{"state":"item_changed"}';end if;
 -- An actual retained response is applied before another provider call is allowed.
 select*into v from public.geo_provider_invocations where item_id=i.id and state='returned'and not applied order by started_at,id limit 1;
 if found then return jsonb_build_object('state','retained','invocationId',v.id);end if;
 select*into v from public.geo_provider_invocations where item_id=i.id and attempt=i.attempts;
 if found then return jsonb_build_object('state',case when v.state='started'then'in_progress'else'retained'end,'invocationId',v.id);end if;
 select org_id into organization from public.properties where id=j.property_id;perform set_config('p11.geo_service_scope',j.property_id::text,true);
 insert into public.geo_provider_invocations(property_id,org_id,run_id,item_id,lease_token,attempt,source_snapshot)values(j.property_id,organization,j.run_id,i.id,p_token,i.attempts,jsonb_build_object('job',j.snapshot,'query',i.query_snapshot,'ordinal',i.ordinal))returning*into v;
 perform public.record_geo_service(j.property_id,j.run_id,v.id,'invocation_started',jsonb_build_object('attempt',i.attempts,'measurementMode',j.snapshot#>>'{run,measurement_mode}'));
 return jsonb_build_object('state','claimed','invocationId',v.id);
end$$;

create or replace function public.advance_geo_execution(p_run_id uuid,p_token uuid,p_item_id uuid default null,p_result jsonb default null,p_error text default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.geo_execution_jobs; item public.geo_execution_items; a public.geo_answers; c jsonb; n integer; done integer; failed integer;
begin
 select * into j from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>now() and state='running' for update;
 if not found or not exists(select 1 from public.geo_runs where id=p_run_id and status='running') then raise exception 'Execution lease lost'; end if;
 if not public.geo_execution_authorized(p_run_id)then return public.hold_geo_execution(p_run_id,case when exists(select 1 from public.geo_runs where id=p_run_id and(requested_by is null or operator_request_id is null))then'reviewed_request_required'else'authorization_changed'end);end if;
 update public.geo_execution_jobs set lease_until=now()+interval '3 minutes' where run_id=p_run_id;
 update public.geo_runs set last_updated_at=now() where id=p_run_id;
 if p_item_id is not null then
   select * into item from public.geo_execution_items where id=p_item_id and run_id=p_run_id for update;
   if not found then raise exception 'Execution item missing'; end if;
   if item.state='completed' then return jsonb_build_object('saved',true); end if;
   if item.state<>'running' then raise exception 'Execution item is not running'; end if;
   if p_result is not null then
     a := jsonb_populate_record(null::public.geo_answers,p_result->'answer');
     if a.query_id<>(item.query_snapshot->>'id')::uuid or a.run_id<>p_run_id then raise exception 'Answer scope mismatch'; end if;
     insert into public.geo_answers(run_id,query_id,presence,llm_rank,link_rank,sov,flags,answer_summary,ordered_entities,raw_json,natural_response,analysis_method)
       values(p_run_id,a.query_id,a.presence,a.llm_rank,a.link_rank,a.sov,a.flags,a.answer_summary,a.ordered_entities,a.raw_json,a.natural_response,a.analysis_method) returning id into a.id;
     for c in select value from jsonb_array_elements(coalesce(p_result->'citations','[]')) loop
       insert into public.geo_citations(answer_id,url,domain,is_brand_domain,entity_ref)
         values(a.id,c->>'url',c->>'domain',(c->>'is_brand_domain')::boolean,c->>'entity_ref');
     end loop;
     update public.geo_execution_items set state='completed',answer_id=a.id,score=p_result->'score',error_code=null where id=item.id;
   else
     update public.geo_execution_items set state=case when attempts>=3 or p_error='missing_provider_key' then 'failed' else 'queued' end,error_code=p_error where id=item.id;
     if p_error='missing_provider_key' then update public.geo_execution_items set state='failed',error_code=p_error where run_id=p_run_id and state='queued'; end if;
     update public.geo_execution_jobs set state='queued',lease_until=null,lease_token=null,available_at=now()+make_interval(secs=>least(120,10*power(2,item.attempts)::integer)) where run_id=p_run_id;
     return jsonb_build_object('retry_scheduled',true);
   end if;
 end if;
 select count(*),count(*) filter(where state='completed'),count(*) filter(where state='failed') into n,done,failed from public.geo_execution_items where run_id=p_run_id;
 update public.geo_runs set current_query_index=done+failed,progress_pct=floor(100.0*(done+failed)/n),run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('expected_executions',n,'successful_executions',done,'failed_executions',failed,'coverage_pct',round(100.0*done/n,1)) where id=p_run_id;
 select * into item from public.geo_execution_items where run_id=p_run_id and state='queued' order by ordinal limit 1 for update;
 if found then
   update public.geo_execution_items set state='running',attempts=attempts+1 where id=item.id returning * into item;
   return jsonb_build_object('item',to_jsonb(item));
 end if;
 return jsonb_build_object('ready_to_finish',true,'expected',n,'succeeded',done,'failed',failed);
end; $$;

create or replace function public.apply_geo_provider_invocation(p_id uuid,p_run_id uuid,p_token uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v public.geo_provider_invocations;j public.geo_execution_jobs;answer jsonb;
begin
 select*into j from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>statement_timestamp()and state='running'for update;if not found then return'{"state":"lease_lost"}';end if;
 select*into v from public.geo_provider_invocations where id=p_id and run_id=p_run_id for update;if not found then return'{"state":"not_found"}';end if;
 if v.applied then return v.application_result;end if;
 if not public.geo_execution_authorized(p_run_id)then return public.hold_geo_execution(p_run_id,case when exists(select 1 from public.geo_runs where id=p_run_id and(requested_by is null or operator_request_id is null))then'reviewed_request_required'else'authorization_changed'end);end if;
 if v.state='started'then return'{"state":"response_pending"}';end if;
 if not exists(select 1 from public.geo_runs where id=p_run_id and status='running'and not stopped_by_operator)then return'{"state":"stopped"}';end if;
 if not exists(select 1 from public.geo_execution_items where id=v.item_id and run_id=p_run_id and state='running')then return'{"state":"item_changed"}';end if;
 answer:=public.advance_geo_execution(p_run_id,p_token,v.item_id,v.provider_result,v.error_code);
 if answer->>'state'in('authorization_changed','reviewed_request_required','held','lease_lost')then return answer;end if;
 perform set_config('p11.geo_service_scope',v.property_id::text,true);
 update public.geo_provider_invocations set applied=true,application_result=answer,applied_at=clock_timestamp()where id=v.id;
 perform public.record_geo_service(v.property_id,v.run_id,v.id,'response_applied',jsonb_build_object('resultSaved',v.state='returned','retryScheduled',coalesce((answer->>'retry_scheduled')::boolean,false)));
 return answer;
end$$;

create or replace function public.finish_geo_execution(p_run_id uuid,p_token uuid,p_aggregate jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare n integer; done integer; failed integer; final_state text;
begin
 perform 1 from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>now() and state='running' for update;
 if not found then raise exception 'Execution lease lost'; end if;
 if not public.geo_execution_authorized(p_run_id)then return public.hold_geo_execution(p_run_id,case when exists(select 1 from public.geo_runs where id=p_run_id and(requested_by is null or operator_request_id is null))then'reviewed_request_required'else'authorization_changed'end);end if;
 select count(*),count(*) filter(where state='completed'),count(*) filter(where state='failed') into n,done,failed from public.geo_execution_items where run_id=p_run_id;
 if done+failed<>n then raise exception 'Unfinished execution items'; end if;
 final_state:=case when done=0 then 'failed' when failed>0 then 'partial' else 'completed' end;
 if done>0 then
   insert into public.geo_scores(run_id,overall_score,visibility_pct,avg_llm_rank,avg_link_rank,avg_sov,breakdown,query_scores)
     values(p_run_id,(p_aggregate->>'overall_score')::numeric,(p_aggregate->>'visibility_pct')::numeric,(p_aggregate->>'avg_llm_rank')::numeric,(p_aggregate->>'avg_link_rank')::numeric,(p_aggregate->>'avg_sov')::numeric,
       coalesce(p_aggregate->'breakdown','{}')||jsonb_build_object('coverage_pct',round(100.0*done/n,1),'expected',n,'succeeded',done,'failed',failed,'measurement_state',final_state),
       (select coalesce(jsonb_agg(score order by ordinal),'[]') from public.geo_execution_items where run_id=p_run_id and state='completed'));
 end if;
 -- Existing status enums/readers stay compatible: incomplete measurements are failed,
 -- while their saved answers and score remain available with explicit coverage.
 update public.geo_runs set status=case when failed=0 then 'completed'::public.geo_run_status_enum else 'failed'::public.geo_run_status_enum end,
   finished_at=now(),progress_pct=100,last_updated_at=now(),
   error_message=case when failed>0 then format('Incomplete measurement: %s of %s executions succeeded; %s failed after bounded retries.',done,n,failed) else null end,
   provider_failure_reason=case when failed>0 then 'partial_measurement' else null end,
   run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('measurement_state',final_state,'expected_executions',n,'successful_executions',done,'failed_executions',failed,'coverage_pct',round(100.0*done/n,1))
   where id=p_run_id and status='running';
 if not found then raise exception 'Run is no longer running'; end if;
 update public.geo_execution_jobs set state=final_state,lease_until=null,lease_token=null,finished_at=now() where run_id=p_run_id;
 perform public.record_geo_service((select property_id from public.geo_runs where id=p_run_id),p_run_id,null,'execution_finished',jsonb_build_object('state',final_state,'expected',n,'succeeded',done,'failed',failed));
 return jsonb_build_object('state',final_state,'succeeded',done,'failed',failed,'expected',n);
end; $$;

create table public.geo_crawl_receipts(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),crawl_id uuid not null references public.geo_site_crawls(id)on delete cascade,
 lease_hash text not null,kind text not null check(kind in('pages','checkpoint','completed','failed')),
 payload jsonb not null,payload_hash text not null,application_result jsonb,applied_at timestamptz,held_reason text,
 created_at timestamptz not null default clock_timestamp()
);
create index geo_crawl_receipts_property on public.geo_crawl_receipts(property_id,created_at desc,id desc);
create index geo_crawl_receipts_org on public.geo_crawl_receipts(org_id);
create index geo_crawl_receipts_crawl on public.geo_crawl_receipts(crawl_id,created_at,id);
alter table public.geo_crawl_receipts enable row level security;
revoke all on public.geo_crawl_receipts from public,anon,authenticated;
grant all on public.geo_crawl_receipts to service_role;
create policy geo_crawl_receipts_service on public.geo_crawl_receipts for all to service_role using(true)with check(true);
create function public.guard_geo_crawl_receipt()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Retain captured crawl evidence';
 end if;
 if current_setting('p11.geo_crawl_receipt_scope',true)is distinct from new.property_id::text then raise exception 'Use retained crawl operations';end if;
 if tg_op='UPDATE'then
  if(new.id,new.property_id,new.org_id,new.crawl_id,new.lease_hash,new.kind,new.payload,new.payload_hash,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.crawl_id,old.lease_hash,old.kind,old.payload,old.payload_hash,old.created_at)then raise exception 'Captured crawl evidence is immutable';end if;
  if old.application_result is not null and new is distinct from old then raise exception 'Accepted crawl receipt is immutable';end if;
 end if;return new;
end$$;
create trigger geo_crawl_receipts_guard before insert or update or delete on public.geo_crawl_receipts for each row execute function public.guard_geo_crawl_receipt();
create function public.geo_crawl_authorized(p_crawl_id uuid)returns boolean language sql stable security invoker set search_path=''as $$
 select exists(select 1 from public.geo_site_crawls c join public.properties p on p.id=c.property_id join public.profiles u on u.id=c.requested_by and u.org_id=p.org_id join public.geo_operator_commands d on d.id=c.operator_request_id and d.property_id=c.property_id and d.org_id=p.org_id and d.actor_id=c.requested_by and d.operation in('run_request','crawl_retry')where c.id=p_crawl_id and u.role in('admin','manager'));
$$;
create function public.hold_geo_crawl(p_crawl_id uuid,p_reason text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare c public.geo_site_crawls;
begin
 if p_reason not in('authorization_changed','recovery_limit','reviewed_request_required')then raise exception 'Invalid crawl hold';end if;
 select*into c from public.geo_site_crawls where id=p_crawl_id for update;
 if not found then return'{"state":"not_found"}';end if;
 if c.status not in('queued','running')then return jsonb_build_object('state','held','reason',p_reason);end if;
 update public.geo_site_crawls set status='failed',lease_token=null,lease_until=null,finished_at=clock_timestamp(),last_updated_at=clock_timestamp(),error_message=case when p_reason='authorization_changed'then'The requesting account no longer has crawl access. Captured evidence remains retained.'when p_reason='recovery_limit'then'Crawl recovery limit reached. Review captured evidence before a linked retry.'else'This crawl needs a recorded request before continuing.'end where id=p_crawl_id;
 perform public.record_geo_service(c.property_id,null,null,'crawl_failed',jsonb_build_object('crawlId',p_crawl_id,'reason',p_reason));
 return jsonb_build_object('state',p_reason,'crawlId',p_crawl_id);
end$$;
create function public.retain_geo_crawl_receipt(p_id uuid,p_crawl_id uuid,p_token uuid,p_kind text,p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare c public.geo_site_crawls;r public.geo_crawl_receipts;organization uuid;v_hash text:=public.knowledge_hash(to_jsonb(p_token));
begin
 if p_id is null or coalesce(p_kind,'')not in('pages','checkpoint','completed','failed')or jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>16777216 then return'{"state":"invalid_input"}';end if;
 select*into c from public.geo_site_crawls where id=p_crawl_id;
 if not found then return'{"state":"not_found"}';end if;
 -- Historical hashed authority permits retention of a returning capture after a stop.
 if not exists(select 1 from public.geo_service_events e where e.property_id=c.property_id and e.kind='crawl_claimed'and e.detail->>'crawlId'=p_crawl_id::text and e.detail->>'leaseHash'=v_hash)then return'{"state":"lease_lost"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,993));select*into r from public.geo_crawl_receipts where id=p_id;
 if found then
  if(r.crawl_id,r.lease_hash,r.kind,r.payload)is distinct from(p_crawl_id,v_hash,p_kind,p_payload)then return'{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','retained','receiptId',p_id,'applied',r.application_result is not null);
 end if;
 select org_id into organization from public.properties where id=c.property_id;
 perform set_config('p11.geo_crawl_receipt_scope',c.property_id::text,true);
 insert into public.geo_crawl_receipts(id,property_id,org_id,crawl_id,lease_hash,kind,payload,payload_hash)values(p_id,c.property_id,organization,p_crawl_id,v_hash,p_kind,p_payload,public.knowledge_hash(p_payload));
 perform public.record_geo_service(c.property_id,null,null,'crawl_payload_retained',jsonb_build_object('crawlId',c.id,'receiptId',p_id,'kind',p_kind,'payloadHash',public.knowledge_hash(p_payload),'crawlStatus',c.status));
 return jsonb_build_object('state','retained','receiptId',p_id,'applied',false);
end$$;
create function public.guard_geo_crawl_page_revision()returns trigger language plpgsql security invoker set search_path=''as $$
declare c public.geo_site_crawls;
begin
 if current_user='authenticated'then raise exception 'Use recorded crawl operations';end if;
 if tg_op='UPDATE'then
  if new.crawl_id is distinct from old.crawl_id then raise exception 'Captured page crawl is immutable';end if;
 end if;
 select*into c from public.geo_site_crawls where id=new.crawl_id;
 if c.operator_request_id is not null then
  if current_setting('p11.geo_crawl_apply_scope',true)is distinct from c.id::text or c.status<>'running'then raise exception 'Apply a retained crawl receipt before changing captured pages';end if;
 end if;return new;
end$$;
create trigger geo_crawl_page_revision_guard before insert or update on public.geo_crawl_pages for each row execute function public.guard_geo_crawl_page_revision();

create or replace function public.claim_geo_site_crawl(p_crawl_id uuid default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare c public.geo_site_crawls;
begin
 perform pg_advisory_xact_lock(401905);
 for c in select z.*from public.geo_site_crawls z where z.operator_request_id is not null and(p_crawl_id is null or z.id=p_crawl_id)and z.status in('queued','running')and(not public.geo_crawl_authorized(z.id)or(z.claim_count>=3 and(z.lease_until is null or z.lease_until<=statement_timestamp())))for update skip locked loop
  perform public.hold_geo_crawl(c.id,case when not public.geo_crawl_authorized(c.id)then'authorization_changed'else'recovery_limit'end);
 end loop;

 if(select count(*)from public.geo_site_crawls where operator_request_id is not null and status='running'and lease_until>statement_timestamp())>=2 then return null;end if;
 select*into c from public.geo_site_crawls z where z.operator_request_id is not null and(p_crawl_id is null or z.id=p_crawl_id)and(p_crawl_id is not null or z.measurement_mode<>'local_fixture')and z.status in('queued','running')and(z.lease_until is null or z.lease_until<=statement_timestamp())and z.claim_count<3
 and public.geo_crawl_authorized(z.id)
 and not exists(select 1 from public.geo_site_crawls peer where peer.id<>z.id and peer.property_id=z.property_id and peer.status='running'and peer.lease_until>statement_timestamp())
 order by z.created_at,z.id for update skip locked limit 1;
 if not found then return null;end if;
 update public.geo_site_crawls set status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval'3 minutes',claim_count=claim_count+1,started_at=coalesce(started_at,clock_timestamp()),last_updated_at=clock_timestamp(),finished_at=null,error_message=null where id=c.id returning*into c;
 perform public.record_geo_service(c.property_id,null,null,'crawl_claimed',jsonb_build_object('crawlId',c.id,'claimCount',c.claim_count,'leaseHash',public.knowledge_hash(to_jsonb(c.lease_token))));return to_jsonb(c)||jsonb_build_object('pendingReceiptIds',coalesce((select jsonb_agg(r.id order by r.created_at,r.id)from public.geo_crawl_receipts r where r.crawl_id=c.id and r.application_result is null),'[]'));
end$$;

create function public.apply_geo_crawl_payload(p_crawl_id uuid,p_token uuid,p_kind text,p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare c public.geo_site_crawls;v jsonb;f public.geo_site_findings;before_rows jsonb;after_rows jsonb;changes int:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended((select property_id::text from public.geo_site_crawls where id=p_crawl_id),4));
 select*into c from public.geo_site_crawls where id=p_crawl_id and operator_request_id is not null and lease_token=p_token and lease_until>statement_timestamp()and status='running'for update;
 if not found then return'{"state":"lease_lost"}';end if;
 if not public.geo_crawl_authorized(p_crawl_id)then return public.hold_geo_crawl(p_crawl_id,'authorization_changed');end if;
 if p_kind<>'heartbeat'and current_setting('p11.geo_crawl_apply_scope',true)is distinct from c.id::text then return'{"state":"receipt_required"}';end if;
 if jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>16777216 then return'{"state":"invalid_input"}';end if;
 if p_kind='pages'then
  if jsonb_typeof(p_payload->'pages')is distinct from'array'or jsonb_array_length(p_payload->'pages')>50 then return'{"state":"invalid_input"}';end if;
  for v in select value from jsonb_array_elements(p_payload->'pages')loop
   if jsonb_typeof(v)is distinct from'object'or length(coalesce(v->>'url',''))not between 1 and 10000 then raise exception 'Invalid crawl page';end if;
   insert into public.geo_crawl_pages(crawl_id,url,final_url,status_code,redirect_chain,content_type,response_headers,title,meta_description,meta_robots,canonical_url,h1s,h2s,word_count,html_bytes,text_html_ratio,images,internal_links,external_links,structured_data,content,forms,provenance,mixed_content,blocked_resources,page_type,crawl_depth,inlink_count,in_sitemap,blocked_by_robots,fetch_error)select crawl_id,url,final_url,status_code,redirect_chain,content_type,response_headers,title,meta_description,meta_robots,canonical_url,h1s,h2s,word_count,html_bytes,text_html_ratio,images,internal_links,external_links,structured_data,content,forms,provenance,mixed_content,blocked_resources,page_type,crawl_depth,inlink_count,in_sitemap,blocked_by_robots,fetch_error from jsonb_populate_record(null::public.geo_crawl_pages,v||jsonb_build_object('crawl_id',c.id))on conflict(crawl_id,url)do update set url=excluded.url,final_url=excluded.final_url,status_code=excluded.status_code,redirect_chain=excluded.redirect_chain,content_type=excluded.content_type,response_headers=excluded.response_headers,title=excluded.title,meta_description=excluded.meta_description,meta_robots=excluded.meta_robots,canonical_url=excluded.canonical_url,h1s=excluded.h1s,h2s=excluded.h2s,word_count=excluded.word_count,html_bytes=excluded.html_bytes,text_html_ratio=excluded.text_html_ratio,images=excluded.images,internal_links=excluded.internal_links,external_links=excluded.external_links,structured_data=excluded.structured_data,content=excluded.content,forms=excluded.forms,provenance=excluded.provenance,mixed_content=excluded.mixed_content,blocked_resources=excluded.blocked_resources,page_type=excluded.page_type,crawl_depth=excluded.crawl_depth,inlink_count=excluded.inlink_count,in_sitemap=excluded.in_sitemap,blocked_by_robots=excluded.blocked_by_robots,fetch_error=excluded.fetch_error;
  end loop;
  if(select count(*)from public.geo_crawl_pages where crawl_id=c.id)>c.page_cap then raise exception 'Reviewed crawl page limit exceeded';end if;
 elsif p_kind='checkpoint'then
  if jsonb_typeof(p_payload->'crawl_state')is distinct from'object'then return'{"state":"invalid_input"}';end if;
  update public.geo_site_crawls set crawl_state=p_payload->'crawl_state',pages_crawled=(select count(*)from public.geo_crawl_pages where crawl_id=c.id),pages_discovered=greatest(0,coalesce((p_payload->>'pages_discovered')::integer,0))where id=c.id;
  perform public.record_geo_service(c.property_id,null,null,'crawl_checkpoint',jsonb_build_object('crawlId',c.id,'sourceHash',public.knowledge_hash(p_payload),'pages',(select count(*)from public.geo_crawl_pages where crawl_id=c.id)));
 elsif p_kind='completed'then
  if jsonb_typeof(p_payload->'findings')is distinct from'array'or jsonb_array_length(p_payload->'findings')>1000 then return'{"state":"invalid_input"}';end if;
  -- Serialize against operator review. An absent detector result does not prove a previous finding was fixed.
  perform pg_advisory_xact_lock(hashtextextended(c.property_id::text,4));
  select coalesce(jsonb_agg(to_jsonb(z)order by z.id),'[]')into before_rows from public.geo_site_findings z where z.property_id=c.property_id;
  for v in select value from jsonb_array_elements(p_payload->'findings')loop
   insert into public.geo_site_findings(property_id,source_crawl_id,fingerprint,category,detector,severity,title,description,occurrences,affected_urls,affected_url_count,evidence,status,owner)
   values(c.property_id,c.id,v->>'fingerprint',v->>'category',v->>'detector',(v->>'severity')::public.geo_finding_severity_enum,v->>'title',v->>'description',(v->>'occurrences')::integer,v->'affected_urls',(v->>'affected_url_count')::integer,v->'evidence','todo',coalesce(v->>'owner','web_developer'))
   on conflict(property_id,fingerprint)do update set source_crawl_id=excluded.source_crawl_id,category=excluded.category,detector=excluded.detector,severity=excluded.severity,title=excluded.title,description=excluded.description,occurrences=excluded.occurrences,affected_urls=excluded.affected_urls,affected_url_count=excluded.affected_url_count,evidence=excluded.evidence,last_seen_at=clock_timestamp(),updated_at=clock_timestamp(),status=case when geo_site_findings.status='fixed'then'todo'::public.geo_finding_status_enum else geo_site_findings.status end,fixed_at=case when geo_site_findings.status='fixed'then null else geo_site_findings.fixed_at end;
   changes:=changes+1;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(z)order by z.id),'[]')into after_rows from public.geo_site_findings z where z.property_id=c.property_id;
  update public.geo_site_crawls set status='completed',finished_at=clock_timestamp(),lease_until=null,crawl_state=jsonb_build_object('final',true,'page_cap_reached',coalesce(p_payload->'page_cap_reached','false'),'recovery_limited',coalesce(p_payload->'recovery_limited','false')),pages_crawled=(select count(*)from public.geo_crawl_pages where crawl_id=c.id),pages_discovered=greatest(0,coalesce((p_payload->>'pages_discovered')::integer,0)),robots_summary=p_payload->'robots_summary',sitemap_summary=p_payload->'sitemap_summary',llms_txt_summary=p_payload->'llms_txt_summary'where id=c.id;
  perform public.record_geo_service(c.property_id,null,null,'crawl_completed',jsonb_build_object('crawlId',c.id,'findings',changes,'before',before_rows,'after',after_rows,'coverage',p_payload-'findings','absenceIsVerifiedFix',false));
 elsif p_kind='failed'then
  update public.geo_site_crawls set status='failed',finished_at=clock_timestamp(),lease_until=null,error_message=left(coalesce(p_payload->>'error','Crawl failed'),2000)where id=c.id;
  perform public.record_geo_service(c.property_id,null,null,'crawl_failed',jsonb_build_object('crawlId',c.id,'error',p_payload->>'error'));
 elsif p_kind<>'heartbeat'then return'{"state":"invalid_input"}';end if;
 update public.geo_site_crawls set last_updated_at=clock_timestamp(),lease_until=case when status='running'then clock_timestamp()+interval'3 minutes'else null end where id=c.id;
 return jsonb_build_object('state','saved','crawlId',c.id,'status',(select status from public.geo_site_crawls where id=c.id));
end$$;

create function public.apply_geo_crawl_receipt(p_id uuid,p_crawl_id uuid,p_token uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.geo_crawl_receipts;c public.geo_site_crawls;result jsonb;reason text;
begin
 perform pg_advisory_xact_lock(hashtextextended((select property_id::text from public.geo_site_crawls where id=p_crawl_id),4));
 select*into r from public.geo_crawl_receipts where id=p_id and crawl_id=p_crawl_id for update;if not found then return'{"state":"not_found"}';end if;
 select*into c from public.geo_site_crawls where id=p_crawl_id for update;
 if r.application_result is not null then
  if public.knowledge_hash(to_jsonb(p_token))is distinct from r.lease_hash and c.lease_token is distinct from p_token then return'{"state":"lease_lost"}';end if;
  return r.application_result||jsonb_build_object('receiptId',p_id,'replayed',true);
 end if;
 if c.status<>'running'or c.lease_token is distinct from p_token or c.lease_until<=statement_timestamp()then result:='{"state":"lease_lost"}';
 elsif not public.geo_crawl_authorized(p_crawl_id)then result:=public.hold_geo_crawl(p_crawl_id,'authorization_changed');
 else
  perform set_config('p11.geo_crawl_apply_scope',p_crawl_id::text,true);
  result:=public.apply_geo_crawl_payload(p_crawl_id,p_token,r.kind,r.payload);
 end if;
 perform set_config('p11.geo_crawl_receipt_scope',r.property_id::text,true);
 if result->>'state'='saved'then
  result:=result||jsonb_build_object('receiptId',p_id);
  update public.geo_crawl_receipts set application_result=result,applied_at=clock_timestamp(),held_reason=null where id=p_id;
  perform public.record_geo_service(r.property_id,null,null,'crawl_payload_applied',jsonb_build_object('crawlId',p_crawl_id,'receiptId',p_id,'kind',r.kind));
 else
  reason:=coalesce(result->>'state','unconfirmed');
  if r.held_reason is distinct from reason then
   update public.geo_crawl_receipts set held_reason=reason where id=p_id;
   perform public.record_geo_service(r.property_id,null,null,'crawl_payload_held',jsonb_build_object('crawlId',p_crawl_id,'receiptId',p_id,'reason',reason));
  end if;
 end if;return result;
end$$;
create or replace function public.save_geo_site_crawl(p_crawl_id uuid,p_token uuid,p_kind text,p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare receipt_id uuid;result jsonb;
begin
 if p_kind='heartbeat'then return public.apply_geo_crawl_payload(p_crawl_id,p_token,p_kind,p_payload);end if;
 receipt_id:=md5('geo.crawl.'||p_crawl_id::text||'.'||p_token::text||'.'||p_kind||'.'||public.knowledge_hash(p_payload))::uuid;
 result:=public.retain_geo_crawl_receipt(receipt_id,p_crawl_id,p_token,p_kind,p_payload);
 if result->>'state'<>'retained'then return result;end if;
 return public.apply_geo_crawl_receipt(receipt_id,p_crawl_id,p_token);
end$$;
create function public.read_geo_crawl_receipts(p_actor_id uuid,p_property_id uuid,p_crawl_id uuid,p_id uuid default null,p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;r public.geo_crawl_receipts;items jsonb;count_value bigint;hash_value text;
begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if not found then return'{"state":"forbidden"}';end if;
 if not exists(select 1 from public.geo_site_crawls where id=p_crawl_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;
 if p_id is not null then
  select*into r from public.geo_crawl_receipts where id=p_id and property_id=p_property_id and org_id=organization and crawl_id=p_crawl_id;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','id',p_id,'propertyId',p_property_id,'record',to_jsonb(r)-'lease_hash');
 end if;
 if p_offset not between 0 and 1000000 then return'{"state":"invalid_input"}';end if;
 select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,application_result,held_reason)order by created_at desc,id desc),'[]'))into count_value,hash_value from public.geo_crawl_receipts where property_id=p_property_id and org_id=organization and crawl_id=p_crawl_id;
 if p_hash is not null and p_hash<>hash_value then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(to_jsonb(z)-array['lease_hash','payload']order by z.created_at desc,z.id desc),'[]')into items from(select*from public.geo_crawl_receipts where property_id=p_property_id and org_id=organization and crawl_id=p_crawl_id order by created_at desc,id desc offset p_offset limit 25)z;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'crawlId',p_crawl_id,'items',items,'count',count_value,'hash',hash_value,'offset',p_offset);
end$$;

revoke all on function public.record_geo_service(uuid,uuid,uuid,text,jsonb),public.geo_execution_authorized(uuid),public.hold_geo_execution(uuid,text),public.claim_geo_execution(uuid),public.start_geo_provider_invocation(uuid,uuid,uuid),public.advance_geo_execution(uuid,uuid,uuid,jsonb,text),public.apply_geo_provider_invocation(uuid,uuid,uuid),public.finish_geo_execution(uuid,uuid,jsonb),public.guard_geo_crawl_receipt(),public.geo_crawl_authorized(uuid),public.hold_geo_crawl(uuid,text),public.retain_geo_crawl_receipt(uuid,uuid,uuid,text,jsonb),public.guard_geo_crawl_page_revision(),public.claim_geo_site_crawl(uuid),public.apply_geo_crawl_payload(uuid,uuid,text,jsonb),public.apply_geo_crawl_receipt(uuid,uuid,uuid),public.save_geo_site_crawl(uuid,uuid,text,jsonb),public.read_geo_crawl_receipts(uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.record_geo_service(uuid,uuid,uuid,text,jsonb),public.geo_execution_authorized(uuid),public.hold_geo_execution(uuid,text),public.claim_geo_execution(uuid),public.start_geo_provider_invocation(uuid,uuid,uuid),public.advance_geo_execution(uuid,uuid,uuid,jsonb,text),public.apply_geo_provider_invocation(uuid,uuid,uuid),public.finish_geo_execution(uuid,uuid,jsonb),public.guard_geo_crawl_receipt(),public.geo_crawl_authorized(uuid),public.hold_geo_crawl(uuid,text),public.retain_geo_crawl_receipt(uuid,uuid,uuid,text,jsonb),public.guard_geo_crawl_page_revision(),public.claim_geo_site_crawl(uuid),public.apply_geo_crawl_payload(uuid,uuid,text,jsonb),public.apply_geo_crawl_receipt(uuid,uuid,uuid),public.save_geo_site_crawl(uuid,uuid,text,jsonb),public.read_geo_crawl_receipts(uuid,uuid,uuid,uuid,integer,text) to service_role;
notify pgrst,'reload schema';
