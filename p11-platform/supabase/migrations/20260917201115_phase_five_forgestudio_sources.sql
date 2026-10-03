-- Source provenance is private and verified against the actual selected values.
create table public.forgestudio_context_sources (
 context_id uuid primary key references public.shared_context_snapshots(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 records jsonb not null check(jsonb_typeof(records)='object'),
 created_at timestamptz not null default now()
);
create index forgestudio_context_sources_property on public.forgestudio_context_sources(property_id);
alter table public.forgestudio_context_sources enable row level security;
revoke all on public.forgestudio_context_sources from public,anon,authenticated;
grant all on public.forgestudio_context_sources to service_role;
create trigger forgestudio_context_sources_immutable before update or delete on public.forgestudio_context_sources for each row execute function public.guard_forgestudio_publication_receipt();

create function public.read_forgestudio_source_record(p_property_id uuid,p_kind text,p_id uuid,p_expected jsonb default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actual jsonb;typed jsonb;keys text[];projection jsonb;expected_projection jsonb;begin
 case p_kind
 when 'property' then
  keys:=array['id','name','address','property_type','website_url','unit_count','target_audience','brand_voice'];
  select to_jsonb(r) into actual from public.properties r where id=p_id and id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.properties,p_expected));end if;
 when 'config' then
  keys:=array['brand_voice','target_audience','key_amenities','include_hashtags','include_cta','max_caption_length'];
  select to_jsonb(r) into actual from public.forgestudio_config r where property_id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.forgestudio_config,p_expected));end if;
 when 'onboarding' then
  keys:=array['id','status','snapshot_payload','content_hash','unresolved_conflicts'];
  select to_jsonb(r) into actual from public.property_onboarding_snapshots r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_onboarding_snapshots,p_expected));end if;
 when 'legal' then
  keys:=array['id','status','version','fair_housing','pricing_disclaimer','accessibility','effective_at'];
  select to_jsonb(r) into actual from public.property_legal_configs r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_legal_configs,p_expected));end if;
 when 'brand' then
  keys:=array['id','generation_status','approval_status','contract_version','contract_hash','section_1_introduction','section_2_positioning','section_3_target_audience','section_4_personas','section_5_name_story','section_6_logo','section_7_typography','section_8_colors','section_9_design_elements','section_10_photo_yep','section_11_photo_nope','section_12_implementation'];
  select to_jsonb(r) into actual from public.property_brand_assets r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_brand_assets,p_expected));end if;
 when 'asset' then
  keys:=array['id','name','asset_type','file_url','thumbnail_url','description','width','height','duration_seconds','alt_text','rights_status','approval_status','curation_status','expires_at','duplicate_of'];
  select to_jsonb(r) into actual from public.content_assets r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.content_assets,p_expected));end if;
 when 'inventory' then
  keys:=array['id','active','unit_type','bedrooms','bathrooms','sqft_min','sqft_max','rent_min','rent_max','available_count','move_in_specials','effective_at','source_updated_at','expires_at','confidence','review_status','source_identity'];
  select to_jsonb(r) into actual from public.property_units r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_units,p_expected));end if;
 when 'poi' then
  keys:=array['id','name','category','address','distance_miles','travel_time_minutes','source_url','captured_at','confidence','approval_status'];
  select to_jsonb(r) into actual from public.property_points_of_interest r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_points_of_interest,p_expected));end if;
 when 'testimonial' then
  keys:=array['id','status','review_text_snapshot','reviewer_name_snapshot','rating_snapshot','platform_snapshot','attribution_approved','rights_basis','revoked_at'];
  select to_jsonb(r) into actual from public.review_testimonial_approvals r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.review_testimonial_approvals,p_expected));end if;
 when 'document' then
  keys:=array['id','content','metadata'];
  select to_jsonb(r) into actual from public.documents r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.documents,p_expected));end if;
 else raise exception 'Unsupported source kind';end case;
 if actual is null then return null;end if;
 select jsonb_object_agg(key,actual->key) into projection from unnest(keys) key;
 if p_expected is not null then
  if not(p_expected ?& keys) or jsonb_typeof(p_expected)<>'object' then raise exception 'Source evidence is incomplete';end if;
  select jsonb_object_agg(key,typed->key) into expected_projection from unnest(keys) key;
  if projection is distinct from expected_projection then raise exception 'A source changed while its context was being saved. Reload and review it again.';end if;
 end if;
 return projection;
end;$$;

create function public.capture_forgestudio_context_sources() returns trigger language plpgsql security invoker set search_path='' as $$
declare entry record;saved jsonb:='{}';canonical jsonb;begin
 if new.source_domain not in('forgestudio.generation','forgestudio.source-review') or not(new.context_payload?'sourceRecords') then return new;end if;
 if new.context_payload->>'propertyId' is distinct from new.property_id::text or jsonb_typeof(new.context_payload->'sourceRecords')<>'object' or length(new.context_payload::text)>1048576 then raise exception 'Invalid source evidence';end if;
 for entry in select * from jsonb_each(new.context_payload->'sourceRecords') loop
  canonical:=public.read_forgestudio_source_record(new.property_id,entry.value->>'kind',(entry.value->>'id')::uuid,entry.value->'values');
  if canonical is null then raise exception 'A scoped source is no longer available';end if;
  saved:=saved||jsonb_build_object(entry.key,entry.value||jsonb_build_object('values',canonical));
 end loop;
 insert into public.forgestudio_context_sources(context_id,property_id,records) values(new.id,new.property_id,saved);
 return new;
end;$$;
create trigger forgestudio_context_sources_capture after insert on public.shared_context_snapshots for each row execute function public.capture_forgestudio_context_sources();

create function public.guard_forgestudio_context_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if exists(select 1 from public.properties where id=old.property_id) and old.source_domain in('forgestudio.generation','forgestudio.source-review') then raise exception 'Saved ForgeStudio context is immutable';end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
create trigger forgestudio_context_snapshot_immutable before update or delete on public.shared_context_snapshots for each row execute function public.guard_forgestudio_context_snapshot();

create function public.check_forgestudio_sources(p_property_id uuid,p_context_id uuid,p_content jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare bundle jsonb;manifest jsonb;issues jsonb:='[]';advisories jsonb:='[]';required text[]:='{}';required_assets text[]:='{}';claim jsonb;citation jsonb;source jsonb;asset jsonb;variant jsonb;source_id text;asset_id text;url text;record_key text;record_value jsonb;current_value jsonb;checked text[]:='{}';code text;label text;begin
 select context_payload into bundle from public.shared_context_snapshots where id=p_context_id and property_id=p_property_id;
 select records into manifest from public.forgestudio_context_sources where context_id=p_context_id and property_id=p_property_id;
 for claim in select * from jsonb_array_elements(coalesce(p_content->'claims','[]')) loop
  if claim->>'type'<>'general' and jsonb_array_length(coalesce(claim->'citations','[]'))=0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','citation_required','label',claim->>'text'));end if;
  for citation in select * from jsonb_array_elements(coalesce(claim->'citations','[]')) loop
   source_id:=citation->>'sourceId';required:=array_append(required,source_id);
   select value into source from jsonb_array_elements(coalesce(bundle->'sources','[]')) where value->>'id'=source_id;
   if source is null or source->>'kind' is distinct from citation->>'sourceType' or not(coalesce(source->'allowedUses','[]')?'claim') or coalesce((source->>'stale')::boolean,false) or coalesce((source->>'conflicted')::boolean,false)
    or (claim->>'type' in('pricing','availability','concession') and source->>'kind'<>'structured_inventory')
    or (claim->>'type'='testimonial' and source->>'kind'<>'approved_testimonial')
    or (claim->>'type'='neighborhood' and source->>'kind'<>'approved_poi')
    or (claim->>'type'='accessibility' and source->>'kind' not in('legal_policy','approved_snapshot')) then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','citation_not_authoritative','sourceId',source_id,'label',claim->>'text'));
   end if;
  end loop;
 end loop;
 for variant in select * from jsonb_array_elements(coalesce(p_content->'variants','[]')) loop
  required_assets:=required_assets||array(select jsonb_array_elements_text(coalesce(variant->'assetIds','[]')));
  if nullif(variant->>'thumbnailAssetId','') is not null then required_assets:=array_append(required_assets,variant->>'thumbnailAssetId');end if;
  for url in select jsonb_array_elements_text(coalesce(variant->'mediaUrls','[]')) loop
   select value into asset from jsonb_array_elements(coalesce(bundle->'assets','[]')) where value->>'fileUrl'=url and value->>'id' in(select jsonb_array_elements_text(coalesce(variant->'assetIds','[]')));
   if asset is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','media_source_required','label','An attached media URL has no matching selected library asset.'));end if;
  end loop;
 end loop;
 for source_id in select distinct unnest(required) loop
  if not exists(select 1 from jsonb_array_elements(coalesce(bundle->'sources','[]')) where value->>'id'=source_id) then issues:=issues||jsonb_build_array(jsonb_build_object('code','source_unavailable','sourceId',source_id,'label','A cited source is missing from the saved context.'));end if;
 end loop;
 for asset_id in select distinct unnest(required_assets) loop
  select value into asset from jsonb_array_elements(coalesce(bundle->'assets','[]')) where value->>'id'=asset_id;
  if asset is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','asset_source_required','sourceId','asset:'||asset_id,'label','An attached asset is absent from the reviewed source snapshot.'));
  else required:=array_append(required,'asset:'||asset_id);end if;
 end loop;
 if p_context_id is not null and bundle is null then issues:=issues||'[{"code":"context_unavailable","label":"The saved source snapshot is unavailable."}]';end if;
 if (cardinality(required)>0 or jsonb_array_length(coalesce(bundle->'sources','[]'))>0) and manifest is null then issues:=issues||'[{"code":"source_manifest_required","label":"Refresh this older revision to verify its saved sources."}]';end if;
 for source in select value from jsonb_array_elements(coalesce(bundle->'sources','[]')) where value->>'id'=any(required) or value->>'kind' in('legal_policy','brand_section','channel_settings') loop
  source_id:=source->>'id';record_key:=source->>'recordKey';label:=source->>'label';
  if record_key is null or not(coalesce(manifest,'{}')?record_key) then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','source_manifest_required','sourceId',source_id,'label',label));continue;
  end if;
  if record_key=any(checked) then continue;end if;checked:=array_append(checked,record_key);
  record_value:=manifest->record_key;
  current_value:=public.read_forgestudio_source_record(p_property_id,record_value->>'kind',(record_value->>'id')::uuid);
  code:=null;
  if current_value is null then code:='source_unavailable';
  elsif record_value->>'kind'='asset' then
   if current_value->>'approval_status' is distinct from 'approved' or current_value->>'duplicate_of' is not null then code:='asset_unavailable';
   elsif (current_value-array['rights_status','curation_status','expires_at']) is distinct from ((record_value->'values')-array['rights_status','curation_status','expires_at']) then code:='asset_changed';end if;
   if current_value->>'rights_status' not in('owned','licensed','generated') or current_value->>'curation_status' not in('approved','selected','in_use') or (current_value->>'expires_at')::timestamptz<=clock_timestamp() or current_value is distinct from record_value->'values' then
    advisories:=advisories||jsonb_build_array(jsonb_build_object('code','asset_metadata_advisory','sourceId',source_id,'label',label,'rightsStatus',current_value->>'rights_status','curationStatus',current_value->>'curation_status','expiresAt',current_value->>'expires_at'));
   end if;
  elsif current_value is distinct from record_value->'values' then code:='source_changed';
  elsif record_value->>'kind'='inventory' and (not(current_value->>'active')::boolean or current_value->>'review_status'<>'approved' or (current_value->>'expires_at')::timestamptz<=clock_timestamp() or (current_value->>'effective_at')::timestamptz>clock_timestamp()) then code:='inventory_not_current';
  elsif record_value->>'kind'='testimonial' and (current_value->>'status'<>'active' or current_value->>'revoked_at' is not null) then code:='testimonial_revoked';
  elsif record_value->>'kind'='legal' and (current_value->>'status'<>'approved' or (current_value->>'effective_at')::timestamptz>clock_timestamp() or exists(select 1 from public.property_legal_configs where property_id=p_property_id and status='approved' and effective_at<=clock_timestamp() and version>(current_value->>'version')::integer)) then code:='legal_policy_changed';
  elsif record_value->>'kind'='onboarding' and (current_value->>'status'<>'approved' or coalesce(current_value->'unresolved_conflicts','[]')<>'[]'::jsonb or exists(select 1 from public.property_onboarding_snapshots candidate join public.property_onboarding_snapshots prior on prior.id=(record_value->>'id')::uuid where candidate.property_id=p_property_id and candidate.status='approved' and candidate.approved_at>prior.approved_at)) then code:='property_source_needs_review';
  end if;
  if code is not null then issues:=issues||jsonb_build_array(jsonb_build_object('code',code,'sourceId',source_id,'label',label));end if;
 end loop;
 return jsonb_build_object('state',case when jsonb_array_length(issues)>0 then 'source_review_required' else 'current' end,'issues',issues,'advisories',advisories,'sources',coalesce(bundle->'sources','[]'),'assets',coalesce(bundle->'assets','[]'),'warnings',coalesce(bundle->'warnings','[]'),'contextId',p_context_id,'checkedAt',clock_timestamp());
end;$$;

-- A refreshed snapshot is a new pending revision, with the owner's reason and
-- exact input saved atomically. Refresh does not approve its unchanged wording.
create function public.refresh_forgestudio_sources(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;decision jsonb:=p_payload-'bundle';organization uuid;context uuid;result jsonb;begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'sources.refreshed',decision);if response->>'state'<>'new' then return response;end if;
 if length(coalesce(p_payload->>'reason','')) not between 3 and 2000 or not exists(select 1 from public.social_content_packages where id=(p_payload->>'packageId')::uuid and property_id=p_property_id and current_revision_id=(p_payload->>'expectedRevisionId')::uuid) then return '{"state":"stale_revision"}';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by) values(organization,p_property_id,'forgestudio.source-review','review:'||p_id,p_payload->'bundle',p_payload->'bundle'->>'contextHash',p_actor_id::text) returning id into context;
 result:=public.save_forgestudio_revision(gen_random_uuid(),p_property_id,p_actor_id,jsonb_build_object('packageId',p_payload->>'packageId','expectedRevisionId',p_payload->>'expectedRevisionId','reason',p_payload->>'reason','authorKind','user','content',p_payload->'content','validation',p_payload->'validation','contextSnapshotId',context));
 if result->>'state' not in('saved','replayed') then
  -- Raising rolls back the new snapshot too; no orphan evidence on a hold.
  raise exception 'Source refresh could not create a revision: %',result->>'state';
 end if;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'sources.refreshed',decision,jsonb_build_object('revisionId',p_payload->>'expectedRevisionId'),jsonb_build_object('revisionId',result->>'revisionId','contextId',context),result-'state',jsonb_build_object('contextId',context));
end;$$;

-- Derive the campaign badge from only its current revision's saved deliveries.
create function public.refresh_forgestudio_package_status(p_package_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare pkg public.social_content_packages;approval text;next_status text;begin
 select * into pkg from public.social_content_packages where id=p_package_id for update;
 if not found or pkg.status='archived' then return;end if;
 select approval_status into approval from public.social_content_revisions where id=pkg.current_revision_id;
 next_status:=case
  when exists(select 1 from public.social_publications where revision_id=pkg.current_revision_id and status in('failed','reconciling')) then 'in_review'
  when exists(select 1 from public.social_publications where revision_id=pkg.current_revision_id and status in('scheduled','queued','publishing')) then 'scheduled'
  when exists(select 1 from public.social_publications where revision_id=pkg.current_revision_id and status='published') then 'published'
  when approval='approved' then 'approved' else 'in_review' end;
 update public.social_content_packages set status=next_status,updated_at=clock_timestamp() where id=pkg.id and status<>next_status;
end;$$;

create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

create or replace function public.review_forgestudio_revision(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;revision public.social_content_revisions;pkg public.social_content_packages;decision text:=p_payload->>'decision';links jsonb;
begin
 result:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'revision.reviewed',p_payload);if result->>'state'<>'new' then return result;end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 if decision is null or decision not in('approved','denied') or length(trim(coalesce(p_payload->>'note','')))<3 or length(p_payload->>'note')>2000 then raise exception 'Invalid review';end if;
 select * into revision from public.social_content_revisions where id=(p_payload->>'revisionId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into pkg from public.social_content_packages where id=revision.package_id for update;
 if revision.id is distinct from pkg.current_revision_id or revision.approval_status<>'pending' or revision.content_hash is distinct from p_payload->>'contentHash' then return '{"state":"stale_revision"}';end if;
 if decision='approved' and (not exists(select 1 from public.social_content_variants where revision_id=revision.id) or exists(select 1 from public.social_content_variants where revision_id=revision.id and validation->'issues' is distinct from '[]'::jsonb) or exists(select 1 from jsonb_array_elements(revision.claims) claim where claim->>'type' in('pricing','concession','availability','testimonial','accessibility','neighborhood') and coalesce(jsonb_array_length(claim->'citations'),0)=0)) then return '{"state":"validation_required"}';end if;
 if decision='approved' then
  result:=public.check_forgestudio_sources(p_property_id,revision.context_snapshot_id,revision.content);
  if result->>'state'<>'current' then return result;end if;
 end if;
 links:=public.record_forgestudio_governance(p_id,p_property_id,p_actor_id,revision.id,decision,p_payload->>'note');
 update public.social_content_revisions set approval_status=decision,approved_by=p_actor_id,approved_at=clock_timestamp(),approval_note=p_payload->>'note' where id=revision.id returning * into revision;
 update public.social_content_packages set status=case when decision='approved' then 'approved' else 'in_review' end,updated_at=clock_timestamp() where id=pkg.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'revision.reviewed',p_payload,jsonb_build_object('revisionId',revision.id,'status','pending'),jsonb_build_object('revisionId',revision.id,'status',decision),jsonb_build_object('revision',to_jsonb(revision),'revisionId',revision.id,'decision',decision),links);
end;$$;

create or replace function public.schedule_forgestudio_publications(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;revision public.social_content_revisions;pkg public.social_content_packages;destination jsonb;connection public.social_connections;variant public.social_content_variants;job uuid;attempt uuid;publication public.social_publications;results jsonb:='[]';seen text[]:='{}';identity text;scheduled timestamptz;tz text;publications uuid[]:='{}';
begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'publications.scheduled',p_payload);if response->>'state'<>'new' then return response;end if;
 if jsonb_typeof(p_payload->'destinations') is distinct from 'array' or jsonb_array_length(p_payload->'destinations') not between 1 and 20 then raise exception 'Choose one to twenty destinations';end if;
 select * into revision from public.social_content_revisions where id=(p_payload->>'revisionId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into pkg from public.social_content_packages where id=revision.package_id for update;
 if revision.approval_status<>'approved' or pkg.current_revision_id is distinct from revision.id or revision.content_hash is distinct from p_payload->>'contentHash' then return '{"state":"stale_revision"}';end if;
 response:=public.check_forgestudio_sources(p_property_id,revision.context_snapshot_id,revision.content);if response->>'state'<>'current' then return response;end if;
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

create or replace function public.prepare_forgestudio_publication_write(p_job_id uuid,p_worker text,p_claim_id uuid,p_fingerprint text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare publication public.social_publications;job public.shared_jobs;revision public.social_content_revisions;pkg public.social_content_packages;variant public.social_content_variants;connection public.social_connections;source_check jsonb;fingerprint text;receipt public.forgestudio_publication_receipts;begin
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
 source_check:=public.check_forgestudio_sources(publication.property_id,revision.context_snapshot_id,revision.content);if source_check->>'state'<>'current' then return source_check;end if;
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

create or replace function public.control_forgestudio_publication(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 perform public.refresh_forgestudio_package_status(publication.package_id);
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'publication.'||operation,p_payload,previous,jsonb_build_object('publicationId',publication.id,'status',publication.status,'scheduledFor',publication.scheduled_for),jsonb_build_object('publication',to_jsonb(publication),'publicationId',publication.id,'status',publication.status),jsonb_build_object('jobId',job.id,'attemptId',publication.shared_action_attempt_id));
end;$$;

create or replace function public.finish_forgestudio_publication_write(p_job_id uuid,p_worker text,p_claim_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
   perform public.refresh_forgestudio_package_status(publication.package_id);
   return '{"state":"saved","status":"reconciling"}';
  end if;
  return jsonb_build_object('state','saved','status',publication.status,'reviewedResultPreserved',true);
 end if;
 result_status:=case kind when 'provider_acknowledged' then 'published' when 'provider_uncertain' then 'reconciling' else 'failed' end;
 update public.social_publications set status=result_status,remote_post_id=case when kind='provider_acknowledged' then p_payload->>'providerPostId' else remote_post_id end,remote_post_url=case when kind='provider_acknowledged' then p_payload->>'providerPostUrl' else remote_post_url end,published_at=case when kind='provider_acknowledged' then clock_timestamp() else published_at end,last_error=case when kind='provider_acknowledged' then null else proof->>'reason' end,error_classification=case kind when 'provider_uncertain' then 'ambiguous' when 'blocked_before_send' then 'permanent' else null end,updated_at=clock_timestamp() where id=publication.id;
 update public.social_publication_attempts set status=case kind when 'provider_acknowledged' then 'succeeded' when 'provider_uncertain' then 'reconciling' else 'failed' end,provider_post_id=p_payload->>'providerPostId',provider_post_url=p_payload->>'providerPostUrl',response_summary=proof,error_message=case when kind='provider_acknowledged' then null else proof->>'reason' end,error_classification=case when kind='provider_uncertain' then 'ambiguous' else null end,finished_at=clock_timestamp() where publication_id=publication.id and request_summary->>'claimId'=p_claim_id::text;
 update public.shared_jobs set lifecycle_status=case when kind='provider_acknowledged' then 'succeeded' else 'failed' end,status_reason=kind,error_message=case when kind='provider_acknowledged' then null else proof->>'reason' end,lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=job.id;
 update public.shared_action_attempts set lifecycle_status=case when kind='provider_acknowledged' then 'succeeded' else 'failed' end,execution_status=case when kind='provider_acknowledged' then 'executed' else 'failed' end,execution_result=proof,error_message=case when kind='provider_acknowledged' then null else proof->>'reason' end,executed_at=case when kind='provider_acknowledged' then clock_timestamp() else null end,updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;

 perform public.refresh_forgestudio_package_status(publication.package_id);
 return jsonb_build_object('state','saved','status',result_status);
end;$$;

create or replace function public.review_forgestudio_publication_recovery(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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

 end if;
 perform public.refresh_forgestudio_package_status(publication.package_id);
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'publication.recovery_reviewed',p_payload,jsonb_build_object('publicationId',publication.id,'status',publication.status),jsonb_build_object('publicationId',publication.id,'decision',operation,'evidenceSource',case when operation='record_existing_post' then 'operator_attestation' else 'saved_before_send_history' end),jsonb_build_object('publicationId',publication.id,'decision',operation),jsonb_build_object('jobId',job.id,'writeIntentId',intent.id));
end;$$;

revoke all on function public.read_forgestudio_source_record(uuid,text,uuid,jsonb),public.capture_forgestudio_context_sources(),public.guard_forgestudio_context_snapshot(),public.check_forgestudio_sources(uuid,uuid,jsonb),public.refresh_forgestudio_sources(uuid,uuid,uuid,jsonb),public.refresh_forgestudio_package_status(uuid) from public,anon,authenticated;
grant execute on function public.read_forgestudio_source_record(uuid,text,uuid,jsonb),public.capture_forgestudio_context_sources(),public.guard_forgestudio_context_snapshot(),public.check_forgestudio_sources(uuid,uuid,jsonb),public.refresh_forgestudio_sources(uuid,uuid,uuid,jsonb),public.refresh_forgestudio_package_status(uuid) to service_role;
notify pgrst,'reload schema';
