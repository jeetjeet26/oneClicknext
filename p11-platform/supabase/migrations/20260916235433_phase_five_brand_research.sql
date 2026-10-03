create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'brand.%' then
  if p_product<>'brandforge' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid brand evidence';end if;
 elsif p_action in ('luma.configuration.created','luma.configuration.saved') then
  if p_product<>'lumaleasing' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid configuration evidence';end if;
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
 origin:=case when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;



create table public.brand_research_runs(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),claim_token uuid not null default gen_random_uuid(),
 state text not null default 'running' check(state in ('running','succeeded','failed','cancelled')),
 input jsonb not null,property_context jsonb not null,result jsonb not null default '{}',
 started_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index brand_research_runs_property on public.brand_research_runs(property_id,started_at desc);
create index brand_research_runs_actor on public.brand_research_runs(actor_id);
create unique index brand_research_runs_active on public.brand_research_runs(property_id) where state='running';
alter table public.brand_research_runs enable row level security;
create policy brand_research_service on public.brand_research_runs for all to service_role using(true) with check(true);
revoke all on public.brand_research_runs from public,anon,authenticated;
grant all on public.brand_research_runs to service_role;
create or replace function public.protect_brand_research() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if pg_trigger_depth()=1 then raise exception 'Research history is immutable';end if;return old;end if;
 if old.state<>'running' or (old.id,old.property_id,old.actor_id,old.claim_token,old.input,old.property_context,old.started_at) is distinct from (new.id,new.property_id,new.actor_id,new.claim_token,new.input,new.property_context,new.started_at) then raise exception 'Research history is immutable';end if;
 return new;
end;$$;
create trigger brand_research_immutable before update or delete on public.brand_research_runs for each row execute function public.protect_brand_research();
create or replace function public.begin_brand_research(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.brand_research_runs;property_row public.properties;e jsonb;
begin
 if p_request_id is null or jsonb_typeof(p_input) is distinct from 'object' or p_input-array['mode','radiusMiles','maxCompetitors']<>'{}' or coalesce(p_input->>'mode','') not in ('saved','refresh') or coalesce((p_input->>'radiusMiles')::numeric,0) not between 0.5 and 25 or coalesce((p_input->>'maxCompetitors')::int,0) not between 1 and 30 then raise exception 'Invalid research request';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into r from public.brand_research_runs where id=p_request_id;
 if found then
  if (r.property_id,r.actor_id,r.input) is distinct from (p_property_id,p_actor_id,p_input) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state',case when r.state='succeeded' then 'replayed' else r.state end,'requestId',r.id,'analysis',r.result);
 end if;
 if exists(select 1 from public.brand_research_runs where property_id=p_property_id and state='running') then return '{"state":"busy"}';end if;
 select * into property_row from public.properties where id=p_property_id for share;
 insert into public.brand_research_runs(id,property_id,actor_id,input,property_context) values(p_request_id,p_property_id,p_actor_id,p_input,jsonb_build_object('name',property_row.name,'address',to_jsonb(property_row)->'address','propertyType',to_jsonb(property_row)->'property_type')) returning * into r;
 e:=public.append_shared_action_event(public.brand_source_event_id('brand-research-start/'||p_request_id),p_request_id,p_property_id,p_actor_id,'brandforge','brand.research.requested','server_confirmed','succeeded',p_input,null,null,jsonb_build_object('state','running','requestId',r.id));
 if e->>'state' not in ('recorded','replayed') then raise exception 'Research request could not be recorded';end if;
 return jsonb_build_object('state','claimed','claimToken',r.claim_token,'requestId',r.id);
end;$$;
create or replace function public.check_brand_research(p_request_id uuid,p_claim_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.brand_research_runs;
begin
 select * into r from public.brand_research_runs where id=p_request_id;
 if not found or r.claim_token is distinct from p_claim_token then return '{"state":"claim_conflict"}';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=r.property_id and u.id=r.actor_id) then return '{"state":"forbidden"}';end if;
 return jsonb_build_object('state',case when r.state='running' then 'active' else r.state end);
end;$$;
create or replace function public.finish_brand_research(p_request_id uuid,p_claim_token uuid,p_result jsonb,p_error text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.brand_research_runs;e jsonb;output jsonb;
begin
 select * into r from public.brand_research_runs where id=p_request_id;
 if not found or r.claim_token is distinct from p_claim_token then return '{"state":"claim_conflict"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,12));
 select * into r from public.brand_research_runs where id=p_request_id for update;
 if r.state='succeeded' then return jsonb_build_object('state','replayed','requestId',r.id,'analysis',r.result);end if;
 if r.state<>'running' then return jsonb_build_object('state',r.state,'requestId',r.id);end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=r.property_id and u.id=r.actor_id) then return '{"state":"forbidden"}';end if;
 if p_error is not null and p_error<>'research_failed' then raise exception 'Invalid research failure';end if;
 if p_error is null and (jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>524288 or jsonb_typeof(p_result->'competitors') is distinct from 'array' or jsonb_typeof(p_result->'marketGaps') is distinct from 'array' or jsonb_typeof(p_result->'evidence') is distinct from 'object') then raise exception 'Invalid research snapshot';end if;
 output:=case when p_error is not null then jsonb_build_object('code',p_error,'provider',p_result->'provider') else p_result end;
 update public.brand_research_runs set state=case when p_error is null then 'succeeded' else 'failed' end,result=output,finished_at=clock_timestamp() where id=r.id;
 e:=public.append_shared_action_event(r.id,r.id,r.property_id,r.actor_id,'brandforge','brand.research.completed','server_confirmed',case when p_error is null then 'succeeded' else 'failed' end,r.input,null,case when p_error is null then jsonb_build_object('requestId',r.id,'competitorCount',jsonb_array_length(p_result->'competitors'),'evidence',p_result->'evidence') else null end,jsonb_build_object('state',case when p_error is null then 'saved' else 'failed' end,'requestId',r.id,'provider',p_result->'provider','code',p_error));
 if e->>'state' not in ('recorded','replayed') then raise exception 'Research result could not be recorded';end if;
 return jsonb_build_object('state',case when p_error is null then 'applied' else 'failed' end,'requestId',r.id,'analysis',output);
end;$$;
create or replace function public.cancel_brand_research(p_property_id uuid,p_request_id uuid,p_actor_id uuid,p_decision_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.brand_research_runs;e jsonb;prior public.shared_action_events;
begin
 if p_decision_id is null then raise exception 'Decision ID required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into prior from public.shared_action_events where id=p_decision_id;
 if found then
  if (prior.property_id,prior.actor_id,prior.action,prior.request) is distinct from (p_property_id,p_actor_id,'brand.research.cancelled',jsonb_build_object('requestId',p_request_id)) then return '{"state":"request_conflict"}';end if;
  return '{"state":"cancelled"}';
 end if;
 select * into r from public.brand_research_runs where id=p_request_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if r.state<>'running' then return jsonb_build_object('state',r.state);end if;
 update public.brand_research_runs set state='cancelled',finished_at=clock_timestamp() where id=r.id;
 e:=public.append_shared_action_event(p_decision_id,p_decision_id,p_property_id,p_actor_id,'brandforge','brand.research.cancelled','server_confirmed','succeeded',jsonb_build_object('requestId',r.id),jsonb_build_object('state','running'),jsonb_build_object('state','cancelled'),jsonb_build_object('state','cancelled','providerStopConfirmed',false));
 if e->>'state' not in ('recorded','replayed') then raise exception 'Research stop could not be recorded';end if;
 return '{"state":"cancelled"}';
end;$$;
revoke all on function public.protect_brand_research(),public.begin_brand_research(uuid,uuid,uuid,jsonb),public.check_brand_research(uuid,uuid),public.finish_brand_research(uuid,uuid,jsonb,text),public.cancel_brand_research(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.protect_brand_research(),public.begin_brand_research(uuid,uuid,uuid,jsonb),public.check_brand_research(uuid,uuid),public.finish_brand_research(uuid,uuid,jsonb,text),public.cancel_brand_research(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
