begin;
create function public.brain_documents(p_property_id uuid,p_purpose text,p_query text,p_ids uuid[] default null)returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(
 select d.id,d.content,d.metadata,e.allowed_uses,e.content_hash,e.authority,e.audience from public.documents d join public.community_evidence e on e.id=d.evidence_id and e.property_id=d.property_id
 where p_property_id is not null and d.property_id=p_property_id and public.brain_evidence_eligible(e.id,p_property_id,p_purpose,case when p_purpose in('site','social','brand','chat')then'public'else'internal'end)
 and(case when p_ids is not null then d.id=any(p_ids)else d.search_text@@websearch_to_tsquery('english',left(p_query,4000))end)
 order by ts_rank_cd(d.search_text,websearch_to_tsquery('english',left(p_query,4000)))desc,d.id limit 12)q
$$;
create table public.community_asset_bindings(
 id uuid primary key,property_id uuid not null,org_id uuid not null,actor_id uuid not null references auth.users(id),
 file_id uuid not null,asset_id uuid not null,unit_id uuid,original_hash text not null,decision jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(property_id,org_id)references public.properties(id,org_id),foreign key(file_id,property_id)references public.knowledge_files(id,property_id),
 foreign key(asset_id,property_id)references public.content_assets(id,property_id),foreign key(unit_id,property_id)references public.property_units(id,property_id)
);
create function public.brain_file_detail(p_scope_id uuid,p_file_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare f public.knowledge_files;begin select *into f from public.knowledge_files where id=p_file_id;
 if not found or not public.brain_scope_current(p_scope_id,f.property_id)then raise insufficient_privilege;end if;
 return jsonb_build_object('file',to_jsonb(f),'extraction',(select to_jsonb(x)from public.knowledge_file_extractions x where id=f.latest_extraction_id and property_id=f.property_id),
 'renditions',(select coalesce(jsonb_agg(to_jsonb(r)-'storage_path'-'storage_bucket'order by page,kind),'[]')from public.community_file_renditions r where file_id=f.id and property_id=f.property_id),
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.unit_type,'hash',public.knowledge_hash(to_jsonb(u)))order by u.unit_type,u.id),'[]')from public.property_units u where u.property_id=f.property_id and u.active));end$$;
create function public.brain_review_asset(p_scope_id uuid,p_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;f public.knowledge_files;r public.community_file_renditions;a public.content_assets;u public.property_units;path text;hash text;mime text;sz bigint;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 select *into f from public.knowledge_files where id=(p_input->>'fileId')::uuid and property_id=s.property_ids[1]for update;
 if s.kind is distinct from'community'or f.id is null or not public.brain_scope_current(s.id,f.property_id)or not public.brain_can(s.actor_id,f.property_id,'manage')then raise insufficient_privilege;end if;
 if f.state<>'stored'or not exists(select 1 from public.knowledge_file_extractions x where x.id=f.latest_extraction_id and x.property_id=f.property_id and x.state='ready'and x.receipt->>'fileHash'=f.input->>'byteHash')then raise exception 'Review a completed extraction of this original first';end if;
 if p_input->>'originalHash'is distinct from f.input->>'byteHash'or p_input->'confirmed'is distinct from'true'::jsonb or length(p_input->>'reason')not between 3 and 2000 or p_input->>'rights'not in('owned','licensed')then raise exception 'Confirm the exact original and its usage rights';end if;
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
 rights_status,rights_metadata,approval_status,curation_status,approved_by,approved_at,uploaded_by,source_identity,source_metadata,alt_text)
 values(p_id,f.property_id,f.org_id,p_input->>'name',p_input->>'description',case when mime like'font/%'then'font'when mime like'video/%'then'video'else'image'end,p_input->>'role',
 '/api/community-brain/assets?propertyId='||f.property_id||'&assetId='||p_id,sz,case mime when'image/jpeg'then'jpg'when'image/svg+xml'then'svg'else split_part(mime,'/',2)end,'knowledge-originals',path,hash,f.id,r.page,
 p_input->>'rights',jsonb_build_object('license',p_input->>'license','reviewReason',p_input->>'reason'),'approved','approved',s.actor_id,clock_timestamp(),s.actor_id,'knowledge-file:'||f.id||':'||coalesce(r.id::text,'original'),jsonb_build_object('originalHash',f.input->>'byteHash','renditionId',r.id),p_input->>'description')returning *into a;
 if p_input->>'unitId'is not null then
  select *into u from public.property_units where id=(p_input->>'unitId')::uuid and property_id=f.property_id for update;
  if u.id is null or p_input->>'role'<>'floorplan'or public.knowledge_hash(to_jsonb(u))is distinct from p_input->>'unitHash'then raise exception 'Floorplan changed or belongs to another community';end if;
  perform set_config('p11.unit_review_scope',f.property_id::text,true);
  update public.property_units set floor_plan_image_asset_id=a.id,floor_plan_image_url=a.file_url,floor_plan_image_alt=a.alt_text,last_updated_at=clock_timestamp()where id=u.id and property_id=f.property_id;
 end if;
 insert into public.community_asset_bindings(id,property_id,org_id,actor_id,file_id,asset_id,unit_id,original_hash,decision)values(p_id,f.property_id,f.org_id,s.actor_id,f.id,a.id,u.id,f.input->>'byteHash',p_input);
 return jsonb_build_object('state','saved','assetId',a.id,'unitId',u.id);end$$;
create function public.brain_original_identity_guard()returns trigger language plpgsql set search_path='' as $$begin
 if old.original_file_id is not null and(tg_op='DELETE'or(to_jsonb(new)->'content_hash',to_jsonb(new)->'storage_path',to_jsonb(new)->'storage_bucket',to_jsonb(new)->'original_file_id',to_jsonb(new)->'original_page')is distinct from(to_jsonb(old)->'content_hash',to_jsonb(old)->'storage_path',to_jsonb(old)->'storage_bucket',to_jsonb(old)->'original_file_id',to_jsonb(old)->'original_page'))then raise exception 'Archive the asset and review a replacement; original identity is immutable';end if;return case when tg_op='DELETE'then old else new end;end$$;
create trigger brain_asset_original_immutable before update or delete on public.content_assets for each row execute function public.brain_original_identity_guard();

create table public.community_model_calls(
 id uuid primary key,scope_id uuid not null references public.community_task_scopes(id),actor_id uuid not null references auth.users(id),org_id uuid not null references public.organizations(id),
 portfolio_session_id uuid references public.community_portfolio_sessions(id),request_hash text not null,model text not null,input_units int not null,output_limit int not null,
 state text not null default'invoking'check(state in('invoking','received','uncertain','failed')),response jsonb,usage jsonb,provider_object_id uuid references public.community_provider_objects(id),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,check(input_units between 1 and 100000 and output_limit between 1 and 3000)
);
create index community_model_daily on public.community_model_calls(actor_id,created_at);
create function public.brain_begin_model(p_scope_id uuid,p_id uuid,p_session_id uuid,p_hash text,p_model text,p_units int,p_output int)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;c public.community_model_calls;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'portfolio'then raise insufficient_privilege;end if;
 perform public.brain_portfolio_session(s.id,p_session_id);
 perform pg_advisory_xact_lock(hashtextextended(s.actor_id::text,92));
 select *into c from public.community_model_calls where id=p_id;
 if found then
  if c.actor_id<>s.actor_id or c.portfolio_session_id<>p_session_id or c.request_hash<>p_hash then raise insufficient_privilege;end if;
  return jsonb_build_object('state',c.state,'response',c.response);
 end if;
 if(select count(*)from public.community_model_calls where actor_id=s.actor_id and created_at>=date_trunc('day',clock_timestamp()))>=100
 or(select coalesce(sum(input_units+output_limit),0)from public.community_model_calls where actor_id=s.actor_id and created_at>=date_trunc('day',clock_timestamp()))+p_units+p_output>1000000 then raise exception 'Daily portfolio processing allowance reached';end if;
 insert into public.community_model_calls(id,scope_id,actor_id,org_id,portfolio_session_id,request_hash,model,input_units,output_limit)values(p_id,s.id,s.actor_id,s.org_id,p_session_id,p_hash,p_model,p_units,p_output);
 return jsonb_build_object('state','invoke_once');end$$;
create function public.brain_finish_model(p_scope_id uuid,p_id uuid,p_response jsonb,p_uncertain boolean)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;c public.community_model_calls;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into c from public.community_model_calls where id=p_id for update;
 if not found or c.scope_id<>s.id or c.actor_id<>s.actor_id then raise insufficient_privilege;end if;
 if c.state='received'then if c.response is distinct from p_response then raise exception 'Conflicting model receipt';end if;else
  if c.state<>'invoking'or octet_length(p_response::text)>1000000 then raise exception 'Model request is not awaiting this result';end if;
  update public.community_model_calls set state=case when p_uncertain then'uncertain'else'received'end,response=p_response,usage=p_response->'usage',finished_at=clock_timestamp()where id=p_id;
 end if;
 return jsonb_build_object('state','saved','usable',public.brain_scope_current(s.id,s.property_ids[1]));end$$;

create function public.brain_reconciliation(p_scope_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare s public.community_task_scopes;pid uuid;begin select *into s from public.community_task_scopes where id=p_scope_id;pid:=s.property_ids[1];
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,pid)then raise insufficient_privilege;end if;
 return jsonb_build_object('propertyId',pid,'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'classification',case when evidence_id is null then'needs_review'when public.brain_evidence_eligible(evidence_id,pid,'research','internal')then'eligible'else'history_or_withdrawn'end,'embeddingCompatible',embedding_model='text-embedding-3-small'and embedding_recipe='community-text-v1','contentHash',public.knowledge_hash(to_jsonb(content)))),'[]')from public.documents where property_id=pid),
 'competitorChunks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'captureId',capture_id,'classification',case when capture_id is null then'unresolved'when evidence_id is null then'needs_review'when public.brain_evidence_eligible(evidence_id,pid,'research','internal')then'eligible'else'history_or_withdrawn'end,'embeddingCompatible',embedding_model='text-embedding-3-small'and embedding_recipe='community-text-v1')),'[]')from public.competitor_content_chunks where property_id=pid),
 'assets',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'classification',case when storage_path is null or coalesce(content_hash,'')!~'^[a-f0-9]{64}$'then'needs_identity_review'else'linked'end)),'[]')from public.content_assets where property_id=pid));end$$;
create function public.brain_operational_status(p_scope_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare s public.community_task_scopes;begin select *into s from public.community_task_scopes where id=p_scope_id;
 if not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 return jsonb_build_object('communities',(select jsonb_agg(jsonb_build_object('propertyId',p.id,'queued',(select count(*)from public.shared_jobs where property_id=p.id and domain='community_brain'and lifecycle_status in('queued','retrying')),'oldestQueuedAt',(select min(created_at)from public.shared_jobs where property_id=p.id and domain='community_brain'and lifecycle_status in('queued','retrying')),'failed',(select count(*)from public.shared_jobs where property_id=p.id and domain='community_brain'and lifecycle_status='failed'),'overdueEvidence',(select count(*)from public.community_evidence where property_id=p.id and review_status='approved'and review_after<=now()),'overdueSources',(select count(*)from public.knowledge_materials where property_id=p.id and next_check_at<now()),'pendingProviderCleanup',(select count(*)from public.community_provider_objects where property_id=p.id and state<>'deleted'and expires_at<now()))order by p.id)from public.properties p where id=any(s.property_ids)),'readAt',statement_timestamp());end$$;

do $$declare t text;f regprocedure;begin
 foreach t in array array['community_asset_bindings','community_model_calls']loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,community_brain_worker',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'brain\_%'escape '\'and p.proname not in('brain_can','brain_storage_owner')loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;
end$$;
commit;
