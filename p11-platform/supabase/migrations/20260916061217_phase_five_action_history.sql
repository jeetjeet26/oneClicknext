-- Recording is separate from permission to execute. No jobs or provider calls are created here.
create table public.shared_action_episodes (
 id uuid primary key, org_id uuid not null references public.organizations on delete cascade,
 property_id uuid not null references public.properties on delete cascade,
 actor_id uuid not null, origin text not null check(origin in ('console','workflow')),
 created_at timestamptz not null default now(), unique(id,property_id)
);
create index shared_action_episodes_property_idx on public.shared_action_episodes(property_id,created_at desc);
create index shared_action_episodes_org_idx on public.shared_action_episodes(org_id);
create table public.shared_action_events (
 id uuid primary key, schema_version integer not null default 1 check(schema_version=1),
 episode_id uuid not null references public.shared_action_episodes on delete cascade,
 org_id uuid not null references public.organizations on delete cascade,
 property_id uuid not null references public.properties on delete cascade,
 actor_id uuid not null, product text not null, action text not null,
 evidence text not null check(evidence in ('browser_observed','server_confirmed')),
 phase text not null check(phase in ('observed','succeeded','failed')),
 request jsonb not null, before_state jsonb, after_state jsonb, result jsonb not null,
 created_at timestamptz not null default now(),
 -- Historical references are immutable even if an operational job is later removed.
 shared_job_ref uuid, shared_attempt_ref uuid, context_snapshot_ref uuid,
 training_eligible boolean not null default false check(training_eligible=false),
 constraint observation_is_not_completion check(evidence<>'browser_observed' or phase='observed')
);
create index shared_action_events_property_time_idx on public.shared_action_events(property_id,created_at desc,id desc);
create index shared_action_events_org_idx on public.shared_action_events(org_id);
create index shared_action_events_episode_idx on public.shared_action_events(episode_id,created_at,id);
alter table public.shared_action_episodes enable row level security;
alter table public.shared_action_events enable row level security;
revoke all on public.shared_action_episodes,public.shared_action_events from public,anon,authenticated;
grant all on public.shared_action_episodes,public.shared_action_events to service_role;

create function public.protect_shared_action_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
 raise exception 'Action history is immutable' using errcode='55000';
end; $$;
create trigger immutable_shared_action_event before update or delete on public.shared_action_events for each row execute function public.protect_shared_action_history();
create trigger immutable_shared_action_episode before update or delete on public.shared_action_episodes for each row execute function public.protect_shared_action_history();

create function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 else
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid workflow evidence';end if;
 end if;
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id;
 if organization is null then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 job:=nullif(p_links->>'jobId','')::uuid;attempt:=nullif(p_links->>'attemptId','')::uuid;context_id:=nullif(p_links->>'contextId','')::uuid;
 select * into e from public.shared_action_events where id=p_id;
 if found then
  if (e.episode_id,e.property_id,e.actor_id,e.product,e.action,e.evidence,e.phase,e.request,e.before_state,e.after_state,e.result,e.shared_job_ref,e.shared_attempt_ref,e.context_snapshot_ref)
   is distinct from (p_episode_id,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','eventId',e.id);
 end if;
 if job is not null and not exists(select 1 from public.shared_jobs where id=job and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 if attempt is not null and not exists(select 1 from public.shared_action_attempts where id=attempt and org_id=organization and property_id=p_property_id and (job is null or job_id=job)) then return '{"state":"link_conflict"}';end if;
 if context_id is not null and not exists(select 1 from public.shared_context_snapshots where id=context_id and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 origin:=case when p_action='console.page.viewed' then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

-- The event and business mutation commit or roll back together. Replays do not repeat the control.
create function public.control_recorded_workflow(p_property_id uuid,p_lead_id uuid,p_workflow_id uuid,p_actor_id uuid,p_action text,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.shared_action_events;before_state jsonb;result jsonb;saved jsonb;input jsonb:=jsonb_build_object('leadId',p_lead_id,'workflowId',p_workflow_id);organization uuid;
begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if organization is null then return '{"state":"forbidden"}';end if;
 if p_request_id is null or coalesce(p_action,'') not in ('pause','resume','stop') then raise exception 'Invalid action identity';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'workflow.'||p_action,input) then return '{"state":"request_conflict"}';end if;
  return e.result||jsonb_build_object('replayed',true,'workflow',(select to_jsonb(w)-'processing_started_at'-'processing_expires_at' from public.lead_workflows w where w.id=p_workflow_id and w.lead_id=p_lead_id));
 end if;
 select jsonb_build_object('status',w.status,'step',w.current_step,'nextActionAt',w.next_action_at) into before_state from public.lead_workflows w join public.leads l on l.id=w.lead_id where w.id=p_workflow_id and w.lead_id=p_lead_id and l.property_id=p_property_id;
 result:=public.control_lead_workflow(p_property_id,p_lead_id,p_workflow_id,p_actor_id,p_action);
 if result->>'state'='not_found' then return result;end if;
 result:=case when result ? 'workflow' then jsonb_set(result,'{workflow}',(result->'workflow')-'processing_started_at'-'processing_expires_at') else result end;
 saved:=public.append_shared_action_event(p_request_id,md5(p_workflow_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'tourspark','workflow.'||p_action,'server_confirmed',case when result->>'state'='applied' then 'succeeded' else 'failed' end,input,before_state,
  case when result ? 'workflow' then jsonb_build_object('status',result->'workflow'->'status','step',result->'workflow'->'current_step','nextActionAt',result->'workflow'->'next_action_at') end,result);
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Action record could not be saved';end if;
 return result||jsonb_build_object('actionEventId',p_request_id);
end; $$;

create function public.review_recorded_workflow_delivery(p_property_id uuid,p_lead_id uuid,p_delivery_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare before_state jsonb;workflow_id uuid;result jsonb;saved jsonb;existing public.shared_action_events;input jsonb;
begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select jsonb_build_object('state',state,'attempts',attempts,'errorCode',error_code)  ,lead_workflow_id into before_state,workflow_id from public.workflow_deliveries where id=p_delivery_id and property_id=p_property_id and lead_id=p_lead_id;
 result:=public.review_workflow_delivery(p_property_id,p_lead_id,p_delivery_id,p_actor_id,p_request_id,p_input);
 if result->>'state' not in ('applied','replayed') then return result;end if;
 -- Free-text evidence remains in the original scoped review. Store its reference here.
 input:=jsonb_build_object('leadId',p_lead_id,'deliveryId',p_delivery_id,'resolution',p_input->>'resolution','reviewRequestId',p_request_id);
 select * into existing from public.shared_action_events where id=p_request_id;
 if found then
  if (existing.property_id,existing.actor_id,existing.action,existing.request) is distinct from (p_property_id,p_actor_id,'workflow.delivery.reviewed',input) then raise exception 'Action identity conflict';end if;
  return result||jsonb_build_object('actionEventId',p_request_id);
 end if;
 saved:=public.append_shared_action_event(p_request_id,md5(workflow_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'tourspark','workflow.delivery.reviewed','server_confirmed','succeeded',input,
  case when result->>'state'='replayed' then null else before_state end,jsonb_build_object('state',result->>'deliveryState'),result||jsonb_build_object('reviewRequestId',p_request_id,'outcomeEvidence','operator_review'));
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Action record could not be saved';end if;
 return result||jsonb_build_object('actionEventId',p_request_id);
end; $$;

DO $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('protect_shared_action_history','append_shared_action_event','control_recorded_workflow','review_recorded_workflow_delivery') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end$$;
NOTIFY pgrst,'reload schema';
