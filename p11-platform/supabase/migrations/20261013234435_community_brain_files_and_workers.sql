begin;
create function public.brain_file_limit(p_mime text) returns bigint language sql immutable set search_path='' as $$
 select case
 when p_mime in('text/plain','text/markdown','text/csv','image/svg+xml')then 1048576
 when p_mime in('image/jpeg','image/png','image/webp','image/gif')then 20971520
 when p_mime in('font/woff','font/woff2','font/ttf','font/otf')then 5242880
 when p_mime in('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')then 26214400
 when p_mime in('video/mp4','video/webm')then 104857600 else 0 end
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('knowledge-originals','knowledge-originals',false,104857600,array['application/pdf','text/plain','text/markdown','text/csv','image/jpeg','image/png','image/webp','image/gif','image/svg+xml','font/woff','font/woff2','font/ttf','font/otf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','video/mp4','video/webm'])
on conflict(id)do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function public.brain_storage_owner(p_name text) returns uuid language sql immutable set search_path='' as $$
 select case when split_part(p_name,'/',1)~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'then split_part(p_name,'/',1)::uuid end
$$;
create policy brain_storage_read on storage.objects as restrictive for select to authenticated using(
 bucket_id not in('knowledge-originals','property-assets','content-assets','brand-assets')or public.brain_can((select auth.uid()),public.brain_storage_owner(name),'download'));
create policy brain_storage_insert on storage.objects as restrictive for insert to authenticated with check(
 bucket_id not in('knowledge-originals','property-assets','content-assets','brand-assets')or public.brain_can((select auth.uid()),public.brain_storage_owner(name),'manage'));
create policy brain_storage_update on storage.objects as restrictive for update to authenticated using(
 bucket_id not in('knowledge-originals','property-assets','content-assets','brand-assets')or public.brain_can((select auth.uid()),public.brain_storage_owner(name),'manage'))with check(
 bucket_id not in('knowledge-originals','property-assets','content-assets','brand-assets')or public.brain_can((select auth.uid()),public.brain_storage_owner(name),'manage'));
create policy brain_storage_delete on storage.objects as restrictive for delete to authenticated using(
 bucket_id not in('knowledge-originals','property-assets','content-assets','brand-assets')or public.brain_can((select auth.uid()),public.brain_storage_owner(name),'manage'));

alter table public.forgestudio_asset_uploads add column storage_bucket text not null default 'property-assets';
alter table public.forgestudio_asset_uploads alter column storage_bucket set default 'knowledge-originals';
create unique index brain_knowledge_files_owner on public.knowledge_files(id,property_id);
alter table public.content_assets add column original_file_id uuid;
alter table public.content_assets add column original_page integer check(original_page>0);
alter table public.content_assets add constraint brain_asset_original_owner foreign key(original_file_id,property_id)references public.knowledge_files(id,property_id);
create table public.community_file_renditions (
 id uuid primary key,file_id uuid not null,property_id uuid not null,
 recipe text not null,page integer not null check(page>0),kind text not null check(kind in('page','preview','poster','sanitized')),
 mime_type text not null,storage_bucket text not null default 'knowledge-originals'check(storage_bucket='knowledge-originals'),storage_path text not null,
 content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),original_hash text not null check(original_hash~'^[a-f0-9]{64}$'),
 byte_size bigint not null check(byte_size between 1 and 20000000),metadata jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
 unique(file_id,recipe,page,kind),unique(id,property_id),foreign key(file_id,property_id)references public.knowledge_files(id,property_id),
 check(storage_path like property_id::text||'/'||file_id::text||'/%')
);

create function public.brain_enqueue_extraction(p_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$
 declare r public.knowledge_file_extractions;jid uuid:=md5('brain.extract:'||p_id::text)::uuid;begin
  select * into r from public.knowledge_file_extractions where id=p_id for update;
  if not found or not public.brain_can(r.actor_id,r.property_id,'manage')then return '{"state":"forbidden"}';end if;
  if r.state<>'queued'then return jsonb_build_object('state',r.state);end if;
  insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,dedupe_key,payload)
   values(jid,r.org_id,r.property_id,'community_brain','file_extraction',r.id::text,'brain.extract:'||r.id,jsonb_build_object('extractionId',r.id,'fileId',r.file_id,'actorId',r.actor_id))on conflict(id)do nothing;
  return jsonb_build_object('state','queued','jobId',jid,'extractionId',r.id);
 end
$$;

create function public.brain_claim_work(p_worker text,p_limit integer default 2)returns jsonb language plpgsql security definer set search_path='' as $$
 declare j public.shared_jobs;r public.knowledge_file_extractions;f public.knowledge_files;claim jsonb;out_rows jsonb:='[]';begin
 if length(p_worker)not between 16 and 120 or p_limit not between 1 and 5 then raise exception 'Invalid worker lease request';end if;
 -- One job per community in each batch prevents a large upload from starving other communities.
 for j in with candidates as(select id,row_number()over(partition by property_id order by available_at,id)n from public.shared_jobs where domain='community_brain'and lifecycle_status in('queued','retrying')and not cancel_requested and available_at<=clock_timestamp()and attempt_count<max_attempts)
  select q.*from public.shared_jobs q join candidates c on c.id=q.id where c.n=1 order by q.available_at,q.id limit p_limit for update of q skip locked
 loop
  if j.subject_type='file_extraction'then
   select *into r from public.knowledge_file_extractions where id=(j.payload->>'extractionId')::uuid and property_id=j.property_id and org_id=j.org_id;
   select *into f from public.knowledge_files where id=r.file_id and property_id=j.property_id and org_id=j.org_id;
   if r.id is null or f.state is distinct from 'stored'or not public.brain_can(r.actor_id,j.property_id,'manage')then
    update public.shared_jobs set lifecycle_status='cancelled',finished_at=clock_timestamp(),status_reason='Source or access unavailable'where id=j.id;continue;
   end if;
   claim:=public.claim_knowledge_file_extraction(r.id);
   if claim->>'state'<>'invoke_once'then
    update public.shared_jobs set lifecycle_status=case when claim->>'state'='ready'then'succeeded'else'failed'end,finished_at=clock_timestamp(),status_reason='Extraction already claimed or closed'where id=j.id;continue;
   end if;
  elsif j.subject_type='memory_projection'then claim:=null;
  else update public.shared_jobs set lifecycle_status='failed',finished_at=clock_timestamp(),status_reason='Unsupported community work'where id=j.id;continue;
  end if;
  update public.shared_jobs set lifecycle_status='running',lease_owner=p_worker,lease_expires_at=clock_timestamp()+interval '5 minutes',started_at=coalesce(started_at,clock_timestamp()),attempt_count=attempt_count+1 where id=j.id returning *into j;
  out_rows:=out_rows||jsonb_build_array(jsonb_build_object('job',to_jsonb(j),'claim',claim));
 end loop;
 return jsonb_build_object('jobs',out_rows);
 end
$$;
create function public.brain_finish_extraction(p_job_id uuid,p_worker text,p_claim_token uuid,p_receipt jsonb,p_renditions jsonb default '[]')returns jsonb language plpgsql security definer set search_path='' as $$
 declare j public.shared_jobs;r public.knowledge_file_extractions;f public.knowledge_files;a jsonb;result jsonb;begin
  select *into j from public.shared_jobs where id=p_job_id and domain='community_brain'and subject_type='file_extraction'for update;
  if not found or j.lifecycle_status<>'running'or j.lease_owner is distinct from p_worker or j.lease_expires_at<=clock_timestamp()or j.cancel_requested then raise insufficient_privilege using message='Processing lease is no longer current';end if;
  select *into r from public.knowledge_file_extractions where id=(j.payload->>'extractionId')::uuid and property_id=j.property_id and org_id=j.org_id;
  select *into f from public.knowledge_files where id=r.file_id and property_id=j.property_id;
  if r.claim_token is distinct from p_claim_token or f.state<>'stored'or not public.brain_can(r.actor_id,j.property_id,'manage')then raise insufficient_privilege using message='Source or community access changed';end if;
  if jsonb_typeof(p_renditions)<>'array'or jsonb_array_length(p_renditions)>100 then raise exception 'Invalid rendition receipt';end if;
  for a in select value from jsonb_array_elements(p_renditions)loop
   if a->>'originalHash' is distinct from f.input->>'byteHash'or a->>'storagePath'not like j.property_id::text||'/'||f.id::text||'/%'then raise exception 'Rendition original identity mismatch';end if;
   insert into public.community_file_renditions(id,file_id,property_id,recipe,page,kind,mime_type,storage_path,content_hash,original_hash,byte_size,metadata)
    values((a->>'id')::uuid,f.id,j.property_id,a->>'recipe',(a->>'page')::integer,a->>'kind',a->>'mimeType',a->>'storagePath',a->>'contentHash',a->>'originalHash',(a->>'byteSize')::bigint,coalesce(a->'metadata','{}'))
    on conflict(file_id,recipe,page,kind)do nothing;
   if not exists(select 1 from public.community_file_renditions where file_id=f.id and recipe=a->>'recipe'and page=(a->>'page')::integer and kind=a->>'kind'and content_hash=a->>'contentHash'and original_hash=a->>'originalHash')then raise exception 'Conflicting rendition replay';end if;
  end loop;
  result:=public.record_knowledge_file_extraction(r.id,p_claim_token,p_receipt);
  update public.shared_jobs set lifecycle_status=case when result->>'state'='ready'then'succeeded'else'failed'end,output=result,finished_at=clock_timestamp(),lease_expires_at=null where id=j.id;
  return result;
 end
$$;

create function public.brain_read_asset(p_scope_id uuid,p_asset_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare a public.content_assets;s public.community_task_scopes;begin
  select *into s from public.community_task_scopes where id=p_scope_id;
  select *into a from public.content_assets where id=p_asset_id;
  if not found or a.archived_at is not null or not public.brain_scope_current(p_scope_id,a.property_id)or not public.brain_can(s.actor_id,a.property_id,'download')then raise insufficient_privilege using message='Asset is unavailable';end if;
  if a.storage_bucket not in('knowledge-originals','property-assets','content-assets','brand-assets')or public.brain_storage_owner(a.storage_path)is distinct from a.property_id or a.content_hash!~'^[a-f0-9]{64}$'then raise exception 'Asset storage identity needs reconciliation';end if;
  return jsonb_build_object('id',a.id,'propertyId',a.property_id,'name',a.name,'bucket',a.storage_bucket,'path',a.storage_path,'hash',a.content_hash,'format',a.format,'revision',a.governance_revision);
 end
$$;

alter table public.community_file_renditions enable row level security;
revoke all on public.community_file_renditions from public,anon,authenticated;
grant select,insert on public.community_file_renditions to service_role;
do $$declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'brain\_%'escape '\'and p.proname<>'brain_can'loop
  execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
 end loop;
end$$;
grant execute on function public.brain_storage_owner(text) to authenticated;
-- Native file/asset functions are updated below, retaining their existing decision transactions.

CREATE OR REPLACE FUNCTION "public"."_brain_begin_knowledge_file"("p_id" "uuid", "p_property_id" "uuid", "p_actor_id" "uuid", "p_input" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare v_start jsonb;v_path text;
begin
 v_start:=public.knowledge_file_start(p_id,p_property_id,p_actor_id,'upload_requested',p_input);if v_start->>'state'<>'new'then return v_start;end if;
 if p_input-array['title','fileName','mimeType','size','byteHash','reason','materialId']<>'{}'or not(p_input?&array['title','fileName','mimeType','size','byteHash','reason','materialId'])or length(btrim(coalesce(p_input->>'title','')))not between 1 and 300 or length(coalesce(p_input->>'fileName',''))not between 1 and 255 or public.brain_file_limit(coalesce(p_input->>'mimeType',''))=0 or coalesce(p_input->>'byteHash','')!~'^[a-f0-9]{64}$'or jsonb_typeof(p_input->'size')is distinct from'number'or (p_input->>'size')::numeric<>trunc((p_input->>'size')::numeric)or(p_input->>'size')::numeric not between 1 and public.brain_file_limit(p_input->>'mimeType')then raise exception 'Provide the exact supported original file';end if;
 if p_input->>'materialId'is not null and not exists(select 1 from public.knowledge_materials where id=(p_input->>'materialId')::uuid and property_id=p_property_id and org_id=(v_start->>'orgId')::uuid)then return'{"state":"not_found"}';end if;
 v_path:=p_property_id::text||'/'||p_id::text||'/original';
 insert into public.knowledge_files(id,property_id,org_id,actor_id,input,input_hash,storage_path)values(p_id,p_property_id,(v_start->>'orgId')::uuid,p_actor_id,p_input,public.knowledge_hash(p_input),v_path);
 return public.knowledge_file_finish(p_id,p_property_id,p_actor_id,p_id,'upload_requested',p_input,null,jsonb_build_object('state','pending'),jsonb_build_object('fileId',p_id,'fileState','pending'));
end$_$;


CREATE OR REPLACE FUNCTION "public"."record_knowledge_file_extraction"("p_id" "uuid", "p_claim_token" "uuid", "p_receipt" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare v_run public.knowledge_file_extractions;v_file public.knowledge_files;v_ready boolean;v_state text;
begin
 select *into v_run from public.knowledge_file_extractions where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_run.property_id::text,12));
 select *into v_run from public.knowledge_file_extractions where id=p_id for update;select *into v_file from public.knowledge_files where id=v_run.file_id;
 if p_claim_token is null or v_run.claim_token is distinct from p_claim_token then return'{"state":"request_conflict"}';end if;
 if v_run.receipt is not null then if v_run.receipt<>p_receipt then return'{"state":"receipt_changed"}';end if;return jsonb_build_object('state',v_run.state,'receiptHash',v_run.receipt_hash);end if;
 if jsonb_typeof(p_receipt)is distinct from'object'or octet_length(p_receipt::text)>8388608 then raise exception 'Retain a bounded extraction receipt';end if;
 v_ready:=p_receipt->'complete'='true'::jsonb and p_receipt->>'fileHash'=v_file.input->>'byteHash'and p_receipt->>'recipe'in('unpdf-1.4.0-pages-v1','community-file-v1')and jsonb_typeof(p_receipt->'pages')='array'and coalesce(p_receipt->>'totalPages','')~'^[1-9][0-9]{0,2}$'and jsonb_typeof(p_receipt->'text')='string'and octet_length(p_receipt->>'text')between 0 and 1048576 and(length(btrim(p_receipt->>'text'))>0 or p_receipt->'retrievalOnly'='true'::jsonb);
 if v_ready then
  v_ready:=jsonb_array_length(p_receipt->'pages')between 1 and 100 and jsonb_array_length(p_receipt->'pages')=(p_receipt->>'totalPages')::integer
  and not exists(select 1 from jsonb_array_elements(p_receipt->'pages')with ordinality p(v,n)where jsonb_typeof(v)is distinct from'string')
  and (select string_agg(v#>>'{}',E'\n\n'order by n)from jsonb_array_elements(p_receipt->'pages')with ordinality p(v,n))=p_receipt->>'text';
 end if;
 v_state:=case when v_run.state='stopped'then'stopped'when coalesce(v_ready,false)and v_file.state='stored'and v_file.latest_extraction_id=p_id and public.brain_can(v_run.actor_id,v_run.property_id,'manage')and exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=v_run.property_id and p.org_id=v_run.org_id and u.id=v_run.actor_id and u.role in('admin','manager'))then'ready'else'held'end;
 perform set_config('p11.knowledge_file_scope',v_run.property_id::text,true);
 update public.knowledge_file_extractions set receipt=p_receipt,receipt_hash=public.knowledge_hash(p_receipt),state=v_state,finished_at=coalesce(finished_at,clock_timestamp())where id=p_id;
 perform public.knowledge_file_service_event(p_id,v_run.property_id,v_run.org_id,'knowledge.file.extraction_received',jsonb_build_object('fileId',v_file.id,'extractionId',p_id,'receiptHash',public.knowledge_hash(p_receipt),'extractionState',v_state));
 return jsonb_build_object('state',v_state,'receiptHash',public.knowledge_hash(p_receipt));
end$_$;


CREATE OR REPLACE FUNCTION "public"."_brain_begin_forgestudio_asset_upload"("p_id" "uuid", "p_property_id" "uuid", "p_actor_id" "uuid", "p_input" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
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
 return jsonb_build_object('state','prepared','uploadId',p_id,'storagePath',upload.storage_path,'storageBucket',upload.storage_bucket,'duplicateAssetId',duplicate);
end;$_$;


CREATE OR REPLACE FUNCTION "public"."_brain_finish_forgestudio_asset_upload"("p_id" "uuid", "p_property_id" "uuid", "p_actor_id" "uuid", "p_payload" "jsonb", "p_keep_separate" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
  if p_payload->>'contentHash' is distinct from upload.input->>'contentHash' or p_payload->>'storagePath' is distinct from upload.storage_path or p_payload->>'storageBucket' is distinct from upload.storage_bucket or coalesce((p_payload->>'storageVerified')::boolean,false) is not true or coalesce(p_payload->>'fileUrl','')='' then raise exception 'Stored file evidence required';end if;
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


commit;
