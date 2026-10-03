create table public.organization_setups(id uuid primary key default gen_random_uuid(),actor_id uuid not null unique references public.profiles(id)on delete cascade,revision integer not null,state text not null default'draft'check(state in('draft','completed')),draft jsonb not null,org_id uuid references public.organizations(id)on delete cascade,property_id uuid references public.properties(id)on delete cascade,completion_decision_id uuid,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),completed_at timestamptz,check((state='draft'and org_id is null and property_id is null and completion_decision_id is null and completed_at is null)or(state='completed'and org_id is not null and property_id is not null and completion_decision_id is not null and completed_at is not null)));
create table public.organization_setup_decisions(id uuid primary key,setup_id uuid not null references public.organization_setups(id)on delete cascade,actor_id uuid not null references public.profiles(id)on delete cascade,decision_sequence bigint generated always as identity unique,kind text not null check(kind in('save','complete')),input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.organization_setups add foreign key(completion_decision_id)references public.organization_setup_decisions(id)deferrable initially deferred;
create table public.organization_setup_cancellations(id uuid primary key,actor_id uuid not null references public.profiles(id)on delete cascade,input jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.organization_setups enable row level security;revoke all on public.organization_setups from public,anon,authenticated;grant all on public.organization_setups to service_role;create policy organization_setups_service on public.organization_setups for all to service_role using(true)with check(true);
create index organization_setups_idx_0 on public.organization_setups(org_id);
create index organization_setups_idx_1 on public.organization_setups(property_id);
create index organization_setups_idx_2 on public.organization_setups(completion_decision_id);
alter table public.organization_setup_decisions enable row level security;revoke all on public.organization_setup_decisions from public,anon,authenticated;grant all on public.organization_setup_decisions to service_role;create policy organization_setup_decisions_service on public.organization_setup_decisions for all to service_role using(true)with check(true);
create index organization_setup_decisions_idx_0 on public.organization_setup_decisions(setup_id);
create index organization_setup_decisions_idx_1 on public.organization_setup_decisions(actor_id,decision_sequence desc);
alter table public.organization_setup_cancellations enable row level security;revoke all on public.organization_setup_cancellations from public,anon,authenticated;grant all on public.organization_setup_cancellations to service_role;create policy organization_setup_cancellations_service on public.organization_setup_cancellations for all to service_role using(true)with check(true);
create index organization_setup_cancellations_idx_0 on public.organization_setup_cancellations(actor_id);
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
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
 origin:=case when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create function public.guard_organization_setup()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and(not exists(select 1 from public.profiles where id=old.actor_id)or(old.property_id is not null and not exists(select 1 from public.properties where id=old.property_id))or(old.org_id is not null and not exists(select 1 from public.organizations where id=old.org_id)))then return old;end if;
 if tg_op='DELETE'then raise exception 'Retain organization setup history';end if;
 if current_setting('p11.organization_setup_actor',true)is distinct from new.actor_id::text then raise exception 'Use a recorded organization setup decision';end if;
 if tg_op='UPDATE'and((new.id,new.actor_id,new.created_at)is distinct from(old.id,old.actor_id,old.created_at)or old.state='completed')then raise exception 'Organization setup identity and completed evidence are immutable';end if;return new;
end$$;
create function public.guard_organization_setup_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin if tg_op='DELETE'and not exists(select 1 from public.organization_setups where id=old.setup_id)then return old;end if;raise exception 'Organization setup decisions are immutable';end$$;
create function public.guard_organization_setup_cancellation()returns trigger language plpgsql security invoker set search_path=''as $$
begin if tg_op='DELETE'and not exists(select 1 from public.profiles where id=old.actor_id)then return old;end if;raise exception 'Organization setup cancellations are immutable';end$$;
create function public.decide_organization_setup(p_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare p public.profiles;q public.organization_setups;d public.organization_setup_decisions;c public.organization_setup_cancellations;v_kind text:=p_input->>'operation';v_draft jsonb;v_before jsonb;v_result jsonb;v_org uuid;v_property uuid;v_created jsonb;v_saved jsonb;v_event jsonb;v_snapshot jsonb;v_key text;
begin
 if p_id is null or p_actor_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>524288 or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 then raise exception 'Review the complete organization setup decision';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,913));
 select *into p from public.profiles where id=p_actor_id for update;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,914));
 select *into q from public.organization_setups where actor_id=p_actor_id for update;
 if q.state='completed'and(q.org_id is distinct from p.org_id or not exists(select 1 from public.properties where id=q.property_id and org_id=p.org_id))then return'{"state":"forbidden"}';end if;
 select *into d from public.organization_setup_decisions where id=p_id;
 if found then
  if d.actor_id<>p_actor_id or(v_kind<>'cancel_unused'and d.input is distinct from p_input)then return'{"state":"request_conflict"}';end if;
  if d.kind='save'and p.org_id is not null and q.state is distinct from'completed'then return'{"state":"already_member"}';end if;
  return d.result||'{"state":"replayed"}';
 end if;
 select *into c from public.organization_setup_cancellations where id=p_id;
 if found then if c.actor_id<>p_actor_id then return'{"state":"request_conflict"}';end if;return jsonb_build_object('state',case when v_kind='cancel_unused'then'cancelled'else'decision_cancelled'end,'decisionId',p_id,'cancelled',true);end if;
 if v_kind='cancel_unused'then
  if p_input-array['operation','inputHash','reason']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then raise exception 'Identify the unused setup decision';end if;
  insert into public.organization_setup_cancellations(id,actor_id,input)values(p_id,p_actor_id,p_input);return jsonb_build_object('state','cancelled','decisionId',p_id,'cancelled',true);
 end if;
 if p.org_id is not null then return jsonb_build_object('state',case when q.state='completed'then'already_completed'else'already_member'end);end if;
 if v_kind not in('save','complete')or v_kind is null or coalesce(p_input->>'expectedRevision','')!~'^[0-9]{1,9}$'then raise exception 'Choose a saved setup revision';end if;
 if coalesce(q.revision,0)<>(p_input->>'expectedRevision')::int then return'{"state":"setup_changed"}';end if;
 v_before:=to_jsonb(q);
 perform set_config('p11.organization_setup_actor',p_actor_id::text,true);
 if v_kind='save'then
  if p_input-array['operation','expectedRevision','draft','reason']<>'{}'or jsonb_typeof(p_input->'draft')is distinct from'object'then raise exception 'Provide a complete setup draft';end if;
  v_draft:=p_input->'draft';
  if v_draft-array['organization','profile','contacts','connectionRequests','step']<>'{}'or not(v_draft?&array['organization','profile','contacts','connectionRequests','step'])or v_draft->>'step'not in('organization','community','contacts','integrations','knowledge','review')or jsonb_typeof(v_draft->'organization')is distinct from'object'or(v_draft->'organization')-array['name','type','legalName']<>'{}'or not(v_draft->'organization'?&array['name','type','legalName'])then raise exception 'Provide the complete organization and setup step';end if;
  foreach v_key in array array['name','type','legalName']loop if jsonb_typeof(v_draft->'organization'->v_key)is distinct from'string'or length(v_draft->'organization'->>v_key)>500 then raise exception 'Invalid organization detail';end if;end loop;
  if v_draft->'organization'->>'type'not in('','pmc','owner_operator','developer','reit','other')or jsonb_typeof(v_draft->'profile')is distinct from'object'or jsonb_typeof(v_draft->'contacts')is distinct from'array'or jsonb_array_length(v_draft->'contacts')>100 or jsonb_typeof(v_draft->'connectionRequests')is distinct from'array'or jsonb_array_length(v_draft->'connectionRequests')>11 then raise exception 'Review the bounded setup draft';end if;
  insert into public.organization_setups(actor_id,revision,draft)values(p_actor_id,1,v_draft)on conflict(actor_id)do update set revision=public.organization_setups.revision+1,draft=excluded.draft,updated_at=clock_timestamp()returning *into q;
  v_result:=jsonb_build_object('decisionId',p_id,'setupId',q.id,'revision',q.revision,'draftHash',public.knowledge_hash(q.draft),'completed',false);
 else
  if p_input-array['operation','expectedRevision','draftHash','confirmed','reason']<>'{}'or p_input->'confirmed'is distinct from'true'::jsonb or coalesce(p_input->>'draftHash','')!~'^[a-f0-9]{64}$'then raise exception 'Confirm the exact saved setup before creating the organization';end if;
  if q.id is null or public.knowledge_hash(q.draft)<>p_input->>'draftHash'then return'{"state":"setup_changed"}';end if;
  if length(btrim(q.draft->'organization'->>'name'))not between 1 and 300 then raise exception 'Organization name is required';end if;
  v_org:=gen_random_uuid();v_property:=md5('organization-first-property:'||q.id::text)::uuid;
  insert into public.organizations(id,name,subscription_tier,settings)values(v_org,btrim(q.draft->'organization'->>'name'),'starter',jsonb_build_object('organizationType',q.draft->'organization'->>'type','legalName',q.draft->'organization'->>'legalName'));
  update public.profiles set org_id=v_org,role='admin'where id=p_actor_id;
  v_created:=public.create_property_from_setup(v_property,p_actor_id,jsonb_build_object('profile',q.draft->'profile','template',null));
  if v_created->>'state'<>'created'then raise exception 'The first property could not be created atomically';end if;
  v_snapshot:=public.property_edit_snapshot(v_property);
  v_saved:=public.save_property_setup(md5('organization-first-setup:'||p_id::text)::uuid,v_property,p_actor_id,jsonb_build_object('expectedHash',public.knowledge_hash(v_snapshot),'profile',q.draft->'profile','contacts',q.draft->'contacts','connectionRequests',q.draft->'connectionRequests','reason',p_input->>'reason','completeOnboarding',true));
  if v_saved->>'state'<>'saved'then raise exception 'The complete first-property setup could not be retained';end if;
  update public.organization_setups set revision=revision+1,state='completed',org_id=v_org,property_id=v_property,completion_decision_id=p_id,completed_at=clock_timestamp(),updated_at=clock_timestamp()where id=q.id returning *into q;
  v_result:=jsonb_build_object('decisionId',p_id,'setupId',q.id,'revision',q.revision,'draftHash',public.knowledge_hash(q.draft),'completed',true,'organizationId',v_org,'propertyId',v_property,'connectionsActivated',false,'knowledgePublished',false,'trainingStarted',false);
  v_event:=public.append_shared_action_event(p_id,p_id,v_property,p_actor_id,'property','organization.setup.completed','server_confirmed','succeeded',jsonb_build_object('setupId',q.id,'inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(v_before)),jsonb_build_object('hash',public.knowledge_hash(to_jsonb(q))),v_result);
  if v_event->>'state'not in('recorded','replayed')then raise exception 'Organization completion evidence could not be retained';end if;
 end if;
 insert into public.organization_setup_decisions(id,setup_id,actor_id,kind,input,input_hash,before_state,after_state,result)values(p_id,q.id,p_actor_id,v_kind,p_input,public.knowledge_hash(p_input),v_before,to_jsonb(q),v_result);
 return v_result||'{"state":"saved"}';
end$$;
create function public.read_organization_setup(p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare p public.profiles;q public.organization_setups;d public.organization_setup_decisions;v_rows jsonb;v_items jsonb;v_hash text;v_total int;v_offset int:=coalesce((p_input->>'offset')::int,0);
begin
 select *into p from public.profiles where id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_input-array['decisionId','offset','expectedHash']<>'{}'or v_offset not between 0 and 1000000 then raise exception 'Choose a saved setup decision or history page';end if;
 select *into q from public.organization_setups where actor_id=p_actor_id;
 if q.state='completed'and(q.org_id is distinct from p.org_id or not exists(select 1 from public.properties where id=q.property_id and org_id=p.org_id))then return'{"state":"forbidden"}';end if;
 if p.org_id is not null and q.state is distinct from'completed'then return jsonb_build_object('state','ready','actorId',p_actor_id,'alreadyMember',true,'setup',null,'items','[]'::jsonb,'total',0,'nextOffset',null);end if;
 if p_input?'decisionId'then
  select *into d from public.organization_setup_decisions where id=(p_input->>'decisionId')::uuid and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','actorId',p_actor_id,'decision',to_jsonb(d),'result',d.result);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'createdAt',x.created_at,'reason',x.input->>'reason','revision',x.result->'revision')order by x.decision_sequence desc),'[]')into v_rows from public.organization_setup_decisions x where actor_id=p_actor_id;
 v_total:=jsonb_array_length(v_rows);v_hash:=public.knowledge_hash(v_rows);if p_input?'expectedHash'and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v order by n),'[]')into v_items from jsonb_array_elements(v_rows)with ordinality rows(v,n)where n>v_offset and n<=v_offset+20;
 return jsonb_build_object('state','ready','actorId',p_actor_id,'alreadyMember',false,'setup',case when q.id is not null then to_jsonb(q)||jsonb_build_object('draftHash',public.knowledge_hash(q.draft))end,'items',v_items,'total',v_total,'historyHash',v_hash,'nextOffset',case when v_offset+20<v_total then v_offset+20 else null end);
end$$;

create trigger organization_setup_guard before insert or update or delete on public.organization_setups for each row execute function public.guard_organization_setup();
create trigger organization_setup_history_guard before update or delete on public.organization_setup_decisions for each row execute function public.guard_organization_setup_history();
create trigger organization_setup_cancellation_guard before update or delete on public.organization_setup_cancellations for each row execute function public.guard_organization_setup_cancellation();
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.guard_organization_setup() from public,anon,authenticated;grant execute on function public.guard_organization_setup() to service_role;
revoke all on function public.guard_organization_setup_history() from public,anon,authenticated;grant execute on function public.guard_organization_setup_history() to service_role;
revoke all on function public.guard_organization_setup_cancellation() from public,anon,authenticated;grant execute on function public.guard_organization_setup_cancellation() to service_role;
revoke all on function public.decide_organization_setup(uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.decide_organization_setup(uuid,uuid,jsonb) to service_role;
revoke all on function public.read_organization_setup(uuid,jsonb) from public,anon,authenticated;grant execute on function public.read_organization_setup(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
