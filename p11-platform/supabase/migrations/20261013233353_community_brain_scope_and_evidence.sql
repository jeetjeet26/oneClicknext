-- CB02/CB03: explicit community authority and server-bound task scopes.
-- Rehearsed against the live 2026-10-13 catalog, not the older local migration ledger.
begin;

create table public.community_access_grants (
 actor_id uuid not null references auth.users(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 capabilities text[] not null default array['read']::text[],
 revision bigint not null default 1 check(revision>0),
 expires_at timestamptz, revoked_at timestamptz,
 granted_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,property_id),
 check(cardinality(capabilities)>0 and capabilities <@ array['read','manage','generate','portfolio','download']::text[])
);
create index community_access_grants_property on public.community_access_grants(property_id,actor_id);
create table public.community_access_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 property_id uuid not null references public.properties(id), target_actor_id uuid not null references auth.users(id),
 before_state jsonb, after_state jsonb not null, reason text not null check(length(reason) between 3 and 2000),
 created_at timestamptz not null default clock_timestamp()
);
create table public.community_brain_settings (
 property_id uuid primary key references public.properties(id) on delete cascade,
 context_enabled boolean not null default false, ingestion_enabled boolean not null default false,
 portfolio_enabled boolean not null default false, policy_revision integer not null default 1,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.community_brain_settings(property_id) select id from public.properties;
-- Trusted current administrators retain an explicit, inspectable grant. Staff are assigned deliberately.
insert into public.community_access_grants(actor_id,property_id,capabilities,granted_by)
 select u.id,p.id,array['read','manage','generate','portfolio','download'],u.id
 from public.profiles u join public.properties p on p.org_id=u.org_id
 where public.team_admin_current(p.org_id,u.id);

create function public.brain_can(p_actor_id uuid,p_property_id uuid,p_capability text default 'read') returns boolean
 language sql stable security definer set search_path='' as $$
 select coalesce(exists(
  select 1 from public.community_access_grants g
  join public.properties p on p.id=g.property_id
  join public.profiles m on m.id=g.actor_id and m.org_id=p.org_id
  join auth.users u on u.id=m.id
  where g.actor_id=p_actor_id and g.property_id=p_property_id
   and g.revoked_at is null and(g.expires_at is null or g.expires_at>statement_timestamp())
   and p_capability=any(g.capabilities) and 'read'=any(g.capabilities)
   and u.email_confirmed_at is not null and u.deleted_at is null
   and(u.banned_until is null or u.banned_until<=statement_timestamp())
   and (current_setting('role',true) not in('authenticated','anon') or p_actor_id=auth.uid())
 ),false)
$$;
revoke all on function public.brain_can(uuid,uuid,text) from public,anon;
grant execute on function public.brain_can(uuid,uuid,text) to authenticated,service_role;

create function public.brain_set_access(p_actor_id uuid,p_property_id uuid,p_target_actor_id uuid,p_capabilities text[],p_expires_at timestamptz,p_revoke boolean,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare v_org uuid;v_before jsonb;v_after jsonb;
 begin
  select org_id into v_org from public.properties where id=p_property_id for share;
  if not public.team_admin_current(v_org,p_actor_id) or not exists(select 1 from public.profiles where id=p_target_actor_id and org_id=v_org) then raise insufficient_privilege using message='Community access cannot be changed';end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 or p_revoke is null or p_capabilities is null or not('read'=any(p_capabilities)) then raise exception 'A reviewed community grant and reason are required';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||p_target_actor_id::text,81));
  select to_jsonb(g) into v_before from public.community_access_grants g where actor_id=p_target_actor_id and property_id=p_property_id for update;
  insert into public.community_access_grants(actor_id,property_id,capabilities,granted_by,expires_at,revoked_at)
  values(p_target_actor_id,p_property_id,p_capabilities,p_actor_id,p_expires_at,case when p_revoke then clock_timestamp() end)
  on conflict(actor_id,property_id) do update set capabilities=excluded.capabilities,revision=community_access_grants.revision+1,
   granted_by=excluded.granted_by,expires_at=excluded.expires_at,revoked_at=excluded.revoked_at,updated_at=clock_timestamp();
  select to_jsonb(g) into v_after from public.community_access_grants g where actor_id=p_target_actor_id and property_id=p_property_id;
  insert into public.community_access_events(actor_id,property_id,target_actor_id,before_state,after_state,reason) values(p_actor_id,p_property_id,p_target_actor_id,v_before,v_after,p_reason);
  return v_after;
 end
$$;

create table public.community_task_scopes (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),org_id uuid not null references public.organizations(id),
 kind text not null check(kind in('community','portfolio')),property_ids uuid[] not null,
 purpose text not null check(purpose in('site','chat','social','brand','research','portfolio','ingestion','manage','download')),
 permission_hash text not null,policy_revision integer not null default 1,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check(cardinality(property_ids) between 1 and 500),check(kind='portfolio' or cardinality(property_ids)=1),
 check((kind='portfolio')=(purpose='portfolio')),
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes')
);
create index community_task_scopes_actor on public.community_task_scopes(actor_id,created_at desc);
create index community_task_scopes_expiry on public.community_task_scopes(expires_at);

create function public.brain_permission_hash(p_actor_id uuid,p_properties uuid[]) returns text
 language sql stable security definer set search_path='' as $$
 select public.knowledge_hash(jsonb_build_array(
  (select to_jsonb(m) from public.profiles m where id=p_actor_id),
  (select jsonb_build_array(email_confirmed_at,deleted_at,banned_until) from auth.users where id=p_actor_id),
  (select jsonb_agg(jsonb_build_array(g.property_id,g.capabilities,g.revision,g.expires_at,g.revoked_at,p.org_id) order by g.property_id)
   from public.community_access_grants g join public.properties p on p.id=g.property_id where g.actor_id=p_actor_id and g.property_id=any(p_properties))))
$$;
create function public.brain_scope_capability(p_purpose text) returns text
 language sql immutable set search_path='' as $$ select case p_purpose when 'portfolio' then 'portfolio' when 'download' then 'download' when 'manage' then 'manage' when 'ingestion' then 'manage' when 'site' then 'generate' when 'social' then 'generate' when 'brand' then 'generate' else 'read' end $$;

create function public.brain_resolve_scope(p_actor_id uuid,p_property_ids uuid[],p_purpose text) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare v_ids uuid[];v_org uuid;v_scope public.community_task_scopes;
 begin
  select array_agg(id order by id) into v_ids from(select distinct unnest(p_property_ids)id)s;
  if v_ids is null or cardinality(v_ids) not between 1 and 500 or array_position(v_ids,null) is not null
   or(p_purpose<>'portfolio' and cardinality(v_ids)<>1) or exists(select 1 from unnest(v_ids)id where not public.brain_can(p_actor_id,id,public.brain_scope_capability(p_purpose)))
  then raise insufficient_privilege using message='Selected communities are unavailable';end if;
  select org_id into v_org from public.properties where id=v_ids[1];
  if exists(select 1 from public.properties where id=any(v_ids) and org_id<>v_org) then raise insufficient_privilege using message='Cross-organization scope requires separate delegation';end if;
  insert into public.community_task_scopes(actor_id,org_id,kind,property_ids,purpose,permission_hash,expires_at)
   values(p_actor_id,v_org,case when p_purpose='portfolio' then 'portfolio' else 'community' end,v_ids,p_purpose,public.brain_permission_hash(p_actor_id,v_ids),clock_timestamp()+interval '10 minutes') returning * into v_scope;
  return to_jsonb(v_scope);
 end
$$;
create function public.brain_scope_current(p_scope_id uuid,p_property_id uuid,p_actor_id uuid default null) returns boolean
 language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.community_task_scopes s where s.id=p_scope_id
  and(p_actor_id is null or s.actor_id=p_actor_id) and s.expires_at>statement_timestamp()
  and p_property_id=any(s.property_ids) and s.permission_hash=public.brain_permission_hash(s.actor_id,s.property_ids)
  and not exists(select 1 from unnest(s.property_ids)id where not public.brain_can(s.actor_id,id,public.brain_scope_capability(s.purpose)))),false)
$$;
create function public.brain_immutable_scope() returns trigger language plpgsql set search_path='' as $$
 begin raise exception 'Task scope is immutable; resolve current authority for a new task';end
$$;
create trigger community_task_scope_immutable before update on public.community_task_scopes for each row execute function public.brain_immutable_scope();

-- Restrictive policies combine with every legacy permissive policy; no OR bypass remains.
-- The live competitor index inherited ownership through competitors, not a property_id column.
alter table public.competitor_content_chunks add column property_id uuid;
update public.competitor_content_chunks c set property_id=p.property_id from public.competitors p where p.id=c.competitor_id;
alter table public.competitor_content_chunks alter column property_id set not null;
create unique index community_competitors_owner on public.competitors(id,property_id);
alter table public.competitor_content_chunks add constraint brain_competitor_owner foreign key(competitor_id,property_id) references public.competitors(id,property_id);
create index brain_competitor_chunks_property on public.competitor_content_chunks(property_id);
do $$ declare t text;begin
 foreach t in array array['documents','knowledge_sources','knowledge_files','knowledge_file_extractions','knowledge_materials','knowledge_material_versions',
  'knowledge_web_captures','competitors','competitor_content_chunks','content_assets','property_units','property_intelligence_documents','property_brand_assets'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy community_scope_read on public.%I as restrictive for select to authenticated using(public.brain_can((select auth.uid()),property_id,''read''))',t);
  execute format('create policy community_scope_insert on public.%I as restrictive for insert to authenticated with check(public.brain_can((select auth.uid()),property_id,''manage''))',t);
  execute format('create policy community_scope_update on public.%I as restrictive for update to authenticated using(public.brain_can((select auth.uid()),property_id,''manage'')) with check(public.brain_can((select auth.uid()),property_id,''manage''))',t);
  execute format('create policy community_scope_delete on public.%I as restrictive for delete to authenticated using(public.brain_can((select auth.uid()),property_id,''manage''))',t);
 end loop;
end $$;
create policy community_property_read on public.properties as restrictive for select to authenticated using(public.brain_can((select auth.uid()),id,'read'));
create policy community_property_update on public.properties as restrictive for update to authenticated using(public.brain_can((select auth.uid()),id,'manage')) with check(public.brain_can((select auth.uid()),id,'manage'));

-- New writes cannot splice identities across communities, even with a service client.
create unique index community_properties_owner on public.properties(id,org_id);
create unique index community_content_assets_owner on public.content_assets(id,property_id);
create unique index community_context_owner on public.shared_context_snapshots(id,property_id,org_id);
alter table public.property_units add constraint brain_unit_owner foreign key(property_id,org_id) references public.properties(id,org_id) not valid;
alter table public.content_assets add constraint brain_asset_owner foreign key(property_id,org_id) references public.properties(id,org_id) not valid;
alter table public.property_units add constraint brain_unit_drawing_owner foreign key(floor_plan_image_asset_id,property_id) references public.content_assets(id,property_id) not valid;
alter table public.content_assets add constraint brain_asset_parent_owner foreign key(source_asset_id,property_id) references public.content_assets(id,property_id) not valid;
alter table public.content_assets add constraint brain_asset_duplicate_owner foreign key(duplicate_of,property_id) references public.content_assets(id,property_id) not valid;
alter table public.content_assets add constraint brain_asset_replacement_owner foreign key(replacement_asset_id,property_id) references public.content_assets(id,property_id) not valid;
alter table public.shared_jobs add constraint brain_job_context_owner foreign key(context_snapshot_id,property_id,org_id) references public.shared_context_snapshots(id,property_id,org_id) not valid;
alter table public.shared_jobs add column scope_kind text not null default 'unclassified' check(scope_kind in('community','organization','unclassified'));
alter table public.shared_context_snapshots add column scope_kind text not null default 'unclassified' check(scope_kind in('community','organization','unclassified'));
update public.shared_jobs set scope_kind='community' where property_id is not null;
update public.shared_context_snapshots set scope_kind='community' where property_id is not null;
alter table public.shared_jobs add constraint brain_job_required_owner check(scope_kind<>'community' or property_id is not null) not valid;
alter table public.shared_context_snapshots add constraint brain_context_required_owner check(scope_kind<>'community' or property_id is not null) not valid;
create function public.brain_record_scope_kind() returns trigger language plpgsql set search_path='' as $$
 begin
  if tg_op='INSERT' and new.property_id is not null then new.scope_kind:='community';end if;
  if tg_op='UPDATE' and(old.property_id is distinct from new.property_id or old.org_id is distinct from new.org_id or old.scope_kind is distinct from new.scope_kind) then raise exception 'Saved job/context ownership is immutable';end if;
  return new;
 end
$$;
create trigger brain_job_scope before insert or update on public.shared_jobs for each row execute function public.brain_record_scope_kind();
create trigger brain_context_scope before insert or update on public.shared_context_snapshots for each row execute function public.brain_record_scope_kind();
create policy brain_shared_job_read on public.shared_jobs as restrictive for select to authenticated using(scope_kind='community' and public.brain_can((select auth.uid()),property_id,'read'));
create policy brain_shared_context_read on public.shared_context_snapshots as restrictive for select to authenticated using(scope_kind='community' and public.brain_can((select auth.uid()),property_id,'read'));

-- CB05: typed evidence references. Legacy vectors remain retained but ineligible until reconciled.
create table public.community_evidence (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),org_id uuid not null,
 material_version_id uuid references public.knowledge_material_versions(id),competitor_capture_id uuid references public.market_source_captures(id),
 creative_id uuid references public.property_intelligence_documents(id),asset_id uuid references public.content_assets(id),
 competitor_id uuid references public.competitors(id),
 authority text not null check(authority in('reviewed','observed','creative')),
 audience text not null default 'internal' check(audience in('public','internal')),
 purposes text[] not null default array['research','portfolio'],
 allowed_uses text[] not null default array['research'],
 content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 review_status text not null default 'pending' check(review_status in('pending','approved','withdrawn','quarantined')),
 effective_at timestamptz not null default clock_timestamp(), expires_at timestamptz,review_after timestamptz not null,
 parent_evidence_id uuid,origin text not null check(origin in('original','generated','derived')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(id,property_id),foreign key(property_id,org_id) references public.properties(id,org_id),
 foreign key(parent_evidence_id,property_id) references public.community_evidence(id,property_id),
 check(num_nonnulls(material_version_id,competitor_capture_id,creative_id,asset_id)=1),
 check(cardinality(purposes)>0 and purposes <@ array['chat','site','social','brand','research','portfolio']::text[]),
 check(cardinality(allowed_uses)>0 and allowed_uses <@ array['fact','style','research','measurement']::text[]),
 check(not('fact'=any(allowed_uses)) or(authority='reviewed' and origin='original' and competitor_id is null and creative_id is null)),
 check((competitor_capture_id is null)=(competitor_id is null)),
 check(expires_at is null or expires_at>effective_at),check(review_after>effective_at)
);
create index community_evidence_owner on public.community_evidence(property_id,review_status,review_after);
create index community_evidence_material on public.community_evidence(material_version_id);
create index community_evidence_capture on public.community_evidence(competitor_capture_id);
create index community_evidence_asset on public.community_evidence(asset_id);
create index community_evidence_creative on public.community_evidence(creative_id);
create index community_evidence_parent on public.community_evidence(parent_evidence_id,property_id);
create function public.brain_check_evidence_owner() returns trigger language plpgsql set search_path='' as $$
 begin
  if new.material_version_id is not null and not exists(select 1 from public.knowledge_material_versions where id=new.material_version_id and property_id=new.property_id and content_hash=new.content_hash) then raise exception 'Material evidence identity mismatch';end if;
  if new.competitor_capture_id is not null and not exists(select 1 from public.market_source_captures where id=new.competitor_capture_id and property_id=new.property_id and competitor_id=new.competitor_id) then raise exception 'Competitor evidence identity mismatch';end if;
  if new.creative_id is not null and not exists(select 1 from public.property_intelligence_documents where id=new.creative_id and property_id=new.property_id and kind='creative') then raise exception 'Creative evidence identity mismatch';end if;
  if new.asset_id is not null and not exists(select 1 from public.content_assets where id=new.asset_id and property_id=new.property_id and content_hash=new.content_hash) then raise exception 'Asset evidence identity mismatch';end if;
  if new.parent_evidence_id=new.id then raise exception 'Evidence cannot corroborate itself';end if;
  if tg_op='UPDATE' and (new.property_id<>old.property_id or new.org_id<>old.org_id or new.content_hash<>old.content_hash or new.material_version_id is distinct from old.material_version_id or new.competitor_capture_id is distinct from old.competitor_capture_id or new.creative_id is distinct from old.creative_id or new.asset_id is distinct from old.asset_id or new.parent_evidence_id is distinct from old.parent_evidence_id or new.origin<>old.origin) then raise exception 'Evidence identity is immutable';end if;
  new.updated_at:=clock_timestamp();return new;
 end
$$;
create trigger community_evidence_identity before insert or update on public.community_evidence for each row execute function public.brain_check_evidence_owner();
alter table public.documents add column evidence_id uuid;
alter table public.documents add column embedding_model text;
alter table public.documents add column embedding_recipe text;
alter table public.documents add column search_text tsvector generated always as(to_tsvector('english',content)) stored;
alter table public.documents add constraint brain_document_evidence_owner foreign key(evidence_id,property_id) references public.community_evidence(id,property_id) not valid;
create index documents_property_idx on public.documents(property_id);
create index documents_evidence_idx on public.documents(evidence_id,property_id);
create index documents_lexical_idx on public.documents using gin(search_text);
alter table public.competitor_content_chunks add column evidence_id uuid;
alter table public.competitor_content_chunks add constraint brain_competitor_evidence_owner foreign key(evidence_id,property_id) references public.community_evidence(id,property_id) not valid;
create index competitor_chunks_evidence_idx on public.competitor_content_chunks(evidence_id,property_id);

create function public.brain_evidence_eligible(p_id uuid,p_property_id uuid,p_purpose text,p_audience text) returns boolean
 language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.community_evidence e where e.id=p_id and e.property_id=p_property_id
  and e.review_status='approved' and e.effective_at<=statement_timestamp() and e.review_after>statement_timestamp()
  and(e.expires_at is null or e.expires_at>statement_timestamp()) and p_purpose=any(e.purposes)
  and(p_audience='internal' or e.audience='public')
  and(p_purpose in('research','portfolio') or(e.competitor_id is null and 'fact'=any(e.allowed_uses)))
  and(e.material_version_id is null or exists(select 1 from public.knowledge_materials m join public.knowledge_material_versions v on v.id=m.active_version_id and v.property_id=m.property_id where m.active_version_id=e.material_version_id and m.property_id=e.property_id and v.content_hash=e.content_hash))
  and(e.asset_id is null or exists(select 1 from public.content_assets a where a.id=e.asset_id and a.property_id=e.property_id and a.content_hash=e.content_hash and a.approval_status='approved' and a.archived_at is null and a.rights_status in('owned','licensed','generated') and(a.expires_at is null or a.expires_at>statement_timestamp())))
  and(e.creative_id is null or exists(select 1 from public.property_intelligence_documents d where d.id=e.creative_id and d.property_id=e.property_id and d.status='approved' and public.knowledge_hash(d.payload)=e.content_hash))
  and(e.competitor_id is null or exists(select 1 from public.competitors c join public.market_source_captures s on s.competitor_id=c.id and s.property_id=c.property_id where c.id=e.competitor_id and c.property_id=e.property_id and c.is_active and s.id=e.competitor_capture_id and s.status='ready'))
 ),false)
$$;

-- Scope-free legacy RAG is restricted to reviewed, public, community facts. Unknown legacy provenance is never inferred.
create or replace function public.match_documents(query_embedding public.vector,match_threshold double precision,match_count integer,filter_property uuid)
 returns table(id uuid,content text,similarity double precision,metadata jsonb)
 language sql stable security definer set search_path='' as $$
 select d.id,d.content,1-(d.embedding operator(public.<=>) query_embedding),d.metadata
 from public.documents d where filter_property is not null and d.property_id=filter_property
  and d.embedding_model='text-embedding-3-small' and d.embedding_recipe='community-text-v1'
  and public.vector_dims(query_embedding)=1536 and public.brain_evidence_eligible(d.evidence_id,filter_property,'site','public')
  and 1-(d.embedding operator(public.<=>) query_embedding)>greatest(0,match_threshold)
 order by d.embedding operator(public.<=>) query_embedding limit least(greatest(match_count,0),50)
$$;
revoke all on function public.match_documents(public.vector,double precision,integer,uuid) from public,anon,authenticated;
grant execute on function public.match_documents(public.vector,double precision,integer,uuid) to service_role;

-- Only the server may mint scopes or mutate the grant/evidence registry.
do $$ declare t text;f regprocedure;begin
 foreach t in array array['community_access_grants','community_access_events','community_brain_settings','community_task_scopes','community_evidence'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'brain\_%' escape '\' and p.proname<>'brain_can' loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
commit;
