begin;

create or replace function public.brain_context_current(p_context_id uuid,p_actor_id uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
 declare s public.shared_context_snapshots;c jsonb;purpose text;begin
 select *into s from public.shared_context_snapshots where id=p_context_id and source_domain='community_brain'and scope_kind='community'and invalidated_at is null;
 if not found or s.captured_by<>p_actor_id::text then return false;end if;
 purpose:=s.context_payload->>'purpose';
 if not public.brain_can(p_actor_id,s.property_id,public.brain_scope_capability(purpose))then return false;end if;
 -- Re-check current sources independently of the initial scope TTL. A fresh dispatch scope is still required by callers.
 c:=public.brain_canonical_context(s.property_id,purpose,array(select jsonb_array_elements_text(s.context_payload->'selectedAssetIds'))::uuid[]);
 if public.knowledge_hash(c-'asOf')<>public.knowledge_hash((s.context_payload->'canonical')-'asOf')then return false;end if;
 if exists(select 1 from jsonb_array_elements(s.context_payload->'evidence')x where not public.brain_evidence_eligible((x->>'evidenceId')::uuid,s.property_id,purpose,case when purpose in('chat','site','social','brand')then'public'else'internal'end))then return false;end if;
 return true;
end$$;

create or replace function public.brain_review_asset(p_scope_id uuid,p_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;f public.knowledge_files;r public.community_file_renditions;a public.content_assets;u public.property_units;path text;hash text;mime text;sz bigint;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 select *into f from public.knowledge_files where id=(p_input->>'fileId')::uuid and property_id=s.property_ids[1]for update;
 if s.kind is distinct from'community'or f.id is null or not public.brain_scope_current(s.id,f.property_id)or not public.brain_can(s.actor_id,f.property_id,'manage')then raise insufficient_privilege;end if;
 if f.state<>'stored'or not exists(select 1 from public.knowledge_file_extractions x where x.id=f.latest_extraction_id and x.property_id=f.property_id and x.state='ready'and x.receipt->>'fileHash'=f.input->>'byteHash')then raise exception 'Review a completed extraction of this original first';end if;
 if p_input->>'originalHash'is distinct from f.input->>'byteHash'or p_input->'confirmed'is distinct from'true'::jsonb or length(p_input->>'reason')not between 3 and 2000 or p_input->>'rights'not in('owned','licensed')then raise exception 'Confirm the exact original and its usage rights';end if;
 if jsonb_typeof(p_input->'isGenerated')is distinct from'boolean'then raise exception 'Identify whether this asset is generated';end if;
 if p_input->>'role'='floorplan'and(p_input->>'isGenerated')::boolean then raise exception 'Generated images cannot establish real floorplan drawings';end if;
 if p_input->>'rights'='licensed'and length(coalesce(p_input->>'license',''))<3 then raise exception 'Record the usage license';end if;
 if p_input->>'renditionId'is not null then
  select *into r from public.community_file_renditions where id=(p_input->>'renditionId')::uuid and file_id=f.id and property_id=f.property_id and original_hash=f.input->>'byteHash';
  if r.id is null then raise exception 'Selected page does not belong to this original';end if;
  path:=r.storage_path;hash:=r.content_hash;mime:=r.mime_type;sz:=r.byte_size;
 else path:=f.storage_path;hash:=f.input->>'byteHash';mime:=f.input->>'mimeType';sz:=(f.input->>'size')::bigint;end if;
 if mime='image/svg+xml'and r.kind is distinct from'sanitized'then raise exception 'Use the validated SVG rendition';end if;
 if mime not like'image/%'and mime not like'font/%'and mime not like'video/%'then raise exception 'Select a rendered page for this document';end if;
 if p_input->>'role'='floorplan'and(r.kind is distinct from'page'or mime<>'image/png')then raise exception 'Floorplans require an exact rendered drawing page';end if;
 if exists(select 1 from public.community_asset_bindings where id=p_id)then
  if not exists(select 1 from public.community_asset_bindings where id=p_id and property_id=f.property_id and actor_id=s.actor_id and decision=p_input)then raise exception 'Asset review identity conflict';end if;
  return(select jsonb_build_object('state','replayed','assetId',asset_id)from public.community_asset_bindings where id=p_id);end if;
 insert into public.content_assets(id,property_id,org_id,name,description,asset_type,asset_role,file_url,file_size_bytes,format,storage_bucket,storage_path,content_hash,original_file_id,original_page,
 is_ai_generated,rights_status,rights_metadata,approval_status,curation_status,approved_by,approved_at,uploaded_by,source_identity,source_metadata,alt_text)
 values(p_id,f.property_id,f.org_id,p_input->>'name',p_input->>'description',case when mime like'font/%'then'font'when mime like'video/%'then'video'else'image'end,p_input->>'role',
 '/api/community-brain/assets?propertyId='||f.property_id||'&assetId='||p_id,sz,case mime when'image/jpeg'then'jpg'when'image/svg+xml'then'svg'else split_part(mime,'/',2)end,'knowledge-originals',path,hash,f.id,r.page,
 (p_input->>'isGenerated')::boolean,p_input->>'rights',jsonb_build_object('license',p_input->>'license','reviewReason',p_input->>'reason'),'approved','approved',s.actor_id,clock_timestamp(),s.actor_id,'knowledge-file:'||f.id||':'||coalesce(r.id::text,'original'),jsonb_build_object('originalHash',f.input->>'byteHash','renditionId',r.id),p_input->>'description')returning *into a;
 if p_input->>'unitId'is not null then
  select *into u from public.property_units where id=(p_input->>'unitId')::uuid and property_id=f.property_id for update;
  if u.id is null or p_input->>'role'<>'floorplan'or public.knowledge_hash(to_jsonb(u))is distinct from p_input->>'unitHash'then raise exception 'Floorplan changed or belongs to another community';end if;
  perform set_config('p11.unit_review_scope',f.property_id::text,true);
  update public.property_units set floor_plan_image_asset_id=a.id,floor_plan_image_url=a.file_url,floor_plan_image_alt=a.alt_text,last_updated_at=clock_timestamp()where id=u.id and property_id=f.property_id;
 end if;
 insert into public.community_asset_bindings(id,property_id,org_id,actor_id,file_id,asset_id,unit_id,original_hash,decision)values(p_id,f.property_id,f.org_id,s.actor_id,f.id,a.id,u.id,f.input->>'byteHash',p_input);
 return jsonb_build_object('state','saved','assetId',a.id,'unitId',u.id);end$$;

alter table public.content_assets add constraint brain_real_floorplan check(not(asset_role='floorplan'and is_ai_generated))not valid;

create or replace function public.brain_search(p_scope_id uuid,p_property_id uuid,p_query text,p_embedding public.vector default null,p_model text default null,p_limit integer default 12) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
 declare s public.community_task_scopes;result jsonb;
 begin
  if not public.brain_scope_current(p_scope_id,p_property_id) then raise insufficient_privilege using message='Community scope expired or access changed';end if;
  if length(p_query)>4000 or p_limit not between 1 and 50 then raise exception 'Search exceeds its bounded input';end if;
  if p_embedding is not null and(public.vector_dims(p_embedding)<>1536 or p_model is distinct from 'text-embedding-3-small') then raise exception 'Embedding namespace mismatch';end if;
  select * into s from public.community_task_scopes where id=p_scope_id;
  with eligible as materialized(
   select d.*,e.allowed_uses,e.authority,e.audience,e.content_hash source_hash
   from public.documents d join public.community_evidence e on e.id=d.evidence_id and e.property_id=d.property_id
   where d.property_id=p_property_id and public.brain_evidence_eligible(e.id,p_property_id,s.purpose,case when s.purpose in('chat','site','social','brand') then 'public' else 'internal' end)
  ), lexical as(
   select id,row_number()over(order by ts_rank_cd(search_text,websearch_to_tsquery('english',p_query))desc,id)rank
   from eligible where search_text@@websearch_to_tsquery('english',p_query) limit 100
  ), semantic as(
   select id,row_number()over(order by embedding operator(public.<=>) p_embedding,id)rank
   from eligible where p_embedding is not null and embedding is not null and embedding_model=p_model and embedding_recipe in('community-text-v1','lossless-utf8-4096-v1')
   order by embedding operator(public.<=>) p_embedding,id limit 100
  ), ranked as(
   select e.*,coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+v.rank),0)score from eligible e
   left join lexical l on l.id=e.id left join semantic v on v.id=e.id where l.id is not null or v.id is not null
   order by score desc,e.id
  ), diverse as(select r.*,row_number()over(partition by evidence_id order by score desc,id)source_rank from ranked r), selected as(select *from diverse where source_rank<=2 order by score desc,id limit p_limit) select coalesce(jsonb_agg(jsonb_build_object('id',id,'propertyId',property_id,'evidenceId',evidence_id,'sourceHash',source_hash,'content',left(content,8000),'allowedUses',allowed_uses,'authority',authority,'audience',audience,'score',score,'metadata',metadata)order by score desc,id),'[]') into result from selected;
  return jsonb_build_object('propertyId',p_property_id,'scopeId',p_scope_id,'items',result,'recipe','community-hybrid-rrf-v1','readAt',statement_timestamp());
 end
$$;

create or replace function public.brain_project_memory(p_job_id uuid,p_worker text)returns jsonb language plpgsql security definer set search_path='' as $$
 declare j public.shared_jobs;ev public.community_memory_events;m public.knowledge_materials;v public.knowledge_material_versions;r public.community_source_reviews;
 d public.property_intelligence_documents;a public.content_assets;e public.community_evidence;eid uuid;body text;h text;source_kind text;source_id uuid;outcome text:='canonical_refreshed';part record;begin
 select *into j from public.shared_jobs where id=p_job_id and domain='community_brain'and subject_type='memory_projection'for update;
 if not found or not public.brain_worker_can(j.property_id)or not public.brain_worker_lease(p_worker)or j.lease_owner is distinct from p_worker or j.lifecycle_status<>'running'or j.lease_expires_at<=clock_timestamp()or j.cancel_requested then raise insufficient_privilege;end if;
 select *into strict ev from public.community_memory_events where id=(j.payload->>'eventId')::uuid and property_id=j.property_id and job_id=j.id;
 if ev.source_table='knowledge_materials'then
  select *into m from public.knowledge_materials where id=ev.source_id and property_id=j.property_id;
  select *into v from public.knowledge_material_versions where id=m.active_version_id and property_id=j.property_id;
  update public.community_evidence set review_status='withdrawn'where property_id=j.property_id and material_version_id in(select id from public.knowledge_material_versions where material_id=m.id)and material_version_id is distinct from m.active_version_id and review_status<>'withdrawn';
  if v.id is not null then
   select *into r from public.community_source_reviews where version_id=v.id and property_id=j.property_id;
   if r.version_id is not null and r.review_after>clock_timestamp()and(r.expires_at is null or r.expires_at>clock_timestamp())then
   h:=v.content_hash;eid:=md5('material:'||v.id::text)::uuid;body:=v.content;
   insert into public.community_evidence(id,property_id,org_id,material_version_id,authority,audience,purposes,allowed_uses,content_hash,review_status,review_after,expires_at,origin)
   values(eid,j.property_id,j.org_id,v.id,case when 'fact'=any(r.allowed_uses)then'reviewed'when r.origin='generated'then'creative'else'observed'end,coalesce(r.audience,'internal'),coalesce(r.purposes,array['research','portfolio']),coalesce(r.allowed_uses,array['research']),h,case when r.version_id is null then'pending'else'approved'end,coalesce(r.review_after,clock_timestamp()+interval '90 days'),r.expires_at,coalesce(r.origin,'derived'))
   on conflict(id)do update set review_status=excluded.review_status,audience=excluded.audience,allowed_uses=excluded.allowed_uses,purposes=excluded.purposes,review_after=excluded.review_after,expires_at=excluded.expires_at;
   outcome:='indexed';
   else outcome:='source_review_required';end if;
  end if;
 elsif ev.source_table='property_intelligence_documents'then
  select *into d from public.property_intelligence_documents where id=ev.source_id and property_id=j.property_id;
  if d.kind='creative'and d.status='approved'then
   h:=public.knowledge_hash(d.payload);eid:=md5('creative:'||d.id::text||h)::uuid;body:=d.payload::text;
   insert into public.community_evidence(id,property_id,org_id,creative_id,authority,audience,purposes,allowed_uses,content_hash,review_status,review_after,origin)
   values(eid,j.property_id,j.org_id,d.id,'creative',case when d.payload->>'visibility'='public'then'public'else'internal'end,array['social','brand','site','portfolio'],array['style'],h,'approved',clock_timestamp()+interval '90 days','generated')on conflict(id)do nothing;
   outcome:='creative_indexed';
  end if;
 elsif ev.source_table='content_assets'then
  select *into a from public.content_assets where id=ev.source_id and property_id=j.property_id;
  if a.approval_status='approved'and a.archived_at is null and coalesce(a.content_hash,'')~'^[a-f0-9]{64}$'then
   h:=a.content_hash;eid:=md5('asset:'||a.id::text||h)::uuid;body:=concat_ws(E'
',a.name,a.description,a.alt_text);
   insert into public.community_evidence(id,property_id,org_id,asset_id,authority,audience,purposes,allowed_uses,content_hash,review_status,review_after,expires_at,origin)
   values(eid,j.property_id,j.org_id,a.id,'creative','internal',array['portfolio','research'],array['style'],h,'approved',coalesce(a.expires_at,clock_timestamp()+interval '365 days'),a.expires_at,case when a.is_ai_generated then'generated'else'original'end)on conflict(id)do nothing;
   outcome:='asset_indexed';
  end if;
 end if;
 if eid is not null and length(coalesce(body,''))>0 then
  -- Reuse exact validated native embedding receipts, retaining their actual namespace.
  if v.id is not null then
   update public.documents d set evidence_id=eid,embedding_model='text-embedding-3-small',embedding_recipe='lossless-utf8-4096-v1'
   from public.knowledge_embedding_requests k,jsonb_array_elements(k.model_input->'chunks')with ordinality ch(value,n),jsonb_array_elements(k.raw_result#>'{response,data}') emb
   where k.version_id=v.id and k.property_id=j.property_id and k.state='ready'and k.model_input->>'model'='text-embedding-3-small'and k.model_input->>'recipe'='lossless-utf8-4096-v1'
   and k.model_input->>'contentHash'=h and d.property_id=j.property_id and d.metadata->>'version_id'=v.id::text
   and d.metadata->>'chunk_index'=(ch.n-1)::text and d.content=(ch.value#>>'{}')and(emb->>'index')::int=ch.n-1
   and d.embedding=(emb->'embedding')::text::public.vector;
  end if;
  if not exists(select 1 from public.documents where property_id=j.property_id and evidence_id=eid and embedding_model='text-embedding-3-small')then
  -- Derived text is replaceable. Exact assets and canonical records remain authoritative.
  for part in select n,substring(body from n for 3500)text from generate_series(1,least(length(body),262144),3000)n loop
   insert into public.documents(id,property_id,content,metadata,evidence_id)
   values(md5(eid::text||':'||part.n)::uuid,j.property_id,part.text,jsonb_build_object('recipe','community-text-v1','chunkOffset',part.n,'sourceHash',h),eid)
   on conflict(id)do nothing;
  end loop;
  end if;
 end if;
 insert into public.community_memory_receipts(event_id,property_id,outcome,projection_hash)values(ev.id,j.property_id,outcome,coalesce(h,ev.source_hash))on conflict(event_id)do nothing;
 update public.shared_jobs set lifecycle_status='succeeded',finished_at=clock_timestamp(),lease_expires_at=null,output=jsonb_build_object('state',outcome,'evidenceId',eid)where id=j.id;
 return jsonb_build_object('state',outcome,'evidenceId',eid);
end$$;

create or replace function public.brain_provider_cleanup(p_id uuid default null,p_confirmed boolean default false)returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_id is not null then update public.community_provider_objects set state=case when p_confirmed then'deleted'else'deletion_unconfirmed'end,last_checked_at=clock_timestamp(),deleted_at=case when p_confirmed then clock_timestamp()end where id=p_id and state in('delete_requested','deletion_unconfirmed','expired_unconfirmed');return jsonb_build_object('recorded',found);end if;
 return(with chosen as(
  select id from public.community_provider_objects where state<>'deleted'and(expires_at<=clock_timestamp()or state='delete_requested')and(last_checked_at is null or last_checked_at<clock_timestamp()-interval '1 hour')order by expires_at,id limit 50 for update skip locked), marked as(update public.community_provider_objects o set state='delete_requested',last_checked_at=clock_timestamp()from chosen c where o.id=c.id returning o.*)select coalesce(jsonb_agg(to_jsonb(marked)order by case object_kind when'container'then 0 when'output_file'then 2 else 1 end),'[]')from marked);end$$;

commit;
