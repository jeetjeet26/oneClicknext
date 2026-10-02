create table public.knowledge_cancelled_decisions(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),input_hash text not null,reason text not null,created_at timestamptz not null default clock_timestamp());
alter table public.knowledge_cancelled_decisions enable row level security;
revoke all on public.knowledge_cancelled_decisions from public,anon,authenticated;
grant all on public.knowledge_cancelled_decisions to service_role;
create policy knowledge_cancelled_decisions_service on public.knowledge_cancelled_decisions for all to service_role using(true)with check(true);
create index knowledge_cancelled_decisions_property_idx on public.knowledge_cancelled_decisions(property_id);
create index knowledge_cancelled_decisions_org_idx on public.knowledge_cancelled_decisions(org_id);
create index knowledge_cancelled_decisions_actor_idx on public.knowledge_cancelled_decisions(actor_id);
create trigger knowledge_cancelled_decisions_immutable before update or delete on public.knowledge_cancelled_decisions for each row execute function public.guard_siteforge_brief_history();

-- Exact retained plaintext versions are private until explicitly published for retrieval.
create table public.knowledge_materials(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),created_by uuid not null references public.profiles(id),latest_version_id uuid,active_version_id uuid,last_release_id uuid,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.knowledge_material_versions(
 id uuid primary key,version_sequence bigint generated always as identity unique,material_id uuid not null references public.knowledge_materials(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),previous_version_id uuid references public.knowledge_material_versions(id),title text not null,content text not null,content_hash text not null,input jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.knowledge_material_decisions(
 id uuid primary key,decision_sequence bigint generated always as identity unique,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),material_id uuid not null references public.knowledge_materials(id)on delete cascade,kind text not null,input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.knowledge_embedding_requests(
 id uuid primary key references public.shared_jobs(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),material_id uuid not null references public.knowledge_materials(id)on delete cascade,version_id uuid not null unique references public.knowledge_material_versions(id),context_id uuid not null references public.shared_context_snapshots(id),input jsonb not null,model_input jsonb not null,
 state text not null default'queued'check(state in('queued','running','result_ready','ready','held','stopped')),revision integer not null default 1,claim_token uuid,raw_result jsonb,result_hash text,error_code text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz
);
alter table public.knowledge_materials add constraint knowledge_latest_version foreign key(latest_version_id)references public.knowledge_material_versions(id)deferrable initially deferred;
alter table public.knowledge_materials add constraint knowledge_active_version foreign key(active_version_id)references public.knowledge_material_versions(id)deferrable initially deferred;
alter table public.knowledge_materials add constraint knowledge_last_release foreign key(last_release_id)references public.knowledge_material_decisions(id)deferrable initially deferred;
alter table public.knowledge_sources drop constraint knowledge_sources_status_check;
alter table public.knowledge_sources add constraint knowledge_sources_status_check check(status in('pending','processing','completed','failed','withdrawn'));
create index knowledge_materials_idx_0 on public.knowledge_materials(property_id,updated_at desc,id desc);
create index knowledge_materials_idx_1 on public.knowledge_materials(org_id);
create index knowledge_materials_idx_2 on public.knowledge_materials(created_by);
create index knowledge_materials_idx_3 on public.knowledge_materials(latest_version_id);
create index knowledge_materials_idx_4 on public.knowledge_materials(active_version_id);
create index knowledge_materials_idx_5 on public.knowledge_materials(last_release_id);
alter table public.knowledge_materials enable row level security;
revoke all on public.knowledge_materials from public,anon,authenticated;
grant all on public.knowledge_materials to service_role;
create policy knowledge_materials_service on public.knowledge_materials for all to service_role using(true)with check(true);
create index knowledge_material_versions_idx_0 on public.knowledge_material_versions(material_id,version_sequence desc);
create index knowledge_material_versions_idx_1 on public.knowledge_material_versions(property_id,version_sequence desc);
create index knowledge_material_versions_idx_2 on public.knowledge_material_versions(org_id);
create index knowledge_material_versions_idx_3 on public.knowledge_material_versions(actor_id);
create index knowledge_material_versions_idx_4 on public.knowledge_material_versions(previous_version_id);
alter table public.knowledge_material_versions enable row level security;
revoke all on public.knowledge_material_versions from public,anon,authenticated;
grant all on public.knowledge_material_versions to service_role;
create policy knowledge_material_versions_service on public.knowledge_material_versions for all to service_role using(true)with check(true);
create index knowledge_material_decisions_idx_0 on public.knowledge_material_decisions(material_id,decision_sequence desc);
create index knowledge_material_decisions_idx_1 on public.knowledge_material_decisions(property_id,decision_sequence desc);
create index knowledge_material_decisions_idx_2 on public.knowledge_material_decisions(org_id);
create index knowledge_material_decisions_idx_3 on public.knowledge_material_decisions(actor_id);
alter table public.knowledge_material_decisions enable row level security;
revoke all on public.knowledge_material_decisions from public,anon,authenticated;
grant all on public.knowledge_material_decisions to service_role;
create policy knowledge_material_decisions_service on public.knowledge_material_decisions for all to service_role using(true)with check(true);
create index knowledge_embedding_requests_idx_0 on public.knowledge_embedding_requests(material_id,created_at desc,id desc);
create index knowledge_embedding_requests_idx_1 on public.knowledge_embedding_requests(property_id,created_at desc,id desc);
create index knowledge_embedding_requests_idx_2 on public.knowledge_embedding_requests(org_id);
create index knowledge_embedding_requests_idx_3 on public.knowledge_embedding_requests(actor_id);
create index knowledge_embedding_requests_idx_4 on public.knowledge_embedding_requests(context_id);
alter table public.knowledge_embedding_requests enable row level security;
revoke all on public.knowledge_embedding_requests from public,anon,authenticated;
grant all on public.knowledge_embedding_requests to service_role;
create policy knowledge_embedding_requests_service on public.knowledge_embedding_requests for all to service_role using(true)with check(true);
create trigger knowledge_material_versions_immutable before update or delete on public.knowledge_material_versions for each row execute function public.guard_siteforge_brief_history();
create trigger knowledge_material_decisions_immutable before update or delete on public.knowledge_material_decisions for each row execute function public.guard_siteforge_brief_history();
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('property.setup.saved','property.created','property.onboarding.completed') then
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
 origin:=case when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

create function public.knowledge_hash(p_value jsonb)returns text language sql immutable security invoker set search_path=''as $$select encode(extensions.digest(p_value::text,'sha256'),'hex')$$;
create function public.knowledge_decision_start(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_role text;v_prior public.knowledge_material_decisions;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if v_org is null or not coalesce(v_role in('admin','manager'),false)then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>1048576 or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 then raise exception 'Review this knowledge decision and its reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=v_org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;
 if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,886));
 if exists(select 1 from public.knowledge_cancelled_decisions where id=p_id)then return'{"state":"decision_cancelled"}';end if;
 select *into v_prior from public.knowledge_material_decisions where id=p_id;
 if found then if(v_prior.property_id,v_prior.org_id,v_prior.actor_id,v_prior.kind,v_prior.input)is distinct from(p_property_id,v_org,p_actor_id,p_kind,p_input)then return'{"state":"request_conflict"}';end if;return v_prior.result||'{"state":"replayed"}';end if;
 return jsonb_build_object('state','new','orgId',v_org);
end$$;
create function public.knowledge_decision_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_material_id uuid,p_kind text,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_event jsonb;v_links jsonb:='{}';
begin
 select org_id into v_org from public.properties where id=p_property_id;
 insert into public.knowledge_material_decisions(id,property_id,org_id,actor_id,material_id,kind,input,input_hash,before_state,after_state,result)values(p_id,p_property_id,v_org,p_actor_id,p_material_id,p_kind,p_input,public.knowledge_hash(p_input),p_before,p_after,p_result);
 if p_result?'searchId'then select jsonb_build_object('jobId',j.id,'contextId',j.context_snapshot_id)into v_links from public.shared_jobs j where j.id=(p_result->>'searchId')::uuid and j.property_id=p_property_id;end if;
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'knowledge','knowledge.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('materialId',p_material_id,'inputHash',public.knowledge_hash(p_input)),case when p_before is not null then jsonb_build_object('hash',public.knowledge_hash(p_before))end,case when p_after is not null then jsonb_build_object('hash',public.knowledge_hash(p_after))end,p_result,coalesce(v_links,'{}'));
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Knowledge decision history could not be saved';end if;
 return p_result||'{"state":"saved"}';
end$$;
create function public.record_knowledge_service_event(p_entry public.knowledge_embedding_requests,p_action text,p_phase text,p_result jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare v_id uuid:=md5(p_action||':'||p_entry.id::text||case when p_action='knowledge.search.held'then ':'||p_entry.revision::text else ''end)::uuid;v_existing public.shared_action_events;
begin
 if p_action not in('knowledge.search.started','knowledge.search.result_received','knowledge.search.prepared','knowledge.search.held')or p_phase not in('succeeded','failed')then raise exception 'Invalid knowledge service outcome';end if;
 select *into v_existing from public.shared_action_events where id=v_id;
 if found then if(v_existing.shared_job_ref,v_existing.service_principal,v_existing.action,v_existing.phase,v_existing.result)is distinct from(p_entry.id,'knowledge.embedding',p_action,p_phase,p_result)then raise exception 'Knowledge service outcome changed';end if;return;end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin)values(v_id,p_entry.org_id,p_entry.property_id,null,'knowledge.embedding','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,context_snapshot_ref)values(v_id,v_id,p_entry.org_id,p_entry.property_id,null,'knowledge.embedding','knowledge',p_action,'server_confirmed',p_phase,jsonb_build_object('searchId',p_entry.id,'versionId',p_entry.version_id),jsonb_build_object('state',p_entry.state),jsonb_build_object('state',p_result->>'requestState'),p_result,p_entry.id,p_entry.context_id);
end$$;
create function public.guard_knowledge_embedding_request()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Knowledge search evidence is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.material_id,new.version_id,new.context_id,new.input,new.model_input,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.material_id,old.version_id,old.context_id,old.input,old.model_input,old.created_at)or(old.claim_token is not null and new.claim_token is distinct from old.claim_token)or(old.raw_result is not null and(new.raw_result,new.result_hash)is distinct from(old.raw_result,old.result_hash))then raise exception 'Knowledge search inputs and receipts are retained';end if;
 new.updated_at:=clock_timestamp();new.revision:=old.revision+1;return new;
end$$;
create trigger knowledge_embedding_request_guard before update or delete on public.knowledge_embedding_requests for each row execute function public.guard_knowledge_embedding_request();
create function public.save_knowledge_material(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_material public.knowledge_materials;v_id uuid;v_previous uuid;
begin
 v_start:=public.knowledge_decision_start(p_id,p_property_id,p_actor_id,'source.saved',p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['materialId','previousVersionId','title','content','reason']<>'{}'or not(p_input?&array['materialId','previousVersionId','title','content','reason'])or jsonb_typeof(p_input->'title')is distinct from'string'or length(btrim(p_input->>'title'))not between 1 and 300 or jsonb_typeof(p_input->'content')is distinct from'string'or octet_length(p_input->>'content')not between 1 and 262144 or length(btrim(p_input->>'content'))=0 then raise exception 'Provide a title and complete text up to 256 KiB';end if;
 v_id:=nullif(p_input->>'materialId','')::uuid;v_previous:=nullif(p_input->>'previousVersionId','')::uuid;
 if v_id is null then
  if v_previous is not null then raise exception 'A new source cannot have a previous version';end if;
  v_id:=p_id;insert into public.knowledge_materials(id,property_id,org_id,created_by)values(v_id,p_property_id,(v_start->>'orgId')::uuid,p_actor_id)returning *into v_material;
 else
  select *into v_material from public.knowledge_materials where id=v_id and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid for update;
  if not found then return'{"state":"not_found"}';end if;
  if v_material.latest_version_id is distinct from v_previous then return'{"state":"source_changed"}';end if;
 end if;
 insert into public.knowledge_material_versions(id,material_id,property_id,org_id,actor_id,previous_version_id,title,content,content_hash,input)values(p_id,v_id,p_property_id,v_material.org_id,p_actor_id,v_previous,btrim(p_input->>'title'),p_input->>'content',encode(extensions.digest(p_input->>'content','sha256'),'hex'),p_input);
 update public.knowledge_materials set latest_version_id=p_id,updated_at=clock_timestamp()where id=v_id;
 return public.knowledge_decision_finish(p_id,p_property_id,p_actor_id,v_id,'source.saved',p_input,jsonb_build_object('latestVersionId',v_previous,'activeVersionId',v_material.active_version_id),jsonb_build_object('latestVersionId',p_id,'activeVersionId',v_material.active_version_id),jsonb_build_object('materialId',v_id,'versionId',p_id,'activeVersionId',v_material.active_version_id,'published',false));
end$$;

create function public.begin_knowledge_search(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_model_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_source public.knowledge_materials;v_version public.knowledge_material_versions;v_run public.knowledge_embedding_requests;v_context uuid;v_snapshot jsonb;v_text text;v_chunk jsonb;
begin
 v_start:=public.knowledge_decision_start(p_id,p_property_id,p_actor_id,'search.requested',p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['materialId','versionId','contentHash','confirmed','reason']<>'{}'or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Review the exact text before preparing search data';end if;
 select *into v_source from public.knowledge_materials where id=(p_input->>'materialId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid for update;
 if not found then return'{"state":"not_found"}';end if;
 select *into v_version from public.knowledge_material_versions where id=(p_input->>'versionId')::uuid and material_id=v_source.id;
 if not found then return'{"state":"not_found"}';end if;
 if v_source.latest_version_id is distinct from v_version.id or v_version.content_hash is distinct from p_input->>'contentHash'then return'{"state":"source_changed"}';end if;
 select *into v_run from public.knowledge_embedding_requests where version_id=v_version.id;
 if found then return jsonb_build_object('state','existing_search','searchId',v_run.id);end if;
 if jsonb_typeof(p_model_input)is distinct from'object'or(p_model_input-array['model','dimensions','recipe','chunks','contentHash'])<>'{}'or p_model_input->>'model'is distinct from'text-embedding-3-small'or p_model_input->'dimensions'is distinct from'1536'::jsonb or p_model_input->>'recipe'is distinct from'lossless-utf8-4096-v1'or p_model_input->>'contentHash'is distinct from v_version.content_hash or jsonb_typeof(p_model_input->'chunks')is distinct from'array'or jsonb_array_length(p_model_input->'chunks')not between 1 and 256 then raise exception 'Search preparation must retain the reviewed source';end if;
 v_text:='';for v_chunk in select value from jsonb_array_elements(p_model_input->'chunks')loop
  if jsonb_typeof(v_chunk)is distinct from'string'or octet_length(v_chunk#>>'{}')not between 1 and 4096 then raise exception 'Invalid complete search chunk';end if;v_text:=v_text||(v_chunk#>>'{}');
 end loop;
 if v_text is distinct from v_version.content then raise exception 'Search chunks differ from the complete source';end if;
 v_snapshot:=jsonb_build_object('materialId',v_source.id,'versionId',v_version.id,'contentHash',v_version.content_hash,'model','text-embedding-3-small','dimensions',1536,'recipe','lossless-utf8-4096-v1','chunks',jsonb_array_length(p_model_input->'chunks'),'modelInputHash',public.knowledge_hash(p_model_input));
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by)values(v_source.org_id,p_property_id,'knowledge.embedding',p_id::text,v_snapshot,public.knowledge_hash(v_snapshot),p_actor_id::text)returning id into v_context;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,max_attempts,stage,progress,current_step)values(p_id,v_source.org_id,p_property_id,'knowledge.embedding','knowledge_material',v_source.id::text,'queued','reviewed_search_saved',p_id::text,jsonb_build_object('materialId',v_source.id,'versionId',v_version.id),v_context,1,'queued',0,'Saved text awaits one search preparation');
 insert into public.knowledge_embedding_requests(id,property_id,org_id,actor_id,material_id,version_id,context_id,input,model_input)values(p_id,p_property_id,v_source.org_id,p_actor_id,v_source.id,v_version.id,v_context,p_input,p_model_input);
 return public.knowledge_decision_finish(p_id,p_property_id,p_actor_id,v_source.id,'search.requested',p_input,null,jsonb_build_object('requestState','queued'),jsonb_build_object('materialId',v_source.id,'versionId',v_version.id,'searchId',p_id,'requestState','queued','modelInvoked',false));
end$$;
create function public.claim_knowledge_search(p_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_run public.knowledge_embedding_requests;v_prior public.knowledge_embedding_requests;
begin
 select *into v_run from public.knowledge_embedding_requests where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_run.property_id::text,12));
 select *into v_run from public.knowledge_embedding_requests where id=p_id for update;
 if v_run.state<>'queued'or v_run.claim_token is not null then return jsonb_build_object('state',v_run.state);end if;
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id join public.knowledge_materials m on m.property_id=p.id and m.org_id=p.org_id where p.id=v_run.property_id and p.org_id=v_run.org_id and u.id=v_run.actor_id and u.role in('admin','manager')and m.id=v_run.material_id and m.latest_version_id=v_run.version_id for share of p,u,m;
 if not found then
  update public.knowledge_embedding_requests set state='held',error_code='source_or_access_changed',finished_at=clock_timestamp()where id=p_id;
  update public.shared_jobs set lifecycle_status='failed',status_reason='source_or_access_changed',finished_at=clock_timestamp(),updated_at=clock_timestamp()where id=p_id;
  perform public.record_knowledge_service_event(v_run,'knowledge.search.held','failed','{"requestState":"held","reason":"source_or_access_changed"}');return'{"state":"held"}';
 end if;
 v_prior:=v_run;update public.knowledge_embedding_requests set state='running',claim_token=gen_random_uuid(),started_at=clock_timestamp()where id=p_id returning *into v_run;
 update public.shared_jobs set lifecycle_status='running',attempt_count=1,stage='preparing',progress=10,started_at=clock_timestamp(),updated_at=clock_timestamp(),current_step='One search preparation started; awaiting retained result'where id=p_id;
 perform public.record_knowledge_service_event(v_prior,'knowledge.search.started','succeeded','{"requestState":"running"}');
 return jsonb_build_object('state','invoke_once','claimToken',v_run.claim_token,'modelInput',v_run.model_input);
end$$;
create function public.record_knowledge_search_result(p_id uuid,p_claim_token uuid,p_result jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_run public.knowledge_embedding_requests;v_state text;
begin
 select *into v_run from public.knowledge_embedding_requests where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_run.property_id::text,12));select *into v_run from public.knowledge_embedding_requests where id=p_id for update;
 if p_claim_token is null or v_run.claim_token is distinct from p_claim_token then return'{"state":"claim_mismatch"}';end if;
 if jsonb_typeof(p_result)is distinct from'object'or octet_length(p_result::text)>8388608 or coalesce(p_result->>'status','')not in('received','uncertain')then raise exception 'Retain the complete search preparation receipt';end if;
 if v_run.raw_result is not null then if v_run.raw_result is distinct from p_result then return'{"state":"result_conflict"}';end if;return jsonb_build_object('state','replayed','requestState',v_run.state);end if;
 v_state:=case when v_run.state='stopped'then'stopped'when p_result->>'status'='received'then'result_ready'else'held'end;
 update public.knowledge_embedding_requests set raw_result=p_result,result_hash=public.knowledge_hash(p_result),state=v_state,error_code=case when v_state='held'then'model_uncertain'end where id=p_id;
 if v_state<>'stopped'then update public.shared_jobs set lifecycle_status='failed',status_reason=case when v_state='result_ready'then'receipt_retained'else'model_uncertain'end,stage='review',current_step='Retained outcome awaits local validation; no automatic model retry',updated_at=clock_timestamp()where id=p_id;end if;
 perform public.record_knowledge_service_event(v_run,'knowledge.search.result_received',case when p_result->>'status'='received'then'succeeded'else'failed'end,jsonb_build_object('requestState',v_state,'resultHash',public.knowledge_hash(p_result)));
 return jsonb_build_object('state','saved','requestState',v_state);
end$$;
create function public.validate_knowledge_search(p_id uuid,p_result_hash text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_run public.knowledge_embedding_requests;v_data jsonb;v_item jsonb;v_valid boolean:=true;v_count int;v_index int;v_seen int[]:='{}';
begin
 select *into v_run from public.knowledge_embedding_requests where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_run.property_id::text,12));select *into v_run from public.knowledge_embedding_requests where id=p_id for update;
 if v_run.result_hash is distinct from p_result_hash then return'{"state":"receipt_changed"}';end if;
 if v_run.state<>'result_ready'then return jsonb_build_object('state',v_run.state);end if;
 v_count:=jsonb_array_length(v_run.model_input->'chunks');v_data:=v_run.raw_result->'response'->'data';
 begin
  v_valid:=v_run.raw_result->>'status'='received'and v_run.raw_result->'response'->>'model'='text-embedding-3-small'and jsonb_typeof(v_data)='array'and jsonb_array_length(v_data)=v_count;
  if v_valid then for v_item in select value from jsonb_array_elements(v_data)loop
   if jsonb_typeof(v_item->'index')is distinct from'number'or(v_item->>'index')!~'^[0-9]+$'then v_valid:=false;exit;end if;
   v_index:=(v_item->>'index')::int;
   if v_index<0 or v_index>=v_count or v_index=any(v_seen)or jsonb_typeof(v_item->'embedding')is distinct from'array'or jsonb_array_length(v_item->'embedding')<>1536 then v_valid:=false;exit;end if;
   if exists(select 1 from jsonb_array_elements(v_item->'embedding')n where jsonb_typeof(n)<>'number'or abs((n#>>'{}')::numeric)>3.4e38)or not exists(select 1 from jsonb_array_elements(v_item->'embedding')n where(n#>>'{}')::numeric<>0)then v_valid:=false;exit;end if;
   v_seen:=array_append(v_seen,v_index);
  end loop;end if;
 exception when others then v_valid:=false;
 end;
 if v_valid is not true then
  update public.knowledge_embedding_requests set state='held',error_code='invalid_output',finished_at=clock_timestamp()where id=p_id;
  update public.shared_jobs set lifecycle_status='failed',status_reason='invalid_output',stage='review',finished_at=clock_timestamp(),updated_at=clock_timestamp()where id=p_id;
  perform public.record_knowledge_service_event(v_run,'knowledge.search.held','failed','{"requestState":"held","reason":"invalid_output"}');return'{"state":"held"}';
 end if;
 update public.knowledge_embedding_requests set state='ready',error_code=null,finished_at=clock_timestamp()where id=p_id;
 update public.shared_jobs set lifecycle_status='succeeded',status_reason='search_data_prepared',stage='completed',progress=100,finished_at=clock_timestamp(),updated_at=clock_timestamp(),current_step='Search data prepared; explicit source publication still required'where id=p_id;
 perform public.record_knowledge_service_event(v_run,'knowledge.search.prepared','succeeded',jsonb_build_object('requestState','ready','chunks',v_count,'resultHash',v_run.result_hash,'published',false));return'{"state":"ready"}';
end$$;
create function public.control_knowledge_search(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_run public.knowledge_embedding_requests;v_kind text;
begin
 v_kind:=case p_input->>'operation'when'stop'then'search.stopped'when'recover'then'search.recovered'else null end;if v_kind is null then raise exception 'Choose stop or recover';end if;
 v_start:=public.knowledge_decision_start(p_id,p_property_id,p_actor_id,v_kind,p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['searchId','expectedRevision','operation','reason']<>'{}'then raise exception 'Invalid search decision';end if;
 select *into v_run from public.knowledge_embedding_requests where id=(p_input->>'searchId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid for update;if not found then return'{"state":"not_found"}';end if;
 if v_run.revision is distinct from(p_input->>'expectedRevision')::int then return'{"state":"request_changed"}';end if;
 if v_kind='search.stopped'then
  if v_run.state not in('queued','running','result_ready','held')then return'{"state":"closed_request"}';end if;
  update public.knowledge_embedding_requests set state='stopped',finished_at=clock_timestamp()where id=v_run.id;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='operator_stopped',finished_at=clock_timestamp(),updated_at=clock_timestamp(),current_step='Preparation stopped; any late receipt remains private'where id=v_run.id;
 elsif v_run.state='running'then
  if v_run.started_at>clock_timestamp()-interval'90 seconds'then return'{"state":"still_running"}';end if;
  update public.knowledge_embedding_requests set state='held',error_code='invocation_unconfirmed',finished_at=clock_timestamp()where id=v_run.id;
  update public.shared_jobs set lifecycle_status='failed',status_reason='invocation_unconfirmed',updated_at=clock_timestamp(),finished_at=clock_timestamp(),current_step='Invocation unconfirmed; inspect retained receipt without repeating it'where id=v_run.id;
 end if;
 return public.knowledge_decision_finish(p_id,p_property_id,p_actor_id,v_run.material_id,v_kind,p_input,jsonb_build_object('requestState',v_run.state,'revision',v_run.revision),(select jsonb_build_object('requestState',r.state,'revision',r.revision)from public.knowledge_embedding_requests r where r.id=v_run.id),jsonb_build_object('materialId',v_run.material_id,'versionId',v_run.version_id,'searchId',v_run.id,'modelInvoked',false));
end$$;
create function public.release_knowledge_material(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_source public.knowledge_materials;v_version public.knowledge_material_versions;v_run public.knowledge_embedding_requests;v_kind text;v_active uuid;v_count int:=0;v_before jsonb;v_now timestamptz:=clock_timestamp();
begin
 v_kind:=case p_input->>'operation'when'publish'then'source.published'when'withdraw'then'source.withdrawn'else null end;if v_kind is null then raise exception 'Choose publish or withdraw';end if;
 v_start:=public.knowledge_decision_start(p_id,p_property_id,p_actor_id,v_kind,p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['materialId','versionId','expectedLatestVersionId','expectedActiveVersionId','expectedReleaseId','resultHash','operation','confirmed','reason']<>'{}'or not(p_input?&array['materialId','versionId','expectedLatestVersionId','expectedActiveVersionId','expectedReleaseId','resultHash','operation','confirmed','reason'])or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Review the exact source publication decision';end if;
 select *into v_source from public.knowledge_materials where id=(p_input->>'materialId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid for update;if not found then return'{"state":"not_found"}';end if;
 if(v_source.latest_version_id,v_source.active_version_id,v_source.last_release_id)is distinct from((p_input->>'expectedLatestVersionId')::uuid,(p_input->>'expectedActiveVersionId')::uuid,(p_input->>'expectedReleaseId')::uuid)then return'{"state":"source_changed"}';end if;
 select *into v_version from public.knowledge_material_versions where id=(p_input->>'versionId')::uuid and material_id=v_source.id;if not found then return'{"state":"not_found"}';end if;
 if v_kind='source.published'then
  select *into v_run from public.knowledge_embedding_requests where version_id=v_version.id and material_id=v_source.id and org_id=v_source.org_id and property_id=p_property_id for update;
  if not found or v_run.state<>'ready'or v_run.result_hash is distinct from p_input->>'resultHash'then return'{"state":"preparation_required"}';end if;
  if v_source.active_version_id=v_version.id then return'{"state":"already_published"}';end if;
  v_active:=v_version.id;v_count:=jsonb_array_length(v_run.model_input->'chunks');
 else
  if v_source.active_version_id is distinct from v_version.id then return'{"state":"source_changed"}';end if;
  if p_input->'resultHash'is distinct from'null'::jsonb then raise exception 'Withdrawal does not submit model evidence';end if;
 end if;
 v_before:=jsonb_build_object('activeVersionId',v_source.active_version_id,'releaseId',v_source.last_release_id);
 perform set_config('p11.knowledge_scope',v_source.id::text,true);
 delete from public.documents where property_id=p_property_id and metadata->>'knowledge_material_id'=v_source.id::text;
 if v_active is not null then
  insert into public.documents(id,property_id,content,metadata,embedding)
   select md5(v_version.id::text||':'||(ch.ordinality-1)::text)::uuid,p_property_id,ch.value#>>'{}',jsonb_build_object('title',v_version.title,'source','knowledge:'||v_source.id::text,'knowledge_material_id',v_source.id,'knowledge_source_id',v_source.id,'ingestion_run_id',v_version.id,'version_id',v_version.id,'chunk_index',ch.ordinality-1,'content_hash',v_version.content_hash),(e.value->'embedding')::text::public.vector
   from jsonb_array_elements(v_run.model_input->'chunks')with ordinality ch(value,ordinality)join jsonb_array_elements(v_run.raw_result->'response'->'data')e(value)on(e.value->>'index')::int=ch.ordinality-1;
 end if;
 insert into public.knowledge_sources(id,property_id,source_type,source_name,status,documents_created,extracted_data,processing_notes,last_synced_at,updated_at)values(v_source.id,p_property_id,'manual',v_version.title,case when v_active is null then'withdrawn'else'completed'end,v_count,jsonb_build_object('knowledge_material_id',v_source.id,'active_version_id',v_active,'last_release_id',p_id,'content_hash',v_version.content_hash),'Reviewed text publication; assistant facts require a separate refresh.',v_now,v_now)
 on conflict(id)do update set source_name=excluded.source_name,status=excluded.status,documents_created=excluded.documents_created,extracted_data=excluded.extracted_data,processing_notes=excluded.processing_notes,last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at;
 update public.knowledge_materials set active_version_id=v_active,last_release_id=p_id,updated_at=v_now where id=v_source.id;
 update public.property_chatbot_contexts set status='stale',stale_at=v_now,last_change_summary='Reviewed knowledge publication changed; refresh assistant facts before using this version.',version=version+1,updated_at=v_now where property_id=p_property_id;
 perform set_config('p11.knowledge_scope','',true);
 return public.knowledge_decision_finish(p_id,p_property_id,p_actor_id,v_source.id,v_kind,p_input,v_before,jsonb_build_object('activeVersionId',v_active,'releaseId',p_id),jsonb_build_object('materialId',v_source.id,'versionId',v_version.id,'activeVersionId',v_active,'releaseId',p_id,'published',v_active is not null,'chunks',v_count,'assistantRefreshRequired',true));
end$$;

create function public.knowledge_search_view(p_run public.knowledge_embedding_requests)returns jsonb language sql stable security invoker set search_path=''as $$select jsonb_build_object('id',p_run.id,'versionId',p_run.version_id,'state',p_run.state,'revision',p_run.revision,'resultHash',p_run.result_hash,'errorCode',p_run.error_code,'chunks',jsonb_array_length(p_run.model_input->'chunks'),'model',p_run.model_input->>'model','receiptModel',p_run.raw_result->'response'->>'model','usage',p_run.raw_result->'response'->'usage','providerRequestId',p_run.raw_result->>'providerRequestId','cost',null,'createdAt',p_run.created_at,'startedAt',p_run.started_at,'finishedAt',p_run.finished_at,'invocationClaimed',p_run.claim_token is not null)$$;
create function public.read_knowledge_materials(p_property_id uuid,p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_role text;v_kind text:=coalesce(p_input->>'kind','materials');v_material uuid:=(p_input->>'materialId')::uuid;v_version uuid:=(p_input->>'versionId')::uuid;v_offset int:=coalesce((p_input->>'offset')::int,0);v_hash text;v_total int;v_items jsonb;v_source public.knowledge_materials;v_exact public.knowledge_material_versions;v_selected jsonb;v_decision jsonb;
begin
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','materialId','versionId','offset','expectedHash','decisionId']<>'{}'or v_kind not in('materials','versions','decisions','version','decision')or v_offset not between 0 and 1000000 then raise exception 'Choose a valid source history page';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id for share of p,u;if v_org is null then return'{"state":"forbidden"}';end if;
 select public.knowledge_hash(jsonb_build_object('materials',coalesce((select jsonb_agg(jsonb_build_array(m.id,m.latest_version_id,m.active_version_id,m.last_release_id)order by m.id)from public.knowledge_materials m where m.property_id=p_property_id and m.org_id=v_org),'[]'),'requests',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.revision)order by r.id)from public.knowledge_embedding_requests r where r.property_id=p_property_id and r.org_id=v_org),'[]'),'decisions',(select count(*)from public.knowledge_material_decisions d where d.property_id=p_property_id and d.org_id=v_org)))into v_hash;
 if p_input?'expectedHash'and p_input->>'expectedHash'is distinct from v_hash then return'{"state":"history_changed"}';end if;
 if v_kind<>'materials'then
  select *into v_source from public.knowledge_materials where id=v_material and property_id=p_property_id and org_id=v_org;if not found then return'{"state":"not_found"}';end if;
 end if;
 if v_kind='version'then
  select *into v_exact from public.knowledge_material_versions where id=coalesce(v_version,v_source.latest_version_id)and material_id=v_source.id and org_id=v_org;if not found then return'{"state":"not_found"}';end if;
  select public.knowledge_search_view(r)into v_selected from public.knowledge_embedding_requests r where r.version_id=v_exact.id;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',v_role in('admin','manager'),'historyHash',v_hash,'material',to_jsonb(v_source),'version',to_jsonb(v_exact)-'input','search',v_selected);
 elsif v_kind='decision'then
  select to_jsonb(d)into v_decision from public.knowledge_material_decisions d where d.id=(p_input->>'decisionId')::uuid and d.property_id=p_property_id and d.org_id=v_org and d.material_id=v_material;
  if v_decision is null then return'{"state":"not_found"}';end if;return jsonb_build_object('state','ready','propertyId',p_property_id,'historyHash',v_hash,'decision',v_decision);
 elsif v_kind='materials'then
  select count(*)into v_total from public.knowledge_materials where property_id=p_property_id and org_id=v_org;
  select coalesce(jsonb_agg(to_jsonb(page)),'[]')into v_items from(select m.id,m.latest_version_id,m.active_version_id,m.last_release_id,m.updated_at,v.title,v.content_hash,(select public.knowledge_search_view(r)from public.knowledge_embedding_requests r where r.version_id=v.id)as search from public.knowledge_materials m join public.knowledge_material_versions v on v.id=m.latest_version_id where m.property_id=p_property_id and m.org_id=v_org order by m.updated_at desc,m.id desc limit 20 offset v_offset)page;
 elsif v_kind='versions'then
  select count(*)into v_total from public.knowledge_material_versions where material_id=v_material;
  select coalesce(jsonb_agg(to_jsonb(page)),'[]')into v_items from(select v.id,v.version_sequence,v.previous_version_id,v.title,v.content_hash,octet_length(v.content)as bytes,v.created_at,v.actor_id,(select public.knowledge_search_view(r)from public.knowledge_embedding_requests r where r.version_id=v.id)as search from public.knowledge_material_versions v where material_id=v_material order by version_sequence desc limit 20 offset v_offset)page;
 else
  select count(*)into v_total from public.knowledge_material_decisions where material_id=v_material;
  select coalesce(jsonb_agg(to_jsonb(page)),'[]')into v_items from(select d.id,d.kind,d.actor_id,d.created_at,d.input->>'reason'as reason,d.before_state,d.after_state,d.result from public.knowledge_material_decisions d where material_id=v_material order by decision_sequence desc limit 20 offset v_offset)page;
 end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',v_role in('admin','manager'),'historyHash',v_hash,'kind',v_kind,'items',v_items,'total',v_total,'offset',v_offset,'nextOffset',case when v_offset+20<v_total then v_offset+20 else null end);
end$$;
create function public.guard_managed_knowledge()returns trigger language plpgsql security invoker set search_path=''as $$
declare v_old uuid;v_new uuid;v_property uuid;v_marker text:=current_setting('p11.knowledge_scope',true);
begin
 if tg_table_name='documents'then
  if tg_op<>'INSERT'and old.metadata?'knowledge_material_id'then v_old:=(old.metadata->>'knowledge_material_id')::uuid;end if;
  if tg_op<>'DELETE'and new.metadata?'knowledge_material_id'then v_new:=(new.metadata->>'knowledge_material_id')::uuid;end if;
 else
  if tg_op<>'INSERT'and exists(select 1 from public.knowledge_materials where id=old.id)then v_old:=old.id;end if;
  if tg_op<>'DELETE'and exists(select 1 from public.knowledge_materials where id=new.id)then v_new:=new.id;end if;
 end if;
 if v_old is not null or v_new is not null then
  v_property:=case when tg_op='DELETE'then old.property_id else new.property_id end;
  if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  if(v_old is not null and v_old::text is distinct from v_marker)or(v_new is not null and v_new::text is distinct from v_marker)or not exists(select 1 from public.knowledge_materials where id=coalesce(v_new,v_old)and property_id=v_property)then raise exception 'Use the recorded source publication or withdrawal workflow';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger managed_knowledge_documents_guard before insert or update or delete on public.documents for each row execute function public.guard_managed_knowledge();
create trigger managed_knowledge_sources_guard before insert or update or delete on public.knowledge_sources for each row execute function public.guard_managed_knowledge();
create function public.guard_knowledge_context()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if exists(select 1 from public.knowledge_embedding_requests where context_id=old.id)and exists(select 1 from public.properties where id=old.property_id)then raise exception 'Knowledge search context is retained';end if;if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger knowledge_context_guard before update or delete on public.shared_context_snapshots for each row execute function public.guard_knowledge_context();
create function public.guard_knowledge_job()returns trigger language plpgsql security invoker set search_path=''as $$
declare v_run public.knowledge_embedding_requests;v_state text;
begin
 if old.property_id is not null and new.property_id is null and not exists(select 1 from public.properties where id=old.property_id)then return new;end if;
 select *into v_run from public.knowledge_embedding_requests where id=old.id;if not found then return new;end if;
 if(new.id,new.org_id,new.property_id,new.domain,new.subject_type,new.subject_id,new.payload,new.context_snapshot_id,new.max_attempts,new.dedupe_key)is distinct from(old.id,old.org_id,old.property_id,old.domain,old.subject_type,old.subject_id,old.payload,old.context_snapshot_id,old.max_attempts,old.dedupe_key)then raise exception 'Knowledge search job identity is retained';end if;
 v_state:=case v_run.state when'queued'then'queued'when'running'then'running'when'ready'then'succeeded'when'stopped'then'cancelled'else'failed'end;
 if new.lifecycle_status<>v_state or new.attempt_count>1 then raise exception 'Use the recorded knowledge search controls';end if;return new;
end$$;
create trigger knowledge_job_guard before update on public.shared_jobs for each row execute function public.guard_knowledge_job();

create function public.cancel_unused_knowledge_decision(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_prior public.knowledge_material_decisions;v_cancelled public.knowledge_cancelled_decisions;v_event jsonb;v_event_id uuid:=md5('knowledge-cancel:'||p_id::text)::uuid;
begin
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if v_org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or p_input-array['inputHash','reason']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 then raise exception 'Review the unused request before cancelling';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=v_org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,886));
 select *into v_prior from public.knowledge_material_decisions where id=p_id;
 if found then if(v_prior.property_id,v_prior.org_id,v_prior.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_prior.result||'{"state":"replayed","cancelled":false}';end if;
 select *into v_cancelled from public.knowledge_cancelled_decisions where id=p_id;
 if found then if(v_cancelled.property_id,v_cancelled.org_id,v_cancelled.actor_id,v_cancelled.input_hash,v_cancelled.reason)is distinct from(p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason')then return'{"state":"request_conflict"}';end if;return'{"state":"cancelled","cancelled":true}';end if;
 insert into public.knowledge_cancelled_decisions(id,property_id,org_id,actor_id,input_hash,reason)values(p_id,p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason');
 v_event:=public.append_shared_action_event(v_event_id,v_event_id,p_property_id,p_actor_id,'knowledge','knowledge.decision.cancelled','server_confirmed','succeeded',jsonb_build_object('unusedRequestId',p_id,'browserInputHash',p_input->>'inputHash'),null,null,'{"cancelled":true}');
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Cancellation history could not be saved';end if;
 return'{"state":"cancelled","cancelled":true}';
end$$;

revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)to service_role;

revoke all on function public.knowledge_hash(jsonb)from public,anon,authenticated;
grant execute on function public.knowledge_hash(jsonb)to service_role;

revoke all on function public.knowledge_decision_start(uuid,uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.knowledge_decision_start(uuid,uuid,uuid,text,jsonb)to service_role;

revoke all on function public.knowledge_decision_finish(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.knowledge_decision_finish(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb)to service_role;

revoke all on function public.record_knowledge_service_event(public.knowledge_embedding_requests,text,text,jsonb)from public,anon,authenticated;
grant execute on function public.record_knowledge_service_event(public.knowledge_embedding_requests,text,text,jsonb)to service_role;

revoke all on function public.guard_knowledge_embedding_request()from public,anon,authenticated;
grant execute on function public.guard_knowledge_embedding_request()to service_role;

revoke all on function public.save_knowledge_material(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.save_knowledge_material(uuid,uuid,uuid,jsonb)to service_role;

revoke all on function public.begin_knowledge_search(uuid,uuid,uuid,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.begin_knowledge_search(uuid,uuid,uuid,jsonb,jsonb)to service_role;

revoke all on function public.claim_knowledge_search(uuid)from public,anon,authenticated;
grant execute on function public.claim_knowledge_search(uuid)to service_role;

revoke all on function public.record_knowledge_search_result(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.record_knowledge_search_result(uuid,uuid,jsonb)to service_role;

revoke all on function public.validate_knowledge_search(uuid,text)from public,anon,authenticated;
grant execute on function public.validate_knowledge_search(uuid,text)to service_role;

revoke all on function public.control_knowledge_search(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.control_knowledge_search(uuid,uuid,uuid,jsonb)to service_role;

revoke all on function public.release_knowledge_material(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.release_knowledge_material(uuid,uuid,uuid,jsonb)to service_role;

revoke all on function public.knowledge_search_view(public.knowledge_embedding_requests)from public,anon,authenticated;
grant execute on function public.knowledge_search_view(public.knowledge_embedding_requests)to service_role;

revoke all on function public.read_knowledge_materials(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_knowledge_materials(uuid,uuid,jsonb)to service_role;

revoke all on function public.guard_managed_knowledge()from public,anon,authenticated;
grant execute on function public.guard_managed_knowledge()to service_role;

revoke all on function public.guard_knowledge_context()from public,anon,authenticated;
grant execute on function public.guard_knowledge_context()to service_role;

revoke all on function public.guard_knowledge_job()from public,anon,authenticated;
grant execute on function public.guard_knowledge_job()to service_role;

revoke all on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb)to service_role;
