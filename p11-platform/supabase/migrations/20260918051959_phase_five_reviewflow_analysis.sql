create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.%' then
  if p_product<>'leadpulse' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid scoring evidence';end if;
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
 origin:=case when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
alter table public.reviews add column source_version integer not null default 1;
alter table public.review_analyses add column source_version integer;
create function public.guard_reviewflow_source() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if(new.id,new.property_id,new.platform,new.platform_review_id) is distinct from(old.id,old.property_id,old.platform,old.platform_review_id) then raise exception 'Review source identity cannot change';end if;
 if(new.review_text,new.rating,new.reviewer_name,new.review_date) is distinct from(old.review_text,old.rating,old.reviewer_name,old.review_date) then
  new.source_version:=old.source_version+1;new.sentiment:=null;new.sentiment_score:=null;new.topics:='[]'::jsonb;new.is_urgent:=false;
 else new.source_version:=old.source_version;end if;return new;
end$$;
create trigger reviewflow_source_guard before update on public.reviews for each row execute function public.guard_reviewflow_source();

create table public.reviewflow_commands(id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,actor_id uuid not null references public.profiles(id),kind text not null,input jsonb not null,input_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create index reviewflow_commands_property on public.reviewflow_commands(property_id,created_at desc);
create index reviewflow_commands_actor on public.reviewflow_commands(actor_id);
create table public.reviewflow_analysis_requests(
 id uuid primary key references public.shared_jobs(id),property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),review_id uuid not null references public.reviews(id) on delete cascade,source_version integer not null,
 input jsonb not null,input_hash text not null,source_snapshot jsonb not null,model_input jsonb not null,context_id uuid not null references public.shared_context_snapshots(id),
 state text not null default 'queued' check(state in('queued','running','result_ready','completed','held','stopped')),version integer not null default 1,claim_token uuid,raw_result jsonb,result_hash text,
 analysis_id uuid references public.review_analyses(id) deferrable initially deferred,error_code text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz
);
create unique index reviewflow_analysis_active on public.reviewflow_analysis_requests(review_id,source_version) where state in('queued','running','result_ready');
create index reviewflow_analysis_property on public.reviewflow_analysis_requests(property_id,created_at desc,id);
create index reviewflow_analysis_org on public.reviewflow_analysis_requests(org_id);
create index reviewflow_analysis_actor on public.reviewflow_analysis_requests(actor_id);
create index reviewflow_analysis_context on public.reviewflow_analysis_requests(context_id);
create index reviewflow_analysis_result on public.reviewflow_analysis_requests(analysis_id);
alter table public.reviewflow_commands enable row level security;
alter table public.reviewflow_analysis_requests enable row level security;
create policy reviewflow_commands_service on public.reviewflow_commands for all to service_role using(true) with check(true);
create policy reviewflow_analysis_service on public.reviewflow_analysis_requests for all to service_role using(true) with check(true);
revoke all on public.reviewflow_commands,public.reviewflow_analysis_requests from public,anon,authenticated;
grant all on public.reviewflow_commands,public.reviewflow_analysis_requests to service_role;
create function public.guard_reviewflow_analysis() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) or not exists(select 1 from public.reviews where id=old.review_id) then return old;end if;raise exception 'Analysis request history is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.review_id,new.source_version,new.input,new.input_hash,new.source_snapshot,new.model_input,new.context_id,new.created_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.review_id,old.source_version,old.input,old.input_hash,old.source_snapshot,old.model_input,old.context_id,old.created_at) then raise exception 'Analysis request identity is immutable';end if;
 if old.claim_token is not null and new.claim_token is distinct from old.claim_token then raise exception 'One model intent is retained';end if;
 if old.raw_result is not null and(new.raw_result,new.result_hash) is distinct from(old.raw_result,old.result_hash) then raise exception 'Model result is immutable';end if;
 if old.state in('completed','held','stopped') and new.state<>old.state then raise exception 'Closed analysis cannot restart';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_analysis_guard before update or delete on public.reviewflow_analysis_requests for each row execute function public.guard_reviewflow_analysis();
create function public.reviewflow_command_start(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare prior public.reviewflow_commands;begin
 if p_id is null or jsonb_typeof(p_input) is distinct from 'object' or length(p_input::text)>524288 then raise exception 'Invalid review decision';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));select * into prior from public.reviewflow_commands where id=p_id;
 if found then if(prior.property_id,prior.actor_id,prior.kind,prior.input_hash) is distinct from(p_property_id,p_actor_id,p_kind,public.crm_configuration_hash(p_input)) then return '{"state":"request_conflict"}';end if;return prior.result||'{"state":"replayed"}';end if;return '{"state":"new"}';
end$$;
create function public.reviewflow_command_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$declare recorded jsonb;begin
 insert into public.reviewflow_commands(id,property_id,actor_id,kind,input,input_hash,result) values(p_id,p_property_id,p_actor_id,p_kind,p_input,public.crm_configuration_hash(p_input),p_result);
 recorded:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'reviewflow','review.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_input)),p_before,p_after,p_result,p_links);
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Review decision history could not be saved';end if;return p_result||'{"state":"saved"}';end$$;

create function public.begin_reviewflow_analysis(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_model_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;run public.reviewflow_analysis_requests;review public.reviews;organization uuid;context uuid;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'analysis.requested',p_input);if result->>'state' not in('new','replayed') then return result;end if;
 select * into run from public.reviewflow_analysis_requests where id=p_id;if found then return jsonb_build_object('state',run.state,'requestId',run.id,'version',run.version,'analysisId',run.analysis_id);end if;
 if(p_input-'reviewId'-'sourceVersion')<>'{}'::jsonb or jsonb_typeof(p_input->'sourceVersion') is distinct from 'number' then raise exception 'Choose the saved review source';end if;
 select * into review from public.reviews where id=(p_input->>'reviewId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if review.source_version is distinct from(p_input->>'sourceVersion')::integer then return '{"state":"stale_source"}';end if;
 if length(trim(coalesce(review.review_text,''))) not between 1 and 20000 then return '{"state":"source_unavailable"}';end if;
 select * into run from public.reviewflow_analysis_requests where review_id=review.id and source_version=review.source_version and state in('queued','running','result_ready');if found then return jsonb_build_object('state','busy','requestId',run.id,'version',run.version);end if;
 if jsonb_typeof(p_model_input) is distinct from 'object' or length(p_model_input::text)>131072 or p_model_input->'source' is distinct from jsonb_build_object('reviewText',review.review_text,'rating',review.rating,'platform',review.platform,'reviewerName',review.reviewer_name) or length(coalesce(p_model_input->>'model','')) not between 1 and 200 or length(coalesce(p_model_input->>'systemPrompt','')) not between 1 and 20000 or length(coalesce(p_model_input->>'userPrompt','')) not between 1 and 24000 or p_model_input->>'promptVersion' is distinct from 'analysis-v3' then raise exception 'The saved analysis input is incomplete or stale';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by) values(organization,p_property_id,'reviewflow.analysis',review.id::text,jsonb_build_object('review',to_jsonb(review),'modelInput',p_model_input),public.crm_configuration_hash(p_model_input),p_actor_id::text) returning id into context;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,max_attempts,stage,progress,current_step) values(p_id,organization,p_property_id,'reviewflow.analysis','review',review.id::text,'queued','analysis_saved',p_id::text,jsonb_build_object('requestId',p_id,'reviewId',review.id,'sourceVersion',review.source_version),context,1,'queued',0,'Saved review analysis awaits execution');
 insert into public.reviewflow_analysis_requests(id,property_id,org_id,actor_id,review_id,source_version,input,input_hash,source_snapshot,model_input,context_id) values(p_id,p_property_id,organization,p_actor_id,review.id,review.source_version,p_input,public.crm_configuration_hash(p_input),to_jsonb(review),p_model_input,context);
 perform public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'analysis.requested',p_input,jsonb_build_object('reviewId',review.id,'sourceVersion',review.source_version),jsonb_build_object('requestId',p_id,'state','queued'),jsonb_build_object('requestId',p_id,'reviewId',review.id,'sourceVersion',review.source_version,'modelInvoked',false),jsonb_build_object('jobId',p_id,'contextId',context));
 return jsonb_build_object('state','queued','requestId',p_id,'version',1);
end$$;

create function public.record_reviewflow_analysis_event(p_run public.reviewflow_analysis_requests,p_actor_id uuid,p_action text,p_phase text,p_result jsonb) returns void language plpgsql security invoker set search_path='' as $$declare event_id uuid;recorded jsonb;begin
 -- Keep private receipts even after the requester leaves; never invent a replacement human actor.
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_run.property_id and p.org_id=p_run.org_id) then return;end if;
 event_id:=md5(p_action||':'||p_run.id::text)::uuid;
 recorded:=public.append_shared_action_event(event_id,event_id,p_run.property_id,p_actor_id,'reviewflow',p_action,'server_confirmed',p_phase,jsonb_build_object('requestId',p_run.id,'sourceVersion',p_run.source_version),jsonb_build_object('state',p_run.state),jsonb_build_object('state',p_result->>'requestState'),p_result||jsonb_build_object('requestId',p_run.id,'origin','analysis_worker','requestedBy',p_run.actor_id,'publicationStarted',false),jsonb_build_object('jobId',p_run.id,'contextId',p_run.context_id));
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Analysis outcome history could not be saved';end if;
end$$;

create function public.claim_reviewflow_analysis(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare run public.reviewflow_analysis_requests;begin
 select * into run from public.reviewflow_analysis_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_analysis_requests where id=p_id for update;
 if run.state<>'queued' then return jsonb_build_object('state',run.state);end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id join public.reviews r on r.property_id=p.id where p.id=run.property_id and p.org_id=run.org_id and u.id=run.actor_id and r.id=run.review_id and r.source_version=run.source_version) then
  update public.reviewflow_analysis_requests set state='held',error_code='source_or_access_changed',finished_at=clock_timestamp() where id=run.id;update public.shared_jobs set lifecycle_status='failed',status_reason='source_or_access_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;perform public.record_reviewflow_analysis_event(run,run.actor_id,'review.analysis.completed','failed',jsonb_build_object('requestState','held','reason','source_or_access_changed'));return '{"state":"held"}';
 end if;
 update public.reviewflow_analysis_requests set state='running',claim_token=gen_random_uuid(),started_at=clock_timestamp() where id=run.id returning * into run;
 update public.shared_jobs set lifecycle_status='running',attempt_count=1,stage='analyzing',progress=10,started_at=clock_timestamp(),current_step='One model request started; awaiting its saved result',updated_at=clock_timestamp() where id=run.id;
 perform public.record_reviewflow_analysis_event(run,run.actor_id,'review.analysis.started','succeeded',jsonb_build_object('requestState','running'));
 return jsonb_build_object('state','invoke_once','claimToken',run.claim_token,'modelInput',run.model_input,'propertyId',run.property_id,'actorId',run.actor_id);
end$$;

create function public.record_reviewflow_analysis_result(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare run public.reviewflow_analysis_requests;next_state text;begin
 select * into run from public.reviewflow_analysis_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_analysis_requests where id=p_id for update;
 if p_claim_token is null or run.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if run.raw_result is not null then if run.result_hash=public.crm_configuration_hash(p_result) then return jsonb_build_object('state','replayed','requestState',run.state);end if;return '{"state":"result_conflict"}';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>262144 or coalesce(p_result->>'status','') not in('received','uncertain') or(p_result-'status'-'content'-'providerId'-'usage'-'errorCode')<>'{}'::jsonb or(p_result->>'status'='received' and jsonb_typeof(p_result->'content') is distinct from 'string') then raise exception 'Invalid model receipt';end if;
 next_state:=case when run.state in('held','stopped') then run.state when p_result->>'status'='uncertain' then 'held' else 'result_ready' end;
 update public.reviewflow_analysis_requests set raw_result=p_result,result_hash=public.crm_configuration_hash(p_result),state=next_state,error_code=case when p_result->>'status'='uncertain' then 'model_uncertain' else error_code end where id=run.id;
 if next_state<>'stopped' then update public.shared_jobs set lifecycle_status='failed',status_reason=case when next_state='result_ready' then 'analysis_result_saved' else 'model_uncertain' end,stage='review',current_step=case when next_state='result_ready' then 'Saved model result awaits validated application' else 'Model outcome needs operator review' end,updated_at=clock_timestamp() where id=run.id;end if;
 perform public.record_reviewflow_analysis_event(run,run.actor_id,'review.analysis.result_received',case when p_result->>'status'='received' then 'succeeded' else 'failed' end,jsonb_build_object('requestState',next_state,'resultHash',public.crm_configuration_hash(p_result),'receiptStatus',p_result->>'status'));
 return jsonb_build_object('state','saved','requestState',next_state);
end$$;

create function public.apply_reviewflow_analysis(p_id uuid,p_property_id uuid,p_actor_id uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.reviewflow_analysis_requests;review public.reviews;case_row public.reputation_cases;classification jsonb;next_priority text;ticket public.review_tickets;analysis_version integer;event_result jsonb;event_id uuid;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));select * into run from public.reviewflow_analysis_requests where id=p_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.state='completed' then return jsonb_build_object('state','replayed','analysisId',run.analysis_id);end if;
 if run.state in('stopped','held') then return jsonb_build_object('state',run.state);end if;
 if run.state<>'result_ready' or run.raw_result is null then return '{"state":"result_required"}';end if;
 select * into review from public.reviews where id=run.review_id and property_id=p_property_id for update;
 if review.source_version is distinct from run.source_version or not exists(select 1 from public.properties where id=p_property_id and org_id=run.org_id) then
  update public.reviewflow_analysis_requests set state='held',error_code='source_changed',finished_at=clock_timestamp() where id=run.id;update public.shared_jobs set lifecycle_status='failed',status_reason='source_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;perform public.record_reviewflow_analysis_event(run,p_actor_id,'review.analysis.completed','failed',jsonb_build_object('requestState','held','reason','source_changed'));return '{"state":"held","reason":"source_changed"}';
 end if;
 if p_result->>'resultHash' is distinct from run.result_hash or(p_result-'resultHash'-'analysis'-'errorCode')<>'{}'::jsonb then return '{"state":"result_conflict"}';end if;
 if p_result->>'errorCode'='invalid_output' then
  update public.reviewflow_analysis_requests set state='held',error_code='invalid_output',finished_at=clock_timestamp() where id=run.id;update public.shared_jobs set lifecycle_status='failed',status_reason='invalid_output',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;perform public.record_reviewflow_analysis_event(run,p_actor_id,'review.analysis.completed','failed',jsonb_build_object('requestState','held','reason','invalid_output'));return '{"state":"held","reason":"invalid_output"}';
 end if;
 classification:=p_result->'analysis';
 if jsonb_typeof(classification) is distinct from 'object' or length(classification::text)>32768 or classification->'provenance'->>'model' is distinct from run.model_input->>'model' or classification->'provenance'->>'promptVersion' is distinct from run.model_input->>'promptVersion' or classification->'provenance'->>'taxonomyVersion' is distinct from run.model_input->>'taxonomyVersion' or classification->'provenance'->>'policyVersion' is distinct from run.model_input->>'policyVersion' or classification->>'sentiment' not in('positive','neutral','negative') or jsonb_typeof(classification->'policy'->'requiresHumanReview') is distinct from 'boolean' then raise exception 'Analysis result does not match its saved contract';end if;
 if(classification-'policy'-'provenance'-'usage'-'policyClass') is distinct from((run.raw_result->>'content')::jsonb-'policyClass') then raise exception 'Analysis differs from its saved model receipt';end if;
 if jsonb_typeof(classification->'topics') is distinct from 'array' or jsonb_typeof(classification->'evidence') is distinct from 'array' or jsonb_typeof(classification->'issueDomains') is distinct from 'array' then raise exception 'Invalid analysis evidence';end if;
 if exists(select 1 from jsonb_array_elements(classification->'evidence') e where length(coalesce(e->>'quote',''))=0 or position(e->>'quote' in review.review_text)=0) then raise exception 'Analysis quotations must exist in the saved review';end if;
 select coalesce(max(a.analysis_version),0)+1 into analysis_version from public.review_analyses a where a.review_id=review.id;
 insert into public.review_analyses(id,review_id,property_id,source_version,analysis_version,taxonomy_version,model,prompt_version,status,sentiment,sentiment_score,topics,journey_stage,issue_domains,severity,risk_class,policy_class,policy_flags,evidence,confidence,is_urgent,summary,recommended_action,usage)
 values(run.id,review.id,p_property_id,run.source_version,analysis_version,classification->'provenance'->>'taxonomyVersion',classification->'provenance'->>'model',classification->'provenance'->>'promptVersion',case when (classification->'policy'->>'requiresHumanReview')::boolean then 'manual_review_required' else 'completed' end,classification->>'sentiment',(classification->>'sentimentScore')::numeric,classification->'topics',classification->>'journeyStage',classification->'issueDomains',classification->>'severity',classification->>'riskClass',classification->>'policyClass',classification->'policy'->'flags',classification->'evidence',(classification->>'confidence')::numeric,(classification->>'isUrgent')::boolean,classification->>'summary',classification->>'recommendedAction',classification->'usage');
 update public.reviews set sentiment=classification->>'sentiment',sentiment_score=(classification->>'sentimentScore')::numeric,topics=classification->'topics',is_urgent=(classification->>'isUrgent')::boolean,updated_at=clock_timestamp() where id=review.id;
 next_priority:=case when (classification->>'isUrgent')::boolean or classification->>'severity'='critical' or classification->>'riskClass'='legal_regulatory' then 'urgent' when classification->>'severity'='high' or classification->>'sentiment'='negative' then 'high' when classification->>'severity'='medium' or classification->>'sentiment'='neutral' then 'medium' else 'low' end;
 insert into public.reputation_cases(property_id,review_id,status,priority) values(p_property_id,review.id,'open',next_priority) on conflict(review_id) do nothing;
 select * into case_row from public.reputation_cases where review_id=review.id for update;if case_row.property_id<>p_property_id then raise exception 'Review case scope does not match';end if;
 update public.reputation_cases set status=case when status='open' then 'triaged' else status end,priority=next_priority,risk_class=classification->>'riskClass',policy_class=classification->>'policyClass',journey_stage=classification->>'journeyStage',issue_domains=classification->'issueDomains',root_cause=classification->>'summary',sla_due_at=case when status='open' or sla_due_at is null then clock_timestamp()+make_interval(hours=>case next_priority when 'urgent' then 4 when 'high' then 24 when 'medium' then 72 else 168 end) else sla_due_at end,last_activity_at=clock_timestamp(),updated_at=clock_timestamp() where id=case_row.id;
 if case_row.status not in('resolved','dismissed') and (classification->>'sentiment'='negative' or(classification->>'isUrgent')::boolean) then
  select * into ticket from public.review_tickets t where t.review_id=review.id and t.property_id=p_property_id and t.title not ilike 'provider response posted%' order by t.created_at,t.id limit 1 for update;
  if not found then insert into public.review_tickets(review_id,property_id,title,description,priority,status) values(review.id,p_property_id,'Review needs staff attention',classification->>'summary',next_priority,'open') returning * into ticket;
  elsif ticket.status not in('resolved','closed') then update public.review_tickets set priority=next_priority,description=classification->>'summary',updated_at=clock_timestamp() where id=ticket.id;end if;
  update public.reputation_cases set source_ticket_id=ticket.id where id=case_row.id and source_ticket_id is null;
 end if;
 insert into public.reputation_case_events(case_id,property_id,event_type,actor_label,payload) values(case_row.id,p_property_id,'analysis_recorded','analysis_worker',jsonb_build_object('requestId',run.id,'analysisId',run.id,'sourceVersion',run.source_version,'requestedBy',run.actor_id,'savedBy',p_actor_id,'requiresHumanReview',classification->'policy'->'requiresHumanReview'));
 update public.reviewflow_analysis_requests set state='completed',analysis_id=run.id,error_code=null,finished_at=clock_timestamp() where id=run.id;
 update public.shared_jobs set lifecycle_status='succeeded',stage='completed',progress=100,status_reason='analysis_applied',current_step='Analysis and case saved together',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 event_id:=md5('reviewflow-analysis-completed:'||run.id::text)::uuid;
 event_result:=public.append_shared_action_event(event_id,event_id,p_property_id,p_actor_id,'reviewflow','review.analysis.completed','server_confirmed','succeeded',jsonb_build_object('requestId',run.id,'resultHash',run.result_hash),jsonb_build_object('reviewId',review.id,'sourceVersion',run.source_version,'caseStatus',case_row.status),jsonb_build_object('analysisId',run.id,'sentiment',classification->>'sentiment','priority',next_priority,'requiresHumanReview',classification->'policy'->'requiresHumanReview'),jsonb_build_object('requestId',run.id,'analysisId',run.id,'caseId',case_row.id,'origin','model_result','requestedBy',run.actor_id,'savedBy',p_actor_id,'publicationStarted',false),jsonb_build_object('jobId',run.id,'contextId',run.context_id));
 if event_result->>'state' not in('recorded','replayed') then raise exception 'Analysis history could not be saved';end if;
 return jsonb_build_object('state','saved','analysisId',run.id,'requiresHumanReview',classification->'policy'->'requiresHumanReview');
end$$;

create function public.control_reviewflow_analysis(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;run public.reviewflow_analysis_requests;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'analysis.stopped',p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'analysisRequestId'-'expectedVersion'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the request and explain the stop';end if;
 select * into run from public.reviewflow_analysis_requests where id=(p_input->>'analysisRequestId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if run.state in('completed','stopped','held') then return jsonb_build_object('state',run.state);end if;
 update public.reviewflow_analysis_requests set state='stopped',finished_at=clock_timestamp() where id=run.id;
 update public.shared_jobs set lifecycle_status='cancelled',stage='stopped',status_reason='operator_stopped',current_step='Stopped; late results are retained without application',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'analysis.stopped',p_input,jsonb_build_object('state',run.state,'version',run.version),jsonb_build_object('state','stopped'),jsonb_build_object('requestId',run.id,'providerCancellationConfirmed',false),jsonb_build_object('jobId',run.id,'contextId',run.context_id));
end$$;

create function public.guard_reviewflow_evidence() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Review evidence is immutable';end$$;
create trigger reviewflow_command_immutable before update or delete on public.reviewflow_commands for each row execute function public.guard_reviewflow_evidence();
create trigger reviewflow_analysis_immutable before update or delete on public.review_analyses for each row execute function public.guard_reviewflow_evidence();
revoke insert,update,delete on public.review_analyses,public.reputation_case_events from public,anon,authenticated;
revoke delete on public.reviews from public,anon,authenticated;

create function public.request_reviewflow_analysis_recovery(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;run public.reviewflow_analysis_requests;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'analysis.recovered',p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'analysisRequestId'-'expectedVersion'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the saved result and recovery reason';end if;
 select * into run from public.reviewflow_analysis_requests where id=(p_input->>'analysisRequestId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if run.state not in('queued','result_ready','completed') then return jsonb_build_object('state',run.state);end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'analysis.recovered',p_input,jsonb_build_object('state',run.state,'version',run.version),jsonb_build_object('state',run.state),jsonb_build_object('requestId',run.id,'requestState',run.state,'modelInvoked',false),jsonb_build_object('jobId',run.id,'contextId',run.context_id));
end$$;

revoke all on function public.record_reviewflow_analysis_event(public.reviewflow_analysis_requests,uuid,text,text,jsonb),public.request_reviewflow_analysis_recovery(uuid,uuid,uuid,jsonb),public.guard_reviewflow_source(),public.guard_reviewflow_analysis(),public.guard_reviewflow_evidence(),public.reviewflow_command_start(uuid,uuid,uuid,text,jsonb),public.reviewflow_command_finish(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.begin_reviewflow_analysis(uuid,uuid,uuid,jsonb,jsonb),public.claim_reviewflow_analysis(uuid),public.record_reviewflow_analysis_result(uuid,uuid,jsonb),public.apply_reviewflow_analysis(uuid,uuid,uuid,jsonb),public.control_reviewflow_analysis(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_reviewflow_analysis_event(public.reviewflow_analysis_requests,uuid,text,text,jsonb),public.request_reviewflow_analysis_recovery(uuid,uuid,uuid,jsonb),public.guard_reviewflow_source(),public.guard_reviewflow_analysis(),public.guard_reviewflow_evidence(),public.reviewflow_command_start(uuid,uuid,uuid,text,jsonb),public.reviewflow_command_finish(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.begin_reviewflow_analysis(uuid,uuid,uuid,jsonb,jsonb),public.claim_reviewflow_analysis(uuid),public.record_reviewflow_analysis_result(uuid,uuid,jsonb),public.apply_reviewflow_analysis(uuid,uuid,uuid,jsonb),public.control_reviewflow_analysis(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
