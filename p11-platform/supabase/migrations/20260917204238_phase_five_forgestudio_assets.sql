-- Library metadata is real schema; archived media remains available to history.
alter table public.content_assets
 add column if not exists folder text,
 add column if not exists is_favorite boolean not null default false,
 add column archived_at timestamptz,
 add column archived_by uuid references public.profiles(id),
 add column archive_reason text,
 add column replacement_asset_id uuid references public.content_assets(id),
 add constraint content_assets_folder_check check(folder is null or length(folder)<=120),
 add constraint content_asset_archive_state check((archived_at is null and archived_by is null and archive_reason is null) or (archived_at is not null and archived_by is not null and length(trim(archive_reason)) between 3 and 2000 and approval_status='rejected'));
create index content_assets_archive_actor on public.content_assets(archived_by);
create index content_assets_replacement on public.content_assets(replacement_asset_id);
create index content_assets_library_page on public.content_assets(property_id,created_at desc,id desc);

create table public.forgestudio_asset_uploads(
 id uuid primary key,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),
 input jsonb not null,
 state text not null default 'prepared' check(state in('prepared','completed')),
 storage_path text not null,
 asset_id uuid references public.content_assets(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index forgestudio_asset_uploads_property on public.forgestudio_asset_uploads(property_id,created_at desc,id desc);
create index forgestudio_asset_uploads_actor on public.forgestudio_asset_uploads(actor_id);
create index forgestudio_asset_uploads_org on public.forgestudio_asset_uploads(org_id);
create index forgestudio_asset_uploads_asset on public.forgestudio_asset_uploads(asset_id);
alter table public.forgestudio_asset_uploads enable row level security;
revoke all on public.forgestudio_asset_uploads from public,anon,authenticated;
grant all on public.forgestudio_asset_uploads to service_role;

create function public.guard_forgestudio_asset_upload() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from public.properties where id=old.property_id) then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' or (new.id,new.property_id,new.org_id,new.actor_id,new.input,new.storage_path) is distinct from (old.id,old.property_id,old.org_id,old.actor_id,old.input,old.storage_path) or (old.state='completed' and to_jsonb(new) is distinct from to_jsonb(old)) then raise exception 'Saved asset upload identity is immutable';end if;return new;
end;$$;
create trigger forgestudio_asset_upload_immutable before update or delete on public.forgestudio_asset_uploads for each row execute function public.guard_forgestudio_asset_upload();

create function public.forgestudio_asset_summary(p_asset public.content_assets) returns jsonb language sql immutable security invoker set search_path='' as $$
 select case when p_asset.id is null then null else jsonb_build_object('assetId',p_asset.id,'revision',p_asset.governance_revision,'approvalStatus',p_asset.approval_status,'rightsStatus',p_asset.rights_status,'expiresAt',p_asset.expires_at,'archivedAt',p_asset.archived_at,'replacementAssetId',p_asset.replacement_asset_id,'contentHash',p_asset.content_hash,'favorite',p_asset.is_favorite) end;
$$;

create function public.guard_forgestudio_library_asset() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='UPDATE' then
  if current_user in('anon','authenticated') and (new.folder,new.is_favorite,new.archived_at,new.archived_by,new.archive_reason,new.replacement_asset_id) is distinct from (old.folder,old.is_favorite,old.archived_at,old.archived_by,old.archive_reason,old.replacement_asset_id) then raise exception 'Library changes require the recorded service';end if;
  if new.replacement_asset_id is not null and (new.replacement_asset_id=new.id or not exists(select 1 from public.content_assets where id=new.replacement_asset_id and property_id=new.property_id)) then raise exception 'Replacement asset must belong to the same property';end if;
 end if;
 if exists(select 1 from public.properties where id=old.property_id) and exists(select 1 from public.forgestudio_asset_uploads where asset_id=old.id and state='completed') and (tg_op='DELETE' or (new.file_url,new.content_hash,new.storage_bucket,new.storage_path,new.asset_type) is distinct from (old.file_url,old.content_hash,old.storage_bucket,old.storage_path,old.asset_type)) then raise exception 'Archive this saved asset or upload a replacement; its original file is immutable';end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
create trigger forgestudio_library_asset_guard before update or delete on public.content_assets for each row execute function public.guard_forgestudio_library_asset();

create function public.manage_forgestudio_asset(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;a public.content_assets;prior public.content_assets;patch public.content_assets;operation text:=p_payload->>'action';kind text;begin
 if operation not in('save','review','archive','restore') then raise exception 'Invalid library decision';end if;
 kind:='asset.'||case operation when 'save' then 'saved' when 'review' then 'reviewed' when 'archive' then 'archived' else 'restored' end;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,kind,p_payload);if response->>'state'<>'new' then return response;end if;
 if operation<>'save' and not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 select * into a from public.content_assets where id=(p_payload->>'assetId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"asset_unavailable"}';end if;
 if a.governance_revision is distinct from (p_payload->>'revision')::bigint then return '{"state":"stale_asset"}';end if;
 prior:=a;
 if operation='save' then
  if jsonb_typeof(p_payload->'patch') is distinct from 'object' or length((p_payload->'patch')::text)>12000 or (p_payload->'patch')-array['name','description','alt_text','tags','folder','is_favorite']<>'{}' then raise exception 'Invalid asset metadata';end if;
  patch:=jsonb_populate_record(a,p_payload->'patch');
  if length(trim(coalesce(patch.name,''))) not between 1 and 255 or length(coalesce(patch.description,''))>2000 or length(coalesce(patch.alt_text,''))>1000 or cardinality(patch.tags)>30 or exists(select 1 from unnest(patch.tags) tag where length(trim(tag)) not between 1 and 80) then raise exception 'Invalid asset metadata';end if;
  update public.content_assets set name=patch.name,description=patch.description,alt_text=patch.alt_text,tags=coalesce(patch.tags,'{}'),folder=nullif(trim(patch.folder),''),is_favorite=patch.is_favorite,updated_at=clock_timestamp() where id=a.id returning * into a;
 elsif operation='review' then
  if a.archived_at is not null then return '{"state":"asset_archived"}';end if;
  if a.duplicate_of is not null and p_payload->'review'->>'approval_status'='approved' then return '{"state":"asset_duplicate"}';end if;
  if jsonb_typeof(p_payload->'review') is distinct from 'object' or length((p_payload->'review')::text)>16000 or (p_payload->'review')-array['approval_status','rights_status','rights_metadata','expires_at']<>'{}' or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Invalid asset review';end if;
  patch:=jsonb_populate_record(a,p_payload->'review');
  if patch.approval_status not in('approved','rejected') or patch.rights_status not in('unknown','owned','licensed','generated','restricted') then raise exception 'Invalid asset review';end if;
  update public.content_assets set approval_status=patch.approval_status,rights_status=patch.rights_status,rights_metadata=patch.rights_metadata,expires_at=patch.expires_at,curation_status=patch.approval_status,approved_by=case when patch.approval_status='approved' then p_actor_id end,approved_at=case when patch.approval_status='approved' then clock_timestamp() end,updated_at=clock_timestamp() where id=a.id returning * into a;
 elsif operation='archive' then
  if a.archived_at is not null then return '{"state":"asset_archived"}';end if;
  if length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Archive reason required';end if;
  update public.content_assets set archived_at=clock_timestamp(),archived_by=p_actor_id,archive_reason=trim(p_payload->>'reason'),approval_status='rejected',approved_by=null,approved_at=null,updated_at=clock_timestamp() where id=a.id returning * into a;
 else
  if a.archived_at is null then return '{"state":"asset_not_archived"}';end if;
  if length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Restore reason required';end if;
  update public.content_assets set archived_at=null,archived_by=null,archive_reason=null,approval_status='pending',approved_by=null,approved_at=null,curation_status='needs_review',updated_at=clock_timestamp() where id=a.id returning * into a;
 end if;
 insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot)values(prior.id,prior.governance_revision,p_property_id,to_jsonb(prior)) on conflict do nothing;
 insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot)values(a.id,a.governance_revision,p_property_id,to_jsonb(a)) on conflict do nothing;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,kind,p_payload,public.forgestudio_asset_summary(prior),public.forgestudio_asset_summary(a),jsonb_build_object('asset',to_jsonb(a),'assetId',a.id,'revision',a.governance_revision,'decision',operation));
end;$$;

create function public.begin_forgestudio_asset_upload(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;upload public.forgestudio_asset_uploads;organization uuid;target public.content_assets;duplicate uuid;begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'asset.uploaded',p_input);if response->>'state'<>'new' then return response;end if;
 if jsonb_typeof(p_input) is distinct from 'object' or length(p_input::text)>32768 or coalesce(p_input->>'contentHash','')!~'^[a-f0-9]{64}$' or (p_input->>'size')::bigint not between 1 and 104857600 or p_input->>'extension' not in('png','jpg','webp','gif','mp4','webm') or jsonb_typeof(p_input->'metadata') is distinct from 'object' then raise exception 'Invalid upload request';end if;
 select * into upload from public.forgestudio_asset_uploads where id=p_id for update;
 if found then
  if (upload.property_id,upload.actor_id,upload.input) is distinct from (p_property_id,p_actor_id,p_input) then return '{"state":"request_conflict"}';end if;
 else
  if nullif(p_input->>'replacesAssetId','') is not null then
   if not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','manager')) then return '{"state":"forbidden"}';end if;
   select * into target from public.content_assets where id=(p_input->>'replacesAssetId')::uuid and property_id=p_property_id for update;
   if target.id is null or target.archived_at is not null or target.governance_revision is distinct from (p_input->>'expectedRevision')::bigint then return '{"state":"stale_asset"}';end if;
   if length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Replacement reason required';end if;
  end if;
  select org_id into organization from public.properties where id=p_property_id;
  insert into public.forgestudio_asset_uploads(id,property_id,org_id,actor_id,input,storage_path)values(p_id,p_property_id,organization,p_actor_id,p_input,p_property_id||'/forgestudio/uploads/'||p_id||'.'||(p_input->>'extension')) returning * into upload;
  response:=public.append_shared_action_event(public.brand_source_event_id('studio-asset-upload-start/'||p_id),p_id,p_property_id,p_actor_id,'forgestudio','studio.asset.upload.requested','server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_input),'contentHash',p_input->>'contentHash'),null,null,jsonb_build_object('uploadId',p_id,'state','prepared'));
  if response->>'state' not in('recorded','replayed') then raise exception 'Upload request history could not be saved';end if;
 end if;
 select id into duplicate from public.content_assets where property_id=p_property_id and content_hash=p_input->>'contentHash';
 return jsonb_build_object('state','prepared','uploadId',p_id,'storagePath',upload.storage_path,'duplicateAssetId',duplicate);
end;$$;

create function public.finish_forgestudio_asset_upload(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb,p_keep_separate boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare upload public.forgestudio_asset_uploads;response jsonb;a public.content_assets;target public.content_assets;prior public.content_assets;metadata jsonb;duplicate boolean;begin
 select * into upload from public.forgestudio_asset_uploads where id=p_id and property_id=p_property_id;
 if not found then return '{"state":"upload_unavailable"}';end if;
 if upload.actor_id is distinct from p_actor_id or not exists(select 1 from public.properties where id=p_property_id and org_id=upload.org_id) then return '{"state":"forbidden"}';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'asset.uploaded',upload.input);if response->>'state'<>'new' then return response;end if;
 select * into upload from public.forgestudio_asset_uploads where id=p_id for update;
 if nullif(upload.input->>'replacesAssetId','') is not null and not p_keep_separate then
  if not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','manager')) then return '{"state":"forbidden"}';end if;
  select * into target from public.content_assets where id=(upload.input->>'replacesAssetId')::uuid and property_id=p_property_id for update;
  if target.id is null or target.archived_at is not null or target.governance_revision is distinct from (upload.input->>'expectedRevision')::bigint then return '{"state":"replacement_changed"}';end if;
  prior:=target;
 end if;
 select * into a from public.content_assets where property_id=p_property_id and content_hash=upload.input->>'contentHash' for update;
 duplicate:=found;
 if duplicate and a.archived_at is not null then return '{"state":"duplicate_archived"}';end if;
 if not duplicate then
  if p_payload->>'contentHash' is distinct from upload.input->>'contentHash' or p_payload->>'storagePath' is distinct from upload.storage_path or p_payload->>'storageBucket' is distinct from 'property-assets' or coalesce((p_payload->>'storageVerified')::boolean,false) is not true or coalesce(p_payload->>'fileUrl','')='' then raise exception 'Stored file evidence required';end if;
  metadata:=upload.input->'metadata';
  if metadata-array['name','description','asset_type','alt_text','folder','tags','rights_status','rights_metadata','width','height']<>'{}' or length(trim(coalesce(metadata->>'name',''))) not between 1 and 255 or metadata->>'asset_type' not in('image','video','gif') then raise exception 'Invalid uploaded asset metadata';end if;
  insert into public.content_assets(id,org_id,property_id,name,description,asset_type,alt_text,folder,tags,rights_status,rights_metadata,file_url,storage_bucket,storage_path,content_hash,format,file_size_bytes,width,height,approval_status,curation_status,is_ai_generated,uploaded_by,source_identity)
  values(p_id,upload.org_id,p_property_id,metadata->>'name',metadata->>'description',metadata->>'asset_type',metadata->>'alt_text',nullif(metadata->>'folder',''),array(select jsonb_array_elements_text(coalesce(metadata->'tags','[]'))),coalesce(metadata->>'rights_status','unknown'),coalesce(metadata->'rights_metadata','{}'),p_payload->>'fileUrl',p_payload->>'storageBucket',upload.storage_path,upload.input->>'contentHash',upload.input->>'extension',(upload.input->>'size')::bigint,nullif(metadata->>'width','')::integer,nullif(metadata->>'height','')::integer,'pending','needs_review',false,p_actor_id,'studio-upload:'||p_id) returning * into a;
 end if;
 if target.id is not null and target.id<>a.id then
  update public.content_assets set replacement_asset_id=a.id,archived_at=clock_timestamp(),archived_by=p_actor_id,archive_reason=upload.input->>'reason',approval_status='rejected',approved_by=null,approved_at=null,updated_at=clock_timestamp() where id=target.id returning * into target;
  insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot)values(prior.id,prior.governance_revision,p_property_id,to_jsonb(prior)),(target.id,target.governance_revision,p_property_id,to_jsonb(target)) on conflict do nothing;
  response:=public.append_shared_action_event(public.brand_source_event_id('studio-asset-replaced/'||p_id),p_id,p_property_id,p_actor_id,'forgestudio','studio.asset.replaced','server_confirmed','succeeded',jsonb_build_object('uploadId',p_id,'inputHash',public.crm_configuration_hash(upload.input)),public.forgestudio_asset_summary(prior),public.forgestudio_asset_summary(target),jsonb_build_object('previousAssetId',target.id,'replacementAssetId',a.id));
  if response->>'state' not in('recorded','replayed') then raise exception 'Replacement history could not be saved';end if;
 end if;
 insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot)values(a.id,a.governance_revision,p_property_id,to_jsonb(a)) on conflict do nothing;
 update public.forgestudio_asset_uploads set state='completed',asset_id=a.id,updated_at=clock_timestamp() where id=p_id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'asset.uploaded',upload.input,public.forgestudio_asset_summary(prior),public.forgestudio_asset_summary(a),jsonb_build_object('asset',to_jsonb(a),'assetId',a.id,'revision',a.governance_revision,'duplicate',duplicate,'replacedAssetId',case when target.id<>a.id then target.id end,'keptSeparate',p_keep_separate));
end;$$;

create function public.recover_forgestudio_asset_upload(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare decision jsonb:=p_payload-'storage';response jsonb;result jsonb;begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'asset.upload.recovered',decision);if response->>'state'<>'new' then return response;end if;
 if p_payload->>'action' not in('recover','keep_separate') or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Upload recovery decision required';end if;
 result:=public.finish_forgestudio_asset_upload((p_payload->>'uploadId')::uuid,p_property_id,p_actor_id,p_payload->'storage',p_payload->>'action'='keep_separate');
 if result->>'state' not in('saved','replayed') then return result;end if;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'asset.upload.recovered',decision,null,jsonb_build_object('assetId',result->>'assetId','action',p_payload->>'action'),result-'state');
end;$$;

create or replace function public.read_forgestudio_source_record(p_property_id uuid,p_kind text,p_id uuid,p_expected jsonb default null) returns jsonb language plpgsql security invoker set search_path='' as $$
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
  keys:=array['id','name','asset_type','file_url','thumbnail_url','description','width','height','duration_seconds','alt_text','rights_status','approval_status','curation_status','expires_at','duplicate_of','content_hash','storage_bucket','storage_path','archived_at','replacement_asset_id'];
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
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

create or replace function public.forgestudio_command_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_payload jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare recorded jsonb;begin
 insert into public.forgestudio_commands(id,property_id,actor_id,kind,payload_hash,payload,result)values(p_id,p_property_id,p_actor_id,p_kind,public.crm_configuration_hash(p_payload),p_payload,p_result);
 recorded:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'forgestudio','studio.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_payload)),p_before,p_after,p_result-array['asset','brief','revision','package','publications','publication'],p_links);
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Editorial history could not be saved';end if;
 return p_result||'{"state":"saved"}';
end;$$;

revoke all on function public.guard_forgestudio_asset_upload(),public.forgestudio_asset_summary(public.content_assets),public.guard_forgestudio_library_asset(),public.manage_forgestudio_asset(uuid,uuid,uuid,jsonb),public.begin_forgestudio_asset_upload(uuid,uuid,uuid,jsonb),public.finish_forgestudio_asset_upload(uuid,uuid,uuid,jsonb,boolean),public.recover_forgestudio_asset_upload(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_forgestudio_asset_upload(),public.forgestudio_asset_summary(public.content_assets),public.guard_forgestudio_library_asset(),public.manage_forgestudio_asset(uuid,uuid,uuid,jsonb),public.begin_forgestudio_asset_upload(uuid,uuid,uuid,jsonb),public.finish_forgestudio_asset_upload(uuid,uuid,uuid,jsonb,boolean),public.recover_forgestudio_asset_upload(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
