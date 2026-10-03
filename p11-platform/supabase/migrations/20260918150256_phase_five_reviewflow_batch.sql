create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
-- Saved selection and exact source versions are independent of browser paging.
create table public.reviewflow_analysis_batches(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),approved_by uuid references public.profiles(id),
 input jsonb not null,input_hash text not null,model_template jsonb not null,template_hash text not null,selection_count integer not null default 0,max_model_calls integer,
 state text not null default 'prepared' check(state in('prepared','queued','running','needs_review','completed','stopped')),version integer not null default 1,summary jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(),approved_at timestamptz,finished_at timestamptz,updated_at timestamptz not null default clock_timestamp()
);
create unique index reviewflow_batch_active_property on public.reviewflow_analysis_batches(property_id) where state in('prepared','queued','running');
create index reviewflow_batch_org on public.reviewflow_analysis_batches(org_id);
create index reviewflow_batch_actor on public.reviewflow_analysis_batches(actor_id);
create index reviewflow_batch_approver on public.reviewflow_analysis_batches(approved_by);
create index reviewflow_batch_history on public.reviewflow_analysis_batches(property_id,created_at desc,id desc);
create table public.reviewflow_analysis_batch_items(
 id uuid primary key,batch_id uuid not null references public.reviewflow_analysis_batches(id) on delete cascade,property_id uuid not null references public.properties(id) on delete cascade,
 review_id uuid not null references public.reviews(id),source_version integer not null,source_snapshot jsonb not null,position integer not null,
 state text not null default 'pending' check(state in('pending','working','analyzed','staff_review','held','stopped')),analysis_request_id uuid references public.reviewflow_analysis_requests(id),analysis_id uuid references public.review_analyses(id),owns_request boolean,error_code text,updated_at timestamptz not null default clock_timestamp(),
 unique(batch_id,review_id),unique(batch_id,position)
);
create index reviewflow_batch_item_property on public.reviewflow_analysis_batch_items(property_id);
create index reviewflow_batch_item_review on public.reviewflow_analysis_batch_items(review_id);
create index reviewflow_batch_item_request on public.reviewflow_analysis_batch_items(analysis_request_id);
create index reviewflow_batch_item_analysis on public.reviewflow_analysis_batch_items(analysis_id);
create index reviewflow_batch_item_queue on public.reviewflow_analysis_batch_items(batch_id,state,position);
alter table public.reviewflow_analysis_batches enable row level security;
alter table public.reviewflow_analysis_batch_items enable row level security;
revoke all on public.reviewflow_analysis_batches,public.reviewflow_analysis_batch_items from public,anon,authenticated;
grant all on public.reviewflow_analysis_batches,public.reviewflow_analysis_batch_items to service_role;
create policy reviewflow_batch_service on public.reviewflow_analysis_batches for all to service_role using(true) with check(true);
create policy reviewflow_batch_item_service on public.reviewflow_analysis_batch_items for all to service_role using(true) with check(true);
create function public.guard_reviewflow_batch() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Analysis queue history is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.input,new.input_hash,new.model_template,new.template_hash,new.created_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.input,old.input_hash,old.model_template,old.template_hash,old.created_at) then raise exception 'Analysis queue identity is immutable';end if;
 if old.approved_at is not null and(new.approved_at,new.approved_by,new.max_model_calls,new.selection_count) is distinct from(old.approved_at,old.approved_by,old.max_model_calls,old.selection_count) then raise exception 'The approved analysis scope cannot change';end if;
 if old.state in('stopped','completed','needs_review') and new.state<>old.state then raise exception 'Closed analysis queue cannot restart';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_batch_guard before update or delete on public.reviewflow_analysis_batches for each row execute function public.guard_reviewflow_batch();
create function public.guard_reviewflow_batch_item() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Analysis selection evidence is retained';end if;
 if(new.id,new.batch_id,new.property_id,new.review_id,new.source_version,new.source_snapshot,new.position) is distinct from(old.id,old.batch_id,old.property_id,old.review_id,old.source_version,old.source_snapshot,old.position) then raise exception 'Selected review source cannot change';end if;
 if old.analysis_request_id is not null and(new.analysis_request_id,new.owns_request) is distinct from(old.analysis_request_id,old.owns_request) then raise exception 'The linked analysis intent cannot change';end if;
 if old.state in('analyzed','staff_review','held','stopped') and new.state<>old.state then raise exception 'Closed analysis item cannot restart';end if;
 new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_batch_item_guard before update or delete on public.reviewflow_analysis_batch_items for each row execute function public.guard_reviewflow_batch_item();

-- Only registered server services may emit these outcomes. This function does not authorize execution.
create function public.append_reviewflow_service_event(p_id uuid,p_job_id uuid,p_principal text,p_action text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.shared_jobs;e public.shared_action_events;begin
 if p_id is null or p_job_id is null or p_phase not in('succeeded','failed') or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object' or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid service outcome';end if;
 if not((p_principal='reviewflow.analysis' and p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed')) or(p_principal='reviewflow.batch' and p_action in('review.analysis.requested','review.batch.progressed'))) then raise exception 'Unregistered review service outcome';end if;
 select * into job from public.shared_jobs where id=p_job_id and domain in('reviewflow.analysis','reviewflow.batch');if not found or job.property_id is null then return '{"state":"not_found"}';end if;
 if(p_principal='reviewflow.analysis' and job.domain<>'reviewflow.analysis') or(p_action='review.batch.progressed' and job.domain<>'reviewflow.batch') then return '{"state":"link_conflict"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(job.property_id::text,12));select * into e from public.shared_action_events where id=p_id;
 if found then if(e.property_id,e.org_id,e.shared_job_ref,e.service_principal,e.action,e.phase,e.request,e.before_state,e.after_state,e.result) is distinct from(job.property_id,job.org_id,job.id,p_principal,p_action,p_phase,p_request,p_before,p_after,p_result) then return '{"state":"request_conflict"}';end if;return jsonb_build_object('state','replayed','eventId',e.id);end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin) values(p_id,job.org_id,job.property_id,null,p_principal,'workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,context_snapshot_ref)
 values(p_id,p_id,job.org_id,job.property_id,null,p_principal,'reviewflow',p_action,'server_confirmed',p_phase,p_request,p_before,p_after,p_result,job.id,job.context_snapshot_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end$$;

create function public.prepare_reviewflow_batch(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_model_template jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;b public.reviewflow_analysis_batches;organization uuid;amount integer;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'batch.prepared',p_input);if result->>'state' not in('new','replayed') then return result;end if;
 select * into b from public.reviewflow_analysis_batches where id=p_id;if found then return jsonb_build_object('state',b.state,'batchId',b.id,'version',b.version,'selected',b.selection_count);end if;
 if(p_input-'scope'-'reason')<>'{}'::jsonb or p_input->>'scope' is distinct from 'unanalyzed_current' or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the current unanalyzed selection and reason';end if;
 select org_id into organization from public.properties where id=p_property_id;
 select * into b from public.reviewflow_analysis_batches where property_id=p_property_id and state in('prepared','queued','running');if found then if b.org_id<>organization then return '{"state":"scope_transfer_required"}';end if;return jsonb_build_object('state','busy','batchId',b.id,'version',b.version,'selected',b.selection_count);end if;
 if jsonb_typeof(p_model_template) is distinct from 'object' or length(p_model_template::text)>131072 or p_model_template->>'promptVersion' is distinct from 'analysis-v3' or length(coalesce(p_model_template->>'systemPrompt','')) not between 1 and 20000 or length(coalesce(p_model_template->>'model','')) not between 1 and 200 or coalesce((p_model_template->>'maxTokens')::integer,0) not between 1 and 2000 or length(coalesce(p_model_template->>'providerBaseUrl','')) not between 1 and 2048 or p_model_template?'source' or p_model_template?'userPrompt' then raise exception 'Review the saved analysis model recipe';end if;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,max_attempts,stage,progress,current_step) values(p_id,organization,p_property_id,'reviewflow.batch','review_selection',p_id::text,'queued','analysis_selection_saved',p_id::text,jsonb_build_object('batchId',p_id),1,'review',0,'Review the saved analysis scope before approving execution');
 insert into public.reviewflow_analysis_batches(id,property_id,org_id,actor_id,input,input_hash,model_template,template_hash) values(p_id,p_property_id,organization,p_actor_id,p_input,public.crm_configuration_hash(p_input),p_model_template,public.crm_configuration_hash(p_model_template));
 insert into public.reviewflow_analysis_batch_items(id,batch_id,property_id,review_id,source_version,source_snapshot,position)
 select md5(p_id::text||':'||r.id::text||':'||r.source_version::text)::uuid,p_id,p_property_id,r.id,r.source_version,to_jsonb(r),row_number() over(order by r.created_at,r.id)::integer
 from public.reviews r where r.property_id=p_property_id and not exists(select 1 from public.review_analyses a where a.review_id=r.id and a.property_id=p_property_id and a.source_version=r.source_version and a.status in('completed','manual_review_required'));
 get diagnostics amount=row_count;
 update public.reviewflow_analysis_batches set selection_count=amount,state=case when amount=0 then 'completed' else 'prepared' end,finished_at=case when amount=0 then clock_timestamp() end,summary=jsonb_build_object('selected',amount,'pending',amount,'analyzed',0,'staffReview',0,'held',0,'stopped',0) where id=p_id returning * into b;
 if amount=0 then update public.shared_jobs set lifecycle_status='succeeded',status_reason='no_analysis_needed',stage='completed',progress=100,finished_at=clock_timestamp(),current_step='No current review versions need analysis' where id=p_id;end if;
 perform public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'batch.prepared',p_input,null,jsonb_build_object('state',b.state,'selected',amount,'templateHash',b.template_hash),jsonb_build_object('batchId',b.id,'selected',amount,'modelInvoked',false),jsonb_build_object('jobId',b.id));
 return jsonb_build_object('state',b.state,'batchId',b.id,'version',b.version,'selected',amount);
end$$;

create function public.reviewflow_batch_authorized(p_batch public.reviewflow_analysis_batches) returns boolean language sql stable security invoker set search_path='' as $$
 select p_batch.state in('queued','running') and p_batch.max_model_calls=p_batch.selection_count and exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_batch.property_id and p.org_id=p_batch.org_id and u.id=p_batch.approved_by and u.role in('admin','manager'));
$$;
create function public.reviewflow_batch_model_input(p_template jsonb,p_source jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
 select p_template||jsonb_build_object('source',jsonb_build_object('reviewText',p_source->>'review_text','rating',p_source->'rating','platform',p_source->>'platform','reviewerName',p_source->>'reviewer_name'),'userPrompt','Platform: '||coalesce(p_source->>'platform','unknown')||E'\nRating: '||case when p_source->>'rating' is null then 'not provided' else(p_source->>'rating')||'/5' end||E'\n\n<review>\n'||(p_source->>'review_text')||E'\n</review>');
$$;

create function public.decide_reviewflow_batch(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;b public.reviewflow_analysis_batches;i public.reviewflow_analysis_batch_items;r public.reviewflow_analysis_requests;operation text:=p_input->>'operation';kind text;begin
 if operation not in('approve','stop','recover') then raise exception 'Choose an analysis queue decision';end if;kind:='batch.'||case operation when 'approve' then 'approved' when 'stop' then 'stopped' else 'recovered' end;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'batchId'-'expectedVersion'-'reason'-'operation'-'maxModelCalls')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the saved queue and reason';end if;
 select * into b from public.reviewflow_analysis_batches where id=(p_input->>'batchId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id) for update;if not found then return '{"state":"not_found"}';end if;
 if b.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if b.state in('stopped','completed','needs_review') then return jsonb_build_object('state',b.state,'batchId',b.id);end if;
 if operation='approve' then
  if b.state<>'prepared' then return '{"state":"already_approved"}';end if;
  if(p_input->>'maxModelCalls')::integer is distinct from b.selection_count then return '{"state":"scope_confirmation_required"}';end if;
  update public.reviewflow_analysis_batches set state='queued',approved_by=p_actor_id,approved_at=clock_timestamp(),max_model_calls=b.selection_count where id=b.id;
  update public.shared_jobs set lifecycle_status='queued',status_reason='analysis_scope_approved',stage='queued',current_step='Approved analysis selection awaits execution',updated_at=clock_timestamp() where id=b.id;
  result:=jsonb_build_object('batchId',b.id,'requestState','queued','approvedModelCalls',b.selection_count,'modelInvoked',false);
 elsif operation='stop' then
  -- Stop only this batch's own unfinished children. Independently requested analysis keeps its original owner.
  for i in select * from public.reviewflow_analysis_batch_items where batch_id=b.id and owns_request=true loop
   select * into r from public.reviewflow_analysis_requests where id=i.analysis_request_id for update;
   if r.state in('queued','running','result_ready') then
    result:=public.control_reviewflow_analysis(md5(p_id::text||':'||r.id::text)::uuid,p_property_id,p_actor_id,jsonb_build_object('analysisRequestId',r.id,'expectedVersion',r.version,'reason',p_input->>'reason'));
    if result->>'state' not in('saved','replayed') then raise exception 'Analysis child stop could not be confirmed';end if;
   end if;
  end loop;
  update public.reviewflow_analysis_batch_items set state='stopped',error_code='batch_stopped' where batch_id=b.id and state in('pending','working');
  update public.reviewflow_analysis_batches set state='stopped',finished_at=clock_timestamp(),summary=(select jsonb_build_object('selected',count(*),'pending',count(*) filter(where state in('pending','working')),'analyzed',count(*) filter(where state='analyzed'),'staffReview',count(*) filter(where state='staff_review'),'held',count(*) filter(where state='held'),'stopped',count(*) filter(where state='stopped')) from public.reviewflow_analysis_batch_items where batch_id=b.id) where id=b.id;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='analysis_batch_stopped',stage='stopped',finished_at=clock_timestamp(),current_step='Queue stopped; late model evidence remains retained',updated_at=clock_timestamp() where id=b.id;
  result:=jsonb_build_object('batchId',b.id,'requestState','stopped','providerCancellationConfirmed',false,'independentAnalysisStopped',false);
 else
  result:=jsonb_build_object('batchId',b.id,'requestState',b.state,'modelInvoked',false);
 end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,jsonb_build_object('state',b.state,'version',b.version),jsonb_build_object('state',result->>'requestState'),result,jsonb_build_object('jobId',b.id));
end$$;

create function public.prepare_reviewflow_batch_item(p_batch_id uuid,p_item_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.reviewflow_analysis_batches;i public.reviewflow_analysis_batch_items;r public.reviews;a public.review_analyses;result jsonb;begin
 select * into b from public.reviewflow_analysis_batches where id=p_batch_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(b.property_id::text,12));select * into b from public.reviewflow_analysis_batches where id=p_batch_id for update;
 select * into i from public.reviewflow_analysis_batch_items where id=p_item_id and batch_id=b.id for update;if not found then return '{"state":"not_found"}';end if;
 if i.state not in('pending','working') then return jsonb_build_object('state',i.state);end if;
 if not public.reviewflow_batch_authorized(b) then return '{"state":"authority_required"}';end if;
 select * into r from public.reviews where id=i.review_id and property_id=b.property_id for update;
 if r.source_version is distinct from i.source_version then update public.reviewflow_analysis_batch_items set state='held',error_code='source_changed' where id=i.id;return '{"state":"held"}';end if;
 if length(trim(coalesce(r.review_text,''))) not between 1 and 20000 then update public.reviewflow_analysis_batch_items set state='held',error_code='source_unavailable' where id=i.id;return '{"state":"held"}';end if;
 if i.analysis_request_id is not null then return jsonb_build_object('state','linked','requestId',i.analysis_request_id,'ownsRequest',i.owns_request);end if;
 select * into a from public.review_analyses where review_id=r.id and property_id=b.property_id and source_version=i.source_version and status in('completed','manual_review_required') order by analysis_version desc limit 1;
 if found then update public.reviewflow_analysis_batch_items set state=case when a.status='manual_review_required' then 'staff_review' else 'analyzed' end,analysis_id=a.id,error_code='current_analysis_reused' where id=i.id;return '{"state":"reused"}';end if;
 result:=public.begin_reviewflow_analysis(i.id,b.property_id,b.approved_by,jsonb_build_object('reviewId',r.id,'sourceVersion',i.source_version),public.reviewflow_batch_model_input(b.model_template,i.source_snapshot));
 if result->>'state' not in('queued','busy','running','result_ready','completed','held','stopped') then raise exception 'Analysis request could not be linked to its batch: %',result->>'state';end if;
 update public.reviewflow_analysis_batch_items set state='working',analysis_request_id=(result->>'requestId')::uuid,owns_request=((result->>'requestId')::uuid=i.id) where id=i.id;
 update public.reviewflow_analysis_batches set state='running' where id=b.id and state='queued';
 update public.shared_jobs set lifecycle_status='running',stage='analyzing',started_at=coalesce(started_at,clock_timestamp()),status_reason='analysis_batch_running',current_step='Processing the saved review selection',updated_at=clock_timestamp() where id=b.id;
 return jsonb_build_object('state','linked','requestId',result->>'requestId','ownsRequest',(result->>'requestId')::uuid=i.id);
end$$;

create function public.checkpoint_reviewflow_batch(p_batch_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.reviewflow_analysis_batches;progress_summary jsonb;next_state text;recorded jsonb;begin
 select * into b from public.reviewflow_analysis_batches where id=p_batch_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(b.property_id::text,12));select * into b from public.reviewflow_analysis_batches where id=p_batch_id for update;
 if b.state in('completed','needs_review','stopped','prepared') then return jsonb_build_object('state',b.state,'batchId',b.id,'summary',b.summary);end if;
 if not public.reviewflow_batch_authorized(b) then
  with held as(update public.reviewflow_analysis_requests r set state='held',error_code='batch_authority_changed',finished_at=clock_timestamp() from public.reviewflow_analysis_batch_items i where i.batch_id=b.id and i.owns_request=true and i.analysis_request_id=r.id and r.state in('queued','running','result_ready') returning r.id) update public.shared_jobs set lifecycle_status='failed',status_reason='batch_authority_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id in(select id from held);
  update public.reviewflow_analysis_batch_items set state='held',error_code='batch_authority_changed' where batch_id=b.id and state in('pending','working');
 end if;
 update public.reviewflow_analysis_batch_items i set state=case when r.state='completed' then case when a.status='manual_review_required' then 'staff_review' else 'analyzed' end else 'held' end,analysis_id=r.analysis_id,error_code=case when r.state='completed' then null else coalesce(r.error_code,'analysis_'||r.state) end
 from public.reviewflow_analysis_requests r left join public.review_analyses a on a.id=r.analysis_id where i.batch_id=b.id and i.state in('pending','working') and i.analysis_request_id=r.id and r.state in('completed','held','stopped');
 select jsonb_build_object('selected',count(*),'pending',count(*) filter(where state in('pending','working')),'analyzed',count(*) filter(where state='analyzed'),'staffReview',count(*) filter(where state='staff_review'),'held',count(*) filter(where state='held'),'stopped',count(*) filter(where state='stopped')) into progress_summary from public.reviewflow_analysis_batch_items where batch_id=b.id;
 next_state:=case when(progress_summary->>'pending')::integer>0 then b.state when(progress_summary->>'held')::integer>0 or(progress_summary->>'staffReview')::integer>0 then 'needs_review' else 'completed' end;
 if(progress_summary,next_state) is distinct from(b.summary,b.state) then
  update public.reviewflow_analysis_batches set state=next_state,summary=progress_summary,finished_at=case when next_state in('completed','needs_review') then clock_timestamp() end where id=b.id;
  update public.shared_jobs set lifecycle_status=case next_state when 'completed' then 'succeeded' when 'needs_review' then 'failed' else 'running' end,progress=case when b.selection_count=0 then 100 else floor(100.0*(b.selection_count-(progress_summary->>'pending')::integer)/b.selection_count)::integer end,stage=case when next_state in('completed','needs_review') then 'review' else 'analyzing' end,status_reason='analysis_batch_'||next_state,output=progress_summary,finished_at=case when next_state in('completed','needs_review') then clock_timestamp() end,updated_at=clock_timestamp() where id=b.id;
  recorded:=public.append_reviewflow_service_event(md5('review.batch.progressed:'||b.id::text||':'||public.crm_configuration_hash(progress_summary||jsonb_build_object('state',next_state)))::uuid,b.id,'reviewflow.batch','review.batch.progressed',case when next_state='needs_review' then 'failed' else 'succeeded' end,jsonb_build_object('batchId',b.id),b.summary,progress_summary,progress_summary||jsonb_build_object('requestState',next_state,'approvedBy',b.approved_by));
  if recorded->>'state' not in('recorded','replayed') then raise exception 'Analysis batch outcome history could not be saved';end if;
 end if;
 return jsonb_build_object('state',next_state,'batchId',b.id,'summary',progress_summary,'authorized',public.reviewflow_batch_authorized(b));
end$$;
create function public.next_reviewflow_batch_items(p_batch_id uuid,p_limit integer default 5) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('itemId',q.id,'requestId',q.analysis_request_id,'requestState',q.request_state)),'[]'::jsonb) from(
  select i.id,i.analysis_request_id,r.state as request_state from public.reviewflow_analysis_batch_items i join public.reviewflow_analysis_batches b on b.id=i.batch_id left join public.reviewflow_analysis_requests r on r.id=i.analysis_request_id
  where b.id=p_batch_id and public.reviewflow_batch_authorized(b) and i.state in('pending','working') and(r.id is null or(r.state<>'running' and not(r.state='queued' and i.owns_request=false))) order by i.position limit least(greatest(p_limit,1),20)
 ) q;
$$;
create function public.list_reviewflow_batch_work(p_limit integer default 5) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(q.id),'[]'::jsonb) from(
  select b.id from public.reviewflow_analysis_batches b where b.state in('queued','running') and(
   not public.reviewflow_batch_authorized(b) or exists(select 1 from public.reviewflow_analysis_batch_items i left join public.reviewflow_analysis_requests r on r.id=i.analysis_request_id where i.batch_id=b.id and i.state in('pending','working') and(r.id is null or(r.state<>'running' and not(r.state='queued' and i.owns_request=false)))))
  order by b.updated_at,b.id limit least(greatest(p_limit,1),10)
 ) q;
$$;

create function public.reviewflow_batch_child_authorized(p_request_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from public.reviewflow_analysis_batch_items i join public.reviewflow_analysis_batches b on b.id=i.batch_id where i.id=p_request_id and not public.reviewflow_batch_authorized(b));
$$;
create function public.finish_reviewflow_analysis_request(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare i public.reviewflow_analysis_batch_items;recorded jsonb;begin
 select * into i from public.reviewflow_analysis_batch_items where id=p_id and property_id=p_property_id;
 if not found then return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,p_kind,p_input,p_before,p_after,p_result,p_links);end if;
 insert into public.reviewflow_commands(id,property_id,actor_id,kind,input,input_hash,result) values(p_id,p_property_id,p_actor_id,p_kind,p_input,public.crm_configuration_hash(p_input),p_result);
 recorded:=public.append_reviewflow_service_event(p_id,p_id,'reviewflow.batch','review.analysis.requested','succeeded',jsonb_build_object('batchId',i.batch_id,'reviewId',i.review_id,'sourceVersion',i.source_version),p_before,p_after,p_result||jsonb_build_object('batchId',i.batch_id,'approvedBy',p_actor_id));
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Batch analysis request history could not be saved';end if;return p_result||'{"state":"saved"}';
end$$;
create or replace function public.record_reviewflow_analysis_event(p_run public.reviewflow_analysis_requests,p_actor_id uuid,p_action text,p_phase text,p_result jsonb) returns void language plpgsql security invoker set search_path='' as $$declare recorded jsonb;begin
 recorded:=public.append_reviewflow_service_event(md5(p_action||':'||p_run.id::text)::uuid,p_run.id,'reviewflow.analysis',p_action,p_phase,jsonb_build_object('requestId',p_run.id,'sourceVersion',p_run.source_version),jsonb_build_object('state',p_run.state),jsonb_build_object('state',p_result->>'requestState'),p_result||jsonb_build_object('requestId',p_run.id,'requestedBy',p_run.actor_id,'publicationStarted',false));
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Analysis outcome history could not be saved';end if;
end$$;
create or replace function public.begin_reviewflow_analysis(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_model_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;run public.reviewflow_analysis_requests;review public.reviews;organization uuid;context uuid;begin
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'analysis.requested',p_input);if result->>'state' not in('new','replayed') then return result;end if;
 select * into run from public.reviewflow_analysis_requests where id=p_id;if found then return jsonb_build_object('state',run.state,'requestId',run.id,'version',run.version,'analysisId',run.analysis_id);end if;
 if exists(select 1 from public.reviewflow_analysis_batch_items i join public.reviewflow_analysis_batches b on b.id=i.batch_id where i.id=p_id and (b.approved_by is distinct from p_actor_id or p_model_input is distinct from public.reviewflow_batch_model_input(b.model_template,i.source_snapshot) or p_input is distinct from jsonb_build_object('reviewId',i.review_id,'sourceVersion',i.source_version))) then return '{"state":"batch_input_changed"}';end if;
 if not public.reviewflow_batch_child_authorized(p_id) then return '{"state":"batch_not_authorized"}';end if;
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
 perform public.finish_reviewflow_analysis_request(p_id,p_property_id,p_actor_id,'analysis.requested',p_input,jsonb_build_object('reviewId',review.id,'sourceVersion',review.source_version),jsonb_build_object('requestId',p_id,'state','queued'),jsonb_build_object('requestId',p_id,'reviewId',review.id,'sourceVersion',review.source_version,'modelInvoked',false),jsonb_build_object('jobId',p_id,'contextId',context));
 return jsonb_build_object('state','queued','requestId',p_id,'version',1);
end$$;
create or replace function public.claim_reviewflow_analysis(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare run public.reviewflow_analysis_requests;begin
 select * into run from public.reviewflow_analysis_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_analysis_requests where id=p_id for update;
 if run.state<>'queued' then return jsonb_build_object('state',run.state);end if;
 if not public.reviewflow_batch_child_authorized(p_id) then
  update public.reviewflow_analysis_requests set state='held',error_code='batch_authority_changed',finished_at=clock_timestamp() where id=run.id;update public.shared_jobs set lifecycle_status='failed',status_reason='batch_authority_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;perform public.record_reviewflow_analysis_event(run,run.actor_id,'review.analysis.completed','failed',jsonb_build_object('requestState','held','reason','batch_authority_changed'));return '{"state":"held"}';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id join public.reviews r on r.property_id=p.id where p.id=run.property_id and p.org_id=run.org_id and u.id=run.actor_id and r.id=run.review_id and r.source_version=run.source_version) then
  update public.reviewflow_analysis_requests set state='held',error_code='source_or_access_changed',finished_at=clock_timestamp() where id=run.id;update public.shared_jobs set lifecycle_status='failed',status_reason='source_or_access_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;perform public.record_reviewflow_analysis_event(run,run.actor_id,'review.analysis.completed','failed',jsonb_build_object('requestState','held','reason','source_or_access_changed'));return '{"state":"held"}';
 end if;
 update public.reviewflow_analysis_requests set state='running',claim_token=gen_random_uuid(),started_at=clock_timestamp() where id=run.id returning * into run;
 update public.shared_jobs set lifecycle_status='running',attempt_count=1,stage='analyzing',progress=10,started_at=clock_timestamp(),current_step='One model request started; awaiting its saved result',updated_at=clock_timestamp() where id=run.id;
 perform public.record_reviewflow_analysis_event(run,run.actor_id,'review.analysis.started','succeeded',jsonb_build_object('requestState','running'));
 return jsonb_build_object('state','invoke_once','claimToken',run.claim_token,'modelInput',run.model_input,'propertyId',run.property_id,'actorId',run.actor_id);
end$$;
create or replace function public.apply_reviewflow_analysis(p_id uuid,p_property_id uuid,p_actor_id uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.reviewflow_analysis_requests;review public.reviews;case_row public.reputation_cases;classification jsonb;next_priority text;ticket public.review_tickets;analysis_version integer;event_result jsonb;event_id uuid;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));select * into run from public.reviewflow_analysis_requests where id=p_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.state='completed' then return jsonb_build_object('state','replayed','analysisId',run.analysis_id);end if;
 if run.state in('stopped','held') then return jsonb_build_object('state',run.state);end if;
 if run.state<>'result_ready' or run.raw_result is null then return '{"state":"result_required"}';end if;
 select * into review from public.reviews where id=run.review_id and property_id=p_property_id for update;
 if not public.reviewflow_batch_child_authorized(p_id) or review.source_version is distinct from run.source_version or not exists(select 1 from public.properties where id=p_property_id and org_id=run.org_id) then
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
 insert into public.reputation_case_events(case_id,property_id,event_type,actor_label,payload) values(case_row.id,p_property_id,'analysis_recorded','analysis_worker',jsonb_build_object('requestId',run.id,'analysisId',run.id,'sourceVersion',run.source_version,'requestedBy',run.actor_id,'executionAuthority',p_actor_id,'requiresHumanReview',classification->'policy'->'requiresHumanReview'));
 update public.reviewflow_analysis_requests set state='completed',analysis_id=run.id,error_code=null,finished_at=clock_timestamp() where id=run.id;
 update public.shared_jobs set lifecycle_status='succeeded',stage='completed',progress=100,status_reason='analysis_applied',current_step='Analysis and case saved together',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 event_id:=md5('reviewflow-analysis-completed:'||run.id::text)::uuid;
 event_result:=public.append_reviewflow_service_event(event_id,run.id,'reviewflow.analysis','review.analysis.completed','succeeded',jsonb_build_object('requestId',run.id,'resultHash',run.result_hash),jsonb_build_object('reviewId',review.id,'sourceVersion',run.source_version,'caseStatus',case_row.status),jsonb_build_object('analysisId',run.id,'sentiment',classification->>'sentiment','priority',next_priority,'requiresHumanReview',classification->'policy'->'requiresHumanReview'),jsonb_build_object('requestId',run.id,'analysisId',run.id,'caseId',case_row.id,'origin','model_result','requestedBy',run.actor_id,'executionAuthority',p_actor_id,'publicationStarted',false));
 if event_result->>'state' not in('recorded','replayed') then raise exception 'Analysis history could not be saved';end if;
 return jsonb_build_object('state','saved','analysisId',run.id,'requiresHumanReview',classification->'policy'->'requiresHumanReview');
end$$;

revoke all on function public.guard_reviewflow_batch(),public.guard_reviewflow_batch_item(),public.append_reviewflow_service_event(uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb),public.prepare_reviewflow_batch(uuid,uuid,uuid,jsonb,jsonb),public.reviewflow_batch_authorized(public.reviewflow_analysis_batches),public.reviewflow_batch_model_input(jsonb,jsonb),public.decide_reviewflow_batch(uuid,uuid,uuid,jsonb),public.prepare_reviewflow_batch_item(uuid,uuid),public.checkpoint_reviewflow_batch(uuid),public.next_reviewflow_batch_items(uuid,integer),public.list_reviewflow_batch_work(integer),public.reviewflow_batch_child_authorized(uuid),public.finish_reviewflow_analysis_request(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.record_reviewflow_analysis_event(public.reviewflow_analysis_requests,uuid,text,text,jsonb),public.begin_reviewflow_analysis(uuid,uuid,uuid,jsonb,jsonb),public.claim_reviewflow_analysis(uuid),public.apply_reviewflow_analysis(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_reviewflow_batch(),public.guard_reviewflow_batch_item(),public.append_reviewflow_service_event(uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb),public.prepare_reviewflow_batch(uuid,uuid,uuid,jsonb,jsonb),public.reviewflow_batch_authorized(public.reviewflow_analysis_batches),public.reviewflow_batch_model_input(jsonb,jsonb),public.decide_reviewflow_batch(uuid,uuid,uuid,jsonb),public.prepare_reviewflow_batch_item(uuid,uuid),public.checkpoint_reviewflow_batch(uuid),public.next_reviewflow_batch_items(uuid,integer),public.list_reviewflow_batch_work(integer),public.reviewflow_batch_child_authorized(uuid),public.finish_reviewflow_analysis_request(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.record_reviewflow_analysis_event(public.reviewflow_analysis_requests,uuid,text,text,jsonb),public.begin_reviewflow_analysis(uuid,uuid,uuid,jsonb,jsonb),public.claim_reviewflow_analysis(uuid),public.apply_reviewflow_analysis(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
