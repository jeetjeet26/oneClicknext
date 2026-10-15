begin;
-- Worker identities have no table-wide bypass and no general service key.
do $$begin if not exists(select 1 from pg_roles where rolname='community_brain_worker')then create role community_brain_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;end if;end$$;
grant community_brain_worker to authenticator;
grant usage on schema public,storage to community_brain_worker;
create table public.community_worker_grants(
 principal_id uuid not null references auth.users(id),property_id uuid not null references public.properties(id),
 expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 primary key(principal_id,property_id)
);
alter table public.community_worker_grants enable row level security;
revoke all on public.community_worker_grants from public,anon,authenticated,community_brain_worker;
grant select,insert,update,delete on public.community_worker_grants to service_role;
create function public.brain_worker_can(p_property_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select current_setting('role',true)in('service_role','postgres','supabase_admin','none') or exists(
 select 1 from public.community_worker_grants g join auth.users u on u.id=g.principal_id
 where current_setting('role',true)='community_brain_worker'and g.principal_id=auth.uid()and g.property_id=p_property_id
 and g.expires_at>statement_timestamp()and g.revoked_at is null and u.deleted_at is null and(u.banned_until is null or u.banned_until<=statement_timestamp()))
$$;
create function public.brain_worker_lease(p_worker text)returns boolean language sql stable set search_path='' as $$
 select length(p_worker)between 16 and 120 and(current_setting('role',true)<>'community_brain_worker'or split_part(p_worker,'/',1)=auth.uid()::text)
$$;
create function public.brain_worker_object(p_name text,p_write boolean)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shared_jobs j join public.knowledge_file_extractions x on x.id=(j.payload->>'extractionId')::uuid and x.property_id=j.property_id
 join public.knowledge_files f on f.id=x.file_id and f.property_id=j.property_id
 where j.domain='community_brain'and j.subject_type='file_extraction'and j.lifecycle_status='running'and not j.cancel_requested
 and j.lease_expires_at>statement_timestamp()and split_part(j.lease_owner,'/',1)=auth.uid()::text and public.brain_worker_can(j.property_id)
 and public.brain_can(x.actor_id,j.property_id,'manage')and f.state='stored'
 and(case when p_write then p_name like j.property_id::text||'/'||f.id::text||'/community-file-v1/%'
 else p_name=f.storage_path or p_name like j.property_id::text||'/'||f.id::text||'/community-file-v1/%'end))
$$;
grant select,insert on storage.objects to community_brain_worker;
create policy community_worker_read on storage.objects for select to community_brain_worker using(bucket_id='knowledge-originals'and public.brain_worker_object(name,false));
create policy community_worker_write on storage.objects for insert to community_brain_worker with check(bucket_id='knowledge-originals'and public.brain_worker_object(name,true));
-- Never widen to service-role credentials when a worker's assignment expires.

create or replace function public.brain_claim_work(p_worker text,p_limit integer default 2)returns jsonb language plpgsql security definer set search_path='' as $$
 declare j public.shared_jobs;r public.knowledge_file_extractions;f public.knowledge_files;claim jsonb;out_rows jsonb:='[]';begin
 if not public.brain_worker_lease(p_worker) or p_limit not between 1 and 5 then raise exception 'Invalid worker lease request';end if;
 -- One job per community in each batch prevents a large upload from starving other communities.
 for j in with candidates as(select id,row_number()over(partition by property_id order by available_at,id)n from public.shared_jobs where domain='community_brain'and public.brain_worker_can(property_id)and lifecycle_status in('queued','retrying')and not cancel_requested and available_at<=clock_timestamp()and attempt_count<max_attempts)
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
create or replace function public.brain_finish_extraction(p_job_id uuid,p_worker text,p_claim_token uuid,p_receipt jsonb,p_renditions jsonb default '[]')returns jsonb language plpgsql security definer set search_path='' as $$
 declare j public.shared_jobs;r public.knowledge_file_extractions;f public.knowledge_files;a jsonb;result jsonb;begin
  select *into j from public.shared_jobs where id=p_job_id and domain='community_brain'and subject_type='file_extraction'for update;
  if not found or not public.brain_worker_can(j.property_id)or not public.brain_worker_lease(p_worker)or j.lifecycle_status<>'running'or j.lease_owner is distinct from p_worker or j.lease_expires_at<=clock_timestamp()or j.cancel_requested then raise insufficient_privilege using message='Processing lease is no longer current';end if;
  select *into r from public.knowledge_file_extractions where id=(j.payload->>'extractionId')::uuid and property_id=j.property_id and org_id=j.org_id;
  select *into f from public.knowledge_files where id=r.file_id and property_id=j.property_id;
  if r.claim_token is distinct from p_claim_token or f.state<>'stored'or not public.brain_can(r.actor_id,j.property_id,'manage')then raise insufficient_privilege using message='Source or community access changed';end if;
  if jsonb_typeof(p_renditions)<>'array'or jsonb_array_length(p_renditions)>200 then raise exception 'Invalid rendition receipt';end if;
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

create function public.brain_heartbeat(p_job_id uuid,p_worker text)returns boolean language plpgsql security definer set search_path='' as $$begin
 update public.shared_jobs set lease_expires_at=clock_timestamp()+interval '5 minutes'where id=p_job_id and domain='community_brain'and lifecycle_status='running'
 and lease_owner=p_worker and lease_expires_at>clock_timestamp()and not cancel_requested and public.brain_worker_can(property_id)and public.brain_worker_lease(p_worker);
 return found;
end$$;
create function public.brain_reconcile_work()returns jsonb language plpgsql security definer set search_path='' as $$declare j public.shared_jobs;n int:=0;begin
 for j in select *from public.shared_jobs where domain='community_brain'and public.brain_worker_can(property_id)and lifecycle_status='running'and lease_expires_at<=clock_timestamp()for update skip locked loop
  -- File parsing and deterministic hash-keyed uploads can be retried; paid model invocations use a different queue.
  if j.subject_type='file_extraction'then
   perform set_config('p11.knowledge_file_scope',j.property_id::text,true);
   update public.knowledge_file_extractions set state='queued',claim_token=null where id=(j.payload->>'extractionId')::uuid and property_id=j.property_id and state='running'and receipt is null;
  end if;
  update public.shared_jobs set lifecycle_status=case when cancel_requested then 'cancelled'when attempt_count>=max_attempts then 'failed'else'retrying'end,
   lease_owner=null,lease_expires_at=null,available_at=clock_timestamp()+interval '30 seconds',status_reason='Expired local processing lease reconciled'where id=j.id;
  n:=n+1;
 end loop;return jsonb_build_object('reconciled',n);end$$;

create or replace function public.brain_evidence_eligible(p_id uuid,p_property_id uuid,p_purpose text,p_audience text) returns boolean
 language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.community_evidence e where e.id=p_id and e.property_id=p_property_id
  and e.review_status='approved' and e.effective_at<=statement_timestamp() and e.review_after>statement_timestamp()
  and(e.expires_at is null or e.expires_at>statement_timestamp()) and p_purpose=any(e.purposes)
  and(p_audience='internal' or e.audience='public')
  and(p_purpose in('research','portfolio') or(e.competitor_id is null and('fact'=any(e.allowed_uses)or(p_purpose in('site','social','brand')and 'style'=any(e.allowed_uses)))))
  and(e.material_version_id is null or exists(select 1 from public.knowledge_materials m join public.knowledge_material_versions v on v.id=m.active_version_id and v.property_id=m.property_id where m.active_version_id=e.material_version_id and m.property_id=e.property_id and v.content_hash=e.content_hash))
  and(e.asset_id is null or exists(select 1 from public.content_assets a where a.id=e.asset_id and a.property_id=e.property_id and a.content_hash=e.content_hash and a.approval_status='approved' and a.archived_at is null and a.rights_status in('owned','licensed','generated') and(a.expires_at is null or a.expires_at>statement_timestamp())))
  and(e.creative_id is null or exists(select 1 from public.property_intelligence_documents d where d.id=e.creative_id and d.property_id=e.property_id and d.status='approved' and public.knowledge_hash(d.payload)=e.content_hash))
  and(e.competitor_id is null or exists(select 1 from public.competitors c join public.market_source_captures s on s.competitor_id=c.id and s.property_id=c.property_id where c.id=e.competitor_id and c.property_id=e.property_id and c.is_active and s.id=e.competitor_capture_id and s.status='captured' and s.content_hash=e.content_hash and not exists(select 1 from public.market_source_captures newer where newer.competitor_id=c.id and newer.property_id=c.property_id and newer.source_type=s.source_type and newer.source_url is not distinct from s.source_url and newer.status='captured'and(newer.captured_at,newer.id)>(s.captured_at,s.id))))
 ),false)
$$;

alter table public.documents add constraint brain_linked_document_owner_required check(evidence_id is null or property_id is not null)not valid;
create unique index brain_unit_identity_owner on public.property_units(id,property_id);
alter table public.community_context_dependencies add constraint brain_dependency_unit_owner foreign key(unit_id,property_id)references public.property_units(id,property_id);
-- A reviewed source policy belongs to this exact version; a future replacement needs its own review.
create unique index brain_material_version_identity_owner on public.knowledge_material_versions(id,property_id);
create table public.community_source_reviews(
 version_id uuid primary key references public.knowledge_material_versions(id),property_id uuid not null,actor_id uuid not null references auth.users(id),
 audience text not null check(audience in('public','internal')),origin text not null check(origin in('original','generated','derived')),
 allowed_uses text[] not null,purposes text[] not null,review_after timestamptz not null,expires_at timestamptz,reason text not null,
 reviewed_at timestamptz not null default clock_timestamp(),foreign key(version_id,property_id)references public.knowledge_material_versions(id,property_id),
 check(cardinality(allowed_uses)>0 and allowed_uses<@array['fact','style','research']::text[]),check(not('fact'=any(allowed_uses))or origin='original'),
 check(cardinality(purposes)>0 and purposes<@array['chat','site','social','brand','research','portfolio']::text[]),check(length(reason)between 3 and 2000)
);
create function public.brain_review_source(p_scope_id uuid,p_version_id uuid,p_review jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;v public.knowledge_material_versions;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 select *into v from public.knowledge_material_versions where id=p_version_id;
 if v.id is null or s.kind<>'community'or not public.brain_scope_current(s.id,v.property_id)or not public.brain_can(s.actor_id,v.property_id,'manage')then raise insufficient_privilege;end if;
 if p_review-array['audience','origin','allowedUses','purposes','reviewAfter','expiresAt','reason']<>'{}'or(p_review->>'reviewAfter')::timestamptz<=clock_timestamp()then raise exception 'A current, exact source review is required';end if;
 -- Revisions derived from a generated artifact cannot become independent factual evidence on a later edit.
 if p_review->>'origin'='original'and exists(with recursive lineage as(select id,previous_version_id from public.knowledge_material_versions where id=v.id union all select p.id,p.previous_version_id from public.knowledge_material_versions p join lineage c on p.id=c.previous_version_id)select 1 from lineage l join public.community_source_reviews r on r.version_id=l.id where r.origin<>'original')then raise exception 'Generated lineage cannot establish independent facts';end if;
 insert into public.community_source_reviews(version_id,property_id,actor_id,audience,origin,allowed_uses,purposes,review_after,expires_at,reason)
 values(v.id,v.property_id,s.actor_id,p_review->>'audience',p_review->>'origin',array(select jsonb_array_elements_text(p_review->'allowedUses')),array(select jsonb_array_elements_text(p_review->'purposes')),(p_review->>'reviewAfter')::timestamptz,(p_review->>'expiresAt')::timestamptz,p_review->>'reason')
 on conflict(version_id)do update set actor_id=excluded.actor_id,audience=excluded.audience,allowed_uses=excluded.allowed_uses,purposes=excluded.purposes,review_after=excluded.review_after,expires_at=excluded.expires_at,reason=excluded.reason,reviewed_at=clock_timestamp();
 update public.knowledge_materials set updated_at=clock_timestamp()where id=v.material_id and property_id=v.property_id;
 return jsonb_build_object('state','reviewed','versionId',v.id);
end$$;
create table public.community_memory_receipts(
 event_id uuid primary key references public.community_memory_events(id),property_id uuid not null references public.properties(id),
 outcome text not null,projection_hash text not null,projected_at timestamptz not null default clock_timestamp()
);
create function public.brain_project_memory(p_job_id uuid,p_worker text)returns jsonb language plpgsql security definer set search_path='' as $$
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
   if r.version_id is not null then
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
  -- Derived text is replaceable. Exact assets and canonical records remain authoritative.
  for part in select n,substring(body from n for 3500)text from generate_series(1,least(length(body),262144),3000)n loop
   insert into public.documents(id,property_id,content,metadata,evidence_id)
   values(md5(eid::text||':'||part.n)::uuid,j.property_id,part.text,jsonb_build_object('recipe','community-text-v1','chunkOffset',part.n,'sourceHash',h),eid)
   on conflict(id)do nothing;
  end loop;
 end if;
 insert into public.community_memory_receipts(event_id,property_id,outcome,projection_hash)values(ev.id,j.property_id,outcome,coalesce(h,ev.source_hash))on conflict(event_id)do nothing;
 update public.shared_jobs set lifecycle_status='succeeded',finished_at=clock_timestamp(),lease_expires_at=null,output=jsonb_build_object('state',outcome,'evidenceId',eid)where id=j.id;
 return jsonb_build_object('state',outcome,'evidenceId',eid);
end$$;

create or replace function public.brain_context(p_scope_id uuid,p_property_id uuid,p_query text default '',p_asset_ids uuid[] default '{}') returns jsonb
 language plpgsql stable security definer set search_path='' as $$
 declare s public.community_task_scopes;v_canonical jsonb;v_search jsonb;v_manifest jsonb;
 begin
  if not public.brain_scope_current(p_scope_id,p_property_id)then raise insufficient_privilege using message='Community scope expired or access changed';end if;
  if cardinality(p_asset_ids)>100 then raise exception 'Select at most 100 assets';end if;
  select * into s from public.community_task_scopes where id=p_scope_id;
  v_canonical:=public.brain_canonical_context(p_property_id,s.purpose,p_asset_ids);
  v_search:=public.brain_search(p_scope_id,p_property_id,p_query,null,null,12);
  v_manifest:=jsonb_build_object('version','community-context-v1','scopeId',s.id,'scopeKind',s.kind,'actorId',s.actor_id,'orgId',s.org_id,'propertyId',p_property_id,'purpose',s.purpose,'policyRevision',s.policy_revision,'permissionHash',s.permission_hash,'expiresAt',s.expires_at,'recipe','community-hybrid-rrf-v1','canonical',v_canonical,'evidence',v_search->'items');
  return v_manifest||jsonb_build_object('readSetHash',public.knowledge_hash(jsonb_build_object('canonical',v_canonical-'asOf','evidence',v_search->'items')),'contextHash',public.knowledge_hash(v_manifest));
 end
$$;
create or replace function public.brain_read_asset(p_scope_id uuid,p_asset_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare a public.content_assets;s public.community_task_scopes;begin
  select *into s from public.community_task_scopes where id=p_scope_id;
  select *into a from public.content_assets where id=p_asset_id;
  if not found or a.archived_at is not null or not public.brain_scope_current(p_scope_id,a.property_id)or not public.brain_can(s.actor_id,a.property_id,'download')then raise insufficient_privilege using message='Asset is unavailable';end if;
  if a.storage_bucket not in('knowledge-originals','property-assets','content-assets','brand-assets')or public.brain_storage_owner(a.storage_path)is distinct from a.property_id or coalesce(a.content_hash,'')!~'^[a-f0-9]{64}$'then raise exception 'Asset storage identity needs reconciliation';end if;
  return jsonb_build_object('id',a.id,'propertyId',a.property_id,'name',a.name,'bucket',a.storage_bucket,'path',a.storage_path,'hash',a.content_hash,'format',a.format,'revision',a.governance_revision);
 end
$$;

create function public.brain_save_context(p_scope_id uuid,p_property_id uuid,p_query text,p_asset_ids uuid[],p_job_id uuid default null)returns jsonb language plpgsql security definer set search_path='' as $$
 declare c jsonb;s public.community_task_scopes;cid uuid:=gen_random_uuid();item jsonb;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'then raise insufficient_privilege using message='Portfolio context cannot enter community jobs';end if;
 c:=public.brain_context(p_scope_id,p_property_id,p_query,p_asset_ids);
 if p_job_id is not null and not exists(select 1 from public.shared_jobs where id=p_job_id and property_id=p_property_id and org_id=s.org_id and scope_kind='community')then raise insufficient_privilege;end if;
 insert into public.shared_context_snapshots(id,org_id,property_id,source_domain,source_ref,context_hash,context_payload,captured_by)
 values(cid,s.org_id,p_property_id,'community_brain',p_job_id::text,c->>'contextHash',c||jsonb_build_object('query',p_query,'selectedAssetIds',p_asset_ids),s.actor_id::text);
 for item in select value from jsonb_array_elements(c->'evidence')loop
  insert into public.community_context_dependencies(context_id,property_id,org_id,evidence_id,source_hash)values(cid,p_property_id,s.org_id,(item->>'evidenceId')::uuid,item->>'sourceHash');
 end loop;
 for item in select value from jsonb_array_elements(c#>'{canonical,assets}')loop
  insert into public.community_context_dependencies(context_id,property_id,org_id,asset_id,source_hash)values(cid,p_property_id,s.org_id,(item->>'id')::uuid,item->>'content_hash');
 end loop;
 for item in select value from jsonb_array_elements(c#>'{canonical,floorplans}')loop
  insert into public.community_context_dependencies(context_id,property_id,org_id,unit_id,source_hash)values(cid,p_property_id,s.org_id,(item->>'id')::uuid,public.knowledge_hash(item));
 end loop;
 if p_job_id is not null then update public.shared_jobs set context_snapshot_id=cid where id=p_job_id and property_id=p_property_id;end if;
 return c||jsonb_build_object('snapshotId',cid);
end$$;
create function public.brain_context_current(p_context_id uuid,p_actor_id uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
 declare s public.shared_context_snapshots;c jsonb;purpose text;begin
 select *into s from public.shared_context_snapshots where id=p_context_id and source_domain='community_brain'and scope_kind='community'and invalidated_at is null;
 if not found or s.captured_by<>p_actor_id::text then return false;end if;
 purpose:=s.context_payload->>'purpose';
 if not public.brain_can(p_actor_id,s.property_id,public.brain_scope_capability(purpose))then return false;end if;
 -- Re-check current sources independently of the initial scope TTL. A fresh dispatch scope is still required by callers.
 c:=public.brain_canonical_context(s.property_id,purpose,array(select jsonb_array_elements_text(s.context_payload->'selectedAssetIds'))::uuid[]);
 if public.knowledge_hash(c-'asOf')<>public.knowledge_hash(s.context_payload->'canonical'-'asOf')then return false;end if;
 if exists(select 1 from jsonb_array_elements(s.context_payload->'evidence')x where not public.brain_evidence_eligible((x->>'evidenceId')::uuid,s.property_id,purpose,case when purpose in('chat','site','social','brand')then'public'else'internal'end))then return false;end if;
 return true;
end$$;
-- Invalidate the entire community context on canonical fact/brand/material changes, including deletes.
create function public.brain_invalidate_canonical()returns trigger language plpgsql security definer set search_path='' as $$declare pid uuid;begin
 pid:=case when tg_table_name='properties'then (coalesce(to_jsonb(new),to_jsonb(old))->>'id')::uuid else(coalesce(to_jsonb(new),to_jsonb(old))->>'property_id')::uuid end;
 update public.shared_context_snapshots set invalidated_at=clock_timestamp()where property_id=pid and source_domain='community_brain'and invalidated_at is null;
 update public.shared_jobs j set cancel_requested=true,status_reason='Community source changed; refresh and review'where j.property_id=pid and j.lifecycle_status in('queued','running','retrying')and exists(select 1 from public.shared_context_snapshots c where c.id=j.context_snapshot_id and c.property_id=j.property_id and c.invalidated_at is not null);
 return null;end$$;
do $$declare t text;begin foreach t in array array['properties','property_intelligence_documents','property_brand_assets','knowledge_materials','content_assets','property_units']loop
 execute format('create trigger brain_canonical_invalidate after update or delete on public.%I for each row execute function public.brain_invalidate_canonical()',t);end loop;end$$;
-- Public widget context is bound to the validated configuration and current session, not an arbitrary supplied owner.
create function public.brain_public_context(p_config_id uuid,p_session_id uuid,p_query text)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare pid uuid;c jsonb;items jsonb;begin
 select w.property_id into pid from public.widget_sessions w join public.lumaleasing_config l on l.property_id=w.property_id
 where w.id=p_session_id and l.id=p_config_id and l.is_active and w.session_end is null and w.last_activity_at>statement_timestamp()-interval '48 hours';
 if pid is null then raise insufficient_privilege using message='Chat session is unavailable';end if;
 c:=public.brain_canonical_context(pid,'chat','{}');
 select coalesce(jsonb_agg(to_jsonb(q)),'[]')into items from(
 select d.id,d.evidence_id,"left"(d.content,5000)content,e.content_hash,e.allowed_uses from public.documents d join public.community_evidence e on e.id=d.evidence_id and e.property_id=d.property_id
 where d.property_id=pid and public.brain_evidence_eligible(e.id,pid,'chat','public')and d.search_text@@websearch_to_tsquery('english',"left"(p_query,4000))
 order by ts_rank_cd(d.search_text,websearch_to_tsquery('english',"left"(p_query,4000)))desc,d.id limit 8)q;
 return jsonb_build_object('propertyId',pid,'canonical',c,'evidence',items,'asOf',statement_timestamp());end$$;

do $$declare t text;f regprocedure;begin
 foreach t in array array['community_source_reviews','community_memory_receipts']loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,community_brain_worker',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'brain\_%'escape '\'and p.proname not in('brain_can','brain_storage_owner')loop
 execute format('revoke all on function %s from public,anon,authenticated,community_brain_worker',f);execute format('grant execute on function %s to service_role',f);end loop;
end$$;
grant execute on function public.brain_claim_work(text,integer),public.brain_finish_extraction(uuid,text,uuid,jsonb,jsonb),public.brain_project_memory(uuid,text),public.brain_heartbeat(uuid,text),public.brain_reconcile_work(),public.brain_worker_object(text,boolean)to community_brain_worker;
commit;
