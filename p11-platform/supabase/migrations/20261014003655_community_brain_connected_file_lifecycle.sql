begin;
create table public.community_source_syncs(
 source_id uuid primary key references public.siteforge_asset_sources(id),run_id uuid not null references public.siteforge_asset_ingest_runs(id),
 actor_id uuid not null references auth.users(id),scope_id uuid not null references public.community_task_scopes(id),
 config_hash text not null,lease_until timestamptz not null,inventory jsonb,inventory_hash text,
 check(inventory is null or(jsonb_typeof(inventory)='array'and jsonb_array_length(inventory)<=1000))
);
create table public.community_connected_files(
 source_id uuid not null references public.siteforge_asset_sources(id),property_id uuid not null references public.properties(id),
 provider_file_id text not null,provider_revision text not null,file_id uuid not null,
 provider_metadata jsonb not null,current boolean not null default true,observed_at timestamptz not null default clock_timestamp(),
 primary key(source_id,provider_file_id,provider_revision),unique(file_id),
 foreign key(file_id,property_id)references public.knowledge_files(id,property_id)
);
alter table public.community_source_syncs enable row level security;
alter table public.community_connected_files enable row level security;
revoke all on public.community_source_syncs,public.community_connected_files from public,anon,authenticated;
grant select on public.community_source_syncs,public.community_connected_files to service_role;
create function public.brain_source_config(p_source_id uuid)returns text language sql stable set search_path='' as $$
 select public.knowledge_hash(jsonb_build_array(id,property_id,org_id,provider,external_folder_id,credential_ref))from public.siteforge_asset_sources where id=p_source_id
$$;
create function public.brain_connected_file_current(p_file_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select p_file_id is null or not exists(select 1 from public.community_connected_files f join public.siteforge_asset_sources s on s.id=f.source_id where f.file_id=p_file_id and(not f.current or s.status<>'active'))
$$;
create function public.brain_source_sync(p_scope_id uuid,p_source_id uuid,p_run_id uuid,p_operation text,p_input jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;c public.siteforge_asset_sources;l public.community_source_syncs;f public.knowledge_files;item jsonb;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into c from public.siteforge_asset_sources where id=p_source_id for update;
 if s.kind is distinct from'community'or s.purpose is distinct from'ingestion'or c.property_id is distinct from s.property_ids[1]or not public.brain_scope_current(s.id,c.property_id)or c.status in('paused','revoked')or c.provider not in('google_drive','dropbox')then raise insufficient_privilege;end if;
 select *into l from public.community_source_syncs where source_id=c.id for update;
 if p_operation='begin'then
  if l.lease_until>clock_timestamp()then raise exception 'This source already has an active intake';end if;
  insert into public.siteforge_asset_ingest_runs(id,source_id,org_id,property_id,website_id,status,started_at)values(p_run_id,c.id,c.org_id,c.property_id,c.website_id,'running',clock_timestamp());
  insert into public.community_source_syncs(source_id,run_id,actor_id,scope_id,config_hash,lease_until)values(c.id,p_run_id,s.actor_id,s.id,public.brain_source_config(c.id),clock_timestamp()+interval '8 minutes')
   on conflict(source_id)do update set run_id=excluded.run_id,actor_id=excluded.actor_id,scope_id=excluded.scope_id,config_hash=excluded.config_hash,lease_until=excluded.lease_until,inventory=null,inventory_hash=null;
  return jsonb_build_object('source',to_jsonb(c),'files',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from public.community_connected_files x where source_id=c.id and current));
 end if;
 if l.run_id is distinct from p_run_id or l.actor_id is distinct from s.actor_id or l.lease_until<=clock_timestamp()or l.config_hash is distinct from public.brain_source_config(c.id)then raise insufficient_privilege;end if;
 if p_operation='observe'then
  if jsonb_typeof(p_input->'files')is distinct from'array'or jsonb_array_length(p_input->'files')>1000 then raise exception 'Bounded complete folder inventory required';end if;
  if exists(select 1 from jsonb_array_elements(p_input->'files')x where length(x->>'id')not between 1 and 300 or length(x->>'revision')not between 1 and 300)then raise exception 'Provider identities missing';end if;
  update public.community_source_syncs set inventory=p_input->'files',inventory_hash=public.knowledge_hash(p_input->'files')where source_id=c.id;
  update public.community_connected_files linked set current=false,observed_at=clock_timestamp()where linked.source_id=c.id and current and not exists(select 1 from jsonb_array_elements(p_input->'files')x where x->>'id'=linked.provider_file_id and x->>'revision'=linked.provider_revision);
 elsif p_operation='bind'then
  select *into f from public.knowledge_files where id=(p_input->>'fileId')::uuid and property_id=c.property_id and state='stored';
  if not found or not exists(select 1 from jsonb_array_elements(l.inventory)x where x->>'id'=p_input->>'providerFileId'and x->>'revision'=p_input->>'providerRevision')then raise exception 'Original does not match this complete provider inventory';end if;
  insert into public.community_connected_files(source_id,property_id,provider_file_id,provider_revision,file_id,provider_metadata)
  values(c.id,c.property_id,p_input->>'providerFileId',p_input->>'providerRevision',f.id,p_input->'metadata')on conflict(source_id,provider_file_id,provider_revision)do update set current=true,observed_at=clock_timestamp()where community_connected_files.file_id=excluded.file_id;
  if not found then raise exception 'A provider revision cannot replace an immutable original';end if;
 elsif p_operation in('finish','fail')then
  if p_input-array['imported','unchanged','remaining','error']<>'{}'then raise exception 'Invalid completion receipt';end if;
  update public.siteforge_asset_ingest_runs set status=case when p_operation='finish'and coalesce((p_input->>'remaining')::int,0)=0 then'succeeded'else'failed'end,
   completed_at=clock_timestamp(),discovered_count=coalesce(jsonb_array_length(l.inventory),0),imported_count=coalesce((p_input->>'imported')::int,0),duplicate_count=coalesce((p_input->>'unchanged')::int,0),
   result_manifest=p_input||jsonb_build_object('recipe','community-connected-originals-v1','inventoryHash',l.inventory_hash,'automaticApproval',false),error_message=left(p_input->>'error',300)
  where id=p_run_id;
  update public.siteforge_asset_sources set status=case when p_operation='fail'then'error'else'active'end,last_synced_at=case when p_operation='finish'then clock_timestamp()else last_synced_at end,last_error=left(p_input->>'error',300)where id=c.id;
  update public.community_source_syncs set lease_until=clock_timestamp()where source_id=c.id;
 else raise exception 'Unknown source intake operation';end if;
 return jsonb_build_object('runId',p_run_id,'state','saved');end$$;

-- Both search and exact assets stop serving a removed/revoked connected source.
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_evidence_eligible(uuid,uuid,text,text)'::regprocedure)into definition;
 definition:=replace(definition,'e.review_status=''approved''','e.review_status=''approved'' and public.brain_connected_file_current((public.knowledge_version_file_origin(e.material_version_id)->>''fileId'')::uuid)');
 definition:=replace(definition,'a.approval_status=''approved''','a.approval_status=''approved'' and public.brain_connected_file_current(a.original_file_id)');execute definition;
 select pg_get_functiondef('public.brain_canonical_context(uuid,text,uuid[])'::regprocedure)into definition;
 definition:=replace(definition,'a.approval_status=''approved''','a.approval_status=''approved'' and public.brain_connected_file_current(a.original_file_id)');execute definition;
 select pg_get_functiondef('public.brain_read_asset(uuid,uuid)'::regprocedure)into definition;
 definition:=replace(definition,'a.archived_at is not null','a.archived_at is not null or not public.brain_connected_file_current(a.original_file_id)');execute definition;
 select pg_get_functiondef('public.brain_review_asset(uuid,uuid,jsonb)'::regprocedure)into definition;
 definition:=replace(definition,'f.state<>''stored''', '(f.state<>''stored'' or not public.brain_connected_file_current(f.id))');execute definition;
 select pg_get_functiondef('public.brain_file_detail(uuid,uuid)'::regprocedure)into definition;
 definition:=replace(definition,'jsonb_build_object(''file'',to_jsonb(f)','jsonb_build_object(''sourceCurrent'',public.brain_connected_file_current(f.id),''file'',to_jsonb(f)');execute definition;
end$$;
revoke all on function public.brain_source_config(uuid),public.brain_connected_file_current(uuid),public.brain_source_sync(uuid,uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.brain_source_sync(uuid,uuid,uuid,text,jsonb)to service_role;
commit;
