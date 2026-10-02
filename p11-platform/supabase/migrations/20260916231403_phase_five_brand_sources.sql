create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;


alter table public.content_assets add column if not exists governance_revision bigint not null default 1;
create or replace function public.version_content_asset_governance() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('anon','authenticated') and (
  (tg_op='INSERT' and (new.approval_status is distinct from 'pending' or new.approved_by is not null or new.approved_at is not null or new.curation_status='approved' or new.governance_revision<>1)) or
  (tg_op='UPDATE' and (new.approval_status,new.approved_by,new.approved_at,new.rights_status,new.rights_metadata,new.expires_at,new.curation_status,new.file_url,new.content_hash,new.org_id,new.property_id) is distinct from (old.approval_status,old.approved_by,old.approved_at,old.rights_status,old.rights_metadata,old.expires_at,old.curation_status,old.file_url,old.content_hash,old.org_id,old.property_id))
 ) then raise exception 'Governed asset changes require the review service';end if;
 if tg_op='INSERT' then new.governance_revision:=1;
 elsif (to_jsonb(new)-array['governance_revision','updated_at','last_used_at','times_used']) is distinct from (to_jsonb(old)-array['governance_revision','updated_at','last_used_at','times_used']) then new.governance_revision:=old.governance_revision+1;
 else new.governance_revision:=old.governance_revision;end if;
 return new;
end; $$;
create trigger content_asset_governance_version before insert or update on public.content_assets for each row execute function public.version_content_asset_governance();
create table public.brand_asset_revisions(
 asset_id uuid not null references public.content_assets(id) on delete cascade,
 revision bigint not null,property_id uuid not null references public.properties(id) on delete cascade,
 snapshot jsonb not null,created_at timestamptz not null default now(),primary key(asset_id,revision)
);
create index brand_asset_revisions_property on public.brand_asset_revisions(property_id,created_at desc);
alter table public.brand_asset_revisions enable row level security;
create policy brand_asset_revisions_service on public.brand_asset_revisions for all to service_role using (true) with check (true);
revoke all on public.brand_asset_revisions from public,anon,authenticated;
grant all on public.brand_asset_revisions to service_role;
create trigger brand_asset_revision_immutable before update or delete on public.brand_asset_revisions for each row execute function public.protect_brand_revision();
create or replace function public.brand_source_event_id(p_identity text) returns uuid language sql immutable security invoker set search_path='' as $$
 select (substr(h,1,12)||'3'||substr(h,14,3)||'8'||substr(h,18))::uuid from (select md5(p_identity) h) t;
$$;
create or replace function public.brand_asset_summary(p_asset public.content_assets) returns jsonb language sql immutable security invoker set search_path='' as $$
 select case when p_asset.id is null then null else jsonb_build_object('assetId',p_asset.id,'revision',p_asset.governance_revision,'role',p_asset.asset_role,'approvalStatus',p_asset.approval_status,'rightsStatus',p_asset.rights_status,'expiresAt',p_asset.expires_at) end;
$$;
create or replace function public.begin_brand_asset_upload(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.shared_action_events;r jsonb;
begin
 if p_request_id is null or p_input-array['contentHash','role','size','metadataHash']<>'{}' or jsonb_typeof(p_input) is distinct from 'object' or length(p_input::text)>16384 or coalesce(p_input->>'contentHash','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid asset request';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'brand.asset.uploaded',p_input) then return '{"state":"request_conflict"}';end if;
  return e.result||'{"state":"replayed"}'::jsonb;
 end if;
 r:=public.append_shared_action_event(public.brand_source_event_id('asset-upload-start/'||p_request_id),p_request_id,p_property_id,p_actor_id,'brandforge','brand.asset.upload.requested','server_confirmed','succeeded',p_input,null,null,'{"state":"prepared"}');
 if r->>'state' not in ('recorded','replayed') then return r;end if;
 return '{"state":"prepared"}';
end; $$;
create or replace function public.finish_brand_asset_upload(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb,p_asset jsonb default null,p_error text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.content_assets;organization uuid;r jsonb;e jsonb;duplicate boolean;source public.shared_action_events;
begin
 r:=public.begin_brand_asset_upload(p_property_id,p_actor_id,p_request_id,p_input);
 if r->>'state'<>'prepared' then return r;end if;
 if p_error is not null then
  if p_error not in ('upload_failed','save_unconfirmed') then raise exception 'Invalid asset failure';end if;
  e:=public.append_shared_action_event(public.brand_source_event_id('asset-upload-failed/'||p_request_id||'/'||p_error),p_request_id,p_property_id,p_actor_id,'brandforge','brand.asset.uploaded','server_confirmed','failed',p_input,null,null,jsonb_build_object('state',p_error));
  if e->>'state' not in ('recorded','replayed') then raise exception 'Asset failure could not be recorded';end if;
  return jsonb_build_object('state',p_error);
 end if;
 select org_id into organization from public.properties where id=p_property_id;
 select * into a from public.content_assets where property_id=p_property_id and content_hash=p_input->>'contentHash' for update;
 duplicate:=found;
 if duplicate and a.asset_role is distinct from p_input->>'role' then return '{"state":"role_conflict"}';end if;
 if not duplicate then
  if jsonb_typeof(p_asset) is distinct from 'object' or length(p_asset::text)>32768 or p_asset-array['name','description','asset_type','asset_role','file_url','file_size_bytes','format','storage_bucket','storage_path','rights_status','rights_metadata','alt_text']<>'{}' or p_asset->>'asset_role' is distinct from p_input->>'role' or p_asset->>'file_size_bytes' is distinct from p_input->>'size' or coalesce(p_asset->>'file_url','')='' or coalesce(p_asset->>'storage_path','')='' then raise exception 'Invalid uploaded asset';end if;
  insert into public.content_assets(org_id,property_id,name,description,asset_type,asset_role,file_url,file_size_bytes,format,storage_bucket,storage_path,content_hash,source_identity,source_metadata,rights_status,rights_metadata,approval_status,alt_text,uploaded_by)
   values(organization,p_property_id,p_asset->>'name',p_asset->>'description',p_asset->>'asset_type',p_asset->>'asset_role',p_asset->>'file_url',(p_asset->>'file_size_bytes')::bigint,p_asset->>'format',p_asset->>'storage_bucket',p_asset->>'storage_path',p_input->>'contentHash','brand-upload:'||p_request_id,jsonb_build_object('requestId',p_request_id),p_asset->>'rights_status',p_asset->'rights_metadata','pending',p_asset->>'alt_text',p_actor_id) returning * into a;
 end if;
 insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot) values(a.id,a.governance_revision,p_property_id,to_jsonb(a)) on conflict do nothing;
 r:=jsonb_build_object('state','applied','assetId',a.id,'revision',a.governance_revision,'duplicate',duplicate);
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'brandforge','brand.asset.uploaded','server_confirmed','succeeded',p_input,case when duplicate then public.brand_asset_summary(a) else null end,public.brand_asset_summary(a),r);
 if e->>'state' not in ('recorded','replayed') then raise exception 'Asset upload could not be recorded';end if;
 return r;
end; $$;
create or replace function public.review_brand_asset(p_property_id uuid,p_asset_id uuid,p_actor_id uuid,p_request_id uuid,p_revision bigint,p_review jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.content_assets;before_state jsonb;input jsonb;prior public.shared_action_events;e jsonb;r jsonb;
begin
 if p_request_id is null or p_revision is null or p_revision<1 or jsonb_typeof(p_review) is distinct from 'object' or length(p_review::text)>16384 or p_review-array['approvalStatus','rightsStatus','rightsMetadata','altText','focalPoint','expiresAt']<>'{}' or coalesce(p_review->>'approvalStatus','') not in ('approved','rejected') or coalesce(p_review->>'rightsStatus','') not in ('unknown','owned','licensed','generated','restricted') then raise exception 'Invalid asset review';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('assetId',p_asset_id,'revision',p_revision,'reviewHash',encode(sha256(convert_to(p_review::text,'UTF8')),'hex'));
 select * into prior from public.shared_action_events where id=p_request_id;
 if found then
  if (prior.property_id,prior.actor_id,prior.action,prior.request) is distinct from (p_property_id,p_actor_id,'brand.asset.reviewed',input) then return '{"state":"request_conflict"}';end if;
  return prior.result||'{"state":"replayed"}'::jsonb;
 end if;
 select * into a from public.content_assets where id=p_asset_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if a.governance_revision<>p_revision then return '{"state":"stale"}';end if;
 if p_review->>'approvalStatus'='approved' and (p_review->>'rightsStatus' not in ('owned','licensed','generated') or a.duplicate_of is not null or (case when p_review?'expiresAt' then nullif(p_review->>'expiresAt','')::timestamptz else a.expires_at end <=clock_timestamp())) then return '{"state":"rights_required"}';end if;
 before_state:=public.brand_asset_summary(a);
 insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot) values(a.id,a.governance_revision,p_property_id,to_jsonb(a)) on conflict do nothing;
 update public.content_assets set approval_status=p_review->>'approvalStatus',curation_status=p_review->>'approvalStatus',rights_status=p_review->>'rightsStatus',rights_metadata=case when p_review?'rightsMetadata' then p_review->'rightsMetadata' else rights_metadata end,alt_text=case when p_review?'altText' then p_review->>'altText' else alt_text end,focal_point=case when p_review?'focalPoint' then p_review->'focalPoint' else focal_point end,expires_at=case when p_review?'expiresAt' then nullif(p_review->>'expiresAt','')::timestamptz else expires_at end,approved_by=case when p_review->>'approvalStatus'='approved' then p_actor_id else null end,approved_at=case when p_review->>'approvalStatus'='approved' then clock_timestamp() else null end where id=a.id returning * into a;
 insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot) values(a.id,a.governance_revision,p_property_id,to_jsonb(a)) on conflict do nothing;
 r:=jsonb_build_object('state','applied','assetId',a.id,'revision',a.governance_revision);
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'brandforge','brand.asset.reviewed','server_confirmed','succeeded',input,before_state,public.brand_asset_summary(a),r);
 if e->>'state' not in ('recorded','replayed') then raise exception 'Asset review could not be recorded';end if;
 return r;
end; $$;
create or replace function public.save_brand_import_preview(p_property_id uuid,p_actor_id uuid,p_idempotency_key text,p_input_hash text,p_base_revision bigint,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare imp public.property_brand_imports;b public.property_brand_assets;organization uuid;request_id uuid;e jsonb;
begin
 if p_idempotency_key is null or p_input_hash is null or p_base_revision is null or length(p_idempotency_key) not between 8 and 200 or p_input_hash!~'^[0-9a-f]{64}$' or p_base_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>524288 then raise exception 'Invalid import preview';end if;
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if organization is null then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into imp from public.property_brand_imports where property_id=p_property_id and org_id=organization and idempotency_key=p_idempotency_key for update;
 if found then
  if imp.created_by is distinct from p_actor_id or imp.extraction_report->>'inputHash' is distinct from p_input_hash then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','preview',to_jsonb(imp));
 end if;
 select * into b from public.property_brand_assets where property_id=p_property_id for share;
 if coalesce(b.revision,0)<>p_base_revision then return '{"state":"stale"}';end if;
 if p_payload-array['source_type','source_identity','source_manifest','extracted_contract','conflicts','extraction_report','content_hash']<>'{}' or jsonb_typeof(p_payload->'extracted_contract') is distinct from 'object' or jsonb_typeof(p_payload->'conflicts') is distinct from 'array' or jsonb_typeof(p_payload->'source_manifest') is distinct from 'array' then raise exception 'Invalid preview content';end if;
 insert into public.property_brand_imports(org_id,property_id,status,source_type,source_identity,idempotency_key,source_manifest,extracted_contract,conflicts,extraction_report,content_hash,created_by)
 values(organization,p_property_id,'needs_review',p_payload->>'source_type',p_payload->>'source_identity',p_idempotency_key,p_payload->'source_manifest',p_payload->'extracted_contract',p_payload->'conflicts',coalesce(p_payload->'extraction_report','{}')||jsonb_build_object('inputHash',p_input_hash,'baseRevision',p_base_revision,'brandAssetId',b.id),p_payload->>'content_hash',p_actor_id) returning * into imp;
 request_id:=public.brand_source_event_id('brand-preview/'||p_property_id||'/'||p_idempotency_key);
 e:=public.append_shared_action_event(request_id,request_id,p_property_id,p_actor_id,'brandforge','brand.import.previewed','server_confirmed','succeeded',jsonb_build_object('inputHash',p_input_hash,'baseRevision',p_base_revision,'sourceType',imp.source_type),public.brand_action_summary(b),jsonb_build_object('importId',imp.id,'status',imp.status,'conflictCount',jsonb_array_length(imp.conflicts)),jsonb_build_object('state','saved','importId',imp.id,'contentHash',imp.content_hash));
 if e->>'state' not in ('recorded','replayed') then raise exception 'Import preview could not be recorded';end if;
 return jsonb_build_object('state','applied','preview',to_jsonb(imp));
end; $$;
revoke all on function public.version_content_asset_governance(),public.brand_source_event_id(text),public.brand_asset_summary(public.content_assets),public.begin_brand_asset_upload(uuid,uuid,uuid,jsonb),public.finish_brand_asset_upload(uuid,uuid,uuid,jsonb,jsonb,text),public.review_brand_asset(uuid,uuid,uuid,uuid,bigint,jsonb),public.save_brand_import_preview(uuid,uuid,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.version_content_asset_governance(),public.brand_source_event_id(text),public.brand_asset_summary(public.content_assets),public.begin_brand_asset_upload(uuid,uuid,uuid,jsonb),public.finish_brand_asset_upload(uuid,uuid,uuid,jsonb,jsonb,text),public.review_brand_asset(uuid,uuid,uuid,uuid,bigint,jsonb),public.save_brand_import_preview(uuid,uuid,text,text,bigint,jsonb) to service_role;
notify pgrst,'reload schema';

-- Import sources are private review material. They are never inserted into retrieval documents.
create table public.brand_import_sources(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 created_by uuid not null references public.profiles(id),name text not null,mime_type text not null,
 content_hash text not null,input_hash text not null,content text not null,created_at timestamptz not null default now()
);
create index brand_import_sources_creator on public.brand_import_sources(created_by);
create index brand_import_sources_property on public.brand_import_sources(property_id,created_at desc);
alter table public.brand_import_sources enable row level security;
create policy brand_import_sources_service on public.brand_import_sources for all to service_role using(true) with check(true);
revoke all on public.brand_import_sources from public,anon,authenticated;
grant all on public.brand_import_sources to service_role;
create trigger brand_import_source_immutable before update or delete on public.brand_import_sources for each row execute function public.protect_brand_revision();
create or replace function public.save_brand_import_source(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_input_hash text,p_content_hash text,p_name text,p_mime_type text,p_content text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare source public.brand_import_sources;e jsonb;r jsonb;
begin
 if p_request_id is null or coalesce(p_input_hash,'')!~'^[0-9a-f]{64}$' or coalesce(p_content_hash,'')!~'^[0-9a-f]{64}$' or coalesce(length(p_name),0) not between 1 and 255 or p_mime_type not in ('application/pdf','text/plain','text/markdown') or coalesce(length(p_content),0) not between 1 and 2000000 then raise exception 'Invalid brand source';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into source from public.brand_import_sources where id=p_request_id;
 if found then
  if (source.property_id,source.created_by,source.input_hash) is distinct from (p_property_id,p_actor_id,p_input_hash) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','sourceId',source.id);
 end if;
 insert into public.brand_import_sources(id,property_id,created_by,name,mime_type,content_hash,input_hash,content)values(p_request_id,p_property_id,p_actor_id,p_name,p_mime_type,p_content_hash,p_input_hash,p_content);
 r:=jsonb_build_object('state','applied','sourceId',p_request_id);
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'brandforge','brand.source.saved','server_confirmed','succeeded',jsonb_build_object('inputHash',p_input_hash,'contentHash',p_content_hash,'mimeType',p_mime_type),null,jsonb_build_object('sourceId',p_request_id,'status','review_source'),r);
 if e->>'state' not in ('recorded','replayed') then raise exception 'Import source could not be recorded';end if;
 return r;
end; $$;
revoke all on function public.save_brand_import_source(uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.save_brand_import_source(uuid,uuid,uuid,text,text,text,text,text) to service_role;
notify pgrst,'reload schema';
