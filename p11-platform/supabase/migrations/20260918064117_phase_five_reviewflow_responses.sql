create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
alter table public.review_responses add column property_id uuid references public.properties(id) on delete cascade;
update public.review_responses d set property_id=r.property_id from public.reviews r where r.id=d.review_id;
alter table public.review_responses add column version integer not null default 1;
alter table public.review_responses add column source_version integer;
alter table public.review_responses add column context_snapshot_id uuid references public.shared_context_snapshots(id);
alter table public.review_responses add column context_hash text;
alter table public.review_responses add column content_hash text;
alter table public.review_responses add column provenance jsonb;
create index reviewflow_response_property on public.review_responses(property_id,created_at desc,id desc);
create index reviewflow_response_context on public.review_responses(context_snapshot_id);

create function public.reviewflow_response_context(p_property_id uuid,p_actor_id uuid,p_review_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.reviews;property public.properties;config jsonb;analysis jsonb;context jsonb;responses jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select * into source from public.reviews where id=p_review_id and property_id=p_property_id for share;if not found then return '{"state":"not_found"}';end if;
 select * into property from public.properties where id=p_property_id for share;
 select jsonb_build_object('propertyPersonality',property_personality,'defaultTone',default_tone) into config from public.reviewflow_config where property_id=p_property_id;
 select jsonb_build_object('id',a.id,'sourceVersion',a.source_version,'policyClass',a.policy_class,'riskClass',a.risk_class,'confidence',a.confidence,'isUrgent',a.is_urgent) into analysis from public.review_analyses a where a.review_id=p_review_id and a.property_id=p_property_id and a.source_version=source.source_version and a.status in('completed','manual_review_required') order by a.analysis_version desc limit 1;
 context:=jsonb_build_object('review',jsonb_build_object('id',source.id,'sourceVersion',source.source_version,'reviewText',source.review_text,'rating',source.rating,'reviewerName',source.reviewer_name,'platform',source.platform,'sentiment',source.sentiment,'topics',source.topics,'isUrgent',source.is_urgent),'property',jsonb_build_object('id',property.id,'orgId',property.org_id,'name',property.name,'brandVoice',property.brand_voice,'targetAudience',property.target_audience,'websiteUrl',property.website_url),'configuration',config,'analysis',analysis);
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'version',d.version,'status',d.status,'contentHash',coalesce(d.content_hash,public.crm_configuration_hash(to_jsonb(d.response_text))),'legacy',d.source_version is null) order by d.id),'[]'::jsonb) into responses from public.review_responses d where d.review_id=p_review_id and d.property_id=p_property_id and d.superseded_at is null and d.status in('draft','approved');
 return jsonb_build_object('state','ready','context',context,'contextHash',public.crm_configuration_hash(context),'pendingResponses',responses,'responseSetHash',public.crm_configuration_hash(responses));
end$$;

create function public.guard_reviewflow_response() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Response history must be retained';end if;
 if tg_op='UPDATE' then
  if(new.id,new.property_id,new.review_id,new.response_text,new.response_type,new.tone,new.ai_model,new.created_by,new.created_at,new.source_version,new.context_snapshot_id,new.context_hash,new.content_hash,new.provenance,new.generation_prompt) is distinct from(old.id,old.property_id,old.review_id,old.response_text,old.response_type,old.tone,old.ai_model,old.created_by,old.created_at,old.source_version,old.context_snapshot_id,old.context_hash,old.content_hash,old.provenance,old.generation_prompt) then raise exception 'Save response edits as a new draft version';end if;
  if old.status='posted' and(new.status,new.posted_at,new.platform_response_id,new.provider_post_url,new.provider_notes,new.posted_by,new.posting_mode) is distinct from(old.status,old.posted_at,old.platform_response_id,old.provider_post_url,old.provider_notes,old.posted_by,old.posting_mode) then raise exception 'Posted response evidence cannot be replaced';end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then raise exception 'Superseded response cannot regain approval';end if;
  new.version:=old.version+1;
 else
  if new.source_version is null or new.context_snapshot_id is null or new.context_hash is null or new.content_hash is null then raise exception 'New responses require saved source and exact text evidence';end if;
  if not exists(select 1 from public.reviews where id=new.review_id and property_id=new.property_id and source_version=new.source_version) then raise exception 'Response source scope does not match';end if;
  new.version:=1;
 end if;
 new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_response_guard before insert or update or delete on public.review_responses for each row execute function public.guard_reviewflow_response();
revoke insert,update,delete on public.review_responses from public,anon,authenticated;

create function public.commit_reviewflow_response_draft(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_provenance jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;effective jsonb:=p_input||jsonb_build_object('provenance',p_provenance);source jsonb;ctx uuid;organization uuid;job uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();draft public.review_responses;c public.reputation_cases;hash text;text_value text:=trim(p_input->>'responseText');replaced uuid[];begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'response.draft_saved',effective);if result->>'state'<>'new' then return result;end if;
 if(p_input-'reviewId'-'sourceVersion'-'contextHash'-'responseSetHash'-'replacePending'-'responseText'-'tone'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 or length(coalesce(text_value,'')) not between 20 and 1400 or coalesce(p_input->>'tone','') not in('professional','empathetic','friendly','apologetic') then raise exception 'Review the response text, tone and reason';end if;
 source:=public.reviewflow_response_context(p_property_id,p_actor_id,(p_input->>'reviewId')::uuid);if source->>'state'<>'ready' then return source;end if;
 if(source->'context'->'review'->>'sourceVersion')::integer is distinct from(p_input->>'sourceVersion')::integer or source->>'contextHash' is distinct from p_input->>'contextHash' then return '{"state":"stale_context"}';end if;
 if source->>'responseSetHash' is distinct from p_input->>'responseSetHash' then return '{"state":"stale_responses"}';end if;
 if jsonb_array_length(source->'pendingResponses')>0 and p_input->'replacePending' is distinct from 'true'::jsonb then return '{"state":"replacement_review_required"}';end if;
 if p_provenance->'textPolicy'->'passed' is distinct from 'true'::jsonb or p_provenance->>'policyVersion' is distinct from 'reviewflow-policy-v1' then raise exception 'A checked response policy is required';end if;
 if exists(select 1 from public.review_responses d join public.shared_action_attempts a on a.id=d.shared_action_attempt_id where d.review_id=(p_input->>'reviewId')::uuid and d.property_id=p_property_id and d.superseded_at is null and d.status in('draft','approved') and a.execution_status in('executing','failed')) then return '{"state":"publication_review_required"}';end if;
 select org_id into organization from public.properties where id=p_property_id;
 hash:=public.crm_configuration_hash(to_jsonb(text_value));
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by) values(organization,p_property_id,'reviewflow.response',p_input->>'reviewId',source->'context',source->>'contextHash',p_actor_id::text) returning id into ctx;
 select array_agg(id) into replaced from public.review_responses where review_id=(p_input->>'reviewId')::uuid and property_id=p_property_id and superseded_at is null and status in('draft','approved');
 update public.shared_jobs set lifecycle_status='cancelled',status_reason='response_superseded',stage='cancelled',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id in(select a.job_id from public.shared_action_attempts a join public.review_responses d on d.shared_action_attempt_id=a.id where d.id=any(replaced));
 update public.shared_action_attempts set lifecycle_status='cancelled',execution_status='cancelled',error_message='Response was superseded before publication',updated_at=clock_timestamp() where id in(select shared_action_attempt_id from public.review_responses where id=any(replaced));
 update public.review_responses set superseded_at=clock_timestamp() where id=any(replaced);
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,max_attempts,stage,progress,current_step) values(job,organization,p_property_id,'reviewflow.response','review_response',p_id::text,'queued','response_requires_approval',p_id::text,jsonb_build_object('responseId',p_id,'reviewId',p_input->>'reviewId','contentHash',hash),ctx,1,'approval',0,'Exact response text awaits manager approval');
 insert into public.shared_action_attempts(id,job_id,org_id,property_id,action_type,lifecycle_status,proposal_decision_status,execution_status,requested_by,request_payload,execution_payload,policy_snapshot,policy_reason) values(attempt,job,organization,p_property_id,'reviewflow_public_response','queued','proposed','pending_approval',p_actor_id,jsonb_build_object('responseId',p_id,'sourceVersion',p_input->'sourceVersion','contentHash',hash,'contextHash',source->>'contextHash'),jsonb_build_object('responseText',text_value),p_provenance->'policy','All public responses require reviewed manager approval');
 insert into public.review_responses(id,review_id,property_id,response_text,response_type,tone,status,ai_model,generation_prompt,created_by,shared_action_attempt_id,source_version,context_snapshot_id,context_hash,content_hash,provenance)
 values(p_id,(p_input->>'reviewId')::uuid,p_property_id,text_value,case when p_provenance->>'origin'='model_result' then 'ai_generated' else 'human_written' end,p_input->>'tone','draft',p_provenance->>'model',p_provenance::text,p_actor_id,attempt,(p_input->>'sourceVersion')::integer,ctx,source->>'contextHash',hash,p_provenance) returning * into draft;
 update public.reviews set response_status='draft_ready',updated_at=clock_timestamp() where id=draft.review_id and property_id=p_property_id;
 insert into public.reputation_cases(property_id,review_id,status,priority) values(p_property_id,draft.review_id,'open','medium') on conflict(review_id) do nothing;
 select * into c from public.reputation_cases where review_id=draft.review_id and property_id=p_property_id for update;
 update public.reputation_cases set status=case when status in('open','triaged','awaiting_approval','ready_to_post') then 'awaiting_approval' else status end,last_activity_at=clock_timestamp() where id=c.id;
 insert into public.reputation_case_events(id,case_id,property_id,event_type,actor_profile_id,actor_label,payload) values(p_id,c.id,p_property_id,'response.draft_saved',case when p_provenance->>'origin'='model_result' then null else p_actor_id end,case when p_provenance->>'origin'='model_result' then 'response_worker' else null end,jsonb_build_object('responseId',draft.id,'contentHash',hash,'contextHash',draft.context_hash,'replacedResponseIds',to_jsonb(replaced),'reason',p_input->>'reason','requestedBy',p_actor_id));
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'response.draft_saved',effective,jsonb_build_object('replacedResponseIds',to_jsonb(replaced)),jsonb_build_object('responseId',draft.id,'version',draft.version,'status','draft','contentHash',hash),jsonb_build_object('responseId',draft.id,'version',draft.version,'origin',coalesce(p_provenance->>'origin','console'),'publicationStarted',false),jsonb_build_object('jobId',job,'attemptId',attempt,'contextId',ctx));
end$$;

create function public.decide_reviewflow_response(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_policy jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;source jsonb;draft public.review_responses;a public.shared_action_attempts;c public.reputation_cases;decision text:=p_input->>'action';kind text;status_value text;begin
 if coalesce(decision,'') not in('approve','reject') then raise exception 'Choose approval or rejection for the exact response';end if;
 kind:=case decision when 'approve' then 'response.approved' else 'response.rejected' end;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id and u.role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 if(p_input-'responseId'-'expectedVersion'-'sourceVersion'-'contextHash'-'contentHash'-'reason'-'action')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the exact response and record your reason';end if;
 select * into draft from public.review_responses where id=(p_input->>'responseId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if draft.version is distinct from(p_input->>'expectedVersion')::integer or draft.superseded_at is not null then return '{"state":"stale_response"}';end if;
 if draft.source_version is null or draft.context_hash is null or draft.content_hash is null or draft.shared_action_attempt_id is null then return '{"state":"legacy_review_required"}';end if;
 if draft.content_hash is distinct from p_input->>'contentHash' or draft.context_hash is distinct from p_input->>'contextHash' or draft.source_version is distinct from(p_input->>'sourceVersion')::integer then return '{"state":"stale_response"}';end if;
 if(decision='approve' and draft.status<>'draft') or(decision='reject' and draft.status not in('draft','approved')) then return '{"state":"response_closed"}';end if;
 select * into a from public.shared_action_attempts where id=draft.shared_action_attempt_id and property_id=p_property_id for update;
 if not found or a.execution_status in('executing','executed','failed','reversed','cancelled') then return '{"state":"publication_review_required"}';end if;
 source:=public.reviewflow_response_context(p_property_id,p_actor_id,draft.review_id);if source->>'state'<>'ready' then return source;end if;
 if decision='approve' then
  if source->>'contextHash' is distinct from draft.context_hash then return '{"state":"stale_context"}';end if;
  if p_policy->'textPolicy'->'passed' is distinct from 'true'::jsonb or p_policy->>'policyVersion' is distinct from 'reviewflow-policy-v1' then raise exception 'Current response policy checks are required';end if;
 end if;
 status_value:=case decision when 'approve' then 'approved' else 'rejected' end;
 update public.review_responses set status=status_value,approved_by=case decision when 'approve' then p_actor_id else approved_by end,approved_at=case decision when 'approve' then clock_timestamp() else approved_at end,decision_reason=p_input->>'reason',rejected_reason=case decision when 'reject' then p_input->>'reason' else null end where id=draft.id;
 update public.shared_action_attempts set proposal_decision_status=case decision when 'approve' then 'approved' else 'denied' end,execution_status=case decision when 'approve' then 'approved_pending_execution' else 'cancelled' end,lifecycle_status=case decision when 'approve' then 'queued' else 'cancelled' end,reviewed_by=p_actor_id,decided_at=clock_timestamp(),policy_snapshot=p_policy,policy_reason=p_input->>'reason',updated_at=clock_timestamp() where id=a.id;
 insert into public.shared_approvals(action_attempt_id,org_id,property_id,decision_status,decision_reason,reviewer_profile_id,decision_payload) values(a.id,a.org_id,p_property_id,case decision when 'approve' then 'approved' else 'denied' end,p_input->>'reason',p_actor_id,jsonb_build_object('responseId',draft.id,'contentHash',draft.content_hash,'contextHash',draft.context_hash));
 insert into public.shared_policy_decisions(org_id,property_id,job_id,action_attempt_id,policy_name,policy_version,decision_status,decision_reason,decision_payload) values(a.org_id,p_property_id,a.job_id,a.id,'reviewflow.public-response','reviewflow-policy-v1',case decision when 'approve' then 'approved' else 'denied' end,p_input->>'reason',jsonb_build_object('responseId',draft.id,'contentHash',draft.content_hash,'contextHash',draft.context_hash));
 update public.shared_jobs set lifecycle_status=case decision when 'approve' then 'queued' else 'cancelled' end,stage=case decision when 'approve' then 'approved' else 'cancelled' end,status_reason='response_'||status_value,current_step=case decision when 'approve' then 'Approved response awaits explicit publication request' else 'Response rejected by reviewer' end,finished_at=case decision when 'reject' then clock_timestamp() else null end,updated_at=clock_timestamp() where id=a.job_id;
 update public.reviews set response_status=case decision when 'approve' then 'approved' else 'pending' end,updated_at=clock_timestamp() where id=draft.review_id and property_id=p_property_id;
 select * into c from public.reputation_cases where review_id=draft.review_id and property_id=p_property_id for update;
 if found then
  update public.reputation_cases set status=case when status in('open','triaged','awaiting_approval','ready_to_post') then case decision when 'approve' then 'ready_to_post' else 'triaged' end else status end,last_activity_at=clock_timestamp() where id=c.id;
  insert into public.reputation_case_events(id,case_id,property_id,event_type,actor_profile_id,payload) values(p_id,c.id,p_property_id,kind,p_actor_id,jsonb_build_object('responseId',draft.id,'contentHash',draft.content_hash,'contextHash',draft.context_hash,'reason',p_input->>'reason','before',jsonb_build_object('status',draft.status,'version',draft.version),'after',jsonb_build_object('status',status_value,'version',draft.version+1)));
 end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,jsonb_build_object('status',draft.status,'version',draft.version),jsonb_build_object('status',status_value,'version',draft.version+1),jsonb_build_object('responseId',draft.id,'status',status_value,'version',draft.version+1,'publicationStarted',false),jsonb_build_object('jobId',a.job_id,'attemptId',a.id,'contextId',draft.context_snapshot_id));
end$$;

create table public.reviewflow_response_generation_requests(
 id uuid primary key references public.shared_jobs(id),property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),review_id uuid not null references public.reviews(id) on delete cascade,source_version integer not null,
 input jsonb not null,input_hash text not null,source_snapshot jsonb not null,model_input jsonb not null,context_id uuid not null references public.shared_context_snapshots(id),
 state text not null default 'queued' check(state in('queued','running','result_ready','completed','held','stopped')),version integer not null default 1,claim_token uuid,raw_result jsonb,result_hash text,
 response_id uuid references public.review_responses(id) deferrable initially deferred,error_code text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz
);
create unique index reviewflow_response_generation_active on public.reviewflow_response_generation_requests(review_id,source_version) where state in('queued','running','result_ready');
create index reviewflow_response_generation_property on public.reviewflow_response_generation_requests(property_id,created_at desc,id);
create index reviewflow_response_generation_org on public.reviewflow_response_generation_requests(org_id);
create index reviewflow_response_generation_actor on public.reviewflow_response_generation_requests(actor_id);
create index reviewflow_response_generation_context on public.reviewflow_response_generation_requests(context_id);
create index reviewflow_response_generation_result on public.reviewflow_response_generation_requests(response_id);

alter table public.reviewflow_response_generation_requests enable row level security;

create policy reviewflow_response_generation_service on public.reviewflow_response_generation_requests for all to service_role using(true) with check(true);
revoke all on public.reviewflow_response_generation_requests from public,anon,authenticated;
grant all on public.reviewflow_response_generation_requests to service_role;
create function public.guard_reviewflow_response_generation() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) or not exists(select 1 from public.reviews where id=old.review_id) then return old;end if;raise exception 'Response generation request history is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.review_id,new.source_version,new.input,new.input_hash,new.source_snapshot,new.model_input,new.context_id,new.created_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.review_id,old.source_version,old.input,old.input_hash,old.source_snapshot,old.model_input,old.context_id,old.created_at) then raise exception 'Response generation request identity is immutable';end if;
 if old.claim_token is not null and new.claim_token is distinct from old.claim_token then raise exception 'One model intent is retained';end if;
 if old.raw_result is not null and(new.raw_result,new.result_hash) is distinct from(old.raw_result,old.result_hash) then raise exception 'Model result is immutable';end if;
 if old.state in('completed','held','stopped') and new.state<>old.state then raise exception 'Closed response generation cannot restart';end if;
 if old.response_id is not null and new.response_id is distinct from old.response_id then raise exception 'Saved response identity cannot change';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_response_generation_guard before update or delete on public.reviewflow_response_generation_requests for each row execute function public.guard_reviewflow_response_generation();

create function public.record_reviewflow_response_generation_event(p_run public.reviewflow_response_generation_requests,p_actor_id uuid,p_action text,p_phase text,p_result jsonb) returns void language plpgsql security invoker set search_path='' as $$declare event_id uuid;recorded jsonb;begin
 -- Keep private receipts even after the requester leaves; never invent a replacement human actor.
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_run.property_id and p.org_id=p_run.org_id) then return;end if;
 event_id:=md5(p_action||':'||p_run.id::text)::uuid;
 recorded:=public.append_shared_action_event(event_id,event_id,p_run.property_id,p_actor_id,'reviewflow',p_action,'server_confirmed',p_phase,jsonb_build_object('requestId',p_run.id,'sourceVersion',p_run.source_version),jsonb_build_object('state',p_run.state),jsonb_build_object('state',p_result->>'requestState'),p_result||jsonb_build_object('requestId',p_run.id,'origin','response_worker','requestedBy',p_run.actor_id,'publicationStarted',false),jsonb_build_object('jobId',p_run.id,'contextId',p_run.context_id));
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Response generation outcome history could not be saved';end if;
end$$;
create function public.claim_reviewflow_response_generation(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare run public.reviewflow_response_generation_requests;begin
 select * into run from public.reviewflow_response_generation_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_response_generation_requests where id=p_id for update;
 if run.state<>'queued' then return jsonb_build_object('state',run.state);end if;
 if (public.reviewflow_response_context(run.property_id,run.actor_id,run.review_id)->>'contextHash') is distinct from run.input->>'contextHash' or (public.reviewflow_response_context(run.property_id,run.actor_id,run.review_id)->>'responseSetHash') is distinct from run.input->>'responseSetHash' or not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id join public.reviews r on r.property_id=p.id where p.id=run.property_id and p.org_id=run.org_id and u.id=run.actor_id and r.id=run.review_id and r.source_version=run.source_version) then
  update public.reviewflow_response_generation_requests set state='held',error_code='source_or_access_changed',finished_at=clock_timestamp() where id=run.id;update public.shared_jobs set lifecycle_status='failed',status_reason='source_or_access_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;perform public.record_reviewflow_response_generation_event(run,run.actor_id,'review.response.generation_completed','failed',jsonb_build_object('requestState','held','reason','source_or_access_changed'));return '{"state":"held"}';
 end if;
 update public.reviewflow_response_generation_requests set state='running',claim_token=gen_random_uuid(),started_at=clock_timestamp() where id=run.id returning * into run;
 update public.shared_jobs set lifecycle_status='running',attempt_count=1,stage='analyzing',progress=10,started_at=clock_timestamp(),current_step='One model request started; awaiting its saved result',updated_at=clock_timestamp() where id=run.id;
 perform public.record_reviewflow_response_generation_event(run,run.actor_id,'review.response.generation_started','succeeded',jsonb_build_object('requestState','running'));
 return jsonb_build_object('state','invoke_once','claimToken',run.claim_token,'modelInput',run.model_input,'propertyId',run.property_id,'actorId',run.actor_id);
end$$;
create function public.record_reviewflow_response_generation_result(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare run public.reviewflow_response_generation_requests;next_state text;begin
 select * into run from public.reviewflow_response_generation_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_response_generation_requests where id=p_id for update;
 if p_claim_token is null or run.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if run.raw_result is not null then if run.result_hash=public.crm_configuration_hash(p_result) then return jsonb_build_object('state','replayed','requestState',run.state);end if;return '{"state":"result_conflict"}';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>262144 or coalesce(p_result->>'status','') not in('received','uncertain') or(p_result-'status'-'content'-'providerId'-'usage'-'errorCode')<>'{}'::jsonb or(p_result->>'status'='received' and jsonb_typeof(p_result->'content') is distinct from 'string') then raise exception 'Invalid model receipt';end if;
 next_state:=case when run.state in('held','stopped') then run.state when p_result->>'status'='uncertain' then 'held' else 'result_ready' end;
 update public.reviewflow_response_generation_requests set raw_result=p_result,result_hash=public.crm_configuration_hash(p_result),state=next_state,error_code=case when p_result->>'status'='uncertain' then 'model_uncertain' else error_code end where id=run.id;
 if next_state<>'stopped' then update public.shared_jobs set lifecycle_status='failed',status_reason=case when next_state='result_ready' then 'response_result_saved' else 'model_uncertain' end,stage='review',current_step=case when next_state='result_ready' then 'Saved model result awaits validated application' else 'Model outcome needs operator review' end,updated_at=clock_timestamp() where id=run.id;end if;
 perform public.record_reviewflow_response_generation_event(run,run.actor_id,'review.response.generation_result_received',case when p_result->>'status'='received' then 'succeeded' else 'failed' end,jsonb_build_object('requestState',next_state,'resultHash',public.crm_configuration_hash(p_result),'receiptStatus',p_result->>'status'));
 return jsonb_build_object('state','saved','requestState',next_state);
end$$;
create function public.control_reviewflow_response_generation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;run public.reviewflow_response_generation_requests;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'response.generation_stopped',p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'generationRequestId'-'expectedVersion'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the request and explain the stop';end if;
 select * into run from public.reviewflow_response_generation_requests where id=(p_input->>'generationRequestId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if run.state in('completed','stopped','held') then return jsonb_build_object('state',run.state);end if;
 update public.reviewflow_response_generation_requests set state='stopped',finished_at=clock_timestamp() where id=run.id;
 update public.shared_jobs set lifecycle_status='cancelled',stage='stopped',status_reason='operator_stopped',current_step='Stopped; late results are retained without application',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'response.generation_stopped',p_input,jsonb_build_object('state',run.state,'version',run.version),jsonb_build_object('state','stopped'),jsonb_build_object('requestId',run.id,'providerCancellationConfirmed',false),jsonb_build_object('jobId',run.id,'contextId',run.context_id));
end$$;
create function public.request_reviewflow_response_generation_recovery(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare result jsonb;run public.reviewflow_response_generation_requests;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'response.generation_recovered',p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'generationRequestId'-'expectedVersion'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the saved result and recovery reason';end if;
 select * into run from public.reviewflow_response_generation_requests where id=(p_input->>'generationRequestId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if run.state not in('queued','result_ready','completed') then return jsonb_build_object('state',run.state);end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'response.generation_recovered',p_input,jsonb_build_object('state',run.state,'version',run.version),jsonb_build_object('state',run.state),jsonb_build_object('requestId',run.id,'requestState',run.state,'modelInvoked',false),jsonb_build_object('jobId',run.id,'contextId',run.context_id));
end$$;
create function public.begin_reviewflow_response_generation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_model_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;source jsonb;run public.reviewflow_response_generation_requests;ctx uuid;organization uuid;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'response.generation_requested',p_input);if result->>'state' not in('new','replayed') then return result;end if;
 select * into run from public.reviewflow_response_generation_requests where id=p_id;if found then return jsonb_build_object('state',run.state,'requestId',run.id,'version',run.version,'responseId',run.response_id);end if;
 if(p_input-'reviewId'-'sourceVersion'-'contextHash'-'responseSetHash'-'replacePending'-'tone'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 or coalesce(p_input->>'tone','') not in('professional','empathetic','friendly','apologetic') then raise exception 'Review the source, tone and generation reason';end if;
 source:=public.reviewflow_response_context(p_property_id,p_actor_id,(p_input->>'reviewId')::uuid);if source->>'state'<>'ready' then return source;end if;
 if source->>'contextHash' is distinct from p_input->>'contextHash' or(source->'context'->'review'->>'sourceVersion')::integer is distinct from(p_input->>'sourceVersion')::integer then return '{"state":"stale_context"}';end if;
 if source->>'responseSetHash' is distinct from p_input->>'responseSetHash' then return '{"state":"stale_responses"}';end if;
 if jsonb_array_length(source->'pendingResponses')>0 and p_input->'replacePending' is distinct from 'true'::jsonb then return '{"state":"replacement_review_required"}';end if;
 select * into run from public.reviewflow_response_generation_requests where property_id=p_property_id and review_id=(p_input->>'reviewId')::uuid and state in('queued','running','result_ready');if found then return jsonb_build_object('state','busy','requestId',run.id,'version',run.version);end if;
 if jsonb_typeof(p_model_input) is distinct from 'object' or length(p_model_input::text)>262144 or p_model_input->'context' is distinct from source->'context' or p_model_input->'source'->>'reviewText' is distinct from source->'context'->'review'->>'reviewText' or p_model_input->'source'->>'tone' is distinct from p_input->>'tone' or p_model_input->>'promptVersion' is distinct from 'response-v3' or length(coalesce(p_model_input->>'model','')) not between 1 and 200 or length(coalesce(p_model_input->>'systemPrompt','')) not between 1 and 32000 or length(coalesce(p_model_input->>'userPrompt','')) not between 1 and 24000 then raise exception 'The saved response model contract is incomplete or stale';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by) values(organization,p_property_id,'reviewflow.response-generation',p_input->>'reviewId',jsonb_build_object('source',source->'context','modelInput',p_model_input),public.crm_configuration_hash(p_model_input),p_actor_id::text) returning id into ctx;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,max_attempts,stage,progress,current_step) values(p_id,organization,p_property_id,'reviewflow.response-generation','review',p_input->>'reviewId','queued','response_generation_saved',p_id::text,jsonb_build_object('requestId',p_id,'reviewId',p_input->>'reviewId','sourceVersion',p_input->'sourceVersion'),ctx,1,'queued',0,'Saved response input awaits execution');
 insert into public.reviewflow_response_generation_requests(id,property_id,org_id,actor_id,review_id,source_version,input,input_hash,source_snapshot,model_input,context_id) values(p_id,p_property_id,organization,p_actor_id,(p_input->>'reviewId')::uuid,(p_input->>'sourceVersion')::integer,p_input,public.crm_configuration_hash(p_input),source->'context',p_model_input,ctx);
 perform public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'response.generation_requested',p_input,jsonb_build_object('sourceVersion',p_input->'sourceVersion','contextHash',p_input->>'contextHash'),jsonb_build_object('requestId',p_id,'state','queued'),jsonb_build_object('requestId',p_id,'reviewId',p_input->>'reviewId','modelInvoked',false),jsonb_build_object('jobId',p_id,'contextId',ctx));
 return jsonb_build_object('state','queued','requestId',p_id,'version',1);
end$$;

create function public.apply_reviewflow_response_generation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.reviewflow_response_generation_requests;result jsonb;draft_id uuid:=md5('response-draft:'||p_id::text)::uuid;provenance jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));select * into run from public.reviewflow_response_generation_requests where id=p_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.state='completed' then return jsonb_build_object('state','replayed','responseId',run.response_id);end if;
 if run.state in('stopped','held') then return jsonb_build_object('state',run.state);end if;
 if run.state<>'result_ready' or run.raw_result is null then return '{"state":"result_required"}';end if;
 if p_result->>'resultHash' is distinct from run.result_hash or(p_result-'resultHash'-'response'-'policy'-'errorCode')<>'{}'::jsonb then return '{"state":"result_conflict"}';end if;
 if p_result->>'errorCode'='invalid_output' then result:='{"state":"invalid_output"}';
 else
  if p_result->'response'->>'responseText' is distinct from((run.raw_result->>'content')::jsonb->>'responseText') or p_result->'response'->'usedFacts' is distinct from((run.raw_result->>'content')::jsonb->'usedFacts') or p_result->'response'->'provenance'->>'model' is distinct from run.model_input->>'model' or p_result->'response'->'provenance'->>'promptVersion' is distinct from run.model_input->>'promptVersion' or p_result->'response'->'provenance'->>'taxonomyVersion' is distinct from run.model_input->>'taxonomyVersion' then raise exception 'Response differs from its saved model receipt';end if;
  if nullif(trim((run.raw_result->>'content')::jsonb->>'refusalReason'),'') is not null then raise exception 'Refused model output cannot become a draft';end if;
  if exists(select 1 from jsonb_array_elements_text(p_result->'response'->'usedFacts') f where not exists(select 1 from jsonb_array_elements(run.model_input->'source'->'grounding'->'citedFacts') allowed where allowed->>'fact'=f)) then raise exception 'Response citations do not match saved facts';end if;
  if not exists(select 1 from public.properties where id=p_property_id and org_id=run.org_id) then result:='{"state":"stale_context"}';else
   provenance:=(p_result->'policy')||jsonb_build_object('origin','model_result','model',run.model_input->>'model','promptVersion',run.model_input->>'promptVersion','taxonomyVersion',run.model_input->>'taxonomyVersion','generationRequestId',run.id,'resultHash',run.result_hash,'usedFacts',p_result->'response'->'usedFacts','usage',p_result->'response'->'usage','requestedBy',run.actor_id,'savedBy',p_actor_id);
   result:=public.commit_reviewflow_response_draft(draft_id,p_property_id,p_actor_id,run.input||jsonb_build_object('responseText',p_result->'response'->>'responseText'),provenance);
  end if;
 end if;
 if result->>'state' not in('saved','replayed') then
  update public.reviewflow_response_generation_requests set state='held',error_code=coalesce(result->>'state','invalid_output'),finished_at=clock_timestamp() where id=run.id;
  update public.shared_jobs set lifecycle_status='failed',status_reason=coalesce(result->>'state','invalid_output'),stage='review',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
  perform public.record_reviewflow_response_generation_event(run,p_actor_id,'review.response.generation_completed','failed',jsonb_build_object('requestState','held','reason',result->>'state'));return jsonb_build_object('state','held','reason',result->>'state');
 end if;
 update public.reviewflow_response_generation_requests set state='completed',response_id=draft_id,error_code=null,finished_at=clock_timestamp() where id=run.id;
 update public.shared_jobs set lifecycle_status='succeeded',stage='completed',progress=100,status_reason='response_draft_saved',current_step='Draft saved for manager review; publication has not started',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 perform public.record_reviewflow_response_generation_event(run,p_actor_id,'review.response.generation_completed','succeeded',jsonb_build_object('requestState','completed','responseId',draft_id));
 return jsonb_build_object('state','saved','responseId',draft_id);
end$$;

revoke all on function public.reviewflow_response_context(uuid,uuid,uuid),public.guard_reviewflow_response(),public.commit_reviewflow_response_draft(uuid,uuid,uuid,jsonb,jsonb),public.decide_reviewflow_response(uuid,uuid,uuid,jsonb,jsonb),public.guard_reviewflow_response_generation(),public.record_reviewflow_response_generation_event(public.reviewflow_response_generation_requests,uuid,text,text,jsonb),public.claim_reviewflow_response_generation(uuid),public.record_reviewflow_response_generation_result(uuid,uuid,jsonb),public.control_reviewflow_response_generation(uuid,uuid,uuid,jsonb),public.request_reviewflow_response_generation_recovery(uuid,uuid,uuid,jsonb),public.begin_reviewflow_response_generation(uuid,uuid,uuid,jsonb,jsonb),public.apply_reviewflow_response_generation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reviewflow_response_context(uuid,uuid,uuid),public.guard_reviewflow_response(),public.commit_reviewflow_response_draft(uuid,uuid,uuid,jsonb,jsonb),public.decide_reviewflow_response(uuid,uuid,uuid,jsonb,jsonb),public.guard_reviewflow_response_generation(),public.record_reviewflow_response_generation_event(public.reviewflow_response_generation_requests,uuid,text,text,jsonb),public.claim_reviewflow_response_generation(uuid),public.record_reviewflow_response_generation_result(uuid,uuid,jsonb),public.control_reviewflow_response_generation(uuid,uuid,uuid,jsonb),public.request_reviewflow_response_generation_recovery(uuid,uuid,uuid,jsonb),public.begin_reviewflow_response_generation(uuid,uuid,uuid,jsonb,jsonb),public.apply_reviewflow_response_generation(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
