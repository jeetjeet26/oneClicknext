begin;
-- Constrain legacy privileged actor/property RPCs at their entry point as well as at HTTP routes.
-- Retain native domain transactions and their narrower role/decision rules behind the wrapper.
do $$ declare f record;v_name text;v_call text;v_cap text;begin
 for f in select p.oid,p.proname,p.proargnames,pg_get_function_arguments(p.oid) args,pg_get_function_identity_arguments(p.oid) identity_args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prorettype='jsonb'::regtype and not p.proretset
   and array['p_actor_id','p_property_id']<@p.proargnames and p.proname not like 'brain\_%' escape '\'
   and p.proname not like '%client%' and p.proname not like '\_brain\_%' escape '\'
 loop
  v_name:='_brain_'||f.proname;
  if length(v_name)>63 then raise exception 'Legacy wrapper name too long: %',f.proname;end if;
  select string_agg(format('%I',a),','order by i) into v_call from unnest(f.proargnames)with ordinality u(a,i);
  v_cap:=case when f.proname~'^(read_|get_)' then 'read' else 'manage' end;
  execute format('alter function public.%I(%s) rename to %I',f.proname,f.identity_args,v_name);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',v_name,f.identity_args);
  execute format('create function public.%I(%s) returns jsonb language plpgsql security definer set search_path='''' as $guard$ begin if not public.brain_can(p_actor_id,p_property_id,%L) then return ''{"state":"forbidden"}''::jsonb;end if;return public.%I(%s);end $guard$',f.proname,f.args,v_cap,v_name,v_call);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname,f.identity_args);
  execute format('grant execute on function public.%I(%s) to service_role',f.proname,f.identity_args);
 end loop;
end $$;

create function public.brain_competitor_chunk_owner() returns trigger language plpgsql set search_path='' as $$
 declare v_property uuid;begin
  select property_id into strict v_property from public.competitors where id=new.competitor_id;
  if new.property_id is not null and new.property_id<>v_property then raise exception 'Competitor chunk owner mismatch';end if;
  if tg_op='UPDATE' and(old.property_id is distinct from v_property or old.competitor_id<>new.competitor_id) then raise exception 'Competitor evidence cannot move communities';end if;
  new.property_id:=v_property;return new;
 end
$$;
create trigger brain_competitor_chunk_owner before insert or update on public.competitor_content_chunks for each row execute function public.brain_competitor_chunk_owner();
create function public.brain_immutable_owner() returns trigger language plpgsql set search_path='' as $$begin
 if new.property_id is distinct from old.property_id then raise exception 'Community ownership is immutable';end if;return new;end$$;
do $$declare t text;begin foreach t in array array['documents','content_assets','property_units','knowledge_sources','knowledge_materials','knowledge_material_versions','knowledge_files','competitors','property_brand_assets','property_intelligence_documents'] loop
 execute format('create trigger brain_immutable_owner before update on public.%I for each row execute function public.brain_immutable_owner()',t);
end loop;end$$;

alter table public.competitor_content_chunks add column embedding_model text;
alter table public.competitor_content_chunks add column embedding_recipe text;
create or replace function public.match_competitor_content(query_embedding public.vector,match_threshold double precision default 0.7,match_count integer default 10,filter_property_id uuid default null,filter_competitor_ids uuid[] default null)
 returns table(id uuid,competitor_id uuid,competitor_name text,page_url text,page_type text,content text,similarity double precision)
 language sql stable set search_path='' as $$
 select cc.id,cc.competitor_id,c.name,cc.page_url,cc.page_type,cc.content,1-(cc.embedding operator(public.<=>) query_embedding)
 from public.competitor_content_chunks cc join public.competitors c on c.id=cc.competitor_id and c.property_id=cc.property_id
 where filter_property_id is not null and cc.property_id=filter_property_id and c.is_active
  and public.brain_evidence_eligible(cc.evidence_id,filter_property_id,'research','internal')
  and cc.embedding_model='text-embedding-3-small' and cc.embedding_recipe='community-text-v1'
  and public.vector_dims(query_embedding)=1536 and(filter_competitor_ids is null or cc.competitor_id=any(filter_competitor_ids))
  and 1-(cc.embedding operator(public.<=>) query_embedding)>greatest(0,match_threshold)
 order by cc.embedding operator(public.<=>) query_embedding limit least(greatest(match_count,0),50)
$$;
revoke all on function public.match_competitor_content(public.vector,double precision,integer,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.match_competitor_content(public.vector,double precision,integer,uuid,uuid[]) to service_role;

create function public.brain_search(p_scope_id uuid,p_property_id uuid,p_query text,p_embedding public.vector default null,p_model text default null,p_limit integer default 12) returns jsonb
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
   from eligible where p_embedding is not null and embedding is not null and embedding_model=p_model and embedding_recipe='community-text-v1'
   order by embedding operator(public.<=>) p_embedding,id limit 100
  ), ranked as(
   select e.*,coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+v.rank),0)score from eligible e
   left join lexical l on l.id=e.id left join semantic v on v.id=e.id where l.id is not null or v.id is not null
   order by score desc,e.id limit p_limit
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'propertyId',property_id,'evidenceId',evidence_id,'sourceHash',source_hash,'content',left(content,8000),'allowedUses',allowed_uses,'authority',authority,'audience',audience,'score',score,'metadata',metadata)order by score desc,id),'[]') into result from ranked;
  return jsonb_build_object('propertyId',p_property_id,'scopeId',p_scope_id,'items',result,'recipe','community-hybrid-rrf-v1','readAt',statement_timestamp());
 end
$$;

create function public.brain_canonical_context(p_property_id uuid,p_purpose text,p_asset_ids uuid[] default '{}') returns jsonb
 language sql stable security definer set search_path='' as $$
 with p as materialized(select id,org_id,name,address,website_url,property_type,unit_count,amenities,pet_policy,parking_info,office_hours,updated_at from public.properties where id=p_property_id),
 facts as materialized(select d.id,d.key,d.payload,d.revision,d.updated_at from public.property_intelligence_documents d join p on p.id=d.property_id and p.org_id=d.org_id
  where d.kind='fact' and d.status='approved' and d.payload->>'visibility'='public'
   and coalesce(d.payload->>'effectiveFrom','0001-01-01')<=current_date::text
   and coalesce(d.payload->>'effectiveTo','9999-12-31')>=current_date::text and d.payload->>'reviewAfter'>=current_date::text),
 units as materialized(select u.* from public.property_units u join p on p.id=u.property_id and p.org_id=u.org_id where u.active and u.review_status='approved' and(u.effective_at is null or u.effective_at<=statement_timestamp())),
 assets as materialized(select a.id,a.property_id,a.name,a.asset_role,a.content_hash,a.governance_revision,a.storage_bucket,a.storage_path,a.format,a.alt_text,a.is_ai_generated,a.rights_status,a.expires_at
  from public.content_assets a join p on p.id=a.property_id and p.org_id=a.org_id
  where a.id=any(p_asset_ids) and a.approval_status='approved' and a.archived_at is null and a.duplicate_of is null
   and a.rights_status in('owned','licensed','generated') and(a.expires_at is null or a.expires_at>statement_timestamp()))
 select jsonb_build_object('property',(select to_jsonb(p)-'org_id' from p),
  'facts',(select coalesce(jsonb_agg(to_jsonb(f)order by id),'[]') from facts f),
  'floorplans',(select coalesce(jsonb_agg(to_jsonb(u)-'org_id'-'import_id'-'inventory_sync_run_id'||case when u.expires_at<=statement_timestamp() then jsonb_build_object('rent_min',null,'rent_max',null,'deposit',null,'available_count',null,'move_in_specials',null,'pricingExpired',true)else '{}'::jsonb end order by u.id),'[]')from units u),
  'brand',(select jsonb_build_object('id',b.id,'revision',b.revision,'contractHash',b.contract_hash,'logos',b.section_6_logo,'typography',b.section_7_typography,'colors',b.section_8_colors,'voice',b.section_2_positioning)from public.property_brand_assets b join p on p.id=b.property_id where b.approval_status='approved'order by b.revision desc limit 1),
  'assets',(select coalesce(jsonb_agg(to_jsonb(a)order by id),'[]')from assets a),
  'omittedAssetIds',(select coalesce(jsonb_agg(requested.id),'[]')from unnest(p_asset_ids)requested(id) where not exists(select 1 from assets a where a.id=requested.id)),
  'asOf',statement_timestamp(),'purpose',p_purpose)
$$;
create function public.brain_context(p_scope_id uuid,p_property_id uuid,p_query text default '',p_asset_ids uuid[] default '{}') returns jsonb
 language plpgsql stable security definer set search_path='' as $$
 declare s public.community_task_scopes;v_canonical jsonb;v_search jsonb;v_manifest jsonb;
 begin
  if not public.brain_scope_current(p_scope_id,p_property_id)then raise insufficient_privilege using message='Community scope expired or access changed';end if;
  if cardinality(p_asset_ids)>100 then raise exception 'Select at most 100 assets';end if;
  select * into s from public.community_task_scopes where id=p_scope_id;
  v_canonical:=public.brain_canonical_context(p_property_id,s.purpose,p_asset_ids);
  v_search:=public.brain_search(p_scope_id,p_property_id,p_query,null,null,12);
  v_manifest:=jsonb_build_object('version','community-context-v1','scopeId',s.id,'scopeKind',s.kind,'actorId',s.actor_id,'orgId',s.org_id,'propertyId',p_property_id,'purpose',s.purpose,'policyRevision',s.policy_revision,'permissionHash',s.permission_hash,'expiresAt',s.expires_at,'recipe','community-hybrid-rrf-v1','canonical',v_canonical,'evidence',v_search->'items');
  return v_manifest||jsonb_build_object('contextHash',public.knowledge_hash(v_manifest));
 end
$$;

-- Approved changes enqueue a projection atomically. Workers never promote generated assertions into facts.
create table public.community_memory_events (
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),org_id uuid not null,
 source_table text not null,source_id uuid not null,source_hash text not null,operation text not null,
 job_id uuid not null references public.shared_jobs(id),created_at timestamptz not null default clock_timestamp(),
 unique(property_id,source_table,source_id,source_hash),foreign key(property_id,org_id) references public.properties(id,org_id)
);
create function public.brain_enqueue_memory() returns trigger language plpgsql security definer set search_path='' as $$
 declare row_data jsonb;v_property uuid;v_org uuid;v_hash text;v_job uuid;v_event uuid;
 begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new;end if;
  v_property:=(row_data->>'property_id')::uuid;
  select org_id into v_org from public.properties where id=v_property;
  if v_property is null or v_org is null then return null;end if;
  v_hash:=public.knowledge_hash(jsonb_build_array(tg_op,row_data));
  v_event:=md5(v_property::text||tg_table_name||(row_data->>'id')||v_hash)::uuid;
  if exists(select 1 from public.community_memory_events where id=v_event)then return null;end if;
  v_job:=gen_random_uuid();
  insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,dedupe_key,payload)
   values(v_job,v_org,v_property,'community_brain','memory_projection',row_data->>'id',v_event::text,jsonb_build_object('eventId',v_event,'sourceTable',tg_table_name,'sourceId',row_data->>'id','sourceHash',v_hash,'operation',tg_op));
  insert into public.community_memory_events(id,property_id,org_id,source_table,source_id,source_hash,operation,job_id)
   values(v_event,v_property,v_org,tg_table_name,(row_data->>'id')::uuid,v_hash,tg_op,v_job);
  return null;
 end
$$;
create trigger brain_fact_memory after insert or update or delete on public.property_intelligence_documents for each row execute function public.brain_enqueue_memory();
create trigger brain_brand_memory after insert or update or delete on public.property_brand_assets for each row execute function public.brain_enqueue_memory();
create trigger brain_asset_memory after insert or update or delete on public.content_assets for each row execute function public.brain_enqueue_memory();
create trigger brain_material_memory after update on public.knowledge_materials for each row execute function public.brain_enqueue_memory();
create trigger brain_unit_memory after insert or update or delete on public.property_units for each row execute function public.brain_enqueue_memory();

alter table public.shared_context_snapshots add column invalidated_at timestamptz;
create table public.community_context_dependencies (
 context_id uuid not null,property_id uuid not null,org_id uuid not null,
 evidence_id uuid,asset_id uuid,unit_id uuid references public.property_units(id),
 source_hash text not null,
 foreign key(context_id,property_id,org_id) references public.shared_context_snapshots(id,property_id,org_id) on delete cascade,
 foreign key(evidence_id,property_id) references public.community_evidence(id,property_id),
 foreign key(asset_id,property_id) references public.content_assets(id,property_id),
 check(num_nonnulls(evidence_id,asset_id,unit_id)=1)
);
create index brain_context_dependencies_context on public.community_context_dependencies(context_id);
create index brain_context_dependencies_evidence on public.community_context_dependencies(evidence_id);
create index brain_context_dependencies_asset on public.community_context_dependencies(asset_id);
create index brain_context_dependencies_unit on public.community_context_dependencies(unit_id);
create function public.brain_invalidate_contexts() returns trigger language plpgsql security definer set search_path='' as $$
 begin
  update public.shared_context_snapshots s set invalidated_at=clock_timestamp() where s.property_id=new.property_id and s.invalidated_at is null
   and exists(select 1 from public.community_context_dependencies d where d.context_id=s.id and d.property_id=new.property_id
    and((tg_table_name='community_evidence' and d.evidence_id=new.id)or(tg_table_name='content_assets' and d.asset_id=new.id)or(tg_table_name='property_units' and d.unit_id=new.id)));
  update public.shared_jobs j set cancel_requested=true,status_reason='Source changed; review current community context' where j.property_id=new.property_id and j.lifecycle_status in('queued','running','retrying')
   and exists(select 1 from public.shared_context_snapshots s where s.id=j.context_snapshot_id and s.property_id=j.property_id and s.invalidated_at is not null);
  return null;
 end
$$;
create trigger brain_evidence_invalidate after update on public.community_evidence for each row execute function public.brain_invalidate_contexts();
create trigger brain_asset_invalidate after update on public.content_assets for each row execute function public.brain_invalidate_contexts();
create trigger brain_unit_invalidate after update on public.property_units for each row execute function public.brain_invalidate_contexts();

do $$declare t text;f regprocedure;begin
 foreach t in array array['community_memory_events','community_context_dependencies'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'brain\_%' escape '\' and p.proname<>'brain_can' loop
  execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
 end loop;
end$$;
commit;
