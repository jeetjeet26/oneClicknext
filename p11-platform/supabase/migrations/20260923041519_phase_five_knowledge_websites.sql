create table public.knowledge_web_captures(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),capture_sequence bigint generated always as identity unique,parent_capture_id uuid references public.knowledge_web_captures(id),input jsonb not null,input_hash text not null,revision int not null default 1,state text not null default'queued'check(state in('queued','running','ready','held','stopped')),claim_token uuid,receipt jsonb,receipt_hash text,material_id uuid references public.knowledge_materials(id),accepted_version_id uuid references public.knowledge_material_versions(id),created_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz);
create table public.knowledge_web_decisions(id uuid primary key,capture_id uuid not null references public.knowledge_web_captures(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),decision_sequence bigint generated always as identity unique,kind text not null,input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.knowledge_web_links(version_id uuid primary key references public.knowledge_material_versions(id)on delete cascade,material_id uuid not null references public.knowledge_materials(id)on delete cascade,capture_id uuid not null references public.knowledge_web_captures(id),decision_id uuid not null references public.knowledge_web_decisions(id)deferrable initially deferred,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),receipt_hash text not null,content_hash text not null,created_at timestamptz not null default clock_timestamp());
alter table public.knowledge_web_captures enable row level security;revoke all on public.knowledge_web_captures from public,anon,authenticated;grant all on public.knowledge_web_captures to service_role;create policy knowledge_web_captures_service on public.knowledge_web_captures for all to service_role using(true)with check(true);
create index knowledge_web_captures_idx_0 on public.knowledge_web_captures(property_id,capture_sequence desc);
create index knowledge_web_captures_idx_1 on public.knowledge_web_captures(org_id);
create index knowledge_web_captures_idx_2 on public.knowledge_web_captures(actor_id);
create index knowledge_web_captures_idx_3 on public.knowledge_web_captures(parent_capture_id);
create index knowledge_web_captures_idx_4 on public.knowledge_web_captures(material_id);
create index knowledge_web_captures_idx_5 on public.knowledge_web_captures(accepted_version_id);
alter table public.knowledge_web_decisions enable row level security;revoke all on public.knowledge_web_decisions from public,anon,authenticated;grant all on public.knowledge_web_decisions to service_role;create policy knowledge_web_decisions_service on public.knowledge_web_decisions for all to service_role using(true)with check(true);
create index knowledge_web_decisions_idx_0 on public.knowledge_web_decisions(capture_id,decision_sequence desc);
create index knowledge_web_decisions_idx_1 on public.knowledge_web_decisions(property_id);
create index knowledge_web_decisions_idx_2 on public.knowledge_web_decisions(org_id);
create index knowledge_web_decisions_idx_3 on public.knowledge_web_decisions(actor_id);
create trigger knowledge_web_decisions_immutable before update or delete on public.knowledge_web_decisions for each row execute function public.guard_siteforge_brief_history();
alter table public.knowledge_web_links enable row level security;revoke all on public.knowledge_web_links from public,anon,authenticated;grant all on public.knowledge_web_links to service_role;create policy knowledge_web_links_service on public.knowledge_web_links for all to service_role using(true)with check(true);
create index knowledge_web_links_idx_0 on public.knowledge_web_links(material_id);
create index knowledge_web_links_idx_1 on public.knowledge_web_links(capture_id);
create index knowledge_web_links_idx_2 on public.knowledge_web_links(decision_id);
create index knowledge_web_links_idx_3 on public.knowledge_web_links(property_id);
create index knowledge_web_links_idx_4 on public.knowledge_web_links(org_id);
create index knowledge_web_links_idx_5 on public.knowledge_web_links(actor_id);
create trigger knowledge_web_links_immutable before update or delete on public.knowledge_web_links for each row execute function public.guard_siteforge_brief_history();
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
 origin:=case when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create function public.knowledge_web_start(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_prior public.knowledge_web_decisions;
begin
 v_start:=public.knowledge_decision_start(p_id,p_property_id,p_actor_id,'web.'||p_kind,p_input);
 if v_start->>'state'<>'new'then return v_start;end if;
 select *into v_prior from public.knowledge_web_decisions where id=p_id;
 if found then
  if(v_prior.property_id,v_prior.org_id,v_prior.actor_id,v_prior.kind,v_prior.input)is distinct from(p_property_id,(v_start->>'orgId')::uuid,p_actor_id,p_kind,p_input)then return'{"state":"request_conflict"}';end if;
  return v_prior.result||'{"state":"replayed"}';
 end if;
 return v_start;
end$$;
create function public.knowledge_web_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_capture_id uuid,p_kind text,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_event jsonb;
begin
 select org_id into v_org from public.properties where id=p_property_id;
 insert into public.knowledge_web_decisions(id,property_id,org_id,actor_id,capture_id,kind,input,input_hash,before_state,after_state,result)
 values(p_id,p_property_id,v_org,p_actor_id,p_capture_id,p_kind,p_input,public.knowledge_hash(p_input),p_before,p_after,p_result);
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'knowledge','knowledge.web.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('captureId',p_capture_id,'inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(p_before)),jsonb_build_object('hash',public.knowledge_hash(p_after)),p_result);
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Website decision history could not be retained';end if;
 return p_result||'{"state":"saved"}';
end$$;
create function public.knowledge_web_service_event(p_id uuid,p_property_id uuid,p_org_id uuid,p_action text,p_result jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare v_id uuid:=md5(p_action||':'||p_id::text)::uuid;
begin
 if p_action not in('knowledge.web.started','knowledge.web.received')then raise exception 'Unknown file outcome';end if;
 if exists(select 1 from public.shared_action_events where id=v_id)then return;end if;
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(v_id,p_org_id,p_property_id,'knowledge.web','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)
 values(v_id,v_id,p_org_id,p_property_id,'knowledge.web','knowledge',p_action,'server_confirmed','succeeded',jsonb_build_object('requestId',p_id),p_result);
end$$;
create function public.begin_knowledge_web_capture(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_parent public.knowledge_web_captures;
begin
 v_start:=public.knowledge_web_start(p_id,p_property_id,p_actor_id,'requested',p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['title','url','materialId','parentCaptureId','expectedParentRevision','reason']<>'{}'or not(p_input?&array['title','url','materialId','parentCaptureId','expectedParentRevision','reason'])or jsonb_typeof(p_input->'title')is distinct from'string'or length(btrim(p_input->>'title'))not between 1 and 300 or jsonb_typeof(p_input->'url')is distinct from'string'or length(p_input->>'url')>2000 or p_input->>'url'!~'^https?://[^[:space:]]+$'or p_input->>'url'~'^https?://[^/]*@'then raise exception 'Choose one exact public website URL and retained title';end if;
 if p_input->>'materialId'is not null and not exists(select 1 from public.knowledge_materials where id=(p_input->>'materialId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid)then return'{"state":"not_found"}';end if;
 if p_input->>'parentCaptureId'is not null then
  select *into v_parent from public.knowledge_web_captures where id=(p_input->>'parentCaptureId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid for update;if not found then return'{"state":"not_found"}';end if;
  if v_parent.revision is distinct from(p_input->>'expectedParentRevision')::int then return'{"state":"capture_changed"}';end if;
  if v_parent.state in('queued','running')then return'{"state":"still_running"}';end if;
  if p_input->>'materialId'is distinct from coalesce(v_parent.material_id::text,v_parent.input->>'materialId')then return'{"state":"source_changed"}';end if;
 elsif p_input->'expectedParentRevision'is distinct from'null'::jsonb then raise exception 'A parent revision needs an exact capture';end if;
 insert into public.knowledge_web_captures(id,property_id,org_id,actor_id,input,input_hash,parent_capture_id)values(p_id,p_property_id,(v_start->>'orgId')::uuid,p_actor_id,p_input,public.knowledge_hash(p_input),v_parent.id);
 return public.knowledge_web_finish(p_id,p_property_id,p_actor_id,p_id,'requested',p_input,null,jsonb_build_object('captureState','queued'),jsonb_build_object('captureId',p_id,'captureState','queued','published',false));
end$$;
create function public.guard_knowledge_web_capture()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Website capture evidence is retained';end if;
 if coalesce(current_setting('p11.knowledge_web_scope',true),'')<>old.property_id::text then raise exception 'Use a recorded website capture decision';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.input,new.input_hash,new.parent_capture_id,new.capture_sequence,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.input,old.input_hash,old.parent_capture_id,old.capture_sequence,old.created_at)then raise exception 'Website request identity is immutable';end if;
 if(old.claim_token is not null and(new.claim_token,new.started_at)is distinct from(old.claim_token,old.started_at))or(old.receipt is not null and(new.receipt,new.receipt_hash,new.finished_at)is distinct from(old.receipt,old.receipt_hash,old.finished_at))or(old.accepted_version_id is not null and(new.accepted_version_id,new.material_id)is distinct from(old.accepted_version_id,old.material_id))then raise exception 'Website receipts are immutable';end if;
 new.revision:=old.revision+1;return new;
end$$;
create trigger knowledge_web_captures_guard before update or delete on public.knowledge_web_captures for each row execute function public.guard_knowledge_web_capture();
create function public.decide_knowledge_web_capture(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_kind text;v_capture public.knowledge_web_captures;v_before jsonb;v_result jsonb;v_material jsonb;v_child uuid;v_content text;
begin
 v_kind:=case p_input->>'operation'when'recover'then'recovered'when'stop'then'stopped'when'accept'then'reviewed'when'download'then'download_prepared'end;if v_kind is null then raise exception 'Choose a retained website decision';end if;
 v_start:=public.knowledge_web_start(p_id,p_property_id,p_actor_id,v_kind,p_input);if v_start->>'state'<>'new'then return v_start;end if;
 select *into v_capture from public.knowledge_web_captures where id=(p_input->>'captureId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid for update;if not found then return'{"state":"not_found"}';end if;
 if v_capture.revision is distinct from(p_input->>'expectedRevision')::int then return'{"state":"capture_changed"}';end if;
 v_before:=to_jsonb(v_capture)-'claim_token'-'receipt';v_result:=jsonb_build_object('captureId',v_capture.id,'captureState',v_capture.state,'published',false);
 perform set_config('p11.knowledge_web_scope',p_property_id::text,true);
 if v_kind in('stopped','recovered','download_prepared')then
  if p_input-array['captureId','expectedRevision','operation','reason']<>'{}'then raise exception 'Unexpected website control fields';end if;
  if v_kind='stopped'then
   if v_capture.state='stopped'or v_capture.accepted_version_id is not null then return'{"state":"closed_request"}';end if;
   update public.knowledge_web_captures set state='stopped'where id=v_capture.id;v_result:=v_result||'{"captureState":"stopped"}';
  elsif v_kind='download_prepared'then
   if jsonb_typeof(v_capture.receipt->'body')is distinct from'string'or v_capture.receipt->>'bodyHash'is null then return'{"state":"original_unavailable"}';end if;
   v_result:=v_result||jsonb_build_object('prepared',true,'bodyHash',v_capture.receipt->>'bodyHash');
  end if;
 else
  if p_input-array['captureId','expectedRevision','operation','reason','receiptHash','content','materialId','previousVersionId','confirmed']<>'{}'or not(p_input?&array['receiptHash','content','materialId','previousVersionId','confirmed'])or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Review the exact complete website capture';end if;
  if v_capture.state<>'ready'or v_capture.accepted_version_id is not null or v_capture.receipt_hash is distinct from p_input->>'receiptHash'then return'{"state":"capture_changed"}';end if;
  if p_input->>'materialId'is distinct from v_capture.input->>'materialId'then return'{"state":"source_changed"}';end if;
  v_content:=p_input->>'content';if jsonb_typeof(p_input->'content')is distinct from'string'or length(btrim(v_content))=0 or octet_length(v_content)>262144 then raise exception 'Review complete text up to 256 KiB; make any shorter correction explicitly';end if;
  v_child:=md5('knowledge-web-material:'||p_id::text)::uuid;
  v_material:=public.save_knowledge_material(v_child,p_property_id,p_actor_id,jsonb_build_object('materialId',p_input->'materialId','previousVersionId',p_input->'previousVersionId','title',v_capture.input->>'title','content',v_content,'reason',p_input->>'reason'));
  if v_material->>'state'not in('saved','replayed')then return v_material;end if;
  insert into public.knowledge_web_links(version_id,material_id,capture_id,decision_id,property_id,org_id,actor_id,receipt_hash,content_hash)values((v_material->>'versionId')::uuid,(v_material->>'materialId')::uuid,v_capture.id,p_id,p_property_id,v_capture.org_id,p_actor_id,v_capture.receipt_hash,encode(extensions.digest(v_content,'sha256'),'hex'));
  update public.knowledge_web_captures set accepted_version_id=(v_material->>'versionId')::uuid,material_id=(v_material->>'materialId')::uuid where id=v_capture.id;
  v_result:=v_result||jsonb_build_object('materialId',v_material->'materialId','versionId',v_material->'versionId');
 end if;
 return public.knowledge_web_finish(p_id,p_property_id,p_actor_id,v_capture.id,v_kind,p_input,v_before,(select to_jsonb(c)-'claim_token'-'receipt'from public.knowledge_web_captures c where id=v_capture.id),v_result);
end$$;
create function public.claim_knowledge_web_capture(p_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_capture public.knowledge_web_captures;v_token uuid;
begin
 select *into v_capture from public.knowledge_web_captures where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_capture.property_id::text,12));select *into v_capture from public.knowledge_web_captures where id=p_id for update;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=v_capture.property_id and p.org_id=v_capture.org_id and u.id=v_capture.actor_id and u.role in('admin','manager'))then return'{"state":"forbidden"}';end if;
 if v_capture.state<>'queued'then return jsonb_build_object('state',v_capture.state);end if;
 v_token:=gen_random_uuid();perform set_config('p11.knowledge_web_scope',v_capture.property_id::text,true);
 update public.knowledge_web_captures set state='running',claim_token=v_token,started_at=clock_timestamp()where id=p_id;
 perform public.knowledge_web_service_event(p_id,v_capture.property_id,v_capture.org_id,'knowledge.web.started',jsonb_build_object('captureId',p_id));
 return jsonb_build_object('state','invoke_once','claimToken',v_token,'url',v_capture.input->>'url');
end$$;
create function public.valid_knowledge_web_receipt(p_receipt jsonb,p_url text,p_started_at timestamptz)returns boolean language plpgsql stable security invoker set search_path=''as $$
begin
 return coalesce(p_receipt->>'recipe'='public-utf8-html-v1'and p_receipt->'complete'='true'::jsonb and p_receipt->>'requestedUrl'=p_url and p_receipt->>'finalUrl'~'^https?://[^[:space:]]+$'and(p_receipt->>'statusCode')::int between 200 and 299 and jsonb_typeof(p_receipt->'body')='string'and octet_length(p_receipt->>'body')between 1 and 1048576 and encode(extensions.digest(p_receipt->>'body','sha256'),'hex')=p_receipt->>'bodyHash'and jsonb_typeof(p_receipt->'text')='string'and octet_length(p_receipt->>'text')between 1 and 1048576 and length(btrim(p_receipt->>'text'))>0 and(p_receipt->>'fetchedAt')::timestamptz>=p_started_at-interval'5 minutes'and(p_receipt->>'fetchedAt')::timestamptz<=clock_timestamp()+interval'5 minutes',false);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end$$;
create function public.record_knowledge_web_capture(p_id uuid,p_claim_token uuid,p_receipt jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_capture public.knowledge_web_captures;v_state text;
begin
 select *into v_capture from public.knowledge_web_captures where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_capture.property_id::text,12));select *into v_capture from public.knowledge_web_captures where id=p_id for update;
 if p_claim_token is null or v_capture.claim_token is distinct from p_claim_token then return'{"state":"request_conflict"}';end if;
 if v_capture.receipt is not null then if v_capture.receipt<>p_receipt then return'{"state":"receipt_changed"}';end if;return jsonb_build_object('state',v_capture.state,'receiptHash',v_capture.receipt_hash);end if;
 if jsonb_typeof(p_receipt)is distinct from'object'or octet_length(p_receipt::text)>8388608 then raise exception 'Retain one bounded website receipt';end if;
 v_state:=case when v_capture.state='stopped'then'stopped'when public.valid_knowledge_web_receipt(p_receipt,v_capture.input->>'url',v_capture.started_at)and exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=v_capture.property_id and p.org_id=v_capture.org_id and u.id=v_capture.actor_id and u.role in('admin','manager'))then'ready'else'held'end;
 perform set_config('p11.knowledge_web_scope',v_capture.property_id::text,true);
 update public.knowledge_web_captures set state=v_state,receipt=p_receipt,receipt_hash=public.knowledge_hash(p_receipt),finished_at=clock_timestamp()where id=p_id;
 perform public.knowledge_web_service_event(p_id,v_capture.property_id,v_capture.org_id,'knowledge.web.received',jsonb_build_object('captureId',p_id,'captureState',v_state,'receiptHash',public.knowledge_hash(p_receipt),'complete',p_receipt->'complete'));
 return jsonb_build_object('state',v_state,'receiptHash',public.knowledge_hash(p_receipt));
end$$;
create function public.read_knowledge_web_captures(p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_role text;v_kind text:=coalesce(p_input->>'kind','captures');v_capture public.knowledge_web_captures;v_decision public.knowledge_web_decisions;v_rows jsonb;v_items jsonb;v_total int;v_hash text;v_offset int:=coalesce((p_input->>'offset')::int,0);
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if v_org is null then return'{"state":"forbidden"}';end if;
 if p_input-array['kind','captureId','decisionId','offset','expectedHash']<>'{}'or v_kind not in('captures','capture','decisions','decision')or v_offset not between 0 and 1000000 then raise exception 'Choose a valid retained website page';end if;
 if v_kind='decision'then select *into v_decision from public.knowledge_web_decisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=v_org and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return v_decision.result||'{"state":"ready"}';end if;
 if v_kind<>'captures'then
  select *into v_capture from public.knowledge_web_captures where id=(p_input->>'captureId')::uuid and property_id=p_property_id and org_id=v_org;if not found then return'{"state":"not_found"}';end if;
  if v_kind='capture'then return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'capture',to_jsonb(v_capture)-'claim_token','material',(select to_jsonb(m)from public.knowledge_materials m where id=coalesce(v_capture.material_id,(v_capture.input->>'materialId')::uuid)and property_id=p_property_id and org_id=v_org));end if;
 end if;
 if v_kind='captures'then select coalesce(jsonb_agg(to_jsonb(c)-'claim_token'-'receipt'order by c.capture_sequence desc),'[]')into v_rows from public.knowledge_web_captures c where property_id=p_property_id and org_id=v_org;
 else select coalesce(jsonb_agg((to_jsonb(d)-'input'-'before_state'-'after_state')||jsonb_build_object('reason',d.input->>'reason')order by d.decision_sequence desc),'[]')into v_rows from public.knowledge_web_decisions d where capture_id=v_capture.id and property_id=p_property_id and org_id=v_org;end if;
 v_total:=jsonb_array_length(v_rows);v_hash:=public.knowledge_hash(v_rows);if p_input?'expectedHash'and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v order by n),'[]')into v_items from jsonb_array_elements(v_rows)with ordinality p(v,n)where n>v_offset and n<=v_offset+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'items',v_items,'total',v_total,'historyHash',v_hash,'nextOffset',case when v_offset+20<v_total then v_offset+20 else null end);
end$$;

create function public.knowledge_version_web_origin(p_version_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 with recursive lineage as(select id,previous_version_id,0 depth from public.knowledge_material_versions where id=p_version_id union all select v.id,v.previous_version_id,l.depth+1 from public.knowledge_material_versions v join lineage l on v.id=l.previous_version_id)
 select case when w.version_id is not null then jsonb_build_object('captureId',w.capture_id,'versionId',w.version_id,'receiptHash',w.receipt_hash,'url',c.receipt->>'finalUrl','requestedUrl',c.input->>'url','fetchedAt',c.receipt->>'fetchedAt','bodyHash',c.receipt->>'bodyHash','inherited',w.version_id<>p_version_id)end
 from lineage a left join public.knowledge_web_links w on w.version_id=a.id left join public.knowledge_file_links f on f.version_id=a.id left join public.knowledge_web_captures c on c.id=w.capture_id where w.version_id is not null or f.version_id is not null order by a.depth limit 1
$$;
create or replace function public.knowledge_version_file_origin(p_version_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 with recursive lineage as(select id,previous_version_id,0 depth from public.knowledge_material_versions where id=p_version_id union all select v.id,v.previous_version_id,l.depth+1 from public.knowledge_material_versions v join lineage l on v.id=l.previous_version_id)
 select case when f.version_id is not null then jsonb_build_object('fileId',o.id,'fileName',o.input->>'fileName','byteHash',o.input->>'byteHash','versionId',f.version_id,'extractionId',f.extraction_id,'receiptHash',f.receipt_hash,'inherited',f.version_id<>p_version_id)end
 from lineage a left join public.knowledge_file_links f on f.version_id=a.id left join public.knowledge_web_links w on w.version_id=a.id left join public.knowledge_files o on o.id=f.file_id where f.version_id is not null or w.version_id is not null order by a.depth limit 1
$$;
create or replace function public.cancel_unused_knowledge_decision(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_web public.knowledge_web_decisions;v_unit public.property_unit_decisions;v_fact public.assistant_fact_decisions;v_file public.knowledge_file_decisions;v_org uuid;v_prior public.knowledge_material_decisions;v_cancelled public.knowledge_cancelled_decisions;v_event jsonb;v_event_id uuid:=md5('knowledge-cancel:'||p_id::text)::uuid;
begin
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if v_org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or p_input-array['inputHash','reason']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 then raise exception 'Review the unused request before cancelling';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=v_org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,886));
 select *into v_web from public.knowledge_web_decisions where id=p_id;if found then if(v_web.property_id,v_web.org_id,v_web.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_web.result||'{"state":"replayed","decisionDomain":"knowledge_web"}';end if;
 select *into v_unit from public.property_unit_decisions where id=p_id;
 if found then if(v_unit.property_id,v_unit.org_id,v_unit.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_unit.result||'{"state":"replayed","decisionDomain":"property_units"}';end if;
 select *into v_file from public.knowledge_file_decisions where id=p_id;
 if found then if(v_file.property_id,v_file.org_id,v_file.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_file.result||'{"state":"replayed","decisionDomain":"knowledge_files"}';end if;
 select *into v_fact from public.assistant_fact_decisions where id=p_id;
 if found then if(v_fact.property_id,v_fact.org_id,v_fact.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_fact.result||'{"state":"replayed","cancelled":false,"decisionDomain":"assistant_facts"}';end if;
 select *into v_prior from public.knowledge_material_decisions where id=p_id;
 if found then if(v_prior.property_id,v_prior.org_id,v_prior.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_prior.result||'{"state":"replayed","cancelled":false}';end if;
 select *into v_cancelled from public.knowledge_cancelled_decisions where id=p_id;
 if found then if(v_cancelled.property_id,v_cancelled.org_id,v_cancelled.actor_id,v_cancelled.input_hash,v_cancelled.reason)is distinct from(p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason')then return'{"state":"request_conflict"}';end if;return'{"state":"cancelled","cancelled":true}';end if;
 insert into public.knowledge_cancelled_decisions(id,property_id,org_id,actor_id,input_hash,reason)values(p_id,p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason');
 v_event:=public.append_shared_action_event(v_event_id,v_event_id,p_property_id,p_actor_id,'knowledge','knowledge.decision.cancelled','server_confirmed','succeeded',jsonb_build_object('unusedRequestId',p_id,'browserInputHash',p_input->>'inputHash'),null,null,'{"cancelled":true}');
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Cancellation history could not be saved';end if;
 return'{"state":"cancelled","cancelled":true}';
end$$;
create or replace function public.read_knowledge_materials(p_property_id uuid,p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
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
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',v_role in('admin','manager'),'historyHash',v_hash,'material',to_jsonb(v_source),'version',to_jsonb(v_exact)-'input','fileOrigin',public.knowledge_version_file_origin(v_exact.id),'webOrigin',public.knowledge_version_web_origin(v_exact.id),'search',v_selected);
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
create or replace function public.release_knowledge_material(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_web jsonb;v_start jsonb;v_source public.knowledge_materials;v_version public.knowledge_material_versions;v_run public.knowledge_embedding_requests;v_kind text;v_active uuid;v_count int:=0;v_before jsonb;v_now timestamptz:=clock_timestamp();
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
 v_web:=public.knowledge_version_web_origin(v_version.id);
 v_before:=jsonb_build_object('activeVersionId',v_source.active_version_id,'releaseId',v_source.last_release_id);
 perform set_config('p11.knowledge_scope',v_source.id::text,true);
 delete from public.documents where property_id=p_property_id and metadata->>'knowledge_material_id'=v_source.id::text;
 if v_active is not null then
  insert into public.documents(id,property_id,content,metadata,embedding)
   select md5(v_version.id::text||':'||(ch.ordinality-1)::text)::uuid,p_property_id,ch.value#>>'{}',jsonb_build_object('title',v_version.title,'source','knowledge:'||v_source.id::text,'knowledge_material_id',v_source.id,'knowledge_source_id',v_source.id,'ingestion_run_id',v_version.id,'version_id',v_version.id,'chunk_index',ch.ordinality-1,'content_hash',v_version.content_hash),(e.value->'embedding')::text::public.vector
   from jsonb_array_elements(v_run.model_input->'chunks')with ordinality ch(value,ordinality)join jsonb_array_elements(v_run.raw_result->'response'->'data')e(value)on(e.value->>'index')::int=ch.ordinality-1;
 end if;
 insert into public.knowledge_sources(id,property_id,source_type,source_url,source_name,status,documents_created,extracted_data,processing_notes,last_synced_at,updated_at)values(v_source.id,p_property_id,case when v_web is null then'manual'else'website'end,v_web->>'url',v_version.title,case when v_active is null then'withdrawn'else'completed'end,v_count,jsonb_build_object('knowledge_material_id',v_source.id,'active_version_id',v_active,'last_release_id',p_id,'content_hash',v_version.content_hash,'web_origin',v_web),'Reviewed text publication; assistant facts require a separate refresh.',case when v_web is null then v_now else(v_web->>'fetchedAt')::timestamptz end,v_now)
 on conflict(id)do update set source_type=excluded.source_type,source_url=excluded.source_url,source_name=excluded.source_name,status=excluded.status,documents_created=excluded.documents_created,extracted_data=excluded.extracted_data,processing_notes=excluded.processing_notes,last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at;
 update public.knowledge_materials set active_version_id=v_active,last_release_id=p_id,updated_at=v_now where id=v_source.id;
 update public.property_chatbot_contexts set status='stale',stale_at=v_now,last_change_summary='Reviewed knowledge publication changed; refresh assistant facts before using this version.',version=version+1,updated_at=v_now where property_id=p_property_id;
 perform set_config('p11.knowledge_scope','',true);
 return public.knowledge_decision_finish(p_id,p_property_id,p_actor_id,v_source.id,v_kind,p_input,v_before,jsonb_build_object('activeVersionId',v_active,'releaseId',p_id),jsonb_build_object('materialId',v_source.id,'versionId',v_version.id,'activeVersionId',v_active,'releaseId',p_id,'published',v_active is not null,'chunks',v_count,'assistantRefreshRequired',true));
end$$;
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.knowledge_web_start(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;grant execute on function public.knowledge_web_start(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.knowledge_web_finish(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;grant execute on function public.knowledge_web_finish(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.knowledge_web_service_event(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;grant execute on function public.knowledge_web_service_event(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.begin_knowledge_web_capture(uuid,uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.begin_knowledge_web_capture(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.guard_knowledge_web_capture() from public,anon,authenticated;grant execute on function public.guard_knowledge_web_capture() to service_role;
revoke all on function public.decide_knowledge_web_capture(uuid,uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.decide_knowledge_web_capture(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.claim_knowledge_web_capture(uuid) from public,anon,authenticated;grant execute on function public.claim_knowledge_web_capture(uuid) to service_role;
revoke all on function public.valid_knowledge_web_receipt(jsonb,text,timestamptz) from public,anon,authenticated;grant execute on function public.valid_knowledge_web_receipt(jsonb,text,timestamptz) to service_role;
revoke all on function public.record_knowledge_web_capture(uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.record_knowledge_web_capture(uuid,uuid,jsonb) to service_role;
revoke all on function public.read_knowledge_web_captures(uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.read_knowledge_web_captures(uuid,uuid,jsonb) to service_role;
revoke all on function public.knowledge_version_web_origin(uuid) from public,anon,authenticated;grant execute on function public.knowledge_version_web_origin(uuid) to service_role;
revoke all on function public.knowledge_version_file_origin(uuid) from public,anon,authenticated;grant execute on function public.knowledge_version_file_origin(uuid) to service_role;
revoke all on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.read_knowledge_materials(uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.read_knowledge_materials(uuid,uuid,jsonb) to service_role;
revoke all on function public.release_knowledge_material(uuid,uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.release_knowledge_material(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
