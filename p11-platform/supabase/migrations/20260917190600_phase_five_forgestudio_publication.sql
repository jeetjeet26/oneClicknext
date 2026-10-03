create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

-- Freeze the approved content and destination identity at scheduling time.
-- Existing rows deliberately remain unqualified until their history is reviewed.
alter table public.social_publications add column delivery_snapshot jsonb;

create function public.schedule_forgestudio_publications(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;revision public.social_content_revisions;pkg public.social_content_packages;destination jsonb;connection public.social_connections;variant public.social_content_variants;job uuid;attempt uuid;publication public.social_publications;results jsonb:='[]';seen text[]:='{}';identity text;scheduled timestamptz;tz text;publications uuid[]:='{}';
begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'publications.scheduled',p_payload);if response->>'state'<>'new' then return response;end if;
 if jsonb_typeof(p_payload->'destinations') is distinct from 'array' or jsonb_array_length(p_payload->'destinations') not between 1 and 20 then raise exception 'Choose one to twenty destinations';end if;
 select * into revision from public.social_content_revisions where id=(p_payload->>'revisionId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into pkg from public.social_content_packages where id=revision.package_id for update;
 if revision.approval_status<>'approved' or pkg.current_revision_id is distinct from revision.id or revision.content_hash is distinct from p_payload->>'contentHash' then return '{"state":"stale_revision"}';end if;
 if not exists(select 1 from public.profiles u where u.id=revision.approved_by and u.org_id=revision.org_id and u.role in('admin','manager')) then return '{"state":"approval_access_changed"}';end if;
 -- Validate every destination before creating any executable job.
 for destination in select value from jsonb_array_elements(p_payload->'destinations') loop
  select * into connection from public.social_connections where id=(destination->>'connectionId')::uuid and property_id=p_property_id and is_active for share;
  if not found or nullif(connection.account_id,'') is null then return '{"state":"connection_unavailable"}';end if;
  select * into variant from public.social_content_variants where id=(destination->>'variantId')::uuid and revision_id=revision.id and property_id=p_property_id and platform=case when connection.platform='twitter' then 'x' else connection.platform end;
  if not found or variant.validation->'issues' is distinct from '[]'::jsonb then return '{"state":"variant_unavailable"}';end if;
  identity:=connection.id::text||':'||variant.id::text;
  if identity=any(seen) then return '{"state":"duplicate_destination"}';end if;seen:=array_append(seen,identity);
  if exists(select 1 from public.social_publications where variant_id=variant.id and connection_id=connection.id and status in('scheduled','queued','publishing','reconciling','published')) then return '{"state":"already_scheduled"}';end if;
  if exists(select 1 from public.social_publications p join public.social_publication_attempts a on a.publication_id=p.id where p.variant_id=variant.id and p.connection_id=connection.id) then return '{"state":"history_review_required"}';end if;
  scheduled:=(destination->>'scheduledFor')::timestamptz;tz:=destination->>'timezone';
  if scheduled is null or not isfinite(scheduled) or scheduled<clock_timestamp() or scheduled>clock_timestamp()+interval '366 days' then return '{"state":"schedule_time_required"}';end if;
  if tz is null or not exists(select 1 from pg_timezone_names where name=tz) then return '{"state":"timezone_required"}';end if;
  if (nullif(destination->>'experimentKey','') is null)<>(nullif(destination->>'experimentGroup','') is null) or destination->>'experimentGroup' not in('control','treatment') then return '{"state":"experiment_invalid"}';end if;
 end loop;
 for destination in select value from jsonb_array_elements(p_payload->'destinations') loop
  select * into connection from public.social_connections where id=(destination->>'connectionId')::uuid;
  select * into variant from public.social_content_variants where id=(destination->>'variantId')::uuid;
  scheduled:=(destination->>'scheduledFor')::timestamptz;job:=gen_random_uuid();attempt:=gen_random_uuid();
  insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,lifecycle_status,status_reason,dedupe_key,payload,available_at,max_attempts)
  values(job,revision.org_id,p_property_id,'forgestudio.publication','social_publication','queued','scheduled','publication:'||p_id||':'||variant.id||':'||connection.id,jsonb_build_object('revisionId',revision.id,'variantId',variant.id,'connectionId',connection.id,'scheduledFor',scheduled),scheduled,1);
  insert into public.shared_action_attempts(id,job_id,org_id,property_id,action_type,lifecycle_status,proposal_decision_status,execution_status,requested_by,reviewed_by,request_payload,execution_payload,policy_snapshot,rollback_metadata,policy_reason,proposed_at,decided_at)
  values(attempt,job,revision.org_id,p_property_id,'publish_social_content_revision','queued','approved','approved_pending_execution',p_actor_id,revision.approved_by,jsonb_build_object('revisionId',revision.id,'variantId',variant.id,'connectionId',connection.id,'scheduledFor',scheduled),jsonb_build_object('revisionId',revision.id,'variantId',variant.id,'connectionId',connection.id,'scheduledFor',scheduled),jsonb_build_object('policy','forgestudio.social-publishing','version','2026-09-17','contentHash',revision.content_hash,'exactRevisionApproved',true),'{"supportedBeforeRemotePublish":true,"operation":"cancel_publication"}',revision.approval_note,clock_timestamp(),clock_timestamp());
  insert into public.shared_approvals(action_attempt_id,org_id,property_id,decision_status,decision_reason,reviewer_profile_id,decision_payload)
  values(attempt,revision.org_id,p_property_id,'approved',revision.approval_note,revision.approved_by,jsonb_build_object('revisionId',revision.id,'contentHash',revision.content_hash,'scheduledBy',p_actor_id));
  insert into public.shared_policy_decisions(org_id,property_id,job_id,action_attempt_id,policy_name,policy_version,decision_status,decision_reason,decision_payload)
  values(revision.org_id,p_property_id,job,attempt,'forgestudio.social-publishing','2026-09-17','approved',revision.approval_note,jsonb_build_object('contentHash',revision.content_hash,'scheduledFor',scheduled));
  insert into public.social_publications(org_id,property_id,package_id,revision_id,variant_id,connection_id,platform,scheduled_for,timezone,experiment_key,experiment_group,status,max_attempts,shared_job_id,shared_action_attempt_id,created_by,delivery_snapshot)
  values(revision.org_id,p_property_id,pkg.id,revision.id,variant.id,connection.id,variant.platform,scheduled,destination->>'timezone',nullif(destination->>'experimentKey',''),nullif(destination->>'experimentGroup',''),'scheduled',1,job,attempt,p_actor_id,jsonb_build_object('version','studio-delivery-v1','contentHash',revision.content_hash,'variantHash',public.crm_configuration_hash(to_jsonb(variant)),'accountId',connection.account_id,'pageId',connection.page_id,'platform',connection.platform,'connectionId',connection.id)) returning * into publication;
  update public.shared_jobs set subject_id=publication.id where id=job;
  results:=results||jsonb_build_array(to_jsonb(publication));publications:=array_append(publications,publication.id);
 end loop;
 update public.social_content_packages set status='scheduled',updated_at=clock_timestamp() where id=pkg.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'publications.scheduled',p_payload,jsonb_build_object('revisionId',revision.id,'packageStatus',pkg.status),jsonb_build_object('revisionId',revision.id,'publicationIds',publications,'count',cardinality(publications)),jsonb_build_object('publications',results,'publicationIds',publications,'count',cardinality(publications)),jsonb_build_object('contextId',revision.context_snapshot_id));
end;$$;

create function public.control_forgestudio_publication(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;publication public.social_publications;job public.shared_jobs;operation text:=p_payload->>'action';previous jsonb;scheduled timestamptz;begin
 if operation is null or operation not in('cancel','reschedule') then raise exception 'Unsupported publication control';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'publication.'||operation,p_payload);if response->>'state'<>'new' then return response;end if;
 select * into publication from public.social_publications where id=(p_payload->>'publicationId')::uuid and property_id=p_property_id;
 if not found then return '{"state":"not_found"}';end if;
 select * into job from public.shared_jobs where id=publication.shared_job_id for update;
 select * into publication from public.social_publications where id=publication.id for update;
 if publication.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then return '{"state":"stale_publication"}';end if;
 if job.id is null then return '{"state":"legacy_review_required"}';end if;
 if publication.status not in('scheduled','queued') or job.lease_owner is not null or job.lifecycle_status not in('queued','retrying') or exists(select 1 from public.social_publication_attempts where publication_id=publication.id) then return '{"state":"publication_in_progress"}';end if;
 previous:=jsonb_build_object('publicationId',publication.id,'status',publication.status,'scheduledFor',publication.scheduled_for);
 if operation='cancel' then
  update public.social_publications set status='cancelled',cancelled_at=clock_timestamp(),updated_at=clock_timestamp() where id=publication.id returning * into publication;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='publication_cancelled',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=job.id;
  update public.shared_action_attempts set lifecycle_status='cancelled',execution_status='cancelled',error_message='Publication cancelled before remote execution',updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
 else
  if publication.delivery_snapshot is null then return '{"state":"legacy_review_required"}';end if;
  scheduled:=(p_payload->>'scheduledFor')::timestamptz;
  if scheduled is null or not isfinite(scheduled) or scheduled<clock_timestamp() or scheduled>clock_timestamp()+interval '366 days' then return '{"state":"schedule_time_required"}';end if;
  update public.social_publications set scheduled_for=scheduled,updated_at=clock_timestamp() where id=publication.id returning * into publication;
  update public.shared_jobs set available_at=scheduled,retry_at=null,payload=jsonb_set(payload,'{scheduledFor}',to_jsonb(scheduled)),updated_at=clock_timestamp() where id=job.id;
  update public.shared_action_attempts set execution_payload=execution_payload||jsonb_build_object('publicationId',publication.id,'scheduledFor',scheduled),updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
 end if;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'publication.'||operation,p_payload,previous,jsonb_build_object('publicationId',publication.id,'status',publication.status,'scheduledFor',publication.scheduled_for),jsonb_build_object('publication',to_jsonb(publication),'publicationId',publication.id,'status',publication.status),jsonb_build_object('jobId',job.id,'attemptId',publication.shared_action_attempt_id));
end;$$;
revoke all on function public.schedule_forgestudio_publications(uuid,uuid,uuid,jsonb),public.control_forgestudio_publication(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.schedule_forgestudio_publications(uuid,uuid,uuid,jsonb),public.control_forgestudio_publication(uuid,uuid,uuid,jsonb) to service_role;

-- Private execution evidence identifies the system worker, not the scheduling user.
create table public.forgestudio_publication_receipts (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 publication_id uuid not null references public.social_publications(id) on delete cascade,
 job_id uuid not null references public.shared_jobs(id) on delete cascade,
 claim_id uuid not null,
 worker_id text not null,
 kind text not null check(kind in('write_intent','provider_acknowledged','provider_uncertain','blocked_before_send','operator_attestation')),
 evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(claim_id,kind)
);
create unique index forgestudio_one_publication_write on public.forgestudio_publication_receipts(publication_id) where kind='write_intent';
create index forgestudio_publication_receipts_publication on public.forgestudio_publication_receipts(publication_id,created_at);
create index forgestudio_publication_receipts_job on public.forgestudio_publication_receipts(job_id);
create index forgestudio_publication_receipts_property on public.forgestudio_publication_receipts(property_id,created_at desc);
alter table public.forgestudio_publication_receipts enable row level security;
revoke all on public.forgestudio_publication_receipts from public,anon,authenticated;
grant select,insert,delete on public.forgestudio_publication_receipts to service_role;
create policy forgestudio_receipts_service on public.forgestudio_publication_receipts for all to service_role using(true) with check(true);
create function public.guard_forgestudio_publication_receipt() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if exists(select 1 from public.properties where id=old.property_id) then raise exception 'Publication evidence is immutable';end if;return old;
end;$$;
create trigger forgestudio_publication_receipt_immutable before update or delete on public.forgestudio_publication_receipts for each row execute function public.guard_forgestudio_publication_receipt();

-- This guard is repeated immediately before the one provider invocation. The
-- credential fingerprint is private and prevents an account/token swap between
-- local validation and the intent transaction. No secrets enter receipts.
create function public.prepare_forgestudio_publication_write(p_job_id uuid,p_worker text,p_claim_id uuid,p_fingerprint text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare publication public.social_publications;job public.shared_jobs;revision public.social_content_revisions;pkg public.social_content_packages;variant public.social_content_variants;connection public.social_connections;fingerprint text;receipt public.forgestudio_publication_receipts;begin
 select * into publication from public.social_publications where shared_job_id=p_job_id;
 if not found then return '{"state":"publication_missing"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(publication.property_id::text,12));
 select * into job from public.shared_jobs where id=p_job_id for update;
 select * into publication from public.social_publications where id=publication.id for update;
 if job.domain<>'forgestudio.publication' or job.subject_id is distinct from publication.id::text or job.property_id is distinct from publication.property_id or job.org_id is distinct from publication.org_id then return '{"state":"job_mismatch"}';end if;
 if exists(select 1 from public.forgestudio_publication_receipts r where r.publication_id=publication.id and r.kind='write_intent') then return '{"state":"write_already_recorded"}';end if;
 if p_claim_id is null or nullif(p_worker,'') is null or job.lifecycle_status<>'running' or job.lease_owner is distinct from p_worker or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp() then return '{"state":"lease_lost"}';end if;
 if publication.delivery_snapshot is null or publication.status not in('scheduled','queued') or exists(select 1 from public.social_publication_attempts where publication_id=publication.id) then return '{"state":"history_review_required"}';end if;
 select * into revision from public.social_content_revisions where id=publication.revision_id;
 select * into pkg from public.social_content_packages where id=publication.package_id;
 select * into variant from public.social_content_variants where id=publication.variant_id;
 select * into connection from public.social_connections where id=publication.connection_id for share;
 if revision.id is null or variant.id is null or revision.approval_status<>'approved' or pkg.current_revision_id is distinct from revision.id or revision.content_hash is distinct from publication.delivery_snapshot->>'contentHash' or public.crm_configuration_hash(to_jsonb(variant)) is distinct from publication.delivery_snapshot->>'variantHash' or variant.validation->'issues' is distinct from '[]'::jsonb then return '{"state":"approval_changed"}';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=publication.property_id and p.org_id=publication.org_id and u.id=revision.approved_by and u.role in('admin','manager')) or not exists(select 1 from public.profiles where id=publication.created_by and org_id=publication.org_id) then return '{"state":"access_changed"}';end if;
 if connection.id is null or connection.is_active is not true or connection.property_id is distinct from publication.property_id or connection.account_id is distinct from publication.delivery_snapshot->>'accountId' or connection.page_id is distinct from publication.delivery_snapshot->>'pageId' or connection.platform is distinct from publication.delivery_snapshot->>'platform' then return '{"state":"destination_changed"}';end if;
 if connection.token_expires_at is not null and connection.token_expires_at<=clock_timestamp()+interval '10 minutes' then return '{"state":"reconnect_required"}';end if;
 fingerprint:=public.crm_configuration_hash(jsonb_build_object('snapshot',publication.delivery_snapshot,'accessToken',connection.access_token,'pageAccessToken',connection.page_access_token,'refreshToken',connection.refresh_token,'tokenExpiresAt',connection.token_expires_at));
 if p_fingerprint is null then return jsonb_build_object('state','prepared','fingerprint',fingerprint,'publication',to_jsonb(publication),'variant',to_jsonb(variant),'connection',to_jsonb(connection));end if;
 if p_fingerprint is distinct from fingerprint then return '{"state":"destination_changed"}';end if;
 insert into public.forgestudio_publication_receipts(property_id,publication_id,job_id,claim_id,worker_id,kind,evidence)
 values(publication.property_id,publication.id,job.id,p_claim_id,p_worker,'write_intent',jsonb_build_object('snapshot',publication.delivery_snapshot,'idempotencyKey','publication:'||publication.id,'origin','system_worker')) returning * into receipt;
 insert into public.social_publication_attempts(publication_id,org_id,property_id,shared_action_attempt_id,attempt_number,idempotency_key,status,request_summary)
 values(publication.id,publication.org_id,publication.property_id,publication.shared_action_attempt_id,job.attempt_count,'publication:'||publication.id,'running',jsonb_build_object('claimId',p_claim_id,'receiptId',receipt.id,'contentHash',revision.content_hash,'accountId',connection.account_id));
 update public.social_publications set status='publishing',attempt_count=job.attempt_count,updated_at=clock_timestamp() where id=publication.id;
 update public.shared_action_attempts set lifecycle_status='running',execution_status='executing',updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
 return jsonb_build_object('state','proceed_once','receiptId',receipt.id,'publicationId',publication.id,'idempotencyKey','publication:'||publication.id);
end;$$;

create function public.finish_forgestudio_publication_write(p_job_id uuid,p_worker text,p_claim_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare publication public.social_publications;job public.shared_jobs;intent public.forgestudio_publication_receipts;prior public.forgestudio_publication_receipts;kind text;result_status text;proof jsonb;begin
 select * into publication from public.social_publications where shared_job_id=p_job_id;
 if not found then return '{"state":"publication_missing"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(publication.property_id::text,12));
 select * into job from public.shared_jobs where id=p_job_id for update;
 select * into publication from public.social_publications where id=publication.id for update;
 select * into intent from public.forgestudio_publication_receipts r where r.publication_id=publication.id and r.kind='write_intent';
 kind:=p_payload->>'kind';
 if kind is null or kind not in('provider_acknowledged','provider_uncertain','blocked_before_send') then raise exception 'Unsupported publication result';end if;
 proof:=jsonb_build_object('kind',kind,'reason',left(coalesce(p_payload->>'reason',''),1000),'providerPostId',p_payload->>'providerPostId','providerPostUrl',p_payload->>'providerPostUrl','origin','system_worker');
 select * into prior from public.forgestudio_publication_receipts r where r.claim_id=p_claim_id and r.kind in('provider_acknowledged','provider_uncertain','blocked_before_send');
 if found then
  if prior.kind=kind and prior.evidence=proof then return jsonb_build_object('state','replayed','status',publication.status);end if;
  return '{"state":"result_conflict"}';
 end if;
 if kind='blocked_before_send' then
  if intent.id is not null or job.lifecycle_status<>'running' or job.lease_owner is distinct from p_worker then return '{"state":"write_review_required"}';end if;
 else
  if intent.id is null or intent.claim_id is distinct from p_claim_id or intent.worker_id is distinct from p_worker then return '{"state":"claim_mismatch"}';end if;
 end if;
 if kind='provider_acknowledged' and ((length(coalesce(p_payload->>'providerPostId','')) not between 1 and 300 or coalesce(p_payload->>'providerPostId','') !~ '^[a-zA-Z0-9_:.-]+$') or (p_payload->>'providerPostUrl' is not null and (length(p_payload->>'providerPostUrl')>2000 or p_payload->>'providerPostUrl' !~ '^https://[^[:space:]]+$'))) then raise exception 'Provider result has no valid post identity';end if;
 insert into public.forgestudio_publication_receipts(property_id,publication_id,job_id,claim_id,worker_id,kind,evidence) values(publication.property_id,publication.id,job.id,p_claim_id,p_worker,kind,proof);
 if exists(select 1 from public.forgestudio_publication_receipts r where r.publication_id=publication.id and r.kind='operator_attestation') then
  if kind='provider_acknowledged' and publication.remote_post_id is distinct from p_payload->>'providerPostId' then
   update public.social_publications set status='reconciling',last_error='The provider acknowledged a different post than the manager recorded. Review both saved identities.',error_classification='ambiguous',updated_at=clock_timestamp() where id=publication.id;
   update public.shared_jobs set lifecycle_status='failed',status_reason='provider_review_conflict',error_message='Provider and manager post identities differ',updated_at=clock_timestamp() where id=job.id;
   update public.shared_action_attempts set lifecycle_status='failed',execution_status='failed',error_message='Provider and manager post identities differ',updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
   return '{"state":"saved","status":"reconciling"}';
  end if;
  return jsonb_build_object('state','saved','status',publication.status,'reviewedResultPreserved',true);
 end if;
 result_status:=case kind when 'provider_acknowledged' then 'published' when 'provider_uncertain' then 'reconciling' else 'failed' end;
 update public.social_publications set status=result_status,remote_post_id=case when kind='provider_acknowledged' then p_payload->>'providerPostId' else remote_post_id end,remote_post_url=case when kind='provider_acknowledged' then p_payload->>'providerPostUrl' else remote_post_url end,published_at=case when kind='provider_acknowledged' then clock_timestamp() else published_at end,last_error=case when kind='provider_acknowledged' then null else proof->>'reason' end,error_classification=case kind when 'provider_uncertain' then 'ambiguous' when 'blocked_before_send' then 'permanent' else null end,updated_at=clock_timestamp() where id=publication.id;
 update public.social_publication_attempts set status=case kind when 'provider_acknowledged' then 'succeeded' when 'provider_uncertain' then 'reconciling' else 'failed' end,provider_post_id=p_payload->>'providerPostId',provider_post_url=p_payload->>'providerPostUrl',response_summary=proof,error_message=case when kind='provider_acknowledged' then null else proof->>'reason' end,error_classification=case when kind='provider_uncertain' then 'ambiguous' else null end,finished_at=clock_timestamp() where publication_id=publication.id and request_summary->>'claimId'=p_claim_id::text;
 update public.shared_jobs set lifecycle_status=case when kind='provider_acknowledged' then 'succeeded' else 'failed' end,status_reason=kind,error_message=case when kind='provider_acknowledged' then null else proof->>'reason' end,lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=job.id;
 update public.shared_action_attempts set lifecycle_status=case when kind='provider_acknowledged' then 'succeeded' else 'failed' end,execution_status=case when kind='provider_acknowledged' then 'executed' else 'failed' end,execution_result=proof,error_message=case when kind='provider_acknowledged' then null else proof->>'reason' end,executed_at=case when kind='provider_acknowledged' then clock_timestamp() else null end,updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
 if kind='provider_acknowledged' and not exists(select 1 from public.social_publications where package_id=publication.package_id and status not in('published','cancelled')) then update public.social_content_packages set status='published',updated_at=clock_timestamp() where id=publication.package_id;end if;
 return jsonb_build_object('state','saved','status',result_status);
end;$$;
revoke all on function public.guard_forgestudio_publication_receipt(),public.prepare_forgestudio_publication_write(uuid,text,uuid,text),public.finish_forgestudio_publication_write(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_forgestudio_publication_receipt(),public.prepare_forgestudio_publication_write(uuid,text,uuid,text),public.finish_forgestudio_publication_write(uuid,text,uuid,jsonb) to service_role;

create function public.review_forgestudio_publication_recovery(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;publication public.social_publications;job public.shared_jobs;intent public.forgestudio_publication_receipts;operation text:=p_payload->>'action';proof jsonb;begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'publication.recovery_reviewed',p_payload);if response->>'state'<>'new' then return response;end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and role in('manager','admin')) then return '{"state":"forbidden"}';end if;
 if operation is null or operation not in('resume_before_send','record_existing_post') or length(trim(coalesce(p_payload->>'reason','')))<10 then raise exception 'Choose a recovery decision and explain the reviewed evidence';end if;
 select * into publication from public.social_publications where id=(p_payload->>'publicationId')::uuid and property_id=p_property_id;
 if not found then return '{"state":"not_found"}';end if;
 select * into job from public.shared_jobs where id=publication.shared_job_id for update;
 select * into publication from public.social_publications where id=publication.id for update;
 if publication.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then return '{"state":"stale_publication"}';end if;
 if job.id is null or publication.delivery_snapshot is null then return '{"state":"legacy_review_required"}';end if;
 if job.lifecycle_status='running' and (job.lease_expires_at is null or job.lease_expires_at>clock_timestamp()) then return '{"state":"publication_in_progress"}';end if;
 if publication.status in('published','cancelled') then return '{"state":"publication_closed"}';end if;
 select * into intent from public.forgestudio_publication_receipts r where r.publication_id=publication.id and r.kind='write_intent';
 if operation='resume_before_send' then
  if intent.id is not null or exists(select 1 from public.social_publication_attempts where publication_id=publication.id) then return '{"state":"write_review_required"}';end if;
  if job.lifecycle_status not in('running','failed') then return '{"state":"publication_in_progress"}';end if;
  update public.social_publications set status='queued',last_error=null,error_classification=null,updated_at=clock_timestamp() where id=publication.id;
  update public.shared_jobs set lifecycle_status='queued',status_reason='reviewed_before_send_resume',available_at=greatest(clock_timestamp(),publication.scheduled_for),max_attempts=attempt_count+1,lease_owner=null,lease_expires_at=null,finished_at=null,error_message=null,updated_at=clock_timestamp() where id=job.id;
  update public.shared_action_attempts set lifecycle_status='queued',execution_status='approved_pending_execution',error_message=null,updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
 else
  if intent.id is null then return '{"state":"write_evidence_required"}';end if;
  if (length(coalesce(p_payload->>'providerPostId','')) not between 1 and 300 or coalesce(p_payload->>'providerPostId','') !~ '^[a-zA-Z0-9_:.-]+$') or (length(coalesce(p_payload->>'providerPostUrl',''))>2000 or coalesce(p_payload->>'providerPostUrl','') !~ '^https://[^[:space:]]+$') then raise exception 'Enter the existing provider post identity and HTTPS URL';end if;
  proof:=jsonb_build_object('source','operator_attestation','actorId',p_actor_id,'reason',p_payload->>'reason','providerPostId',p_payload->>'providerPostId','providerPostUrl',p_payload->>'providerPostUrl','automaticallyVerified',false);
  insert into public.forgestudio_publication_receipts(property_id,publication_id,job_id,claim_id,worker_id,kind,evidence) values(p_property_id,publication.id,job.id,p_id,'console-review','operator_attestation',proof);
  update public.social_publications set status='published',remote_post_id=p_payload->>'providerPostId',remote_post_url=p_payload->>'providerPostUrl',published_at=clock_timestamp(),last_error=null,error_classification=null,updated_at=clock_timestamp() where id=publication.id;
  update public.shared_jobs set lifecycle_status='succeeded',status_reason='operator_attested_existing_post',lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),error_message=null,updated_at=clock_timestamp() where id=job.id;
  update public.shared_action_attempts set lifecycle_status='succeeded',execution_status='executed',execution_result=proof,executed_at=clock_timestamp(),error_message=null,updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
  if not exists(select 1 from public.social_publications where package_id=publication.package_id and status not in('published','cancelled')) then update public.social_content_packages set status='published',updated_at=clock_timestamp() where id=publication.package_id;end if;
 end if;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'publication.recovery_reviewed',p_payload,jsonb_build_object('publicationId',publication.id,'status',publication.status),jsonb_build_object('publicationId',publication.id,'decision',operation,'evidenceSource',case when operation='record_existing_post' then 'operator_attestation' else 'saved_before_send_history' end),jsonb_build_object('publicationId',publication.id,'decision',operation),jsonb_build_object('jobId',job.id,'writeIntentId',intent.id));
end;$$;
revoke all on function public.review_forgestudio_publication_recovery(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.review_forgestudio_publication_recovery(uuid,uuid,uuid,jsonb) to service_role;

create function public.guard_forgestudio_publication_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if exists(select 1 from public.properties where id=old.property_id) and (new.org_id,new.property_id,new.package_id,new.revision_id,new.variant_id,new.connection_id,new.platform,new.delivery_snapshot,new.shared_job_id,new.shared_action_attempt_id,new.created_by) is distinct from (old.org_id,old.property_id,old.package_id,old.revision_id,old.variant_id,old.connection_id,old.platform,old.delivery_snapshot,old.shared_job_id,old.shared_action_attempt_id,old.created_by) then raise exception 'Create a new publication to change its approved content or destination';end if;
 return new;
end;$$;
create trigger forgestudio_publication_snapshot_immutable before update on public.social_publications for each row execute function public.guard_forgestudio_publication_snapshot();
revoke all on function public.guard_forgestudio_publication_snapshot() from public,anon,authenticated;
grant execute on function public.guard_forgestudio_publication_snapshot() to service_role;

notify pgrst,'reload schema';
