create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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


create table public.marketvision_extraction_requests(
 id uuid primary key references public.shared_jobs(id),property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),competitor_id uuid not null references public.competitors(id),
 input jsonb not null,input_hash text not null,source_snapshot jsonb not null,model_input jsonb not null,context_id uuid not null references public.shared_context_snapshots(id),
 state text not null default 'queued' check(state in('queued','running','result_ready','preview_ready','held','stopped','completed')),version integer not null default 1,claim_token uuid,raw_result jsonb,result_hash text,
 preview jsonb,preview_hash text,review_context jsonb,error_code text,applied_capture_id uuid references public.market_source_captures(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz
);
create unique index marketvision_extraction_active on public.marketvision_extraction_requests(competitor_id) where state in('queued','running','result_ready','preview_ready');
create index marketvision_extraction_property on public.marketvision_extraction_requests(property_id,created_at desc,id desc);
create index marketvision_extraction_org on public.marketvision_extraction_requests(org_id);
create index marketvision_extraction_actor on public.marketvision_extraction_requests(actor_id);
create index marketvision_extraction_context on public.marketvision_extraction_requests(context_id);
create index marketvision_extraction_capture on public.marketvision_extraction_requests(applied_capture_id);
alter table public.marketvision_extraction_requests enable row level security;
revoke all on public.marketvision_extraction_requests from public,anon,authenticated;
grant all on public.marketvision_extraction_requests to service_role;
create policy marketvision_extraction_service on public.marketvision_extraction_requests for all to service_role using(true) with check(true);
create function public.guard_marketvision_extraction() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Extraction source and result history is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.competitor_id,new.input,new.input_hash,new.source_snapshot,new.model_input,new.context_id,new.created_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.competitor_id,old.input,old.input_hash,old.source_snapshot,old.model_input,old.context_id,old.created_at) then raise exception 'Saved extraction input is immutable';end if;
 if old.claim_token is not null and new.claim_token is distinct from old.claim_token then raise exception 'One model invocation intent is retained';end if;
 if old.raw_result is not null and(new.raw_result,new.result_hash) is distinct from(old.raw_result,old.result_hash) then raise exception 'Model receipts cannot be replaced';end if;
 if old.preview is not null and new.preview is distinct from old.preview then raise exception 'The saved model preview cannot be replaced';end if;
 if old.state in('stopped','completed') and new.state<>old.state then raise exception 'Closed extraction cannot restart';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger marketvision_extraction_guard before update or delete on public.marketvision_extraction_requests for each row execute function public.guard_marketvision_extraction();

-- Registered non-human outcome writer. Current operator access is checked separately before work can execute.
create function public.append_marketvision_service_event(p_id uuid,p_job_id uuid,p_action text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.shared_jobs;e public.shared_action_events;principal text:='marketvision.extraction';begin
 if p_id is null or p_job_id is null or p_phase not in('succeeded','failed') or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object' or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid market service outcome';end if;
 if p_action not in('market.extraction.started','market.extraction.result_received','market.extraction.previewed','market.extraction.held') then raise exception 'Unregistered market service outcome';end if;
 select * into job from public.shared_jobs where id=p_job_id and domain=principal;if not found or job.property_id is null then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(job.property_id::text,71));select * into e from public.shared_action_events where id=p_id;
 if found then if(e.property_id,e.org_id,e.shared_job_ref,e.service_principal,e.action,e.phase,e.request,e.before_state,e.after_state,e.result) is distinct from(job.property_id,job.org_id,job.id,principal,p_action,p_phase,p_request,p_before,p_after,p_result) then return '{"state":"request_conflict"}';end if;return jsonb_build_object('state','replayed','eventId',e.id);end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin)values(p_id,job.org_id,job.property_id,null,principal,'workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,context_snapshot_ref)values(p_id,p_id,job.org_id,job.property_id,null,principal,'marketvision',p_action,'server_confirmed',p_phase,p_request,p_before,p_after,p_result,job.id,job.context_snapshot_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end$$;
create function public.record_marketvision_extraction_event(p_run public.marketvision_extraction_requests,p_action text,p_phase text,p_result jsonb) returns void language plpgsql security invoker set search_path='' as $$declare saved jsonb;begin
 saved:=public.append_marketvision_service_event(md5(p_action||':'||p_run.id::text)::uuid,p_run.id,p_action,p_phase,jsonb_build_object('requestId',p_run.id),jsonb_build_object('state',p_run.state),jsonb_build_object('state',p_result->>'requestState'),p_result||jsonb_build_object('requestedBy',p_run.actor_id));
 if saved->>'state' not in('recorded','replayed') then raise exception 'Extraction outcome history could not be saved';end if;
end$$;

create function public.marketvision_competitor_context(p_property_id uuid,p_competitor_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('units',coalesce((select jsonb_agg(to_jsonb(u) order by u.id)from public.competitor_units u where u.competitor_id=c.id),'[]')) from public.competitors c where c.id=p_competitor_id and c.property_id=p_property_id;
$$;
create function public.begin_marketvision_extraction(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_model_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior jsonb;r public.marketvision_extraction_requests;c public.competitors;snapshot jsonb;context uuid;organization uuid;begin
 prior:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,'extraction.requested',p_input);if prior->>'state' not in('new','replayed') then return prior;end if;
 select * into r from public.marketvision_extraction_requests where id=p_id;if found then return jsonb_build_object('state',r.state,'requestId',r.id,'version',r.version);end if;
 if(p_input-array['competitorId','sourceVersion','content','sourceUrl','effectiveAt','reason'])<>'{}' or length(trim(coalesce(p_input->>'content',''))) not between 50 and 50000 or length(coalesce(p_input->>'sourceUrl',''))>2000 then raise exception 'Review the pasted source and its provenance';end if;
 if nullif(p_input->>'effectiveAt','')::timestamptz>now()+interval '5 minutes' then raise exception 'Source observation time cannot be in the future';end if;
 select * into c from public.competitors where id=(p_input->>'competitorId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if c.version is distinct from(p_input->>'sourceVersion')::integer then return '{"state":"stale_competitor"}';end if;
 if c.is_active is distinct from true then return '{"state":"competitor_archived"}';end if;
 if c.property_type not in('multifamily','senior','student','mixed_use','affordable','luxury') or c.property_type is null then return '{"state":"unsupported_pricing_basis"}';end if;
 select * into r from public.marketvision_extraction_requests where competitor_id=c.id and state in('queued','running','result_ready','preview_ready');if found then return jsonb_build_object('state','busy','requestId',r.id,'version',r.version);end if;
 perform 1 from public.competitor_units where competitor_id=c.id for update;snapshot:=public.marketvision_competitor_context(p_property_id,c.id);
 if jsonb_typeof(p_model_input) is distinct from 'object' or length(p_model_input::text)>262144 or p_model_input->>'promptVersion' is distinct from 'pricing-v2' or p_model_input->'source' is distinct from jsonb_build_object('content',p_input->>'content','propertyType',c.property_type) or length(coalesce(p_model_input->>'systemPrompt','')) not between 1 and 30000 or length(coalesce(p_model_input->>'userPrompt','')) not between 50 and 60000 or p_model_input->>'model' is distinct from 'gpt-4o-mini' then raise exception 'The extraction model input does not match the reviewed source';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by)values(organization,p_property_id,'marketvision.extraction',c.id::text,jsonb_build_object('source',snapshot,'modelInput',p_model_input),public.crm_configuration_hash(p_model_input),p_actor_id::text)returning id into context;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,max_attempts,stage,progress,current_step)values(p_id,organization,p_property_id,'marketvision.extraction','competitor',c.id::text,'queued','extraction_saved',p_id::text,jsonb_build_object('requestId',p_id,'competitorId',c.id),context,1,'queued',0,'Saved source awaits one extraction request');
 insert into public.marketvision_extraction_requests(id,property_id,org_id,actor_id,competitor_id,input,input_hash,source_snapshot,model_input,context_id)values(p_id,p_property_id,organization,p_actor_id,c.id,p_input,public.crm_configuration_hash(p_input),snapshot,p_model_input,context);
 perform public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,'extraction.requested',c.id,p_input,null,jsonb_build_object('requestId',p_id,'state','queued'),jsonb_build_object('requestId',p_id,'competitorId',c.id,'modelInvoked',false));
 return jsonb_build_object('state','queued','requestId',p_id,'version',1);
end$$;

create function public.claim_marketvision_extraction(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare r public.marketvision_extraction_requests;previous public.marketvision_extraction_requests;begin
 select * into r from public.marketvision_extraction_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,71));select * into r from public.marketvision_extraction_requests where id=p_id for update;
 if r.state<>'queued' or r.claim_token is not null then return jsonb_build_object('state',r.state);end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id join public.competitors c on c.property_id=p.id where p.id=r.property_id and p.org_id=r.org_id and u.id=r.actor_id and c.id=r.competitor_id and c.is_active and c.version=(r.source_snapshot->>'version')::integer) then
  update public.marketvision_extraction_requests set state='held',error_code='source_or_access_changed',finished_at=clock_timestamp()where id=r.id;update public.shared_jobs set lifecycle_status='failed',status_reason='source_or_access_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp()where id=r.id;perform public.record_marketvision_extraction_event(r,'market.extraction.held','failed','{"requestState":"held","reason":"source_or_access_changed"}');return '{"state":"held"}';end if;
 previous:=r;
 update public.marketvision_extraction_requests set state='running',claim_token=gen_random_uuid(),started_at=clock_timestamp()where id=r.id returning * into r;
 update public.shared_jobs set lifecycle_status='running',attempt_count=1,stage='extracting',progress=10,started_at=clock_timestamp(),current_step='One extraction request started; awaiting its retained result',updated_at=clock_timestamp()where id=r.id;
 perform public.record_marketvision_extraction_event(previous,'market.extraction.started','succeeded','{"requestState":"running"}');return jsonb_build_object('state','invoke_once','claimToken',r.claim_token,'modelInput',r.model_input,'propertyId',r.property_id);
end$$;
create function public.record_marketvision_extraction_result(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare r public.marketvision_extraction_requests;next_state text;begin
 select * into r from public.marketvision_extraction_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,71));select * into r from public.marketvision_extraction_requests where id=p_id for update;
 if p_claim_token is null or r.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>262144 or p_result->>'status' not in('received','uncertain') or p_result->>'status' is null then raise exception 'Review the complete extraction receipt';end if;
 if r.raw_result is not null then if r.raw_result is distinct from p_result then return '{"state":"result_conflict"}';end if;return jsonb_build_object('state','replayed','requestState',r.state);end if;
 next_state:=case when r.state='stopped' then 'stopped' when p_result->>'status'='received' then 'result_ready' else 'held' end;
 update public.marketvision_extraction_requests set raw_result=p_result,result_hash=public.crm_configuration_hash(p_result),state=next_state,error_code=case when p_result->>'status'='uncertain' then 'model_uncertain' end where id=r.id;
 if next_state<>'stopped' then update public.shared_jobs set lifecycle_status='failed',status_reason=case when next_state='result_ready' then 'extraction_result_saved' else 'model_uncertain' end,stage='review',current_step='Saved model outcome awaits review; no automatic model retry',updated_at=clock_timestamp()where id=r.id;end if;
 perform public.record_marketvision_extraction_event(r,'market.extraction.result_received',case when p_result->>'status'='received' then 'succeeded' else 'failed' end,jsonb_build_object('requestState',next_state,'resultHash',public.crm_configuration_hash(p_result)));
 return jsonb_build_object('state','saved','requestState',next_state);
end$$;

create function public.prepare_marketvision_extraction_preview(p_id uuid,p_result_hash text,p_preview jsonb,p_error_code text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.marketvision_extraction_requests;begin
 select * into r from public.marketvision_extraction_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,71));select * into r from public.marketvision_extraction_requests where id=p_id for update;
 if r.preview is not null then return jsonb_build_object('state','replayed','requestState',r.state);end if;
 if r.state<>'result_ready' then return jsonb_build_object('state',r.state);end if;
 if r.result_hash is distinct from p_result_hash then return '{"state":"result_conflict"}';end if;
 if p_error_code is not null then
  if p_error_code not in('invalid_output','incomplete_output','unsupported_pricing_basis') then raise exception 'Invalid extraction validation issue';end if;
  update public.marketvision_extraction_requests set state='held',error_code=p_error_code,finished_at=clock_timestamp()where id=r.id;update public.shared_jobs set lifecycle_status='failed',status_reason=p_error_code,stage='review',finished_at=clock_timestamp(),updated_at=clock_timestamp()where id=r.id;perform public.record_marketvision_extraction_event(r,'market.extraction.held','failed',jsonb_build_object('requestState','held','reason',p_error_code));return '{"state":"held"}';
 end if;
 if p_preview is distinct from(r.raw_result->>'content')::jsonb or jsonb_typeof(p_preview->'units') is distinct from 'array' or jsonb_array_length(p_preview->'units')>50 or length(p_preview::text)>200000 then raise exception 'Preview must match the retained model receipt';end if;
 if exists(select 1 from jsonb_array_elements(p_preview->'units')u cross join jsonb_array_elements(u->'evidence')e where length(coalesce(e->>'quote',''))=0 or position(e->>'quote' in (r.input->>'content'))=0) then raise exception 'Quoted evidence must occur in the saved pasted source';end if;
 update public.marketvision_extraction_requests set preview=p_preview,review_context=source_snapshot,preview_hash=public.crm_configuration_hash(jsonb_build_object('preview',p_preview,'context',source_snapshot)),state='preview_ready',error_code=null where id=r.id;
 update public.shared_jobs set lifecycle_status='failed',status_reason='extraction_needs_approval',stage='review',progress=70,current_step='Exact saved pricing candidates await operator review',updated_at=clock_timestamp()where id=r.id;
 perform public.record_marketvision_extraction_event(r,'market.extraction.previewed','succeeded',jsonb_build_object('requestState','preview_ready','candidateCount',jsonb_array_length(p_preview->'units'),'modelResultHash',r.result_hash));return '{"state":"saved","requestState":"preview_ready"}';
end$$;

create function public.control_marketvision_extraction(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare operation text:=p_input->>'action';kind text;result jsonb;r public.marketvision_extraction_requests;c public.competitors;before_state jsonb;new_context jsonb;begin
 if operation not in('stop','recover','rebase') or operation is null then raise exception 'Choose a saved extraction decision';end if;kind:=case operation when 'stop' then 'extraction.stopped' when 'recover' then 'extraction.recovered' else 'extraction.rebased' end;
 result:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-array['action','extractionId','expectedVersion','reason'])<>'{}' then raise exception 'Unsupported extraction decision';end if;
 select * into r from public.marketvision_extraction_requests where id=(p_input->>'extractionId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id) for update;if not found then return '{"state":"not_found"}';end if;
 if r.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;before_state:=to_jsonb(r);
 if r.state in('stopped','completed') then return '{"state":"closed_request"}';end if;
 if operation='stop' then
  update public.marketvision_extraction_requests set state='stopped',finished_at=clock_timestamp()where id=r.id;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='operator_stopped',finished_at=clock_timestamp(),updated_at=clock_timestamp(),current_step='Operator stopped application; late model receipts may still be retained'where id=r.id;
 elsif operation='rebase' then
  if r.state<>'preview_ready' then return '{"state":"preview_required"}';end if;
  select * into c from public.competitors where id=r.competitor_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;if c.is_active is distinct from true then return '{"state":"competitor_archived"}';end if;
  if c.property_type is distinct from r.source_snapshot->>'property_type' then return '{"state":"source_contract_changed"}';end if;
  perform 1 from public.competitor_units where competitor_id=c.id for update;new_context:=public.marketvision_competitor_context(p_property_id,c.id);
  update public.marketvision_extraction_requests set review_context=new_context,preview_hash=public.crm_configuration_hash(jsonb_build_object('preview',preview,'context',new_context))where id=r.id;
 else
  -- Recovery can start an unclaimed saved request or build a preview from a receipt. It never clears the invocation token.
  if r.state='held' or(r.state='running' and r.started_at<now()-interval '2 minutes')then
   update public.marketvision_extraction_requests set error_code=coalesce(error_code,'invocation_unconfirmed')where id=r.id;
  end if;
 end if;
 select * into r from public.marketvision_extraction_requests where id=r.id;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,kind,r.competitor_id,p_input,before_state,to_jsonb(r),jsonb_build_object('requestId',r.id,'requestState',r.state,'version',r.version,'modelInvocationRepeated',false));
end$$;

create function public.apply_marketvision_extraction(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;r public.marketvision_extraction_requests;c public.competitors;context jsonb;u public.competitor_units;item jsonb;reviewed_values jsonb;candidate_index integer;amount integer:=0;prior_units jsonb;applied_units jsonb:='[]';capture uuid;begin
 result:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,'extraction.applied',p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-array['extractionId','expectedVersion','previewHash','selection','confirmedMonthlyRentUsd','reason'])<>'{}' or p_input->'confirmedMonthlyRentUsd' is distinct from 'true'::jsonb or jsonb_typeof(p_input->'selection') is distinct from 'array' or jsonb_array_length(p_input->'selection') not between 1 and 50 then raise exception 'Review the exact source, selected candidates, monthly USD rent basis, and reason';end if;
 select * into r from public.marketvision_extraction_requests where id=(p_input->>'extractionId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id)for update;if not found then return '{"state":"not_found"}';end if;
 if r.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if r.state<>'preview_ready' then return '{"state":"preview_required"}';end if;
 if r.preview_hash is distinct from p_input->>'previewHash' then return '{"state":"stale_preview"}';end if;
 select * into c from public.competitors where id=r.competitor_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;if c.is_active is distinct from true then return '{"state":"competitor_archived"}';end if;
 perform 1 from public.competitor_units where competitor_id=c.id for update;context:=public.marketvision_competitor_context(p_property_id,c.id);
 if public.crm_configuration_hash(context) is distinct from public.crm_configuration_hash(r.review_context) then return '{"state":"stale_source"}';end if;
 if(select count(*) from jsonb_array_elements(p_input->'selection'))<>(select count(distinct x->>'sourceIndex')from jsonb_array_elements(p_input->'selection')x) or(select count(*)from jsonb_array_elements(p_input->'selection'))<>(select count(distinct trim(x->'values'->>'unit_type'))from jsonb_array_elements(p_input->'selection')x) then raise exception 'Select each candidate and unit type only once';end if;
 capture:=r.id;prior_units:=context->'units';
 insert into public.market_source_captures(id,property_id,competitor_id,source_type,source_url,content_hash,raw_ref,status,captured_at,effective_at)values(capture,p_property_id,c.id,'manual',nullif(r.input->>'sourceUrl',''),public.crm_configuration_hash(jsonb_build_object('content',r.input->>'content')),'marketvision_extraction_requests:'||r.id::text,'captured',r.created_at,nullif(r.input->>'effectiveAt','')::timestamptz);
 for item in select value from jsonb_array_elements(p_input->'selection') loop
  if(item-array['sourceIndex','values'])<>'{}' or jsonb_typeof(item->'sourceIndex') is distinct from 'number' then raise exception 'Review exact candidate identities';end if;
  candidate_index:=(item->>'sourceIndex')::integer;if candidate_index<0 or candidate_index>=jsonb_array_length(r.preview->'units') then raise exception 'Selected candidate is outside the saved preview';end if;
  reviewed_values:=item->'values';if jsonb_typeof(reviewed_values) is distinct from 'object' or(reviewed_values-array['unit_type','bedrooms','bathrooms','sqft_min','sqft_max','rent_min','rent_max','deposit','available_count','move_in_specials'])<>'{}' then raise exception 'Unsupported reviewed unit values';end if;
  u:=jsonb_populate_record(null::public.competitor_units,reviewed_values);if public.marketvision_valid_unit(u) is distinct from true then raise exception 'Review every selected unit value and range';end if;
  insert into public.competitor_units(competitor_id,unit_type,bedrooms,bathrooms,sqft_min,sqft_max,rent_min,rent_max,deposit,available_count,move_in_specials,capture_id)values(c.id,trim(u.unit_type),u.bedrooms,u.bathrooms,u.sqft_min,u.sqft_max,u.rent_min,u.rent_max,u.deposit,u.available_count,u.move_in_specials,capture)
  on conflict(competitor_id,unit_type)do update set bedrooms=excluded.bedrooms,bathrooms=excluded.bathrooms,sqft_min=excluded.sqft_min,sqft_max=excluded.sqft_max,rent_min=excluded.rent_min,rent_max=excluded.rent_max,deposit=excluded.deposit,available_count=excluded.available_count,move_in_specials=excluded.move_in_specials,capture_id=excluded.capture_id returning * into u;
  insert into public.competitor_price_history(competitor_unit_id,rent_min,rent_max,available_count,source,capture_id)values(u.id,u.rent_min,u.rent_max,u.available_count,'reviewed_paste_extraction',capture);
  insert into public.market_observations(property_id,competitor_id,capture_id,observation_type,entity_key,value,confidence,observed_at)values(p_property_id,c.id,capture,'pricing',u.id::text,jsonb_build_object('unit',to_jsonb(u),'sourceIndex',candidate_index,'requestId',r.id,'approvedBy',p_actor_id,'basis','monthly_rent_usd','providerVerified',false),null,coalesce(nullif(r.input->>'effectiveAt','')::timestamptz,r.created_at));
  applied_units:=applied_units||jsonb_build_array(to_jsonb(u));amount:=amount+1;
 end loop;
 update public.marketvision_extraction_requests set state='completed',applied_capture_id=capture,finished_at=clock_timestamp()where id=r.id;
 update public.shared_jobs set lifecycle_status='succeeded',status_reason='reviewed_extraction_applied',stage='completed',progress=100,finished_at=clock_timestamp(),updated_at=clock_timestamp(),current_step='Reviewed pasted-source unit values and provenance saved together'where id=r.id;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,'extraction.applied',c.id,p_input,jsonb_build_object('requestId',r.id,'preview',r.preview,'previewHash',r.preview_hash,'units',prior_units),jsonb_build_object('requestId',r.id,'units',applied_units,'captureId',capture),jsonb_build_object('requestId',r.id,'captureId',capture,'savedUnits',amount,'providerVerified',false,'modelInvoked',false));
end$$;

create function public.read_marketvision_extractions(p_property_id uuid,p_actor_id uuid,p_competitor_id uuid,p_request_id uuid default null,p_cursor uuid default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare organization uuid;r public.marketvision_extraction_requests;anchor public.marketvision_extraction_requests;rows jsonb;context jsonb;begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if organization is null then return '{"state":"forbidden"}';end if;
 if not exists(select 1 from public.competitors where id=p_competitor_id and property_id=p_property_id)then return '{"state":"not_found"}';end if;
 context:=public.marketvision_competitor_context(p_property_id,p_competitor_id);
 if p_request_id is not null then
  select * into r from public.marketvision_extraction_requests where id=p_request_id and property_id=p_property_id and org_id=organization and competitor_id=p_competitor_id;if not found then return '{"state":"not_found"}';end if;
  context:=public.marketvision_competitor_context(p_property_id,p_competitor_id);
  return jsonb_build_object('state','ready','request',(to_jsonb(r)-array['model_input','raw_result'])||jsonb_build_object('model',r.model_input->>'model','promptVersion',r.model_input->>'promptVersion','usage',r.raw_result->'usage','finishReason',r.raw_result->>'finishReason','baselineChanged',r.review_context is not null and public.crm_configuration_hash(context) is distinct from public.crm_configuration_hash(r.review_context),'currentContext',context));
 end if;
 if p_cursor is not null then select * into anchor from public.marketvision_extraction_requests where id=p_cursor and property_id=p_property_id and competitor_id=p_competitor_id and org_id=organization;if not found then return '{"state":"cursor_changed"}';end if;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'state',q.state,'version',q.version,'createdAt',q.created_at,'startedAt',q.started_at,'finishedAt',q.finished_at,'sourceUrl',q.input->>'sourceUrl','effectiveAt',q.input->>'effectiveAt','reason',q.input->>'reason','candidateCount',case when q.preview is not null then jsonb_array_length(q.preview->'units')end,'errorCode',q.error_code)order by q.created_at desc,q.id desc),'[]')into rows from(select * from public.marketvision_extraction_requests where property_id=p_property_id and competitor_id=p_competitor_id and org_id=organization and(p_cursor is null or(created_at,id)<(anchor.created_at,anchor.id))order by created_at desc,id desc limit 21)q;
 return jsonb_build_object('state','ready','requests',case when jsonb_array_length(rows)>20 then rows-20 else rows end,'nextCursor',case when jsonb_array_length(rows)>20 then rows->19->>'id'end,'competitorVersion',(context->>'version')::integer);
end$$;

create or replace function public.marketvision_decision_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_resource_id uuid,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare event jsonb;begin
 insert into public.marketvision_decisions(id,org_id,property_id,actor_id,kind,resource_id,input,input_hash,before_state,after_state,result)values(p_id,(select org_id from public.properties where id=p_property_id),p_property_id,p_actor_id,p_kind,p_resource_id,p_input,public.crm_configuration_hash(p_input),p_before,p_after,p_result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'marketvision','market.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_input),'resourceId',p_resource_id),case when p_before is not null then jsonb_build_object('version',p_before->'version','stateHash',public.crm_configuration_hash(p_before)) end,case when p_after is not null then jsonb_build_object('version',p_after->'version','stateHash',public.crm_configuration_hash(p_after)) end,p_result,case when p_kind like 'extraction.%' then coalesce((select jsonb_build_object('jobId',j.id,'contextId',j.context_snapshot_id)from public.shared_jobs j where j.id=(p_result->>'requestId')::uuid and j.property_id=p_property_id),'{}')else '{}'end);
 if event->>'state' not in('recorded','replayed') then raise exception 'Market decision history could not be saved';end if;return p_result||'{"state":"saved"}';
end$$;
create or replace function public.claim_phase_four_maintenance(p_kind text,p_limit integer default 5) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record; token uuid; results jsonb:='[]';
begin
 perform pg_advisory_xact_lock(hashtextextended(p_kind,15));
 for item in
   select c.* from (
     select 'knowledge' as kind,k.id as item_id,k.property_id,to_jsonb(k)||jsonb_build_object('properties',jsonb_build_object('name',p.name)) as payload
     from public.knowledge_sources k join public.properties p on p.id=k.property_id
     where k.source_type='website' and (k.last_synced_at is null or k.last_synced_at<now()-interval '7 days' or exists(select 1 from public.property_chatbot_contexts pc where pc.property_id=k.property_id and (pc.status in ('stale','failed') or (pc.status='generating' and pc.stale_at<now()-interval '15 minutes'))))
     union all
     select 'competitors',c.property_id,c.property_id,to_jsonb(c) from public.scrape_config c where c.is_enabled and c.scrape_frequency<>'manual' and(c.next_run_at is null or c.next_run_at<=now()) and
       (c.last_run_at is null or c.last_run_at<now()-case c.scrape_frequency when 'hourly' then interval '1 hour' when 'weekly' then interval '7 days' else interval '1 day' end)
   ) c left join public.phase_four_maintenance m on m.kind=c.kind and m.item_id=c.item_id
   where c.kind=p_kind and coalesce(m.next_attempt_at,now())<=now() and (m.lease_until is null or m.lease_until<=now())
   order by m.last_attempt_at nulls first,c.item_id limit greatest(1,least(p_limit,5))
 loop
   token:=gen_random_uuid();
   insert into public.phase_four_maintenance(kind,item_id,property_id,lease_token,lease_until,last_attempt_at)
     values(p_kind,item.item_id,item.property_id,token,now()+interval '15 minutes',now())
     on conflict(kind,item_id) do update set lease_token=token,lease_until=now()+interval '15 minutes',last_attempt_at=now();
   results:=results||jsonb_build_array(item.payload||jsonb_build_object('maintenanceToken',token,'maintenanceId',item.item_id));
 end loop;
 return results;
end; $$;
revoke all on function public.guard_marketvision_extraction() from public,anon,authenticated;
grant execute on function public.guard_marketvision_extraction() to service_role;

revoke all on function public.append_marketvision_service_event(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.append_marketvision_service_event(uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb) to service_role;

revoke all on function public.record_marketvision_extraction_event(public.marketvision_extraction_requests,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_marketvision_extraction_event(public.marketvision_extraction_requests,text,text,jsonb) to service_role;

revoke all on function public.marketvision_competitor_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketvision_competitor_context(uuid,uuid) to service_role;

revoke all on function public.begin_marketvision_extraction(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.begin_marketvision_extraction(uuid,uuid,uuid,jsonb,jsonb) to service_role;

revoke all on function public.claim_marketvision_extraction(uuid) from public,anon,authenticated;
grant execute on function public.claim_marketvision_extraction(uuid) to service_role;

revoke all on function public.record_marketvision_extraction_result(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_marketvision_extraction_result(uuid,uuid,jsonb) to service_role;

revoke all on function public.prepare_marketvision_extraction_preview(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.prepare_marketvision_extraction_preview(uuid,text,jsonb,text) to service_role;

revoke all on function public.control_marketvision_extraction(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.control_marketvision_extraction(uuid,uuid,uuid,jsonb) to service_role;

revoke all on function public.apply_marketvision_extraction(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_marketvision_extraction(uuid,uuid,uuid,jsonb) to service_role;

revoke all on function public.read_marketvision_extractions(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_marketvision_extractions(uuid,uuid,uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
