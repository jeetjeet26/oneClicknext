create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
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
 origin:=case when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create or replace function public.append_marketvision_service_event(p_id uuid,p_job_id uuid,p_action text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.shared_jobs;e public.shared_action_events;principal text:=case when p_action like 'market.brand.%'then 'marketvision.brand'when p_action='market.brief.completed'then 'marketvision.brief'when p_action like 'market.source.%'then 'marketvision.source'else 'marketvision.extraction'end;begin
 if p_id is null or p_job_id is null or p_phase not in('succeeded','failed') or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object' or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid market service outcome';end if;
 if p_action not in('market.brand.started','market.brand.result_received','market.brand.previewed','market.brand.held','market.brief.completed','market.source.started','market.source.result_received','market.source.held','market.extraction.started','market.extraction.result_received','market.extraction.previewed','market.extraction.held') then raise exception 'Unregistered market service outcome';end if;
 select * into job from public.shared_jobs where id=p_job_id and domain=principal;if not found or job.property_id is null then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(job.property_id::text,71));select * into e from public.shared_action_events where id=p_id;
 if found then if(e.property_id,e.org_id,e.shared_job_ref,e.service_principal,e.action,e.phase,e.request,e.before_state,e.after_state,e.result) is distinct from(job.property_id,job.org_id,job.id,principal,p_action,p_phase,p_request,p_before,p_after,p_result) then return '{"state":"request_conflict"}';end if;return jsonb_build_object('state','replayed','eventId',e.id);end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin)values(p_id,job.org_id,job.property_id,null,principal,'workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,context_snapshot_ref)values(p_id,p_id,job.org_id,job.property_id,null,principal,'marketvision',p_action,'server_confirmed',p_phase,p_request,p_before,p_after,p_result,job.id,job.context_snapshot_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end$$;
create or replace function public.marketvision_decision_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_resource_id uuid,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare event jsonb;begin
 insert into public.marketvision_decisions(id,org_id,property_id,actor_id,kind,resource_id,input,input_hash,before_state,after_state,result)values(p_id,(select org_id from public.properties where id=p_property_id),p_property_id,p_actor_id,p_kind,p_resource_id,p_input,public.crm_configuration_hash(p_input),p_before,p_after,p_result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'marketvision','market.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_input),'resourceId',p_resource_id),case when p_before is not null then jsonb_build_object('version',p_before->'version','stateHash',public.crm_configuration_hash(p_before)) end,case when p_after is not null then jsonb_build_object('version',p_after->'version','stateHash',public.crm_configuration_hash(p_after)) end,p_result,case when (p_kind like 'extraction.%'or p_kind like 'source.%'or p_kind like 'brand.%'or p_kind like 'intake.%'or p_kind like 'brief.%'or p_kind like 'handoff.%') then coalesce((select jsonb_build_object('jobId',j.id,'contextId',j.context_snapshot_id,'attemptId',case when p_kind like 'handoff.%'then (select h.attempt_id from public.marketvision_handoffs h where h.id=j.id)else null end)from public.shared_jobs j where j.id=(p_result->>'requestId')::uuid and j.property_id=p_property_id),'{}')else '{}'end);
 if event->>'state' not in('recorded','replayed') then raise exception 'Market decision history could not be saved';end if;return p_result||'{"state":"saved"}';
end$$;
create table public.marketvision_brand_requests(
 id uuid primary key references public.shared_jobs(id),property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),competitor_id uuid not null references public.competitors(id),source_id uuid not null references public.marketvision_source_requests(id),context_id uuid not null references public.shared_context_snapshots(id),
 input jsonb not null,input_hash text not null,source_snapshot jsonb not null,model_input jsonb not null,
 state text not null default 'queued'check(state in('queued','running','result_ready','preview_ready','held','stopped','completed')),version integer not null default 1,claim_token uuid,raw_result jsonb,result_hash text,preview jsonb,preview_hash text,error_code text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz
);
create unique index marketvision_brand_active on public.marketvision_brand_requests(competitor_id)where state in('queued','running','result_ready','preview_ready');
create index marketvision_brand_competitor on public.marketvision_brand_requests(competitor_id);
create index marketvision_brand_property on public.marketvision_brand_requests(property_id,created_at desc,id desc);
create index marketvision_brand_org on public.marketvision_brand_requests(org_id);
create index marketvision_brand_actor on public.marketvision_brand_requests(actor_id);
create index marketvision_brand_source on public.marketvision_brand_requests(source_id);
create index marketvision_brand_context on public.marketvision_brand_requests(context_id);
alter table public.marketvision_brand_requests enable row level security;
revoke all on public.marketvision_brand_requests from public,anon,authenticated;
grant all on public.marketvision_brand_requests to service_role;
create policy marketvision_brand_service on public.marketvision_brand_requests for all to service_role using(true)with check(true);
create table public.marketvision_brand_reviews(
 id uuid primary key,review_sequence bigint generated always as identity unique,request_id uuid not null references public.marketvision_brand_requests(id),property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),competitor_id uuid not null references public.competitors(id),actor_id uuid not null references public.profiles(id),previous_review_id uuid references public.marketvision_brand_reviews(id),disposition text not null check(disposition in('published','withdrawn')),claims jsonb not null,input jsonb not null,input_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create index marketvision_brand_review_competitor on public.marketvision_brand_reviews(competitor_id,review_sequence desc);
create index marketvision_brand_review_property on public.marketvision_brand_reviews(property_id,review_sequence desc);
create index marketvision_brand_review_request on public.marketvision_brand_reviews(request_id);
create index marketvision_brand_review_org on public.marketvision_brand_reviews(org_id);
create index marketvision_brand_review_actor on public.marketvision_brand_reviews(actor_id);
create index marketvision_brand_review_previous on public.marketvision_brand_reviews(previous_review_id);
alter table public.marketvision_brand_reviews enable row level security;
revoke all on public.marketvision_brand_reviews from public,anon,authenticated;
grant all on public.marketvision_brand_reviews to service_role;
create policy marketvision_brand_review_service on public.marketvision_brand_reviews for all to service_role using(true)with check(true);
create function public.guard_marketvision_brand_review()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Brand review revisions are retained';
end$$;
create trigger marketvision_brand_review_guard before update or delete on public.marketvision_brand_reviews for each row execute function public.guard_marketvision_brand_review();
create function public.guard_marketvision_brand_request()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Saved brand analysis is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.competitor_id,new.source_id,new.context_id,new.input,new.input_hash,new.source_snapshot,new.model_input,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.competitor_id,old.source_id,old.context_id,old.input,old.input_hash,old.source_snapshot,old.model_input,old.created_at)then raise exception 'Saved brand source and model input are immutable';end if;
 if old.claim_token is not null and new.claim_token is distinct from old.claim_token then raise exception 'One brand model invocation is retained';end if;
 if old.raw_result is not null and(new.raw_result,new.result_hash)is distinct from(old.raw_result,old.result_hash)then raise exception 'Brand model receipts cannot be replaced';end if;
 if old.preview is not null and(new.preview,new.preview_hash)is distinct from(old.preview,old.preview_hash)then raise exception 'Original brand preview cannot be replaced';end if;
 if old.state in('completed','stopped')and new.state<>old.state then raise exception 'Closed brand analysis cannot restart';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger marketvision_brand_request_guard before update or delete on public.marketvision_brand_requests for each row execute function public.guard_marketvision_brand_request();
create function public.record_marketvision_brand_event(p_run public.marketvision_brand_requests,p_action text,p_phase text,p_result jsonb)returns void language plpgsql security invoker set search_path=''as $$declare saved jsonb;begin
 saved:=public.append_marketvision_service_event(md5(p_action||':'||p_run.id::text)::uuid,p_run.id,p_action,p_phase,jsonb_build_object('requestId',p_run.id),jsonb_build_object('state',p_run.state),jsonb_build_object('state',p_result->>'requestState'),p_result||jsonb_build_object('requestedBy',p_run.actor_id));
 if saved->>'state'not in('recorded','replayed')then raise exception 'Brand analysis outcome history could not be saved';end if;
end$$;
create function public.valid_marketvision_brand_claim(p_claim jsonb,p_content text)returns boolean language sql immutable security invoker set search_path=''as $$select
 coalesce(jsonb_typeof(p_claim)='object'and(p_claim-array['category','kind','statement','quote'])='{}'and p_claim->>'category'in('positioning','audience','voice','amenity','service','promotion','lifestyle','messaging','call_to_action')and p_claim->>'kind'in('source_claim','interpretation')and jsonb_typeof(p_claim->'statement')='string'and length(trim(p_claim->>'statement'))between 1 and 1000 and jsonb_typeof(p_claim->'quote')='string'and length(p_claim->>'quote')between 1 and 1000 and position(p_claim->>'quote'in p_content)>0,false);
$$;
create function public.begin_marketvision_brand(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_model_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior jsonb;entry public.marketvision_brand_requests;source_run public.marketvision_source_requests;competitor public.competitors;organization uuid;context uuid;snapshot jsonb;begin
 prior:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,'brand.requested',p_input);if prior->>'state'not in('new','replayed')then return prior;end if;
 select *into entry from public.marketvision_brand_requests where id=p_id;if found then return jsonb_build_object('state',entry.state,'requestId',entry.id,'version',entry.version);end if;
 if(p_input-array['competitorId','sourceId','sourceVersion','confirmedSourceScope','reason'])<>'{}'or p_input->'confirmedSourceScope'is distinct from 'true'::jsonb then raise exception 'Review the exact retained public page';end if;
 select *into competitor from public.competitors where id=(p_input->>'competitorId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if not public.marketvision_capture_current((p_input->>'sourceId')::uuid,p_property_id,competitor.id)then return '{"state":"source_unavailable"}';end if;
 select *into source_run from public.marketvision_source_requests where id=(p_input->>'sourceId')::uuid;
 if source_run.version is distinct from(p_input->>'sourceVersion')::integer then return '{"state":"stale_source"}';end if;
 if length(source_run.raw_result->>'text')not between 50 and 50000 or octet_length(source_run.raw_result->>'text')>80000 then return '{"state":"source_too_large"}';end if;
 select *into entry from public.marketvision_brand_requests where competitor_id=competitor.id and state in('queued','running','result_ready','preview_ready');if found then return jsonb_build_object('state','busy','requestId',entry.id,'version',entry.version);end if;
 if jsonb_typeof(p_model_input)is distinct from 'object'or octet_length(p_model_input::text)>300000 or p_model_input->>'model'is distinct from 'gpt-4o-mini'or p_model_input->>'promptVersion'is distinct from 'brand-evidence-v1'or p_model_input->'maxTokens'is distinct from '8000'::jsonb or p_model_input->'source'is distinct from jsonb_build_object('content',source_run.raw_result->>'text','sourceUrl',source_run.raw_result->>'finalUrl','competitorName',competitor.name)or length(coalesce(p_model_input->>'systemPrompt',''))not between 1 and 10000 or position(source_run.raw_result->>'text'in coalesce(p_model_input->>'userPrompt',''))=0 then raise exception 'Brand model input must retain the exact reviewed page';end if;
 organization:=source_run.org_id;snapshot:=jsonb_build_object('competitorId',competitor.id,'competitorName',competitor.name,'competitorVersion',competitor.version,'sourceId',source_run.id,'sourceVersion',source_run.version,'captureId',source_run.capture_id,'sourceUrl',source_run.raw_result->>'finalUrl','fetchedAt',source_run.raw_result->>'fetchedAt','bodyHash',source_run.raw_result->>'bodyHash','textTruncated',source_run.raw_result->'textTruncated','providerVerified',false);
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by)values(organization,p_property_id,'marketvision.brand',p_id::text,jsonb_build_object('source',snapshot,'modelInput',p_model_input),public.crm_configuration_hash(jsonb_build_object('source',snapshot,'modelInput',p_model_input)),p_actor_id::text)returning id into context;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,max_attempts,stage,progress,current_step)values(p_id,organization,p_property_id,'marketvision.brand','competitor',competitor.id::text,'queued','brand_analysis_saved',p_id::text,jsonb_build_object('requestId',p_id,'competitorId',competitor.id),context,1,'queued',0,'Exact retained page awaits one brand analysis');
 insert into public.marketvision_brand_requests(id,property_id,org_id,actor_id,competitor_id,source_id,context_id,input,input_hash,source_snapshot,model_input)values(p_id,p_property_id,organization,p_actor_id,competitor.id,source_run.id,context,p_input,public.crm_configuration_hash(p_input),snapshot,p_model_input);
 perform public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,'brand.requested',competitor.id,p_input,null,jsonb_build_object('state','queued','version',1),jsonb_build_object('requestId',p_id,'competitorId',competitor.id,'modelInvoked',false));
 return jsonb_build_object('state','queued','requestId',p_id,'version',1);
end$$;

create or replace function public.claim_marketvision_brand(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare r public.marketvision_brand_requests;previous public.marketvision_brand_requests;begin
 select * into r from public.marketvision_brand_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,71));select * into r from public.marketvision_brand_requests where id=p_id for update;
 if r.state<>'queued' or r.claim_token is not null then return jsonb_build_object('state',r.state);end if;
 if not public.marketvision_capture_current(r.source_id,r.property_id,r.competitor_id)or not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id join public.competitors c on c.property_id=p.id where p.id=r.property_id and p.org_id=r.org_id and u.id=r.actor_id and c.id=r.competitor_id and c.is_active and c.version=(r.source_snapshot->>'competitorVersion')::integer) then
  update public.marketvision_brand_requests set state='held',error_code='source_or_access_changed',finished_at=clock_timestamp()where id=r.id;update public.shared_jobs set lifecycle_status='failed',status_reason='source_or_access_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp()where id=r.id;perform public.record_marketvision_brand_event(r,'market.brand.held','failed','{"requestState":"held","reason":"source_or_access_changed"}');return '{"state":"held"}';end if;
 previous:=r;
 update public.marketvision_brand_requests set state='running',claim_token=gen_random_uuid(),started_at=clock_timestamp()where id=r.id returning * into r;
 update public.shared_jobs set lifecycle_status='running',attempt_count=1,stage='analyzing',progress=10,started_at=clock_timestamp(),current_step='One brand analysis started; awaiting its retained result',updated_at=clock_timestamp()where id=r.id;
 perform public.record_marketvision_brand_event(previous,'market.brand.started','succeeded','{"requestState":"running"}');return jsonb_build_object('state','invoke_once','claimToken',r.claim_token,'modelInput',r.model_input,'propertyId',r.property_id);
end$$;

create or replace function public.record_marketvision_brand_result(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare r public.marketvision_brand_requests;next_state text;begin
 select * into r from public.marketvision_brand_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,71));select * into r from public.marketvision_brand_requests where id=p_id for update;
 if p_claim_token is null or r.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>262144 or p_result->>'status' not in('received','uncertain') or p_result->>'status' is null then raise exception 'Review the complete brand analysis receipt';end if;
 if r.raw_result is not null then if r.raw_result is distinct from p_result then return '{"state":"result_conflict"}';end if;return jsonb_build_object('state','replayed','requestState',r.state);end if;
 next_state:=case when r.state='stopped' then 'stopped' when p_result->>'status'='received' then 'result_ready' else 'held' end;
 update public.marketvision_brand_requests set raw_result=p_result,result_hash=public.crm_configuration_hash(p_result),state=next_state,error_code=case when p_result->>'status'='uncertain' then 'model_uncertain' end where id=r.id;
 if next_state<>'stopped' then update public.shared_jobs set lifecycle_status='failed',status_reason=case when next_state='result_ready' then 'brand_result_saved' else 'model_uncertain' end,stage='review',current_step='Saved model outcome awaits review; no automatic model retry',updated_at=clock_timestamp()where id=r.id;end if;
 perform public.record_marketvision_brand_event(r,'market.brand.result_received',case when p_result->>'status'='received' then 'succeeded' else 'failed' end,jsonb_build_object('requestState',next_state,'resultHash',public.crm_configuration_hash(p_result)));
 return jsonb_build_object('state','saved','requestState',next_state);
end$$;

create function public.prepare_marketvision_brand_preview(p_id uuid,p_result_hash text,p_preview jsonb,p_error_code text default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare entry public.marketvision_brand_requests;begin
 select *into entry from public.marketvision_brand_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(entry.property_id::text,71));select *into entry from public.marketvision_brand_requests where id=p_id for update;
 if entry.preview is not null then return jsonb_build_object('state','replayed','requestState',entry.state);end if;
 if entry.state<>'result_ready'then return jsonb_build_object('state',entry.state);end if;
 if entry.result_hash is distinct from p_result_hash then return '{"state":"result_conflict"}';end if;
 if p_error_code is not null then
  if p_error_code not in('invalid_output','incomplete_output')then raise exception 'Invalid brand validation issue';end if;
  update public.marketvision_brand_requests set state='held',error_code=p_error_code,finished_at=clock_timestamp()where id=entry.id;update public.shared_jobs set lifecycle_status='failed',status_reason=p_error_code,stage='review',finished_at=clock_timestamp(),updated_at=clock_timestamp()where id=entry.id;perform public.record_marketvision_brand_event(entry,'market.brand.held','failed',jsonb_build_object('requestState','held','reason',p_error_code));return '{"state":"held"}';
 end if;
 if entry.raw_result->>'finishReason'is distinct from 'stop'or p_preview is distinct from(entry.raw_result->>'content')::jsonb or jsonb_typeof(p_preview)is distinct from 'object'or(p_preview-array['claims','notes'])<>'{}'or jsonb_typeof(p_preview->'claims')is distinct from 'array'or jsonb_array_length(p_preview->'claims')>50 or octet_length(p_preview::text)>200000 or not(p_preview?'notes')or(jsonb_typeof(p_preview->'notes')not in('null','string'))or length(coalesce(p_preview->>'notes',''))>5000 then raise exception 'Brand preview must match the complete retained model result';end if;
 if exists(select 1 from jsonb_array_elements(p_preview->'claims')c where not public.valid_marketvision_brand_claim(c,entry.model_input->'source'->>'content'))then raise exception 'Every brand statement needs exact retained source evidence';end if;
 update public.marketvision_brand_requests set state='preview_ready',preview=p_preview,preview_hash=public.crm_configuration_hash(p_preview),error_code=null where id=entry.id;
 update public.shared_jobs set lifecycle_status='failed',status_reason='brand_review_required',stage='review',progress=70,current_step='Saved brand statements await explicit source review',updated_at=clock_timestamp()where id=entry.id;
 perform public.record_marketvision_brand_event(entry,'market.brand.previewed','succeeded',jsonb_build_object('requestState','preview_ready','candidateCount',jsonb_array_length(p_preview->'claims'),'modelResultHash',entry.result_hash));return '{"state":"saved","requestState":"preview_ready"}';
end$$;
create function public.control_marketvision_brand(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior jsonb;entry public.marketvision_brand_requests;before_state jsonb;kind text;begin
 kind:=case p_input->>'action'when 'stop'then 'brand.stopped'when 'recover'then 'brand.recovered'end;if kind is null then raise exception 'Stop or recover the original brand request';end if;
 prior:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,kind,p_input);if prior->>'state'<>'new'then return prior;end if;
 if(p_input-array['brandRequestId','expectedVersion','action','reason'])<>'{}'then raise exception 'Review the exact saved brand request';end if;
 select *into entry from public.marketvision_brand_requests where id=(p_input->>'brandRequestId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id)for update;if not found then return '{"state":"not_found"}';end if;
 if entry.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if entry.state in('stopped','completed')then return '{"state":"closed_request"}';end if;
 before_state:=jsonb_build_object('state',entry.state,'version',entry.version);
 if kind='brand.stopped'then
  update public.marketvision_brand_requests set state='stopped',finished_at=clock_timestamp()where id=entry.id returning *into entry;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='operator_stopped',finished_at=clock_timestamp(),updated_at=clock_timestamp(),current_step='Brand analysis stopped; late results remain private evidence'where id=entry.id;
 elsif entry.state='running'and entry.started_at<now()-interval '2 minutes'then update public.marketvision_brand_requests set error_code='invocation_unconfirmed'where id=entry.id returning *into entry;
 end if;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,kind,entry.competitor_id,p_input,before_state,jsonb_build_object('state',entry.state,'version',entry.version),jsonb_build_object('requestId',entry.id,'requestState',entry.state,'version',entry.version,'modelInvocationRepeated',false));
end$$;
create function public.review_marketvision_brand(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior jsonb;entry public.marketvision_brand_requests;previous public.marketvision_brand_reviews;item jsonb;selected jsonb:='[]';kind text;ordinal integer;reviewed public.marketvision_brand_reviews;begin
 kind:=case p_input->>'action'when 'publish'then 'brand.published'when 'withdraw'then 'brand.withdrawn'end;if kind is null then raise exception 'Choose a brand evidence review decision';end if;
 prior:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,kind,p_input);if prior->>'state'<>'new'then return prior;end if;
 select *into entry from public.marketvision_brand_requests where id=(p_input->>'brandRequestId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id)for update;if not found then return '{"state":"not_found"}';end if;
 if entry.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 select *into previous from public.marketvision_brand_reviews where competitor_id=entry.competitor_id and property_id=p_property_id and org_id=entry.org_id order by review_sequence desc limit 1;
 if previous.id is distinct from nullif(p_input->>'expectedReviewId','')::uuid then return '{"state":"stale_review"}';end if;
 if kind='brand.published'then
  if entry.state not in('preview_ready','completed')or entry.preview is null then return '{"state":"preview_required"}';end if;
  if entry.preview_hash is distinct from p_input->>'previewHash'then return '{"state":"stale_preview"}';end if;
  if not public.marketvision_capture_current(entry.source_id,p_property_id,entry.competitor_id)then return '{"state":"source_unavailable"}';end if;
  if(p_input-array['brandRequestId','expectedVersion','expectedReviewId','previewHash','action','acknowledgeInterpretation','acknowledgeReplacement','selection','reason'])<>'{}'or p_input->'acknowledgeInterpretation'is distinct from 'true'::jsonb or p_input->'acknowledgeReplacement'is distinct from 'true'::jsonb or jsonb_typeof(p_input->'selection')is distinct from 'array'or jsonb_array_length(p_input->'selection')<>jsonb_array_length(entry.preview->'claims')or(select count(distinct value->>'sourceIndex')from jsonb_array_elements(p_input->'selection'))<>jsonb_array_length(entry.preview->'claims')then raise exception 'Review every statement and acknowledge source limits and replacement';end if;
  for item in select value from jsonb_array_elements(p_input->'selection')order by(value->>'sourceIndex')::integer loop
   if jsonb_typeof(item->'sourceIndex')is distinct from 'number'or item->>'sourceIndex'!~'^[0-9]+$'then raise exception 'Choose a saved candidate';end if;ordinal:=(item->>'sourceIndex')::integer;
   if ordinal<0 or ordinal>=jsonb_array_length(entry.preview->'claims')then raise exception 'Choose a saved candidate';end if;
   if item->>'action'='skip'then if(item-array['sourceIndex','action'])<>'{}'then raise exception 'Only skip this candidate';end if;
   elsif item->>'action'='include'then
    if(item-array['sourceIndex','action','claim'])<>'{}'or not public.valid_marketvision_brand_claim(item->'claim',entry.model_input->'source'->>'content')then raise exception 'Reviewed statements need exact retained source quotations';end if;
    selected:=selected||jsonb_build_array(item->'claim'||jsonb_build_object('sourceIndex',ordinal));
   else raise exception 'Include or skip every candidate';end if;
  end loop;
 else
  if(p_input-array['brandRequestId','expectedVersion','expectedReviewId','action','reason'])<>'{}'then raise exception 'Withdraw only the exact current review';end if;
  if previous.id is null or previous.request_id<>entry.id or previous.disposition<>'published'then return '{"state":"review_not_current"}';end if;
 end if;
 insert into public.marketvision_brand_reviews(id,request_id,property_id,org_id,competitor_id,actor_id,previous_review_id,disposition,claims,input,input_hash)values(p_id,entry.id,p_property_id,entry.org_id,entry.competitor_id,p_actor_id,previous.id,case when kind='brand.published'then 'published'else 'withdrawn'end,selected,p_input,public.crm_configuration_hash(p_input))returning *into reviewed;
 if entry.state='preview_ready'and kind='brand.published'then
  update public.marketvision_brand_requests set state='completed',finished_at=clock_timestamp()where id=entry.id returning *into entry;
  update public.shared_jobs set lifecycle_status='succeeded',status_reason='brand_review_saved',stage='completed',progress=100,finished_at=clock_timestamp(),updated_at=clock_timestamp(),current_step='Source-backed brand review saved; no downstream publication'where id=entry.id;
 end if;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,kind,entry.competitor_id,p_input,case when previous.id is not null then to_jsonb(previous)end,to_jsonb(reviewed),jsonb_build_object('requestId',entry.id,'reviewId',reviewed.id,'reviewSequence',reviewed.review_sequence,'requestState',entry.state,'version',entry.version,'statementCount',jsonb_array_length(selected),'providerVerified',false,'externalPublication',false));
end$$;

-- Return safe evidence projections; model recipes, claim tokens and raw provider receipts stay private.
create function public.marketvision_brand_request_view(p_run public.marketvision_brand_requests)returns jsonb language sql stable security invoker set search_path=''as $$select
 jsonb_build_object('id',p_run.id,'competitorId',p_run.competitor_id,'state',p_run.state,'version',p_run.version,'source',p_run.source_snapshot,'content',p_run.model_input->'source'->>'content','createdAt',p_run.created_at,'updatedAt',p_run.updated_at,'errorCode',p_run.error_code,'preview',p_run.preview,'previewHash',p_run.preview_hash,'sourceCurrent',public.marketvision_capture_current(p_run.source_id,p_run.property_id,p_run.competitor_id),'model',p_run.model_input->>'model','promptVersion',p_run.model_input->>'promptVersion','usage',p_run.raw_result->'usage','estimatedCostUsd',p_run.raw_result->'estimatedCostUsd','costBasis',p_run.raw_result->>'costBasis','pricing',p_run.model_input->'pricing','latestReview',(select jsonb_build_object('id',v.id,'disposition',v.disposition,'requestId',v.request_id,'claims',v.claims,'createdAt',v.created_at)from public.marketvision_brand_reviews v where v.competitor_id=p_run.competitor_id and v.property_id=p_run.property_id and v.org_id=p_run.org_id order by v.review_sequence desc limit 1));$$;
create function public.marketvision_current_brand_evidence(p_property_id uuid,p_org_id uuid)returns table(competitor_id uuid,competitor_name text,review_id uuid,request_id uuid,capture_id uuid,source_url text,observed_at timestamptz,claims jsonb)
language sql stable security invoker set search_path=''as $$
 select c.id,c.name,v.id,r.id,(r.source_snapshot->>'captureId')::uuid,r.source_snapshot->>'sourceUrl',(r.source_snapshot->>'fetchedAt')::timestamptz,v.claims
 from public.competitors c join public.properties p on p.id=c.property_id and p.org_id=p_org_id
 join lateral(select *from public.marketvision_brand_reviews x where x.competitor_id=c.id and x.property_id=p.id and x.org_id=p.org_id order by x.review_sequence desc limit 1)v on v.disposition='published'
 join public.marketvision_brand_requests r on r.id=v.request_id and r.property_id=p.id and r.org_id=p.org_id
 where c.property_id=p_property_id and c.is_active and public.marketvision_capture_current(r.source_id,p.id,c.id);
$$;
create function public.read_marketvision_brand(p_property_id uuid,p_actor_id uuid,p_view text default 'current',p_competitor_id uuid default null,p_request_id uuid default null,p_cursor uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;selected public.marketvision_brand_requests;rows jsonb;anchor_seq bigint;total bigint;anchor_id uuid;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if p_view not in('current','requests','reviews','legacy')or(p_request_id is not null and(p_cursor is not null or p_competitor_id is null))then raise exception 'Choose a saved brand view';end if;
 if p_request_id is not null then
  select *into selected from public.marketvision_brand_requests r where r.id=p_request_id and r.property_id=p_property_id and r.org_id=organization and r.competitor_id=p_competitor_id;
  if not found then return '{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','request',public.marketvision_brand_request_view(selected));
 end if;
 if p_view='current'then
  if p_cursor is not null then select c.id into anchor_id from public.competitors c where c.id=p_cursor and c.property_id=p_property_id and(p_competitor_id is null or c.id=p_competitor_id);if not found then return '{"state":"cursor_changed"}';end if;end if;
  select count(*)into total from public.competitors c where c.property_id=p_property_id and(p_competitor_id is null or c.id=p_competitor_id);
  select coalesce(jsonb_agg(x.value order by x.id),'[]')into rows from(
   select c.id,jsonb_build_object('id',c.id,'competitorId',c.id,'name',c.name,'active',c.is_active,'review',case when v.id is not null then jsonb_build_object('id',v.id,'requestId',v.request_id,'disposition',v.disposition,'createdAt',v.created_at,'claims',v.claims,'source',r.source_snapshot,'sourceCurrent',public.marketvision_capture_current(r.source_id,p_property_id,c.id))end)value
   from public.competitors c left join lateral(select *from public.marketvision_brand_reviews v where v.competitor_id=c.id and v.property_id=p_property_id and v.org_id=organization order by v.review_sequence desc limit 1)v on true left join public.marketvision_brand_requests r on r.id=v.request_id
   where c.property_id=p_property_id and(p_competitor_id is null or c.id=p_competitor_id)and(p_cursor is null or c.id>anchor_id)order by c.id limit 21
  )x;
 elsif p_view='requests'then
  if p_cursor is not null then select r.id into anchor_id from public.marketvision_brand_requests r where r.id=p_cursor and r.property_id=p_property_id and r.org_id=organization and(p_competitor_id is null or r.competitor_id=p_competitor_id);if not found then return '{"state":"cursor_changed"}';end if;end if;
  select count(*)into total from public.marketvision_brand_requests r where r.property_id=p_property_id and r.org_id=organization and(p_competitor_id is null or r.competitor_id=p_competitor_id);
  select coalesce(jsonb_agg(x.value order by x.created_at desc,x.id desc),'[]')into rows from(select r.id,r.created_at,jsonb_build_object('id',r.id,'competitorId',r.competitor_id,'name',r.source_snapshot->>'competitorName','state',r.state,'createdAt',r.created_at)value from public.marketvision_brand_requests r where r.property_id=p_property_id and r.org_id=organization and(p_competitor_id is null or r.competitor_id=p_competitor_id)and(p_cursor is null or(r.created_at,r.id)<(select a.created_at,a.id from public.marketvision_brand_requests a where a.id=anchor_id))order by r.created_at desc,r.id desc limit 21)x;
 elsif p_view='reviews'then
  if p_cursor is not null then select v.review_sequence into anchor_seq from public.marketvision_brand_reviews v where v.id=p_cursor and v.property_id=p_property_id and v.org_id=organization and(p_competitor_id is null or v.competitor_id=p_competitor_id);if not found then return '{"state":"cursor_changed"}';end if;end if;
  select count(*)into total from public.marketvision_brand_reviews v where v.property_id=p_property_id and v.org_id=organization and(p_competitor_id is null or v.competitor_id=p_competitor_id);
  select coalesce(jsonb_agg(x.value order by x.review_sequence desc),'[]')into rows from(select v.review_sequence,jsonb_build_object('id',v.id,'competitorId',v.competitor_id,'requestId',v.request_id,'previousReviewId',v.previous_review_id,'disposition',v.disposition,'claims',v.claims,'reason',v.input->>'reason','createdAt',v.created_at,'name',r.source_snapshot->>'competitorName','source',r.source_snapshot)value from public.marketvision_brand_reviews v join public.marketvision_brand_requests r on r.id=v.request_id where v.property_id=p_property_id and v.org_id=organization and(p_competitor_id is null or v.competitor_id=p_competitor_id)and(p_cursor is null or v.review_sequence<anchor_seq)order by v.review_sequence desc limit 21)x;
 else
  if p_cursor is not null then select b.id into anchor_id from public.competitor_brand_intelligence b join public.competitors c on c.id=b.competitor_id where b.id=p_cursor and c.property_id=p_property_id and(p_competitor_id is null or c.id=p_competitor_id);if not found then return '{"state":"cursor_changed"}';end if;end if;
  select count(*)into total from public.competitor_brand_intelligence b join public.competitors c on c.id=b.competitor_id where c.property_id=p_property_id and(p_competitor_id is null or c.id=p_competitor_id);
  select coalesce(jsonb_agg(x.value order by x.id),'[]')into rows from(select b.id,jsonb_build_object('id',b.id,'competitorId',c.id,'name',c.name,'positioning',b.positioning_statement,'voice',b.brand_voice,'audience',b.target_audience,'themes',b.key_messaging_themes,'analyzedAt',b.last_analyzed_at,'qualified',false)value from public.competitor_brand_intelligence b join public.competitors c on c.id=b.competitor_id where c.property_id=p_property_id and(p_competitor_id is null or c.id=p_competitor_id)and(p_cursor is null or b.id>anchor_id)order by b.id limit 21)x;
 end if;
 return jsonb_build_object('state','ready','items',case when jsonb_array_length(rows)>20 then rows-20 else rows end,'nextCursor',case when jsonb_array_length(rows)>20 then rows->19->>'id'end,'total',total,'readAt',statement_timestamp());
end$$;
create function public.guard_marketvision_brand_context()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if exists(select 1 from public.marketvision_brand_requests r join public.properties p on p.id=r.property_id where r.context_id=old.id)then raise exception 'Saved brand source context is immutable';end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger marketvision_brand_context_guard before update or delete on public.shared_context_snapshots for each row execute function public.guard_marketvision_brand_context();
create function public.guard_marketvision_brand_job()returns trigger language plpgsql security invoker set search_path=''as $$declare r public.marketvision_brand_requests;expected text;begin
 if not exists(select 1 from public.properties where id=old.property_id)then return new;end if;
 select *into r from public.marketvision_brand_requests where id=old.id;if not found then return new;end if;
 if(to_jsonb(new)-array['lifecycle_status','status_reason','stage','progress','current_step','updated_at','attempt_count','started_at','finished_at'])is distinct from(to_jsonb(old)-array['lifecycle_status','status_reason','stage','progress','current_step','updated_at','attempt_count','started_at','finished_at'])then raise exception 'Review the original brand request';end if;
 expected:=case r.state when 'queued'then 'queued'when 'running'then 'running'when 'stopped'then 'cancelled'when 'completed'then 'succeeded'else 'failed'end;
 if new.lifecycle_status is distinct from expected or new.attempt_count is distinct from(case when r.claim_token is null then 0 else 1 end)then raise exception 'Review the original brand request';end if;
 return new;
end$$;
create trigger marketvision_brand_job_guard before update on public.shared_jobs for each row execute function public.guard_marketvision_brand_job();

create or replace function public.marketvision_monitoring_rows(p_property_id uuid,p_org_id uuid)
returns table(id uuid,created_at timestamptz,updated_at timestamptz,kind text,request_state text,category text,label text,competitor_id uuid,brief_id uuid,handoff_id uuid,legacy_status text)
language sql stable security invoker set search_path=''as $$
 with saved as(
 select j.id,j.created_at,j.updated_at,
 case j.domain when 'marketvision.brand'then 'brand'when 'marketvision.source'then 'source'when 'marketvision.extraction'then 'extraction'when 'marketvision.brief'then 'brief'when 'marketvision.intake'then 'intake'when 'marketvision.handoff'then 'handoff'else 'legacy'end kind,
 case j.domain when 'marketvision.brand'then br.state when 'marketvision.source'then s.state when 'marketvision.extraction'then e.state when 'marketvision.brief'then b.state when 'marketvision.intake'then i.state when 'marketvision.handoff'then h.state else 'historical'end request_state,
 case j.domain when 'marketvision.brand'then br.competitor_id when 'marketvision.source'then s.competitor_id when 'marketvision.extraction'then e.competitor_id end competitor_id,
 case j.domain when 'marketvision.brief'then b.id when 'marketvision.handoff'then h.brief_id end brief_id,
 h.id handoff_id,
 case when j.domain in('marketvision.ingestion','marketvision.proposal')then j.lifecycle_status end legacy_status,
 case when j.domain in('marketvision.ingestion','marketvision.proposal')then case j.subject_type when 'discovery'then 'Earlier competitor discovery'when 'observation_refresh'then 'Earlier price refresh'when 'brand_extraction'then 'Earlier brand extraction'when 'embedding'then 'Earlier search indexing'when 'change_detection'then 'Earlier change detection'when 'brief_generation'then 'Earlier brief generation'else 'Earlier MarketVision work'end
 when j.domain='marketvision.intake'then 'Saved competitor intake'when j.domain='marketvision.brief'then 'Saved market brief'when j.domain='marketvision.handoff'then coalesce(h.draft->>'title','Saved draft handoff')else coalesce(c.name,'Saved competitor work')end label
 from public.shared_jobs j
 left join public.marketvision_brand_requests br on br.id=j.id and br.property_id=j.property_id and br.org_id=j.org_id
 left join public.marketvision_source_requests s on s.id=j.id and s.property_id=j.property_id and s.org_id=j.org_id
 left join public.marketvision_extraction_requests e on e.id=j.id and e.property_id=j.property_id and e.org_id=j.org_id
 left join public.marketvision_briefs b on b.id=j.id and b.property_id=j.property_id and b.org_id=j.org_id
 left join public.marketvision_intakes i on i.id=j.id and i.property_id=j.property_id and i.org_id=j.org_id
 left join public.marketvision_handoffs h on h.id=j.id and h.property_id=j.property_id and h.org_id=j.org_id
 left join public.competitors c on c.id=coalesce(s.competitor_id,e.competitor_id,br.competitor_id)and c.property_id=j.property_id
 where j.property_id=p_property_id and j.org_id=p_org_id and j.domain in('marketvision.brand','marketvision.intake','marketvision.source','marketvision.extraction','marketvision.brief','marketvision.handoff','marketvision.ingestion','marketvision.proposal')
 )
 select id,created_at,updated_at,kind,coalesce(request_state,'missing_record'),
 case when kind='legacy'then 'legacy'when request_state in('queued','running')then 'active'when request_state in('ready','completed','applied')then 'complete'when request_state in('stopped','rejected','withdrawn')then 'closed'else 'attention'end,
 label,competitor_id,brief_id,handoff_id,legacy_status from saved;
$$;
revoke all on function public.guard_marketvision_brand_review()from public,anon,authenticated;
grant execute on function public.guard_marketvision_brand_review()to service_role;
revoke all on function public.guard_marketvision_brand_request()from public,anon,authenticated;
grant execute on function public.guard_marketvision_brand_request()to service_role;
revoke all on function public.record_marketvision_brand_event(public.marketvision_brand_requests,text,text,jsonb)from public,anon,authenticated;
grant execute on function public.record_marketvision_brand_event(public.marketvision_brand_requests,text,text,jsonb)to service_role;
revoke all on function public.valid_marketvision_brand_claim(jsonb,text)from public,anon,authenticated;
grant execute on function public.valid_marketvision_brand_claim(jsonb,text)to service_role;
revoke all on function public.begin_marketvision_brand(uuid,uuid,uuid,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.begin_marketvision_brand(uuid,uuid,uuid,jsonb,jsonb)to service_role;
revoke all on function public.claim_marketvision_brand(uuid)from public,anon,authenticated;
grant execute on function public.claim_marketvision_brand(uuid)to service_role;
revoke all on function public.record_marketvision_brand_result(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.record_marketvision_brand_result(uuid,uuid,jsonb)to service_role;
revoke all on function public.prepare_marketvision_brand_preview(uuid,text,jsonb,text)from public,anon,authenticated;
grant execute on function public.prepare_marketvision_brand_preview(uuid,text,jsonb,text)to service_role;
revoke all on function public.control_marketvision_brand(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.control_marketvision_brand(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.review_marketvision_brand(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.review_marketvision_brand(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.marketvision_brand_request_view(public.marketvision_brand_requests)from public,anon,authenticated;
grant execute on function public.marketvision_brand_request_view(public.marketvision_brand_requests)to service_role;
revoke all on function public.marketvision_current_brand_evidence(uuid,uuid)from public,anon,authenticated;
grant execute on function public.marketvision_current_brand_evidence(uuid,uuid)to service_role;
revoke all on function public.read_marketvision_brand(uuid,uuid,text,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.read_marketvision_brand(uuid,uuid,text,uuid,uuid,uuid)to service_role;
revoke all on function public.guard_marketvision_brand_context()from public,anon,authenticated;
grant execute on function public.guard_marketvision_brand_context()to service_role;
revoke all on function public.guard_marketvision_brand_job()from public,anon,authenticated;
grant execute on function public.guard_marketvision_brand_job()to service_role;
revoke all on sequence public.marketvision_brand_reviews_review_sequence_seq from public,anon,authenticated;
grant usage,select on sequence public.marketvision_brand_reviews_review_sequence_seq to service_role;

-- One database snapshot preserves complete coverage beyond the REST row limit.
create function public.read_marketvision_brand_context(p_property_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('propertyId',p.id,'activeCompetitors',(select count(*)from public.competitors c where c.property_id=p.id and c.is_active),'evidence',coalesce((select jsonb_agg(to_jsonb(e)order by e.competitor_id)from public.marketvision_current_brand_evidence(p.id,p.org_id)e),'[]'))from public.properties p where p.id=p_property_id;
$$;
revoke all on function public.read_marketvision_brand_context(uuid)from public,anon,authenticated;
grant execute on function public.read_marketvision_brand_context(uuid)to service_role;
