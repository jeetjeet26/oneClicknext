create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'site.%' then
  if p_product<>'siteforge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid brief evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.note.%' then
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid internal note evidence';end if;
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
 origin:=case when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;



create table public.siteforge_delivery_records (
 id uuid primary key,
 record_sequence bigint generated always as identity unique,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),
 brief_id uuid references public.siteforge_codex_briefs(id),
 parent_id uuid references public.siteforge_delivery_records(id),
 input jsonb not null,
 input_hash text not null,
 source_hash text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index siteforge_delivery_record_property on public.siteforge_delivery_records(property_id,record_sequence desc);
create index siteforge_delivery_record_org on public.siteforge_delivery_records(org_id);
create index siteforge_delivery_record_actor on public.siteforge_delivery_records(actor_id);
create index siteforge_delivery_record_brief on public.siteforge_delivery_records(brief_id);
create index siteforge_delivery_record_parent on public.siteforge_delivery_records(parent_id);
create table public.siteforge_delivery_reviews (
 id uuid primary key,
 review_sequence bigint generated always as identity unique,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),
 record_id uuid not null references public.siteforge_delivery_records(id) on delete cascade,
 action text not null check(action in('review','withdraw')),
 input jsonb not null,
 input_hash text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index siteforge_delivery_review_property on public.siteforge_delivery_reviews(property_id);
create index siteforge_delivery_review_org on public.siteforge_delivery_reviews(org_id);
create index siteforge_delivery_review_actor on public.siteforge_delivery_reviews(actor_id);
create index siteforge_delivery_review_record on public.siteforge_delivery_reviews(record_id,review_sequence desc);
alter table public.siteforge_delivery_records enable row level security;
alter table public.siteforge_delivery_reviews enable row level security;
revoke all on public.siteforge_delivery_records,public.siteforge_delivery_reviews from public,anon,authenticated;
grant all on public.siteforge_delivery_records,public.siteforge_delivery_reviews to service_role;
create policy siteforge_delivery_record_service on public.siteforge_delivery_records for all to service_role using(true)with check(true);
create policy siteforge_delivery_review_service on public.siteforge_delivery_reviews for all to service_role using(true)with check(true);
revoke all on sequence public.siteforge_delivery_records_record_sequence_seq,public.siteforge_delivery_reviews_review_sequence_seq from public,anon,authenticated;
grant usage,select on sequence public.siteforge_delivery_records_record_sequence_seq,public.siteforge_delivery_reviews_review_sequence_seq to service_role;
create trigger siteforge_delivery_record_guard before update or delete on public.siteforge_delivery_records for each row execute function public.guard_siteforge_brief_history();
create trigger siteforge_delivery_review_guard before update or delete on public.siteforge_delivery_reviews for each row execute function public.guard_siteforge_brief_history();

create function public.record_siteforge_delivery(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_org uuid;v_prior public.siteforge_delivery_records;v_brief uuid;v_parent uuid;v_event jsonb;
begin
 select p.org_id into v_org from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from 'object'
  or (p_input-array['sourceName','sourceFormat','sourceOrigin','sourceText','targetLabel','targetPurpose','sourceRevision','observedAt','contentSource','editorOwner','briefId','parentId'])<>'{}'
  or length(trim(coalesce(p_input->>'sourceName','')))not between 1 and 300
  or p_input->>'sourceFormat'not in('markdown','plain_text')or p_input->>'sourceFormat'is null
  or p_input->>'sourceOrigin'not in('client_project_report','operator_report','legacy_record')or p_input->>'sourceOrigin'is null
  or length(trim(coalesce(p_input->>'targetLabel','')))not between 1 and 1000
  or p_input->>'targetPurpose'not in('local','review','staging','production','unconfirmed')or p_input->>'targetPurpose'is null
  or jsonb_typeof(p_input->'sourceText')is distinct from 'string'
  or octet_length(coalesce(p_input->>'sourceText',''))not between 20 and 262144
  or octet_length(p_input::text)>300000
  or length(coalesce(p_input->>'sourceRevision',''))>1000 or length(coalesce(p_input->>'contentSource',''))>2000 or length(coalesce(p_input->>'editorOwner',''))>2000
 then raise exception 'Review the supplied record and its target before saving';end if;
 if p_input->>'observedAt'is not null and (p_input->>'observedAt')::date>current_date then raise exception 'An observation date cannot be in the future';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,94));
 select *into v_prior from public.siteforge_delivery_records where id=p_id;
 if found then
  if(v_prior.property_id,v_prior.org_id,v_prior.actor_id,v_prior.input_hash)is distinct from(p_property_id,v_org,p_actor_id,public.crm_configuration_hash(p_input))then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','recordId',v_prior.id,'sourceHash',v_prior.source_hash);
 end if;
 v_brief:=(p_input->>'briefId')::uuid;v_parent:=(p_input->>'parentId')::uuid;
 if v_brief is not null and not exists(select 1 from public.siteforge_codex_briefs where id=v_brief and property_id=p_property_id and org_id=v_org)then return '{"state":"brief_unavailable"}';end if;
 if v_parent is not null and not exists(select 1 from public.siteforge_delivery_records where id=v_parent and property_id=p_property_id and org_id=v_org)then return '{"state":"parent_unavailable"}';end if;
 insert into public.siteforge_delivery_records(id,property_id,org_id,actor_id,brief_id,parent_id,input,input_hash,source_hash)
 values(p_id,p_property_id,v_org,p_actor_id,v_brief,v_parent,p_input,public.crm_configuration_hash(p_input),encode(extensions.digest(convert_to(p_input->>'sourceText','UTF8'),'sha256'),'hex'))returning *into v_prior;
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'siteforge','site.delivery.recorded','server_confirmed','succeeded',jsonb_build_object('briefId',v_brief,'parentId',v_parent,'inputHash',v_prior.input_hash),null,null,jsonb_build_object('recordId',p_id,'sourceHash',v_prior.source_hash,'sourceVerified',false,'deliveryConfirmed',false));
 if v_event->>'state'not in('recorded','replayed')then raise exception 'The source intake could not be recorded';end if;
 return jsonb_build_object('state','saved','recordId',p_id,'sourceHash',v_prior.source_hash);
end$$;

create function public.review_siteforge_delivery(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_org uuid;v_record public.siteforge_delivery_records;v_prior public.siteforge_delivery_reviews;v_latest public.siteforge_delivery_reviews;v_check jsonb;v_event jsonb;
 v_categories text[]:=array['design_routes','editing','preview_revisions','facts_inventory','inquiry_integrations','accessibility_content','imports_redirects','package_runtime','domain_discovery','recovery','maintenance'];
begin
 select p.org_id into v_org from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found then return '{"state":"forbidden"}';end if;
 select *into v_record from public.siteforge_delivery_records where id=(p_input->>'recordId')::uuid and property_id=p_property_id and org_id=v_org for update;
 if not found then return '{"state":"not_found"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from 'object'or octet_length(p_input::text)>100000
  or length(trim(coalesce(p_input->>'reason','')))not between 3 and 2000
  or p_input->>'action'not in('review','withdraw')or p_input->>'action'is null
  or (p_input-(case when p_input->>'action'='review'then array['recordId','sourceHash','expectedReviewId','action','checks','reason']else array['recordId','sourceHash','expectedReviewId','action','reason']end))<>'{}'
 then raise exception 'Review the exact source, decision and reason';end if;
 select *into v_prior from public.siteforge_delivery_reviews where id=p_id;
 if found then
  if(v_prior.property_id,v_prior.org_id,v_prior.actor_id,v_prior.record_id,v_prior.input_hash)is distinct from(p_property_id,v_org,p_actor_id,v_record.id,public.crm_configuration_hash(p_input))then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','reviewId',v_prior.id,'recordId',v_record.id);
 end if;
 if v_record.source_hash is distinct from p_input->>'sourceHash'then return '{"state":"source_changed"}';end if;
 select *into v_latest from public.siteforge_delivery_reviews where record_id=v_record.id order by review_sequence desc limit 1;
 if v_latest.id is distinct from(p_input->>'expectedReviewId')::uuid then return '{"state":"review_changed"}';end if;
 if p_input->>'action'='withdraw' then
  if v_latest.id is null or v_latest.action<>'review'then return '{"state":"state_changed"}';end if;
 else
  if jsonb_typeof(p_input->'checks')is distinct from 'array'or jsonb_array_length(p_input->'checks')<>11 then raise exception 'Review every acceptance category, keeping untested items explicit';end if;
  if(select count(distinct c->>'category')from jsonb_array_elements(p_input->'checks')c where c->>'category'=any(v_categories))<>11 then raise exception 'Each acceptance category must appear exactly once';end if;
  for v_check in select value from jsonb_array_elements(p_input->'checks')loop
   if jsonb_typeof(v_check)is distinct from 'object'or(v_check-array['category','status','evidence','observedAt','notes'])<>'{}'
    or v_check->>'status'not in('passed','failed','not_run','blocked','out_of_scope')or v_check->>'status'is null
    or length(coalesce(v_check->>'evidence',''))>2000 or length(coalesce(v_check->>'notes',''))>2000
   then raise exception 'Review the supported check status and evidence';end if;
   if v_check->>'observedAt'is not null and(v_check->>'observedAt')::date>current_date then raise exception 'An observed check date cannot be in the future';end if;
   if v_check->>'status'='passed'and(length(trim(coalesce(v_check->>'evidence','')))<3 or v_check->>'observedAt'is null or length(trim(coalesce(v_record.input->>'sourceRevision','')))<1)then raise exception 'A reported pass needs dated evidence and a named tested source version';end if;
   if v_check->>'status'in('failed','blocked','out_of_scope')and length(trim(coalesce(v_check->>'notes','')))<3 then raise exception 'Explain failed, blocked and excluded checks';end if;
  end loop;
 end if;
 insert into public.siteforge_delivery_reviews(id,property_id,org_id,actor_id,record_id,action,input,input_hash)values(p_id,p_property_id,v_org,p_actor_id,v_record.id,p_input->>'action',p_input,public.crm_configuration_hash(p_input));
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'siteforge',case when p_input->>'action'='withdraw'then 'site.delivery.withdrawn'else 'site.delivery.reviewed'end,'server_confirmed','succeeded',jsonb_build_object('recordId',v_record.id,'inputHash',public.crm_configuration_hash(p_input)),case when v_latest.id is not null then jsonb_build_object('reviewId',v_latest.id,'action',v_latest.action)end,jsonb_build_object('reviewId',p_id,'action',p_input->>'action'),jsonb_build_object('recordId',v_record.id,'reviewId',p_id,'reportedEvidenceOnly',true,'deliveryConfirmed',false));
 if v_event->>'state'not in('recorded','replayed')then raise exception 'The review decision could not be recorded';end if;
 return jsonb_build_object('state','saved','reviewId',p_id,'recordId',v_record.id);
end$$;

create function public.read_siteforge_delivery_records(p_property_id uuid,p_actor_id uuid,p_cursor uuid default null,p_record_id uuid default null,p_review_cursor uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_org uuid;v_anchor bigint;v_review_anchor bigint;v_rows jsonb;v_reviews jsonb;v_selected jsonb;
begin
 select p.org_id into v_org from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found then return '{"state":"forbidden"}';end if;
 if p_cursor is not null then select record_sequence into v_anchor from public.siteforge_delivery_records where id=p_cursor and property_id=p_property_id and org_id=v_org;if not found then return '{"state":"cursor_changed"}';end if;end if;
 select coalesce(jsonb_agg(x.value order by x.record_sequence desc),'[]')into v_rows from(
  select r.record_sequence,jsonb_build_object('id',r.id,'sourceName',r.input->>'sourceName','targetLabel',r.input->>'targetLabel','targetPurpose',r.input->>'targetPurpose','sourceRevision',r.input->>'sourceRevision','createdAt',r.created_at,'actorName',a.full_name,'latestAction',v.action,'parentId',r.parent_id)value
  from public.siteforge_delivery_records r left join public.profiles a on a.id=r.actor_id left join lateral(select d.action from public.siteforge_delivery_reviews d where d.record_id=r.id order by d.review_sequence desc limit 1)v on true
  where r.property_id=p_property_id and r.org_id=v_org and(p_cursor is null or r.record_sequence<v_anchor)order by r.record_sequence desc limit 21
 )x;
 if p_record_id is not null then
  select jsonb_build_object('id',r.id,'input',r.input,'sourceHash',r.source_hash,'createdAt',r.created_at,'actorName',a.full_name,'latestReview',case when v.id is not null then jsonb_build_object('id',v.id,'action',v.action,'input',v.input,'createdAt',v.created_at)end)into v_selected
  from public.siteforge_delivery_records r left join public.profiles a on a.id=r.actor_id left join lateral(select *from public.siteforge_delivery_reviews d where d.record_id=r.id order by d.review_sequence desc limit 1)v on true
  where r.id=p_record_id and r.property_id=p_property_id and r.org_id=v_org;
  if not found then return '{"state":"not_found"}';end if;
  if p_review_cursor is not null then select review_sequence into v_review_anchor from public.siteforge_delivery_reviews where id=p_review_cursor and record_id=p_record_id and property_id=p_property_id and org_id=v_org;if not found then return '{"state":"cursor_changed"}';end if;end if;
  select coalesce(jsonb_agg(x.value order by x.review_sequence desc),'[]')into v_reviews from(
   select d.review_sequence,jsonb_build_object('id',d.id,'action',d.action,'input',d.input,'createdAt',d.created_at,'actorName',a.full_name)value from public.siteforge_delivery_reviews d left join public.profiles a on a.id=d.actor_id
   where d.record_id=p_record_id and d.property_id=p_property_id and d.org_id=v_org and(p_review_cursor is null or d.review_sequence<v_review_anchor)order by d.review_sequence desc limit 21
  )x;
 end if;
 return jsonb_build_object('state','ready','records',case when jsonb_array_length(v_rows)>20 then v_rows-20 else v_rows end,'nextCursor',case when jsonb_array_length(v_rows)>20 then v_rows->19->>'id'end,'count',(select count(*)from public.siteforge_delivery_records where property_id=p_property_id and org_id=v_org),'selected',v_selected,'reviews',case when jsonb_array_length(v_reviews)>20 then v_reviews-20 else coalesce(v_reviews,'[]')end,'nextReviewCursor',case when jsonb_array_length(v_reviews)>20 then v_reviews->19->>'id'end);
end$$;
revoke all on function public.record_siteforge_delivery(uuid,uuid,uuid,jsonb),public.review_siteforge_delivery(uuid,uuid,uuid,jsonb),public.read_siteforge_delivery_records(uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.record_siteforge_delivery(uuid,uuid,uuid,jsonb),public.review_siteforge_delivery(uuid,uuid,uuid,jsonb),public.read_siteforge_delivery_records(uuid,uuid,uuid,uuid,uuid)to service_role;
