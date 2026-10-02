create table public.property_unit_workspaces(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),created_by uuid not null references public.profiles(id),latest_version_id uuid,applied_version_id uuid,reviewed_version_id uuid,review_outcome text check(review_outcome in('approved','rejected')),last_decision_id uuid,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create table public.property_unit_versions(id uuid primary key,unit_id uuid not null references public.property_unit_workspaces(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),version_sequence bigint generated always as identity unique,parent_version_id uuid references public.property_unit_versions(id),copied_from_version_id uuid references public.property_unit_versions(id),property_type text,data jsonb not null,data_hash text not null,base_unit jsonb not null,base_unit_hash text not null,created_at timestamptz not null default clock_timestamp());
create table public.property_unit_decisions(id uuid primary key,unit_id uuid not null references public.property_unit_workspaces(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),decision_sequence bigint generated always as identity unique,kind text not null,input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.property_unit_workspaces add foreign key(latest_version_id)references public.property_unit_versions(id)deferrable initially deferred;
alter table public.property_unit_workspaces add foreign key(applied_version_id)references public.property_unit_versions(id)deferrable initially deferred;
alter table public.property_unit_workspaces add foreign key(reviewed_version_id)references public.property_unit_versions(id)deferrable initially deferred;
revoke insert,update,delete on public.property_units,public.property_price_history from anon,authenticated;
alter table public.property_unit_workspaces add foreign key(last_decision_id)references public.property_unit_decisions(id)deferrable initially deferred;
alter table public.property_unit_workspaces enable row level security;
revoke all on public.property_unit_workspaces from public,anon,authenticated;
grant all on public.property_unit_workspaces to service_role;
create policy property_unit_workspaces_service on public.property_unit_workspaces for all to service_role using(true)with check(true);
create index property_unit_workspaces_idx_0 on public.property_unit_workspaces(property_id,updated_at desc);
create index property_unit_workspaces_idx_1 on public.property_unit_workspaces(org_id);
create index property_unit_workspaces_idx_2 on public.property_unit_workspaces(created_by);
create index property_unit_workspaces_idx_3 on public.property_unit_workspaces(latest_version_id);
create index property_unit_workspaces_idx_4 on public.property_unit_workspaces(applied_version_id);
create index property_unit_workspaces_idx_5 on public.property_unit_workspaces(reviewed_version_id);
create index property_unit_workspaces_idx_6 on public.property_unit_workspaces(last_decision_id);
alter table public.property_unit_versions enable row level security;
revoke all on public.property_unit_versions from public,anon,authenticated;
grant all on public.property_unit_versions to service_role;
create policy property_unit_versions_service on public.property_unit_versions for all to service_role using(true)with check(true);
create index property_unit_versions_idx_0 on public.property_unit_versions(unit_id,version_sequence desc);
create index property_unit_versions_idx_1 on public.property_unit_versions(property_id);
create index property_unit_versions_idx_2 on public.property_unit_versions(org_id);
create index property_unit_versions_idx_3 on public.property_unit_versions(actor_id);
create index property_unit_versions_idx_4 on public.property_unit_versions(parent_version_id);
create index property_unit_versions_idx_5 on public.property_unit_versions(copied_from_version_id);
create trigger property_unit_versions_immutable before update or delete on public.property_unit_versions for each row execute function public.guard_siteforge_brief_history();
alter table public.property_unit_decisions enable row level security;
revoke all on public.property_unit_decisions from public,anon,authenticated;
grant all on public.property_unit_decisions to service_role;
create policy property_unit_decisions_service on public.property_unit_decisions for all to service_role using(true)with check(true);
create index property_unit_decisions_idx_0 on public.property_unit_decisions(unit_id,decision_sequence desc);
create index property_unit_decisions_idx_1 on public.property_unit_decisions(property_id);
create index property_unit_decisions_idx_2 on public.property_unit_decisions(org_id);
create index property_unit_decisions_idx_3 on public.property_unit_decisions(actor_id);
create trigger property_unit_decisions_immutable before update or delete on public.property_unit_decisions for each row execute function public.guard_siteforge_brief_history();
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
create function public.property_unit_current(p_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$select coalesce((select to_jsonb(u)from public.property_units u where u.id=p_id),'null'::jsonb)$$;
create function public.property_unit_edit_data(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$
 select jsonb_build_object('canonicalKey',coalesce(p_row->>'canonical_key',''),'name',coalesce(p_row->>'unit_type',''),'bedrooms',p_row->'bedrooms','bathrooms',p_row->'bathrooms','sqftMin',p_row->'sqft_min','sqftMax',p_row->'sqft_max','priceMin',p_row->'rent_min','priceMax',p_row->'rent_max','deposit',p_row->'deposit','available',p_row->'available_count','specials',coalesce(p_row->>'move_in_specials',''),'sourceLabel',coalesce(p_row->>'source_identity',''),'sourceUrl',coalesce(p_row->>'source_url',''),'sourceNote','','observedAt',p_row->'source_updated_at','effectiveAt',p_row->'effective_at','expiresAt',p_row->'expires_at')
$$;
create function public.validate_property_unit_data(p_data jsonb)returns boolean language plpgsql immutable security invoker set search_path=''as $$
declare k text;v numeric;
begin
 if jsonb_typeof(p_data)is distinct from'object'or p_data-array['canonicalKey','name','bedrooms','bathrooms','sqftMin','sqftMax','priceMin','priceMax','deposit','available','specials','sourceLabel','sourceUrl','sourceNote','observedAt','effectiveAt','expiresAt']<>'{}'or not(p_data?&array['canonicalKey','name','bedrooms','bathrooms','sqftMin','sqftMax','priceMin','priceMax','deposit','available','specials','sourceLabel','sourceUrl','sourceNote','observedAt','effectiveAt','expiresAt'])then return false;end if;
 if coalesce(p_data->>'canonicalKey','')!~'^[a-z0-9][a-z0-9_-]{0,99}$'or jsonb_typeof(p_data->'name')is distinct from'string'or length(btrim(p_data->>'name'))not between 1 and 200 or jsonb_typeof(p_data->'sourceLabel')is distinct from'string'or length(btrim(p_data->>'sourceLabel'))not between 3 and 300 or jsonb_typeof(p_data->'sourceNote')is distinct from'string'or length(btrim(p_data->>'sourceNote'))<3 or octet_length(p_data->>'sourceNote')>32768 or jsonb_typeof(p_data->'specials')is distinct from'string'or length(p_data->>'specials')>4000 or jsonb_typeof(p_data->'sourceUrl')is distinct from'string'or length(p_data->>'sourceUrl')>2000 or(p_data->>'sourceUrl'<>''and p_data->>'sourceUrl'!~'^https?://[^[:space:]]+$')or(p_data->>'sourceUrl'~'^https?://[^/]*@')then return false;end if;
 foreach k in array array['bedrooms','bathrooms','sqftMin','sqftMax','priceMin','priceMax','deposit','available']loop
  if p_data->k='null'::jsonb then if k='bedrooms'then return false;end if;continue;end if;
  if jsonb_typeof(p_data->k)is distinct from'number'then return false;end if;v:=(p_data->>k)::numeric;
  if v<0 or v>(case when k='bedrooms'then 50 when k='bathrooms'then 99.9 when k in('sqftMin','sqftMax','available')then 1000000 else 99999999.99 end)then return false;end if;
  if k in('bedrooms','sqftMin','sqftMax','available')and v<>trunc(v)then return false;end if;
  if k='bathrooms'and v<>round(v,1)then return false;end if;
  if k in('priceMin','priceMax','deposit')and v<>round(v,2)then return false;end if;
  if k in('sqftMin','sqftMax')and v=0 then return false;end if;
 end loop;
 if(p_data->>'priceMin')::numeric>(p_data->>'priceMax')::numeric or(p_data->>'sqftMin')::numeric>(p_data->>'sqftMax')::numeric then return false;end if;
 if jsonb_typeof(p_data->'observedAt')is distinct from'string'or(p_data->>'observedAt')::timestamptz in('infinity'::timestamptz,'-infinity'::timestamptz)then return false;end if;
 foreach k in array array['effectiveAt','expiresAt']loop
  if p_data->k='null'::jsonb then continue;end if;
  if jsonb_typeof(p_data->k)is distinct from'string'or(p_data->>k)::timestamptz in('infinity'::timestamptz,'-infinity'::timestamptz)then return false;end if;
 end loop;
 if(p_data->>'effectiveAt')::timestamptz>=(p_data->>'expiresAt')::timestamptz then return false;end if;
 return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return false;
end$$;
create function public.property_unit_decision_start(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_prior public.property_unit_decisions;
begin
 v_start:=public.knowledge_decision_start(p_id,p_property_id,p_actor_id,'unit.'||p_kind,p_input);if v_start->>'state'<>'new'then return v_start;end if;
 select *into v_prior from public.property_unit_decisions where id=p_id;
 if found then if(v_prior.property_id,v_prior.org_id,v_prior.actor_id,v_prior.kind,v_prior.input)is distinct from(p_property_id,(v_start->>'orgId')::uuid,p_actor_id,p_kind,p_input)then return'{"state":"request_conflict"}';end if;return v_prior.result||'{"state":"replayed"}';end if;
 return v_start;
end$$;
create function public.property_unit_decision_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_unit_id uuid,p_kind text,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_event jsonb;
begin
 select org_id into v_org from public.properties where id=p_property_id;
 insert into public.property_unit_decisions(id,property_id,org_id,actor_id,unit_id,kind,input,input_hash,before_state,after_state,result)
 values(p_id,p_property_id,v_org,p_actor_id,p_unit_id,p_kind,p_input,public.knowledge_hash(p_input),p_before,p_after,p_result);
 update public.property_unit_workspaces set last_decision_id=p_id,updated_at=clock_timestamp()where id=p_unit_id;
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property','property.unit.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('unitId',p_unit_id,'inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(p_before)),jsonb_build_object('hash',public.knowledge_hash(p_after)),p_result);
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Floor-plan decision history could not be retained';end if;
 return p_result||'{"state":"saved"}';
end$$;
create function public.guard_reviewed_property_unit()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
 if not exists(select 1 from public.property_unit_workspaces w where w.id=old.id and w.applied_version_id is not null)then if tg_op='DELETE'then return old;end if;return new;end if;
 if tg_op='DELETE'then raise exception 'Retire a reviewed floor plan instead of deleting it';end if;
 if coalesce(current_setting('p11.unit_review_scope',true),'')<>old.property_id::text or(new.id,new.property_id,new.org_id)is distinct from(old.id,old.property_id,old.org_id)then raise exception 'Use a recorded floor-plan review';end if;
 return new;
end$$;
create trigger property_units_review_guard before update or delete on public.property_units for each row execute function public.guard_reviewed_property_unit();
create function public.save_property_unit_draft(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_unit uuid;v_workspace public.property_unit_workspaces;v_current jsonb;v_type text;v_data jsonb:=p_input->'data';
begin
 v_start:=public.property_unit_decision_start(p_id,p_property_id,p_actor_id,'draft_saved',p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['unitId','expectedDraftId','expectedDecisionId','expectedUnitHash','copiedFromVersionId','data','reason']<>'{}'or not(p_input?&array['unitId','expectedDraftId','expectedDecisionId','expectedUnitHash','copiedFromVersionId','data','reason'])or not public.validate_property_unit_data(v_data)then raise exception 'Review the complete floor-plan facts and source evidence';end if;
 if(v_data->>'observedAt')::timestamptz>clock_timestamp()then return'{"state":"source_date_future"}';end if;
 v_unit:=coalesce((p_input->>'unitId')::uuid,p_id);select property_type into v_type from public.properties where id=p_property_id;
 select *into v_workspace from public.property_unit_workspaces where id=v_unit for update;
 if found and(v_workspace.property_id,v_workspace.org_id)is distinct from(p_property_id,(v_start->>'orgId')::uuid)then return'{"state":"not_found"}';end if;
 select to_jsonb(u)into v_current from public.property_units u where id=v_unit for update;v_current:=coalesce(v_current,'null'::jsonb);
 if v_current<>'null'::jsonb and(v_current->>'property_id',v_current->>'org_id')is distinct from(p_property_id::text,v_start->>'orgId')then return'{"state":"not_found"}';end if;
 if p_input->>'unitId'is not null and v_current='null'::jsonb and v_workspace.id is null then return'{"state":"not_found"}';end if;
 if public.knowledge_hash(v_current)is distinct from p_input->>'expectedUnitHash'then return'{"state":"unit_changed"}';end if;
 if(v_workspace.latest_version_id,v_workspace.last_decision_id)is distinct from((p_input->>'expectedDraftId')::uuid,(p_input->>'expectedDecisionId')::uuid)then return'{"state":"draft_changed"}';end if;
 if p_input->>'copiedFromVersionId'is not null and not exists(select 1 from public.property_unit_versions where id=(p_input->>'copiedFromVersionId')::uuid and unit_id=v_unit and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid)then return'{"state":"not_found"}';end if;
 if v_workspace.id is null then insert into public.property_unit_workspaces(id,property_id,org_id,created_by)values(v_unit,p_property_id,(v_start->>'orgId')::uuid,p_actor_id);end if;
 insert into public.property_unit_versions(id,unit_id,property_id,org_id,actor_id,parent_version_id,copied_from_version_id,property_type,data,data_hash,base_unit,base_unit_hash)
 values(p_id,v_unit,p_property_id,(v_start->>'orgId')::uuid,p_actor_id,v_workspace.latest_version_id,(p_input->>'copiedFromVersionId')::uuid,v_type,v_data,public.knowledge_hash(v_data),v_current,public.knowledge_hash(v_current));
 update public.property_unit_workspaces set latest_version_id=p_id,updated_at=clock_timestamp()where id=v_unit;
 return public.property_unit_decision_finish(p_id,p_property_id,p_actor_id,v_unit,'draft_saved',p_input,jsonb_build_object('workspace',to_jsonb(v_workspace),'unit',v_current),jsonb_build_object('latestVersionId',p_id),jsonb_build_object('unitId',v_unit,'versionId',p_id,'applied',false));
end$$;
create function public.release_property_unit(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_kind text;v_workspace public.property_unit_workspaces;v_version public.property_unit_versions;v_current jsonb;v_after jsonb;v_docs jsonb;v_type text;v_data jsonb;v_history uuid;
begin
 v_kind:=case p_input->>'operation'when'approve'then'approved'when'reject'then'draft_rejected'when'retire'then'retired'when'restore'then'restored'end;
 if v_kind is null then raise exception 'Choose a reviewed floor-plan decision';end if;
 v_start:=public.property_unit_decision_start(p_id,p_property_id,p_actor_id,v_kind,p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['operation','unitId','versionId','expectedDraftId','expectedAppliedId','expectedDecisionId','expectedUnitHash','dataHash','confirmed','reason']<>'{}'or not(p_input?&array['operation','unitId','versionId','expectedDraftId','expectedAppliedId','expectedDecisionId','expectedUnitHash','dataHash','confirmed','reason'])or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Review the exact current floor-plan version';end if;
 select *into v_workspace from public.property_unit_workspaces where id=(p_input->>'unitId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid for update;if not found then return'{"state":"not_found"}';end if;
 if(v_workspace.latest_version_id,v_workspace.applied_version_id,v_workspace.last_decision_id)is distinct from((p_input->>'expectedDraftId')::uuid,(p_input->>'expectedAppliedId')::uuid,(p_input->>'expectedDecisionId')::uuid)then return'{"state":"draft_changed"}';end if;
 select *into v_version from public.property_unit_versions where id=(p_input->>'versionId')::uuid and unit_id=v_workspace.id;
 if not found then return'{"state":"not_found"}';end if;
 if v_version.data_hash is distinct from p_input->>'dataHash'then return'{"state":"draft_changed"}';end if;
 select to_jsonb(u)into v_current from public.property_units u where id=v_workspace.id for update;v_current:=coalesce(v_current,'null'::jsonb);
 if public.knowledge_hash(v_current)is distinct from p_input->>'expectedUnitHash'then return'{"state":"unit_changed"}';end if;
 if v_current<>'null'::jsonb and(v_current->>'property_id',v_current->>'org_id')is distinct from(p_property_id::text,v_start->>'orgId')then return'{"state":"not_found"}';end if;
 v_data:=v_version.data;select property_type into v_type from public.properties where id=p_property_id;
 if v_kind in('approved','restored')then
  if v_version.property_type is distinct from v_type then return'{"state":"property_type_changed"}';end if;
  if(v_data->>'expiresAt')::timestamptz<=clock_timestamp()then return'{"state":"facts_expired"}';end if;
 end if;
 if v_kind in('approved','draft_rejected')and v_version.id<>v_workspace.latest_version_id then return'{"state":"draft_changed"}';end if;
 if v_kind in('approved','draft_rejected')and v_workspace.reviewed_version_id=v_version.id then return'{"state":"already_reviewed"}';end if;
 if v_kind='approved'then
  if v_version.base_unit_hash<>public.knowledge_hash(v_current)then return'{"state":"unit_changed"}';end if;
  if exists(select 1 from public.property_units where property_id=p_property_id and source_identity='console-review'and canonical_key=v_data->>'canonicalKey'and id<>v_workspace.id)then return'{"state":"duplicate_identity"}';end if;
 elsif v_kind in('retired','restored')then
  if v_workspace.applied_version_id is null or v_version.id<>v_workspace.applied_version_id or v_current='null'::jsonb then return'{"state":"approval_required"}';end if;
  if(v_kind='retired'and v_current->'active'='false'::jsonb)or(v_kind='restored'and v_current->'active'='true'::jsonb)then return'{"state":"already_applied"}';end if;
 end if;
 v_docs:='[]';
 if v_kind<>'draft_rejected'then
  -- These exact labels identify the obsolete structured-unit renderer, never a raw uploaded source.
  select coalesce(jsonb_agg(locked.row_data order by locked.id),'[]')into v_docs from(select d.id,to_jsonb(d)row_data from public.documents d where d.property_id=p_property_id and d.metadata->>'source'='property_units'and d.metadata->>'category'='pricing'for update)locked;
  if octet_length(v_docs::text)>5242880 then return'{"state":"derived_evidence_too_large"}';end if;
  perform set_config('p11.unit_review_scope',p_property_id::text,true);
  if v_kind='approved'then
   insert into public.property_units(id,property_id,org_id,canonical_key,unit_type,bedrooms,bathrooms,sqft_min,sqft_max,rent_min,rent_max,deposit,available_count,move_in_specials,source,source_identity,source_url,source_updated_at,effective_at,expires_at,active,review_status,last_updated_at)
   values(v_workspace.id,p_property_id,v_workspace.org_id,v_data->>'canonicalKey',v_data->>'name',(v_data->>'bedrooms')::int,(v_data->>'bathrooms')::numeric,(v_data->>'sqftMin')::int,(v_data->>'sqftMax')::int,(v_data->>'priceMin')::numeric,(v_data->>'priceMax')::numeric,(v_data->>'deposit')::numeric,(v_data->>'available')::int,nullif(v_data->>'specials',''),'manual','console-review',nullif(v_data->>'sourceUrl',''),(v_data->>'observedAt')::timestamptz,(v_data->>'effectiveAt')::timestamptz,(v_data->>'expiresAt')::timestamptz,true,'approved',clock_timestamp())
   on conflict(id)do update set canonical_key=excluded.canonical_key,unit_type=excluded.unit_type,bedrooms=excluded.bedrooms,bathrooms=excluded.bathrooms,sqft_min=excluded.sqft_min,sqft_max=excluded.sqft_max,rent_min=excluded.rent_min,rent_max=excluded.rent_max,deposit=excluded.deposit,available_count=excluded.available_count,move_in_specials=excluded.move_in_specials,source=excluded.source,source_identity=excluded.source_identity,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,effective_at=excluded.effective_at,expires_at=excluded.expires_at,active=true,review_status='approved',last_updated_at=excluded.last_updated_at,external_id=null,import_id=null,inventory_sync_run_id=null,imported_at=null;
   update public.property_unit_workspaces set applied_version_id=v_version.id,reviewed_version_id=v_version.id,review_outcome='approved'where id=v_workspace.id;
  else
   update public.property_units set active=(v_kind='restored'),last_updated_at=clock_timestamp()where id=v_workspace.id;
  end if;
  delete from public.documents where property_id=p_property_id and id in(select (value->>'id')::uuid from jsonb_array_elements(v_docs));
  update public.property_chatbot_contexts set status='stale',requires_review=true,updated_at=clock_timestamp()where property_id=p_property_id;
 else
  update public.property_unit_workspaces set reviewed_version_id=v_version.id,review_outcome='rejected'where id=v_workspace.id;
 end if;
 v_after:=public.property_unit_current(v_workspace.id);
 if v_kind='approved'and(v_current->'rent_min',v_current->'rent_max',v_current->'available_count')is distinct from(v_after->'rent_min',v_after->'rent_max',v_after->'available_count')then
  v_history:=p_id;insert into public.property_price_history(id,property_unit_id,rent_min,rent_max,available_count,source)values(v_history,v_workspace.id,(v_after->>'rent_min')::numeric,(v_after->>'rent_max')::numeric,(v_after->>'available_count')::int,'reviewed_console');
 end if;
 return public.property_unit_decision_finish(p_id,p_property_id,p_actor_id,v_workspace.id,v_kind,p_input,jsonb_build_object('workspace',to_jsonb(v_workspace),'unit',v_current,'retiredDerivedDocuments',v_docs),jsonb_build_object('unit',v_after),jsonb_build_object('unitId',v_workspace.id,'versionId',v_version.id,'applied',v_kind<>'draft_rejected','active',v_after->'active','unitHash',public.knowledge_hash(v_after),'priceHistoryId',v_history,'retiredDerivedDocuments',jsonb_array_length(v_docs)));
end$$;
create function public.read_property_unit_review(p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_role text;v_type text;v_kind text:=coalesce(p_input->>'kind','units');v_unit uuid:=(p_input->>'unitId')::uuid;v_version uuid:=(p_input->>'versionId')::uuid;v_offset int:=coalesce((p_input->>'offset')::int,0);v_search text:=lower(btrim(coalesce(p_input->>'search','')));v_workspace public.property_unit_workspaces;v_current jsonb;v_exact public.property_unit_versions;v_decision public.property_unit_decisions;v_rows jsonb;v_items jsonb;v_total int;v_hash text;v_counts jsonb;
begin
 select p.org_id,u.role,p.property_type into v_org,v_role,v_type from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if v_org is null then return'{"state":"forbidden"}';end if;
 if v_kind not in('units','unit','versions','decisions','decision')or v_offset not between 0 and 1000000 or length(v_search)>200 then raise exception 'Choose a retained floor-plan history page';end if;
 if v_kind='decision'then
  select *into v_decision from public.property_unit_decisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=v_org and actor_id=p_actor_id;
  if not found then return'{"state":"not_found"}';end if;return v_decision.result||jsonb_build_object('state','ready','propertyId',p_property_id);
 end if;
 if v_kind<>'units'then
  select *into v_workspace from public.property_unit_workspaces where id=v_unit and property_id=p_property_id and org_id=v_org;
  select coalesce(to_jsonb(u),'null'::jsonb)into v_current from public.property_units u where id=v_unit and property_id=p_property_id and org_id=v_org;v_current:=coalesce(v_current,'null');
  if v_workspace.id is null and v_current='null'::jsonb then return'{"state":"not_found"}';end if;
  if v_kind='unit'then
   select *into v_exact from public.property_unit_versions where id=coalesce(v_version,v_workspace.latest_version_id)and unit_id=v_unit and property_id=p_property_id and org_id=v_org;
   if v_version is not null and v_exact.id is null then return'{"state":"not_found"}';end if;
   return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'propertyType',v_type,'unitId',v_unit,'unit',v_current,'unitHash',public.knowledge_hash(v_current),'workspace',case when v_workspace.id is not null then to_jsonb(v_workspace)end,'version',case when v_exact.id is not null then to_jsonb(v_exact)end,'editData',coalesce(v_exact.data,public.property_unit_edit_data(v_current)),'eligible',coalesce((v_current->>'active')::boolean and v_current->>'review_status'='approved'and(v_current->>'effective_at'is null or(v_current->>'effective_at')::timestamptz<=now())and(v_current->>'expires_at'is null or(v_current->>'expires_at')::timestamptz>now()),false));
  end if;
 end if;
 if v_kind='units'then
  with ids as(select id from public.property_units where property_id=p_property_id and org_id=v_org union select id from public.property_unit_workspaces where property_id=p_property_id and org_id=v_org)
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',coalesce(v.data->>'name',u.unit_type),'draftKey',v.data->>'canonicalKey','unit',to_jsonb(u),'latestVersionId',w.latest_version_id,'appliedVersionId',w.applied_version_id,'latestReview',case when w.reviewed_version_id=w.latest_version_id then w.review_outcome end,'hasDraft',w.latest_version_id is distinct from w.applied_version_id,'eligible',coalesce(u.active and u.review_status='approved'and(u.effective_at is null or u.effective_at<=now())and(u.expires_at is null or u.expires_at>now()),false))order by lower(coalesce(v.data->>'name',u.unit_type)),i.id),'[]')into v_rows
  from ids i left join public.property_units u on u.id=i.id and u.property_id=p_property_id and u.org_id=v_org left join public.property_unit_workspaces w on w.id=i.id and w.property_id=p_property_id and w.org_id=v_org left join public.property_unit_versions v on v.id=w.latest_version_id;
  select jsonb_build_object('all',jsonb_array_length(v_rows),'eligible',count(*)filter(where value->'eligible'='true'::jsonb),'drafts',count(*)filter(where value->'hasDraft'='true'::jsonb),'retired',count(*)filter(where value->'unit'->'active'='false'::jsonb))into v_counts from jsonb_array_elements(v_rows);
  if v_search<>''then select coalesce(jsonb_agg(v order by n),'[]')into v_rows from jsonb_array_elements(v_rows)with ordinality p(v,n)where strpos(lower(v->>'name'),v_search)>0 or strpos(lower(coalesce(v->'unit'->>'canonical_key','')),v_search)>0 or strpos(lower(coalesce(v->>'draftKey','')),v_search)>0 or strpos(lower(coalesce(v->'unit'->>'unit_type','')),v_search)>0;end if;
 elsif v_kind='versions'then select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.data->>'name','created_at',v.created_at,'actor_id',v.actor_id,'data_hash',v.data_hash,'parent_version_id',v.parent_version_id,'copied_from_version_id',v.copied_from_version_id)order by v.version_sequence desc),'[]')into v_rows from public.property_unit_versions v where v.unit_id=v_unit and v.property_id=p_property_id and v.org_id=v_org;
 else select coalesce(jsonb_agg((to_jsonb(d)-'input'-'before_state'-'after_state')||jsonb_build_object('reason',d.input->>'reason')order by d.decision_sequence desc),'[]')into v_rows from public.property_unit_decisions d where d.unit_id=v_unit and d.property_id=p_property_id and d.org_id=v_org;
 end if;
 v_total:=jsonb_array_length(v_rows);v_hash:=public.knowledge_hash(v_rows);
 if p_input?'expectedHash'and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v order by n),'[]')into v_items from jsonb_array_elements(v_rows)with ordinality p(v,n)where n>v_offset and n<=v_offset+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'propertyType',v_type,'emptyUnitHash',public.knowledge_hash('null'),'items',v_items,'historyHash',v_hash,'total',v_total,'counts',v_counts,'nextOffset',case when v_offset+20<v_total then v_offset+20 else null end);
end$$;

create function public.guard_obsolete_unit_documents()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if new.metadata->>'source'='property_units'and new.metadata->>'category'='pricing'then
  perform pg_advisory_xact_lock(hashtextextended(new.property_id::text,12));
  if exists(select 1 from public.property_unit_workspaces where property_id=new.property_id and applied_version_id is not null)then raise exception 'Use reviewed structured floor-plan facts; the old generated pricing copy is retired';end if;
 end if;
 return new;
end$$;
create trigger obsolete_unit_documents_guard before insert or update on public.documents for each row execute function public.guard_obsolete_unit_documents();
create or replace function public.cancel_unused_knowledge_decision(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_unit public.property_unit_decisions;v_fact public.assistant_fact_decisions;v_file public.knowledge_file_decisions;v_org uuid;v_prior public.knowledge_material_decisions;v_cancelled public.knowledge_cancelled_decisions;v_event jsonb;v_event_id uuid:=md5('knowledge-cancel:'||p_id::text)::uuid;
begin
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if v_org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or p_input-array['inputHash','reason']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 then raise exception 'Review the unused request before cancelling';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=v_org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,886));
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
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.property_unit_current(uuid) from public,anon,authenticated;
grant execute on function public.property_unit_current(uuid) to service_role;
revoke all on function public.property_unit_edit_data(jsonb) from public,anon,authenticated;
grant execute on function public.property_unit_edit_data(jsonb) to service_role;
revoke all on function public.validate_property_unit_data(jsonb) from public,anon,authenticated;
grant execute on function public.validate_property_unit_data(jsonb) to service_role;
revoke all on function public.property_unit_decision_start(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.property_unit_decision_start(uuid,uuid,uuid,text,jsonb) to service_role;
revoke all on function public.property_unit_decision_finish(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.property_unit_decision_finish(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.guard_reviewed_property_unit() from public,anon,authenticated;
grant execute on function public.guard_reviewed_property_unit() to service_role;
revoke all on function public.save_property_unit_draft(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_property_unit_draft(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.release_property_unit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.release_property_unit(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.read_property_unit_review(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_property_unit_review(uuid,uuid,jsonb) to service_role;
revoke all on function public.guard_obsolete_unit_documents() from public,anon,authenticated;
grant execute on function public.guard_obsolete_unit_documents() to service_role;
revoke all on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
