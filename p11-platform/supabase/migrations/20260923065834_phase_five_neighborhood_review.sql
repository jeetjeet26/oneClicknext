-- Private reviewed neighborhood sources. Drafts never change approved marketing facts.
create table public.neighborhood_workspaces(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),revision bigint not null default 1,archived boolean not null default false,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create index neighborhood_workspace_property on public.neighborhood_workspaces(property_id,org_id,id);
create table public.neighborhood_versions(
 id uuid primary key,point_id uuid not null references public.neighborhood_workspaces(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),draft jsonb not null,version_sequence bigint generated always as identity,created_at timestamptz not null default clock_timestamp());
create index neighborhood_version_point on public.neighborhood_versions(point_id,version_sequence desc);
create index neighborhood_version_property on public.neighborhood_versions(property_id,org_id,version_sequence desc);
create table public.neighborhood_decisions(
 id uuid primary key,point_id uuid not null references public.neighborhood_workspaces(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),kind text not null check(kind in('saved','approved','rejected','withdrawn','archived','restored')),input jsonb not null,input_hash text not null,before_state jsonb not null,after_state jsonb not null,result jsonb not null,decision_sequence bigint generated always as identity,created_at timestamptz not null default clock_timestamp());
create index neighborhood_decision_property on public.neighborhood_decisions(property_id,org_id,decision_sequence desc);
create index neighborhood_decision_point on public.neighborhood_decisions(point_id,decision_sequence desc);
create table public.neighborhood_cancellations(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),input_hash text not null,reason text not null,created_at timestamptz not null default clock_timestamp());
alter table public.neighborhood_workspaces enable row level security;
alter table public.neighborhood_versions enable row level security;
alter table public.neighborhood_decisions enable row level security;
alter table public.neighborhood_cancellations enable row level security;
revoke all on public.neighborhood_workspaces,public.neighborhood_versions,public.neighborhood_decisions,public.neighborhood_cancellations,public.property_points_of_interest from public,anon,authenticated;
grant all on public.neighborhood_workspaces,public.neighborhood_versions,public.neighborhood_decisions,public.neighborhood_cancellations to service_role;
grant usage,select on sequence public.neighborhood_versions_version_sequence_seq,public.neighborhood_decisions_decision_sequence_seq to service_role;
create function public.guard_neighborhood_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Retain neighborhood review evidence';end$$;
create trigger neighborhood_version_immutable before update or delete on public.neighborhood_versions for each row execute function public.guard_neighborhood_history();
create trigger neighborhood_decision_immutable before update or delete on public.neighborhood_decisions for each row execute function public.guard_neighborhood_history();
create trigger neighborhood_cancellation_immutable before update or delete on public.neighborhood_cancellations for each row execute function public.guard_neighborhood_history();
create function public.guard_neighborhood_review()returns trigger language plpgsql security invoker set search_path=''as $$
declare prop uuid:=case when tg_op='DELETE'then old.property_id else new.property_id end;pid uuid:=case when tg_op='DELETE'then old.id else new.id end;
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=prop)then return old;end if;
 if tg_table_name='neighborhood_workspaces'or exists(select 1 from public.neighborhood_workspaces where id=pid)then
  if tg_op='DELETE'then raise exception 'Archive the neighborhood source instead';end if;
  if current_setting('p11.neighborhood_review_scope',true)is distinct from prop::text then raise exception 'Use a recorded neighborhood decision';end if;
  if tg_op='UPDATE'and(new.id,new.property_id,new.org_id,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.created_at)then raise exception 'Neighborhood review identity is immutable';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger neighborhood_workspace_guard before insert or update or delete on public.neighborhood_workspaces for each row execute function public.guard_neighborhood_review();
create trigger neighborhood_content_guard before insert or update or delete on public.property_points_of_interest for each row execute function public.guard_neighborhood_review();
create function public.neighborhood_point_draft(p_row public.property_points_of_interest)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('name',p_row.name,'category',p_row.category,'address',p_row.address,'latitude',p_row.latitude,'longitude',p_row.longitude,'distanceMiles',p_row.distance_miles,'travelTimeMinutes',p_row.travel_time_minutes,'sourceUrl',coalesce(p_row.source_url,''),'capturedAt',p_row.captured_at,'confidence',p_row.confidence)
$$;
create function public.valid_neighborhood_draft(p_draft jsonb,p_complete boolean default false)returns boolean language plpgsql stable security invoker set search_path=''as $$
declare k text;v numeric;t timestamptz;
begin
 if jsonb_typeof(p_draft)is distinct from'object'or p_draft-array['name','category','address','latitude','longitude','distanceMiles','travelTimeMinutes','sourceUrl','capturedAt','confidence']<>'{}'or not(p_draft?&array['name','category','address','latitude','longitude','distanceMiles','travelTimeMinutes','sourceUrl','capturedAt','confidence'])then return false;end if;
 if jsonb_typeof(p_draft->'name')is distinct from'string'or length(p_draft->>'name')>300 or jsonb_typeof(p_draft->'category')is distinct from'string'or length(p_draft->>'category')>100 or jsonb_typeof(p_draft->'address')is distinct from'object'or octet_length((p_draft->'address')::text)>8192 or jsonb_typeof(p_draft->'sourceUrl')is distinct from'string'or length(p_draft->>'sourceUrl')>4000 or(p_draft->>'sourceUrl'<>''and p_draft->>'sourceUrl'!~'^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$')then return false;end if;
 foreach k in array array['latitude','longitude','distanceMiles','travelTimeMinutes','confidence']loop
  if p_draft->k<>'null'::jsonb then
   if jsonb_typeof(p_draft->k)is distinct from'number'then return false;end if;v:=(p_draft->>k)::numeric;
   if(k='latitude'and(v not between -90 and 90 or v<>round(v,6)))or(k='longitude'and(v not between -180 and 180 or v<>round(v,6)))or(k='distanceMiles'and(v not between 0 and 999999.99 or v<>round(v,2)))or(k='travelTimeMinutes'and(v not between 0 and 2147483647 or v<>trunc(v)))or(k='confidence'and(v not between 0 and 1 or v<>round(v,4)))then return false;end if;
  end if;
 end loop;
 if(p_draft->'latitude'='null'::jsonb)is distinct from(p_draft->'longitude'='null'::jsonb)then return false;end if;
 if p_draft->'capturedAt'<>'null'::jsonb then if jsonb_typeof(p_draft->'capturedAt')is distinct from'string'or p_draft->>'capturedAt'!~'(Z|[+-][0-9]{2}:[0-9]{2})$'then return false;end if;t:=(p_draft->>'capturedAt')::timestamptz;if not isfinite(t)then return false;end if;end if;
 if p_complete and(length(btrim(p_draft->>'name'))=0 or length(btrim(p_draft->>'category'))=0 or p_draft->>'sourceUrl'=''or p_draft->'capturedAt'='null'::jsonb or t>clock_timestamp()or p_draft->'confidence'='null'::jsonb)then return false;end if;return true;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end$$;
create function public.neighborhood_point_state(p_point_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('workspace',(select to_jsonb(w)from public.neighborhood_workspaces w where id=p_point_id),'point',(select to_jsonb(p)from public.property_points_of_interest p where id=p_point_id),'latestVersion',(select to_jsonb(v)from public.neighborhood_versions v where point_id=p_point_id order by version_sequence desc limit 1),'latestReview',(select jsonb_build_object('id',d.id,'kind',d.kind,'versionId',d.input->>'versionId')from public.neighborhood_decisions d where point_id=p_point_id and kind in('approved','rejected')order by decision_sequence desc limit 1))
$$;
create function public.neighborhood_approved_rows(p_property_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select coalesce(jsonb_agg(to_jsonb(p)order by p.id),'[]')from public.property_points_of_interest p join public.properties a on a.id=p.property_id and a.org_id=p.org_id where p.property_id=p_property_id and p.approval_status='approved'and not exists(select 1 from public.neighborhood_workspaces w where w.id=p.id and(w.archived or w.org_id<>p.org_id))
$$;
create function public.neighborhood_snapshot_matches_current(p_property_id uuid,p_org_id uuid,p_rows jsonb)returns boolean language plpgsql stable security invoker set search_path=''as $$
declare expected jsonb;
begin
 if jsonb_typeof(p_rows)is distinct from'array'or not exists(select 1 from public.properties where id=p_property_id and org_id=p_org_id)or exists(select 1 from public.property_points_of_interest where property_id=p_property_id and org_id<>p_org_id)or exists(select 1 from public.neighborhood_workspaces where property_id=p_property_id and org_id<>p_org_id)then return false;end if;
 select coalesce(jsonb_agg(to_jsonb(p)order by p.id),'[]')into expected from jsonb_populate_recordset(null::public.property_points_of_interest,p_rows)p;
 return expected=public.neighborhood_approved_rows(p_property_id);
exception when others then return false;
end$$;
create function public.read_neighborhood_publication_source(p_property_id uuid,p_org_id uuid,p_expected jsonb default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare rows jsonb;
begin
 if not exists(select 1 from public.properties where id=p_property_id and org_id=p_org_id)or exists(select 1 from public.property_points_of_interest where property_id=p_property_id and org_id<>p_org_id)or exists(select 1 from public.neighborhood_workspaces where property_id=p_property_id and org_id<>p_org_id)then return'{"state":"scope_changed"}';end if;
 if p_expected is not null and not public.neighborhood_snapshot_matches_current(p_property_id,p_org_id,p_expected)then return'{"state":"source_changed"}';end if;
 rows:=public.neighborhood_approved_rows(p_property_id);return jsonb_build_object('state','ready','propertyId',p_property_id,'items',rows,'contentHash',public.knowledge_hash(rows),'total',(select count(*)from public.property_points_of_interest where property_id=p_property_id));
end$$;
create function public.guard_readiness_neighborhood_basis()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if exists(select 1 from public.neighborhood_workspaces where property_id=new.property_id)and new.status in('approved','ready','needs_review')and not public.neighborhood_snapshot_matches_current(new.property_id,new.org_id,coalesce(new.snapshot_payload->'pointsOfInterest','[]'))then
  if new.status='approved'then raise exception 'Neighborhood sources changed; rebuild and review readiness';end if;new.status:='stale';
 end if;return new;
end$$;
create trigger readiness_neighborhood_basis before insert or update on public.property_onboarding_snapshots for each row execute function public.guard_readiness_neighborhood_basis();
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'neighborhood.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid neighborhood review evidence';end if;
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

create function public.decide_neighborhood_review(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare org uuid;op text:=p_input->>'operation';pid uuid;decision_kind text;d public.neighborhood_decisions;c public.neighborhood_cancellations;w public.neighborhood_workspaces;r public.property_points_of_interest;v public.neighborhood_versions;draft jsonb;before_value jsonb;after_value jsonb;result jsonb;event jsonb;stale jsonb:='[]';eid uuid;
begin
 select p.org_id into org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>32768 or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(p_input->>'reason'))not between 3 and 2000 or op is null or op not in('save','approve','reject','withdraw','archive','restore','cancel_unused')then raise exception 'Review the neighborhood decision and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,935));
 if exists(select 1 from public.neighborhood_workspaces where property_id=p_property_id and org_id<>org)or exists(select 1 from public.property_points_of_interest where property_id=p_property_id and org_id<>org)then return'{"state":"scope_changed"}';end if;
 select *into d from public.neighborhood_decisions where id=p_id;
 if found then if(d.property_id,d.org_id,d.actor_id)is distinct from(p_property_id,org,p_actor_id)or(op<>'cancel_unused'and d.input<>p_input)then return'{"state":"request_conflict"}';end if;return d.result||'{"state":"replayed"}';end if;
 select *into c from public.neighborhood_cancellations where id=p_id;
 if found then if op<>'cancel_unused'then return'{"state":"decision_cancelled"}';end if;if(c.property_id,c.org_id,c.actor_id,c.input_hash,c.reason)is distinct from(p_property_id,org,p_actor_id,p_input->>'inputHash',p_input->>'reason')then return'{"state":"request_conflict"}';end if;return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);end if;
 if op='cancel_unused'then
  if p_input-array['operation','reason','inputHash']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the unused request digest';end if;
  insert into public.neighborhood_cancellations(id,property_id,org_id,actor_id,input_hash,reason)values(p_id,p_property_id,org,p_actor_id,p_input->>'inputHash',p_input->>'reason');eid:=md5('neighborhood-cancel:'||p_id::text)::uuid;
  event:=public.append_shared_action_event(eid,eid,p_property_id,p_actor_id,'property','neighborhood.cancelled','server_confirmed','succeeded',jsonb_build_object('unusedRequestId',p_id,'browserInputHash',p_input->>'inputHash'),null,null,'{"cancelled":true}');if event->>'state'not in('recorded','replayed')then raise exception 'Neighborhood activity unavailable';end if;
  return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);
 end if;
 pid:=coalesce((p_input->>'pointId')::uuid,p_id);
 select *into w from public.neighborhood_workspaces where id=pid;select *into r from public.property_points_of_interest where id=pid;
 if(w.id is not null and(w.property_id,w.org_id)is distinct from(p_property_id,org))or(r.id is not null and(r.property_id,r.org_id)is distinct from(p_property_id,org))then return'{"state":"not_found"}';end if;
 if p_input->>'pointId'is not null and w.id is null and r.id is null then return'{"state":"not_found"}';end if;
 if p_input->>'pointId'is null and(op<>'save'or w.id is not null or r.id is not null)then return'{"state":"request_conflict"}';end if;
 before_value:=public.neighborhood_point_state(pid);
 if p_input->>'expectedStateHash'is distinct from public.knowledge_hash(before_value)then return'{"state":"source_changed"}';end if;
 if op='save'then
  if p_input-array['operation','reason','pointId','expectedStateHash','draft']<>'{}'or not public.valid_neighborhood_draft(p_input->'draft')then raise exception 'Review the supported neighborhood fields';end if;
  if coalesce(w.archived,false)then return'{"state":"archived"}';end if;decision_kind:='saved';
 elsif op in('approve','reject')then
  if p_input-array['operation','reason','pointId','expectedStateHash','versionId','confirmed']<>'{}'or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Confirm the exact saved neighborhood draft';end if;
  select *into v from public.neighborhood_versions where id=(p_input->>'versionId')::uuid and point_id=pid and property_id=p_property_id and org_id=org;
  if not found or coalesce(w.archived,false)or exists(select 1 from public.neighborhood_versions where point_id=pid and version_sequence>v.version_sequence)or exists(select 1 from public.neighborhood_decisions where point_id=pid and kind in('approved','rejected')and input->>'versionId'=v.id::text)then return'{"state":"version_not_current"}';end if;
  draft:=v.draft;if op='approve'and not public.valid_neighborhood_draft(draft,true)then return'{"state":"review_incomplete"}';end if;decision_kind:=case op when'approve'then'approved'else'rejected'end;
 else
  if p_input-array['operation','reason','pointId','expectedStateHash','confirmed']<>'{}'or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Confirm the saved neighborhood source change';end if;
  if(op='restore'and not coalesce(w.archived,false))or(op in('withdraw','archive')and coalesce(w.archived,false))or(op='withdraw'and r.approval_status is distinct from'approved')then return'{"state":"version_not_current"}';end if;
  decision_kind:=case op when'withdraw'then'withdrawn'when'archive'then'archived'else'restored'end;
 end if;
 perform set_config('p11.neighborhood_review_scope',p_property_id::text,true);
 insert into public.neighborhood_workspaces(id,property_id,org_id)values(pid,p_property_id,org)on conflict(id)do update set revision=neighborhood_workspaces.revision+1,updated_at=clock_timestamp();
 if op='save'then
  insert into public.neighborhood_versions(id,point_id,property_id,org_id,actor_id,draft)values(p_id,pid,p_property_id,org,p_actor_id,p_input->'draft');
 elsif op='approve'then
  insert into public.property_points_of_interest(id,property_id,org_id,name,category,address,latitude,longitude,distance_miles,travel_time_minutes,source_url,captured_at,confidence,approval_status,approved_by,approved_at)
  values(pid,p_property_id,org,draft->>'name',draft->>'category',draft->'address',(draft->>'latitude')::numeric,(draft->>'longitude')::numeric,(draft->>'distanceMiles')::numeric,(draft->>'travelTimeMinutes')::int,draft->>'sourceUrl',(draft->>'capturedAt')::timestamptz,(draft->>'confidence')::numeric,'approved',p_actor_id,clock_timestamp())
  on conflict(id)do update set name=excluded.name,category=excluded.category,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,distance_miles=excluded.distance_miles,travel_time_minutes=excluded.travel_time_minutes,source_url=excluded.source_url,captured_at=excluded.captured_at,confidence=excluded.confidence,approval_status='approved',approved_by=excluded.approved_by,approved_at=excluded.approved_at;
 elsif op in('withdraw','archive')then
  update public.property_points_of_interest set approval_status='pending'where id=pid and approval_status='approved';
 end if;
 if op in('archive','restore')then update public.neighborhood_workspaces set archived=(op='archive')where id=pid;end if;
 if op='approve'or(op in('withdraw','archive')and r.approval_status='approved')then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'contentHash',content_hash)order by id),'[]')into stale from public.property_onboarding_snapshots where property_id=p_property_id and status in('approved','ready','needs_review');
  update public.property_onboarding_snapshots set status='stale'where property_id=p_property_id and status in('approved','ready','needs_review');
 end if;
 after_value:=public.neighborhood_point_state(pid)||jsonb_build_object('invalidatedReadiness',stale);
 if op in('approve','reject')then after_value:=after_value||jsonb_build_object('latestReview',jsonb_build_object('id',p_id,'kind',decision_kind,'versionId',v.id));end if;
 result:=jsonb_build_object('state','saved','propertyId',p_property_id,'decisionId',p_id,'pointId',pid,'versionId',case when op='save'then p_id else v.id end,'kind',decision_kind,'staleReadinessCount',jsonb_array_length(stale),'published',false);
 insert into public.neighborhood_decisions(id,point_id,property_id,org_id,actor_id,kind,input,input_hash,before_state,after_state,result)values(p_id,pid,p_property_id,org,p_actor_id,decision_kind,p_input,public.knowledge_hash(p_input),before_value,after_value,result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property','neighborhood.'||decision_kind,'server_confirmed','succeeded',jsonb_build_object('pointId',pid,'inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(before_value)),jsonb_build_object('hash',public.knowledge_hash(after_value)),result);
 if event->>'state'not in('recorded','replayed')then raise exception 'Neighborhood activity unavailable';end if;
 perform set_config('p11.neighborhood_review_scope','',true);return result;
end$$;
create function public.read_neighborhood_reviews(p_property_id uuid,p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare org uuid;role text;v_read_kind text:=coalesce(p_input->>'kind','points');off int:=coalesce((p_input->>'offset')::int,0);pid uuid:=(p_input->>'pointId')::uuid;state_value jsonb;rows jsonb;items jsonb;total int;hash text;d public.neighborhood_decisions;v public.neighborhood_versions;
begin
 select p.org_id,u.role into org,role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if org is null then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','pointId','versionId','decisionId','offset','expectedHash']<>'{}'or v_read_kind not in('points','point','versions','version','history','history_detail','decision')or off not between 0 and 1000000 then raise exception 'Choose a neighborhood source or review history page';end if;
 if exists(select 1 from public.neighborhood_workspaces where property_id=p_property_id and org_id<>org)or exists(select 1 from public.property_points_of_interest where property_id=p_property_id and org_id<>org)then return'{"state":"scope_changed"}';end if;
 if v_read_kind in('decision','history_detail')then
  select *into d from public.neighborhood_decisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=org and(v_read_kind='history_detail'or actor_id=p_actor_id);if not found then return'{"state":"not_found"}';end if;
  if v_read_kind='decision'then return d.result||'{"state":"ready"}';end if;return jsonb_build_object('state','ready','propertyId',p_property_id,'decision',to_jsonb(d));
 end if;
 if v_read_kind in('point','versions','version')then
  if not exists(select 1 from public.neighborhood_workspaces where id=pid and property_id=p_property_id and org_id=org)and not exists(select 1 from public.property_points_of_interest where id=pid and property_id=p_property_id and org_id=org)then return'{"state":"not_found"}';end if;
  state_value:=public.neighborhood_point_state(pid);
  if v_read_kind='point'then return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(role in('admin','manager'),false),'pointId',pid,'source',state_value,'stateHash',public.knowledge_hash(state_value),'draft',coalesce(state_value->'latestVersion'->'draft',(select public.neighborhood_point_draft(p)from public.property_points_of_interest p where id=pid)));end if;
  if v_read_kind='version'then select *into v from public.neighborhood_versions where id=(p_input->>'versionId')::uuid and point_id=pid;if not found then return'{"state":"not_found"}';end if;return jsonb_build_object('state','ready','propertyId',p_property_id,'version',to_jsonb(v));end if;
 end if;
 if v_read_kind='history'then select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'pointId',x.point_id,'kind',x.kind,'actorId',x.actor_id,'createdAt',x.created_at,'reason',x.input->>'reason')order by decision_sequence desc),'[]')into rows from public.neighborhood_decisions x where property_id=p_property_id and org_id=org;
 elsif v_read_kind='versions'then select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.draft->>'name','createdAt',x.created_at,'actorId',x.actor_id)order by version_sequence desc),'[]')into rows from public.neighborhood_versions x where point_id=pid;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',coalesce(r.name,(select draft->>'name'from public.neighborhood_versions where point_id=x.id order by version_sequence desc limit 1),''),'draftName',(select draft->>'name'from public.neighborhood_versions where point_id=x.id order by version_sequence desc limit 1),'category',r.category,'approvalStatus',coalesce(r.approval_status,'draft'),'archived',coalesce(w.archived,false),'recorded',w.id is not null,'stateHash',public.knowledge_hash(public.neighborhood_point_state(x.id)))order by x.id),'[]')into rows
  from(select id from public.neighborhood_workspaces where property_id=p_property_id union select id from public.property_points_of_interest where property_id=p_property_id)x left join public.property_points_of_interest r on r.id=x.id left join public.neighborhood_workspaces w on w.id=x.id;
 end if;
 total:=jsonb_array_length(rows);hash:=public.knowledge_hash(rows);if p_input?'expectedHash'and p_input->>'expectedHash'is distinct from hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(p.v order by n),'[]')into items from jsonb_array_elements(rows)with ordinality p(v,n)where n>off and n<=off+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(role in('admin','manager'),false),'items',items,'total',total,'nextOffset',case when off+20<total then off+20 else null end,'pageHash',hash,'emptyStateHash',public.knowledge_hash(public.neighborhood_point_state(null)),'approvedCount',jsonb_array_length(public.neighborhood_approved_rows(p_property_id)));
end$$;
revoke all on function public.guard_neighborhood_history()from public,anon,authenticated;grant execute on function public.guard_neighborhood_history()to service_role;
revoke all on function public.guard_neighborhood_review()from public,anon,authenticated;grant execute on function public.guard_neighborhood_review()to service_role;
revoke all on function public.neighborhood_point_draft(public.property_points_of_interest)from public,anon,authenticated;grant execute on function public.neighborhood_point_draft(public.property_points_of_interest)to service_role;
revoke all on function public.valid_neighborhood_draft(jsonb,boolean)from public,anon,authenticated;grant execute on function public.valid_neighborhood_draft(jsonb,boolean)to service_role;
revoke all on function public.neighborhood_point_state(uuid)from public,anon,authenticated;grant execute on function public.neighborhood_point_state(uuid)to service_role;
revoke all on function public.neighborhood_approved_rows(uuid)from public,anon,authenticated;grant execute on function public.neighborhood_approved_rows(uuid)to service_role;
revoke all on function public.neighborhood_snapshot_matches_current(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.neighborhood_snapshot_matches_current(uuid,uuid,jsonb)to service_role;
revoke all on function public.read_neighborhood_publication_source(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.read_neighborhood_publication_source(uuid,uuid,jsonb)to service_role;
revoke all on function public.guard_readiness_neighborhood_basis()from public,anon,authenticated;grant execute on function public.guard_readiness_neighborhood_basis()to service_role;
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated;grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)to service_role;
revoke all on function public.decide_neighborhood_review(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.decide_neighborhood_review(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.read_neighborhood_reviews(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.read_neighborhood_reviews(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
