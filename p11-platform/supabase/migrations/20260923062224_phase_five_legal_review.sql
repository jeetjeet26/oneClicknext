-- Exact retained legal/disclosure drafts and explicit operator review. No legal advice or automatic publication.
create table public.property_legal_workspaces(
 property_id uuid primary key references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),revision bigint not null default 1 check(revision>0),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create table public.property_legal_decisions(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 version_id uuid not null references public.property_legal_configs(id)on delete cascade,kind text not null check(kind in('saved','approved','rejected','withdrawn')),
 input jsonb not null,input_hash text not null,before_state jsonb not null,after_state jsonb not null,result jsonb not null,
 decision_sequence bigint generated always as identity,created_at timestamptz not null default clock_timestamp());
create index property_legal_decision_property on public.property_legal_decisions(property_id,org_id,decision_sequence desc);
create index property_legal_decision_version on public.property_legal_decisions(version_id,decision_sequence desc);
create table public.property_legal_cancellations(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),input_hash text not null,reason text not null,created_at timestamptz not null default clock_timestamp());
alter table public.property_legal_workspaces enable row level security;
alter table public.property_legal_decisions enable row level security;
alter table public.property_legal_cancellations enable row level security;
revoke all on public.property_legal_workspaces,public.property_legal_decisions,public.property_legal_cancellations from public,anon,authenticated;
grant all on public.property_legal_workspaces,public.property_legal_decisions,public.property_legal_cancellations to service_role;
grant usage,select on sequence public.property_legal_decisions_decision_sequence_seq to service_role;
revoke all on public.property_legal_configs from public,anon,authenticated;
create function public.guard_legal_review_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Retain legal review history';end$$;
create trigger property_legal_decision_immutable before update or delete on public.property_legal_decisions for each row execute function public.guard_legal_review_history();
create trigger property_legal_cancellation_immutable before update or delete on public.property_legal_cancellations for each row execute function public.guard_legal_review_history();
create function public.guard_legal_review()returns trigger language plpgsql security invoker set search_path=''as $$
declare v_property uuid:=case when tg_op='DELETE'then old.property_id else new.property_id end;
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=v_property)then return old;end if;
 if tg_table_name='property_legal_workspaces'then
  if tg_op='DELETE'then raise exception 'Retain legal review workspace';end if;
  if current_setting('p11.legal_review_scope',true)is distinct from v_property::text then raise exception 'Use a recorded legal review';end if;
  if tg_op='UPDATE'and(new.property_id,new.org_id,new.created_at)is distinct from(old.property_id,old.org_id,old.created_at)then raise exception 'Legal review scope is immutable';end if;
 elsif exists(select 1 from public.property_legal_workspaces where property_id=v_property)or(tg_op='UPDATE'and exists(select 1 from public.property_legal_workspaces where property_id=old.property_id))then
  if tg_op='DELETE'then raise exception 'Withdraw approval instead of removing reviewed legal content';end if;
  if current_setting('p11.legal_review_scope',true)is distinct from v_property::text then raise exception 'Use a recorded legal review';end if;
  if tg_op='UPDATE'and(to_jsonb(new)-array['status','approved_by','approved_at','updated_at'])is distinct from(to_jsonb(old)-array['status','approved_by','approved_at','updated_at'])then raise exception 'Save a new legal content version';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger property_legal_content_guard before insert or update or delete on public.property_legal_configs for each row execute function public.guard_legal_review();
create trigger property_legal_workspace_guard before insert or update or delete on public.property_legal_workspaces for each row execute function public.guard_legal_review();
create function public.legal_review_state(p_property_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('workspace',(select to_jsonb(w)from public.property_legal_workspaces w where property_id=p_property_id),'versions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'hash',public.knowledge_hash(to_jsonb(r)))order by r.version,r.id)from public.property_legal_configs r where property_id=p_property_id),'[]'))
$$;
create function public.valid_legal_review_draft(p_draft jsonb,p_complete boolean default false)returns boolean language plpgsql stable security invoker set search_path=''as $$
declare k text;v jsonb;t timestamptz;
begin
 if jsonb_typeof(p_draft)is distinct from'object'or p_draft-array['jurisdiction','legalEntityName','effectiveAt','documents','sourceReferences']<>'{}'or not(p_draft?&array['jurisdiction','legalEntityName','effectiveAt','documents','sourceReferences'])then return false;end if;
 if jsonb_typeof(p_draft->'jurisdiction')is distinct from'string'or length(p_draft->>'jurisdiction')>200 or jsonb_typeof(p_draft->'legalEntityName')is distinct from'string'or length(p_draft->>'legalEntityName')>300 then return false;end if;
 if jsonb_typeof(p_draft->'documents')is distinct from'object'or(p_draft->'documents')-array['privacy_policy','terms','accessibility','fair_housing','pricing_disclaimer','analytics_consent','communications_consent']<>'{}'or not(p_draft->'documents'?&array['privacy_policy','terms','accessibility','fair_housing','pricing_disclaimer','analytics_consent','communications_consent'])then return false;end if;
 for k,v in select *from jsonb_each(p_draft->'documents')loop
  if jsonb_typeof(v)is distinct from'object'or jsonb_typeof(v->'text')is distinct from'string'or length(v->>'text')>100000 then return false;end if;
  if p_complete and length(btrim(v->>'text'))<1 then return false;end if;
  if v?'sourceUrl'and(jsonb_typeof(v->'sourceUrl')is distinct from'string'or length(v->>'sourceUrl')>4000 or(v->>'sourceUrl'<>''and v->>'sourceUrl'!~'^https?://[^[:space:]@]+$'))then return false;end if;
  if v?'reviewedAt'and v->'reviewedAt'<>'null'::jsonb then if jsonb_typeof(v->'reviewedAt')is distinct from'string'or v->>'reviewedAt'!~'(Z|[+-][0-9]{2}:[0-9]{2})$'then return false;end if;t:=(v->>'reviewedAt')::timestamptz;if not isfinite(t)then return false;end if;end if;
 end loop;
 if jsonb_typeof(p_draft->'sourceReferences')is distinct from'array'or jsonb_array_length(p_draft->'sourceReferences')>200 then return false;end if;
 for v in select value from jsonb_array_elements(p_draft->'sourceReferences')loop if jsonb_typeof(v)is distinct from'object'or octet_length(v::text)>8192 then return false;end if;end loop;
 if p_draft->'effectiveAt'<>'null'::jsonb then if jsonb_typeof(p_draft->'effectiveAt')is distinct from'string'or p_draft->>'effectiveAt'!~'(Z|[+-][0-9]{2}:[0-9]{2})$'then return false;end if;t:=(p_draft->>'effectiveAt')::timestamptz;if not isfinite(t)then return false;end if;elsif p_complete then return false;end if;
 if p_complete and(length(btrim(p_draft->>'jurisdiction'))<2 or length(btrim(p_draft->>'legalEntityName'))<2 or(p_draft->>'effectiveAt')::timestamptz>clock_timestamp())then return false;end if;
 return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end$$;
create function public.legal_config_draft(p_config public.property_legal_configs)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('jurisdiction',coalesce(p_config.jurisdiction,''),'legalEntityName',coalesce(p_config.legal_entity_name,''),'effectiveAt',p_config.effective_at,'documents',jsonb_build_object('privacy_policy',p_config.privacy_policy,'terms',p_config.terms,'accessibility',p_config.accessibility,'fair_housing',p_config.fair_housing,'pricing_disclaimer',p_config.pricing_disclaimer,'analytics_consent',p_config.analytics_consent,'communications_consent',p_config.communications_consent),'sourceReferences',p_config.source_references)
$$;
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'legal.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid legal review evidence';end if;
 elsif p_action like 'checklist.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid checklist evidence';end if;
 elsif p_action like 'property.unit.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid floor-plan evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('organization.setup.completed','property.setup.saved','property.created','property.onboarding.completed') then
  if p_product<>'property' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid property evidence';end if;
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
 origin:=case when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create function public.decide_legal_review(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_op text:=p_input->>'operation';v_kind text;d public.property_legal_decisions;c public.property_legal_cancellations;r public.property_legal_configs;v_draft jsonb:=p_input->'draft';v_state jsonb;v_before jsonb;v_after jsonb;v_result jsonb;v_event jsonb;v_id uuid;v_source uuid;v_number int;v_stale jsonb:='[]';v_event_id uuid;
begin
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if v_org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>1048576 or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(p_input->>'reason'))not between 3 and 2000 or v_op is null or v_op not in('save','approve','reject','withdraw','cancel_unused')then raise exception 'Review this legal decision and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=v_org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,934));
 select *into d from public.property_legal_decisions where id=p_id;
 if found then if(d.property_id,d.org_id,d.actor_id)is distinct from(p_property_id,v_org,p_actor_id)or(v_op<>'cancel_unused'and d.input<>p_input)then return'{"state":"request_conflict"}';end if;return d.result||'{"state":"replayed"}';end if;
 select *into c from public.property_legal_cancellations where id=p_id;
 if found then if v_op<>'cancel_unused'then return'{"state":"decision_cancelled"}';end if;if(c.property_id,c.org_id,c.actor_id,c.input_hash,c.reason)is distinct from(p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason')then return'{"state":"request_conflict"}';end if;return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);end if;
 if v_op='cancel_unused'then
  if p_input-array['operation','reason','inputHash']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the unused decision digest';end if;
  insert into public.property_legal_cancellations(id,property_id,org_id,actor_id,input_hash,reason)values(p_id,p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason');v_event_id:=md5('legal-cancel:'||p_id::text)::uuid;
  v_event:=public.append_shared_action_event(v_event_id,v_event_id,p_property_id,p_actor_id,'property','legal.cancelled','server_confirmed','succeeded',jsonb_build_object('unusedRequestId',p_id,'browserInputHash',p_input->>'inputHash'),null,null,'{"cancelled":true}');if v_event->>'state'not in('recorded','replayed')then raise exception 'Legal cancellation history could not be saved';end if;
  return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);
 end if;
 if exists(select 1 from public.property_legal_workspaces where property_id=p_property_id and org_id<>v_org)or exists(select 1 from public.property_legal_configs where property_id=p_property_id and org_id<>v_org)then return'{"state":"scope_changed"}';end if;
 v_state:=public.legal_review_state(p_property_id);
 if p_input->>'expectedStateHash'is distinct from public.knowledge_hash(v_state)then return'{"state":"legal_changed"}';end if;
 if v_op='save'then
  if p_input-array['operation','reason','expectedStateHash','sourceVersionId','draft']<>'{}'or not public.valid_legal_review_draft(v_draft)then raise exception 'Review the supported legal draft fields and complete provenance';end if;
  v_source:=(p_input->>'sourceVersionId')::uuid;
  if v_source is not null then select *into r from public.property_legal_configs where id=v_source and property_id=p_property_id and org_id=v_org;if not found then return'{"state":"not_found"}';end if;end if;
  v_id:=p_id;v_kind:='saved';if exists(select 1 from public.property_legal_configs where id=v_id)then return'{"state":"request_conflict"}';end if;
 else
  if p_input-array['operation','reason','expectedStateHash','versionId','versionHash','confirmed']<>'{}'or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Confirm the exact saved legal version';end if;
  v_id:=(p_input->>'versionId')::uuid;select *into r from public.property_legal_configs where id=v_id and property_id=p_property_id and org_id=v_org for update;if not found then return'{"state":"not_found"}';end if;
  if p_input->>'versionHash'is distinct from public.knowledge_hash(to_jsonb(r))then return'{"state":"legal_changed"}';end if;
  if v_op in('approve','reject')and(r.status<>'draft'or exists(select 1 from public.property_legal_configs where property_id=p_property_id and version>r.version))then return'{"state":"version_not_current"}';end if;
  if v_op='approve'and not public.valid_legal_review_draft(public.legal_config_draft(r),true)then return'{"state":"review_incomplete"}';end if;
  if v_op='withdraw'and r.status<>'approved'then return'{"state":"version_not_current"}';end if;
  v_kind:=case v_op when'approve'then'approved'when'reject'then'rejected'else'withdrawn'end;
 end if;
 v_before:=jsonb_build_object('state',v_state,'selectedVersion',case when r.id is not null then to_jsonb(r)else null end,'approvedVersions',coalesce((select jsonb_agg(to_jsonb(x)order by x.version)from public.property_legal_configs x where property_id=p_property_id and status='approved'),'[]'));
 perform set_config('p11.legal_review_scope',p_property_id::text,true);
 if v_op='save'then
  select coalesce(max(version),0)+1 into v_number from public.property_legal_configs where property_id=p_property_id;
  insert into public.property_legal_configs(id,org_id,property_id,version,status,jurisdiction,legal_entity_name,effective_at,privacy_policy,terms,accessibility,fair_housing,pricing_disclaimer,analytics_consent,communications_consent,source_references)
  values(v_id,v_org,p_property_id,v_number,'draft',v_draft->>'jurisdiction',v_draft->>'legalEntityName',(v_draft->>'effectiveAt')::timestamptz,v_draft->'documents'->'privacy_policy',v_draft->'documents'->'terms',v_draft->'documents'->'accessibility',v_draft->'documents'->'fair_housing',v_draft->'documents'->'pricing_disclaimer',v_draft->'documents'->'analytics_consent',v_draft->'documents'->'communications_consent',v_draft->'sourceReferences');
 elsif v_op in('approve','withdraw')then
  update public.property_legal_configs set status='superseded'where property_id=p_property_id and status='approved';
  if v_op='approve'then update public.property_legal_configs set status='approved',approved_by=p_actor_id,approved_at=clock_timestamp()where id=v_id;end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'contentHash',content_hash)order by id),'[]')into v_stale from public.property_onboarding_snapshots where property_id=p_property_id and status in('approved','ready','needs_review');
  update public.property_onboarding_snapshots set status='stale'where property_id=p_property_id and status in('approved','ready','needs_review');
 else update public.property_legal_configs set status='rejected'where id=v_id;
 end if;
 insert into public.property_legal_workspaces(property_id,org_id)values(p_property_id,v_org)on conflict(property_id)do update set revision=property_legal_workspaces.revision+1,updated_at=clock_timestamp();
 select *into r from public.property_legal_configs where id=v_id;
 v_after:=jsonb_build_object('state',public.legal_review_state(p_property_id),'version',to_jsonb(r),'invalidatedReadiness',v_stale);
 v_result:=jsonb_build_object('state','saved','propertyId',p_property_id,'decisionId',p_id,'versionId',v_id,'version',r.version,'status',r.status,'staleReadinessCount',jsonb_array_length(v_stale),'published',false);
 insert into public.property_legal_decisions(id,property_id,org_id,actor_id,version_id,kind,input,input_hash,before_state,after_state,result)values(p_id,p_property_id,v_org,p_actor_id,v_id,v_kind,p_input,public.knowledge_hash(p_input),v_before,v_after,v_result);
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property','legal.'||v_kind,'server_confirmed','succeeded',jsonb_build_object('versionId',v_id,'inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(v_before)),jsonb_build_object('hash',public.knowledge_hash(v_after)),v_result);
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Legal review activity could not be saved';end if;
 perform set_config('p11.legal_review_scope','',true);return v_result;
end$$;
create function public.read_legal_reviews(p_property_id uuid,p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_role text;v_kind text:=coalesce(p_input->>'kind','versions');v_offset int:=coalesce((p_input->>'offset')::int,0);v_state jsonb;v_rows jsonb;v_items jsonb;v_total int;v_hash text;r public.property_legal_configs;d public.property_legal_decisions;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if v_org is null then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','versionId','decisionId','offset','expectedHash']<>'{}'or v_kind not in('versions','version','history','history_detail','decision')or v_offset not between 0 and 1000000 then raise exception 'Choose a legal version or review history page';end if;
 if exists(select 1 from public.property_legal_workspaces where property_id=p_property_id and org_id<>v_org)or exists(select 1 from public.property_legal_configs where property_id=p_property_id and org_id<>v_org)then return'{"state":"scope_changed"}';end if;
 if v_kind in('decision','history_detail')then
  select *into d from public.property_legal_decisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=v_org and(v_kind='history_detail'or actor_id=p_actor_id);if not found then return'{"state":"not_found"}';end if;
  if v_kind='decision'then return d.result||'{"state":"ready"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'decision',to_jsonb(d));
 end if;
 v_state:=public.legal_review_state(p_property_id);
 if v_kind='version'then
  select *into r from public.property_legal_configs where id=(p_input->>'versionId')::uuid and property_id=p_property_id and org_id=v_org;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'version',to_jsonb(r),'draft',public.legal_config_draft(r),'stateHash',public.knowledge_hash(v_state),'versionHash',public.knowledge_hash(to_jsonb(r)),'isLatest',not exists(select 1 from public.property_legal_configs where property_id=p_property_id and version>r.version),'recorded',exists(select 1 from public.property_legal_decisions where version_id=r.id));
 end if;
 if v_kind='history'then
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'versionId',x.version_id,'kind',x.kind,'actorId',x.actor_id,'createdAt',x.created_at,'reason',x.input->>'reason','result',x.result)order by decision_sequence desc),'[]')into v_rows from public.property_legal_decisions x where property_id=p_property_id and org_id=v_org;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'status',x.status,'jurisdiction',x.jurisdiction,'legalEntityName',x.legal_entity_name,'effectiveAt',x.effective_at,'approvedBy',x.approved_by,'approvedAt',x.approved_at,'createdAt',x.created_at,'versionHash',public.knowledge_hash(to_jsonb(x)),'recorded',exists(select 1 from public.property_legal_decisions where version_id=x.id))order by version desc,id),'[]')into v_rows from public.property_legal_configs x where property_id=p_property_id and org_id=v_org;
 end if;
 v_total:=jsonb_array_length(v_rows);v_hash:=public.knowledge_hash(v_rows);if p_input?'expectedHash'and p_input->>'expectedHash'is distinct from v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v order by n),'[]')into v_items from jsonb_array_elements(v_rows)with ordinality p(v,n)where n>v_offset and n<=v_offset+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'items',v_items,'total',v_total,'nextOffset',case when v_offset+20<v_total then v_offset+20 else null end,'pageHash',v_hash,'stateHash',public.knowledge_hash(v_state),'approvedCount',(select count(*)from public.property_legal_configs where property_id=p_property_id and status='approved'),'activeVersionId',(select id from public.property_legal_configs where property_id=p_property_id and status='approved'and effective_at<=clock_timestamp()order by version desc limit 1));
end$$;
-- Existing neighborhood source IDs cannot be used to reparent another property's evidence.
create function public.guard_neighborhood_source_scope()returns trigger language plpgsql security invoker set search_path=''as $$
begin if(new.id,new.property_id,new.org_id)is distinct from(old.id,old.property_id,old.org_id)then raise exception 'Neighborhood source ownership is immutable';end if;return new;end$$;
create trigger neighborhood_source_scope_guard before update on public.property_points_of_interest for each row execute function public.guard_neighborhood_source_scope();
revoke all on function public.guard_legal_review_history()from public,anon,authenticated;grant execute on function public.guard_legal_review_history()to service_role;
revoke all on function public.guard_legal_review()from public,anon,authenticated;grant execute on function public.guard_legal_review()to service_role;
revoke all on function public.legal_review_state(uuid)from public,anon,authenticated;grant execute on function public.legal_review_state(uuid)to service_role;
revoke all on function public.valid_legal_review_draft(jsonb,boolean)from public,anon,authenticated;grant execute on function public.valid_legal_review_draft(jsonb,boolean)to service_role;
revoke all on function public.legal_config_draft(public.property_legal_configs)from public,anon,authenticated;grant execute on function public.legal_config_draft(public.property_legal_configs)to service_role;
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated;grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)to service_role;
revoke all on function public.decide_legal_review(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.decide_legal_review(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.read_legal_reviews(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.read_legal_reviews(uuid,uuid,jsonb)to service_role;
revoke all on function public.guard_neighborhood_source_scope()from public,anon,authenticated;grant execute on function public.guard_neighborhood_source_scope()to service_role;
notify pgrst,'reload schema';

create function public.legal_snapshot_matches_current(p_property_id uuid,p_org_id uuid,p_legal jsonb)returns boolean language plpgsql stable security invoker set search_path=''as $$
declare r public.property_legal_configs;e public.property_legal_configs;
begin
 if jsonb_typeof(p_legal)is distinct from'object'then return false;end if;
 select *into r from public.property_legal_configs where property_id=p_property_id and org_id=p_org_id and status='approved'and effective_at<=clock_timestamp()order by version desc limit 1;if not found then return false;end if;
 e:=jsonb_populate_record(null::public.property_legal_configs,p_legal);return to_jsonb(e)=to_jsonb(r);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end$$;
create function public.guard_readiness_legal_basis()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if exists(select 1 from public.property_legal_workspaces where property_id=new.property_id)and new.status in('ready','needs_review','approved')and(new.status='approved'or jsonb_typeof(new.snapshot_payload->'legal')='object')and not public.legal_snapshot_matches_current(new.property_id,new.org_id,new.snapshot_payload->'legal')then
  if new.status='approved'then raise exception 'The legal approval changed; build and review current readiness';end if;
  new.status:='stale';
 end if;
 return new;
end$$;
create trigger readiness_legal_basis_guard before insert or update on public.property_onboarding_snapshots for each row execute function public.guard_readiness_legal_basis();
revoke all on function public.legal_snapshot_matches_current(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.legal_snapshot_matches_current(uuid,uuid,jsonb)to service_role;
revoke all on function public.guard_readiness_legal_basis()from public,anon,authenticated;grant execute on function public.guard_readiness_legal_basis()to service_role;
notify pgrst,'reload schema';
