create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
 origin:=case when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create or replace function public.guard_reviewflow_source() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if(new.id,new.property_id,new.platform,new.platform_review_id) is distinct from(old.id,old.property_id,old.platform,old.platform_review_id) then raise exception 'Review source identity cannot change';end if;
 if(new.review_text,new.rating,new.reviewer_name,new.review_date) is distinct from(old.review_text,old.rating,old.reviewer_name,old.review_date) then
  new.source_version:=old.source_version+1;new.sentiment:=null;new.sentiment_score:=null;new.topics:='[]'::jsonb;new.is_urgent:=false;new.response_status:='pending';
 else new.source_version:=old.source_version;end if;return new;
end$$;
-- Publication evidence is separate from approval and staff case resolution.
create table public.reviewflow_publications(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),review_id uuid not null references public.reviews(id) on delete cascade,response_id uuid not null references public.review_responses(id) on delete cascade,attempt_id uuid not null references public.shared_action_attempts(id),job_id uuid not null references public.shared_jobs(id),context_id uuid not null references public.shared_context_snapshots(id),
 source_version integer not null,response_version integer not null,content_hash text not null,context_hash text not null,response_text text not null,destination jsonb not null,destination_hash text not null,input jsonb not null,input_hash text not null,
 mode text not null check(mode in('manual')),state text not null check(state in('awaiting_confirmation','held','reported','cancelled')),version integer not null default 1,report jsonb,report_hash text,error_code text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create unique index reviewflow_publication_active on public.reviewflow_publications(review_id) where state in('awaiting_confirmation','held');
create index reviewflow_publication_property on public.reviewflow_publications(property_id,created_at desc,id desc);
create index reviewflow_publication_org on public.reviewflow_publications(org_id);
create index reviewflow_publication_actor on public.reviewflow_publications(actor_id);
create index reviewflow_publication_response on public.reviewflow_publications(response_id);
create index reviewflow_publication_attempt on public.reviewflow_publications(attempt_id);
create index reviewflow_publication_job on public.reviewflow_publications(job_id);
create index reviewflow_publication_context on public.reviewflow_publications(context_id);
alter table public.reviewflow_publications enable row level security;
revoke all on public.reviewflow_publications from public,anon,authenticated;
grant all on public.reviewflow_publications to service_role;
create policy reviewflow_publications_service on public.reviewflow_publications for all to service_role using(true) with check(true);
create function public.guard_reviewflow_publication() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Publication history is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.review_id,new.response_id,new.attempt_id,new.job_id,new.context_id,new.source_version,new.response_version,new.content_hash,new.context_hash,new.response_text,new.destination,new.destination_hash,new.input,new.input_hash,new.mode,new.created_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.review_id,old.response_id,old.attempt_id,old.job_id,old.context_id,old.source_version,old.response_version,old.content_hash,old.context_hash,old.response_text,old.destination,old.destination_hash,old.input,old.input_hash,old.mode,old.created_at) then raise exception 'Publication identity and approved text are immutable';end if;
 if old.state in('reported','cancelled') then raise exception 'Closed publication evidence is immutable';end if;
 if old.report is not null and(new.report,new.report_hash) is distinct from(old.report,old.report_hash) then raise exception 'Reported publication evidence is immutable';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_publication_guard before update or delete on public.reviewflow_publications for each row execute function public.guard_reviewflow_publication();

create function public.reviewflow_publication_target(p_property_id uuid,p_actor_id uuid,p_review_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.reviews;target jsonb;history jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select * into source from public.reviews where id=p_review_id and property_id=p_property_id for share;if not found then return '{"state":"not_found"}';end if;
 select coalesce(jsonb_agg(jsonb_build_object('responseId',id,'contentHash',content_hash,'postedAt',posted_at) order by id),'[]'::jsonb) into history from public.review_responses where review_id=source.id and property_id=p_property_id and status='posted';
 target:=jsonb_build_object('reviewId',source.id,'platform',source.platform,'platformReviewId',source.platform_review_id,'previousPublications',history);
 return jsonb_build_object('state','ready','target',target,'targetHash',public.crm_configuration_hash(target),'hasPreviousPublication',jsonb_array_length(history)>0);
end$$;

create function public.request_reviewflow_manual_publication(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;source jsonb;target jsonb;destination jsonb;d public.review_responses;a public.shared_action_attempts;active public.reviewflow_publications;c public.reputation_cases;begin
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id and u.role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'publication.prepared',p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'responseId'-'expectedVersion'-'sourceVersion'-'contextHash'-'contentHash'-'targetHash'-'destinationUrl'-'replacePublished'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 or length(coalesce(p_input->>'destinationUrl',''))>2048 or coalesce(p_input->>'destinationUrl','')!~'^https://[^/[:space:]@]+/' then raise exception 'Review the exact destination, response and reason';end if;
 select * into d from public.review_responses where id=(p_input->>'responseId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if d.version is distinct from(p_input->>'expectedVersion')::integer or d.source_version is distinct from(p_input->>'sourceVersion')::integer or d.content_hash is distinct from p_input->>'contentHash' or d.context_hash is distinct from p_input->>'contextHash' or d.superseded_at is not null then return '{"state":"stale_response"}';end if;
 if d.status<>'approved' or d.approved_at is null or d.context_snapshot_id is null or not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=p_property_id and u.id=d.approved_by and u.role in('admin','manager')) then return '{"state":"approval_required"}';end if;
 source:=public.reviewflow_response_context(p_property_id,p_actor_id,d.review_id);if source->>'state'<>'ready' then return source;end if;
 if source->>'contextHash' is distinct from d.context_hash then return '{"state":"stale_context"}';end if;
 target:=public.reviewflow_publication_target(p_property_id,p_actor_id,d.review_id);if target->>'targetHash' is distinct from p_input->>'targetHash' then return '{"state":"stale_destination"}';end if;
 if(target->>'hasPreviousPublication')::boolean and p_input->'replacePublished' is distinct from 'true'::jsonb then return '{"state":"replacement_review_required"}';end if;
 select * into active from public.reviewflow_publications where review_id=d.review_id and property_id=p_property_id and state in('awaiting_confirmation','held');if found then return jsonb_build_object('state','busy','publicationId',active.id);end if;
 select * into a from public.shared_action_attempts where id=d.shared_action_attempt_id and property_id=p_property_id and org_id=(source->'context'->'property'->>'orgId')::uuid for update;
 if not found or a.proposal_decision_status<>'approved' or a.execution_status<>'approved_pending_execution' then return '{"state":"publication_review_required"}';end if;
 destination:=target->'target'||jsonb_build_object('url',p_input->>'destinationUrl','evidence','staff_selected');
 insert into public.reviewflow_publications(id,property_id,org_id,actor_id,review_id,response_id,attempt_id,job_id,context_id,source_version,response_version,content_hash,context_hash,response_text,destination,destination_hash,input,input_hash,mode,state)
 values(p_id,p_property_id,a.org_id,p_actor_id,d.review_id,d.id,a.id,a.job_id,d.context_snapshot_id,d.source_version,d.version,d.content_hash,d.context_hash,d.response_text,destination,public.crm_configuration_hash(destination),p_input,public.crm_configuration_hash(p_input),'manual','awaiting_confirmation');
 update public.shared_action_attempts set execution_status='executing',lifecycle_status='running',execution_payload=execution_payload||jsonb_build_object('publicationId',p_id,'mode','manual','destinationHash',public.crm_configuration_hash(destination)),updated_at=clock_timestamp() where id=a.id;
 update public.shared_jobs set lifecycle_status='running',stage='manual_confirmation',status_reason='manual_publication_prepared',current_step='Prepared exact response; awaiting staff publication evidence',started_at=coalesce(started_at,clock_timestamp()),finished_at=null,updated_at=clock_timestamp() where id=a.job_id;
 select * into c from public.reputation_cases where review_id=d.review_id and property_id=p_property_id;
 if found then insert into public.reputation_case_events(id,case_id,property_id,event_type,actor_profile_id,payload) values(p_id,c.id,p_property_id,'publication.prepared',p_actor_id,jsonb_build_object('publicationId',p_id,'responseId',d.id,'contentHash',d.content_hash,'destination',destination,'reason',p_input->>'reason'));end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'publication.prepared',p_input,jsonb_build_object('responseId',d.id,'status',d.status),jsonb_build_object('publicationId',p_id,'state','awaiting_confirmation'),jsonb_build_object('publicationId',p_id,'version',1,'state','awaiting_confirmation','mode','manual','providerCalled',false),jsonb_build_object('jobId',a.job_id,'attemptId',a.id,'contextId',d.context_snapshot_id));
end$$;

create function public.review_reviewflow_manual_publication(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;run public.reviewflow_publications;d public.review_responses;c public.reputation_cases;kind text;decision text:=p_input->>'decision';next_state text;proof jsonb;posted timestamptz;source_changed boolean;begin
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id and u.role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 if coalesce(decision,'') not in('reported','not_published','uncertain') then raise exception 'Review the actual publication outcome';end if;
 kind:=case decision when 'reported' then 'publication.reported' when 'not_published' then 'publication.cancelled' else 'publication.uncertain' end;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'publicationId'-'expectedVersion'-'decision'-'reason'-'confirmedExactText'-'confirmedNotPublished'-'publishedAt'-'evidenceUrl')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Record a reviewed outcome and reason';end if;
 select * into run from public.reviewflow_publications where id=(p_input->>'publicationId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id) for update;if not found then return '{"state":"not_found"}';end if;
 if run.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_publication"}';end if;
 if run.mode<>'manual' or run.state not in('awaiting_confirmation','held') then return '{"state":"publication_closed"}';end if;
 select * into d from public.review_responses where id=run.response_id and property_id=p_property_id for update;
 if d.status<>'approved' or d.superseded_at is not null or d.content_hash is distinct from run.content_hash then return '{"state":"publication_review_required"}';end if;
 source_changed:=not exists(select 1 from public.reviews where id=run.review_id and property_id=p_property_id and source_version=run.source_version);
 if decision='reported' then
  if p_input->'confirmedExactText' is distinct from 'true'::jsonb or length(coalesce(p_input->>'evidenceUrl',''))>2048 or coalesce(p_input->>'evidenceUrl','')!~'^https://[^/[:space:]@]+/' then raise exception 'Confirm exact posted text and provide its public evidence link';end if;
  posted:=nullif(p_input->>'publishedAt','')::timestamptz;if posted is null or posted<run.created_at-interval '5 minutes' or posted>clock_timestamp()+interval '1 minute' then raise exception 'Record the actual publication time after this response was prepared';end if;
  next_state:='reported';proof:=jsonb_build_object('kind','staff_reported','verifiedByProvider',false,'reportedBy',p_actor_id,'reportedAt',clock_timestamp(),'publishedAt',posted,'evidenceUrl',p_input->>'evidenceUrl','contentHash',run.content_hash,'destinationHash',run.destination_hash,'reason',p_input->>'reason','sourceChanged',source_changed);
  update public.reviewflow_publications set state=next_state,report=proof,report_hash=public.crm_configuration_hash(proof),error_code=null,finished_at=clock_timestamp() where id=run.id;
  update public.review_responses set status='posted',posted_at=posted,posted_by=p_actor_id,posting_mode='manual_confirmed',provider_post_url=p_input->>'evidenceUrl',provider_notes='Staff-reported publication; provider has not verified it' where id=d.id;
  update public.reviews set response_status='posted',updated_at=clock_timestamp() where id=run.review_id and property_id=p_property_id and source_version=run.source_version;
  update public.shared_action_attempts set lifecycle_status='succeeded',execution_status='executed',execution_result=proof,executed_at=posted,error_message=null,updated_at=clock_timestamp() where id=run.attempt_id;
  update public.shared_jobs set lifecycle_status='succeeded',stage='completed',status_reason='publication_reported',current_step='Staff reported publication; independent provider verification unavailable',progress=100,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.job_id;
 elsif decision='not_published' then
  if p_input->'confirmedNotPublished' is distinct from 'true'::jsonb then raise exception 'Confirm that this prepared response was not published';end if;
  next_state:='cancelled';proof:=jsonb_build_object('kind','staff_reported_not_published','verifiedByProvider',false,'reviewedBy',p_actor_id,'reason',p_input->>'reason');
  update public.reviewflow_publications set state=next_state,report=proof,report_hash=public.crm_configuration_hash(proof),error_code=null,finished_at=clock_timestamp() where id=run.id;
  update public.shared_action_attempts set lifecycle_status='queued',execution_status='approved_pending_execution',execution_result=proof,error_message=null,updated_at=clock_timestamp() where id=run.attempt_id;
  update public.shared_jobs set lifecycle_status='queued',stage='approved',status_reason='manual_publication_cancelled',current_step='Staff confirmed no publication; awaiting a new explicit request',finished_at=null,updated_at=clock_timestamp() where id=run.job_id;
 else
  next_state:='held';proof:=jsonb_build_object('kind','staff_reported_uncertain','verifiedByProvider',false,'reviewedBy',p_actor_id,'reason',p_input->>'reason');
  update public.reviewflow_publications set state=next_state,error_code='manual_outcome_uncertain' where id=run.id;
  update public.shared_action_attempts set lifecycle_status='failed',execution_status='failed',execution_result=proof,error_message='manual_outcome_uncertain',updated_at=clock_timestamp() where id=run.attempt_id;
  update public.shared_jobs set lifecycle_status='failed',stage='review',status_reason='manual_outcome_uncertain',current_step='Publication outcome is uncertain; review the public destination',updated_at=clock_timestamp() where id=run.job_id;
 end if;
 select * into c from public.reputation_cases where review_id=run.review_id and property_id=p_property_id for update;
 if found then
  update public.reputation_cases set status=case when decision='reported' and status in('awaiting_approval','ready_to_post') then 'triaged' else status end,last_activity_at=clock_timestamp() where id=c.id;
  insert into public.reputation_case_events(id,case_id,property_id,event_type,actor_profile_id,payload) values(p_id,c.id,p_property_id,kind,p_actor_id,jsonb_build_object('publicationId',run.id,'responseId',run.response_id,'previousState',run.state,'state',next_state,'proof',proof));
 end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,jsonb_build_object('publicationId',run.id,'state',run.state),jsonb_build_object('publicationId',run.id,'state',next_state,'version',run.version+1),jsonb_build_object('publicationId',run.id,'state',next_state,'version',run.version+1,'verifiedByProvider',false,'sourceChanged',source_changed),jsonb_build_object('jobId',run.job_id,'attemptId',run.attempt_id,'contextId',run.context_id));
end$$;

revoke all on function public.guard_reviewflow_source(),public.guard_reviewflow_publication(),public.reviewflow_publication_target(uuid,uuid,uuid),public.request_reviewflow_manual_publication(uuid,uuid,uuid,jsonb),public.review_reviewflow_manual_publication(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_reviewflow_source(),public.guard_reviewflow_publication(),public.reviewflow_publication_target(uuid,uuid,uuid),public.request_reviewflow_manual_publication(uuid,uuid,uuid,jsonb),public.review_reviewflow_manual_publication(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
