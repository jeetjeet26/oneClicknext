begin;
-- Restrictive policies intersect all existing permissive policies on community-owned tables.
do $$declare t record;begin
 for t in select c.table_name from information_schema.columns c join pg_class p on p.relname=c.table_name join pg_namespace n on n.oid=p.relnamespace and n.nspname=c.table_schema where c.table_schema='public'and c.column_name='property_id'and p.relkind in('r','p')and c.table_name not like 'community_%'loop
  if not exists(select 1 from pg_policies where schemaname='public'and tablename=t.table_name and policyname='community_scope_read')then
   execute format('alter table public.%I enable row level security',t.table_name);
   execute format('create policy community_scope_read on public.%I as restrictive for select to authenticated using(public.brain_can((select auth.uid()),property_id,''read''))',t.table_name);
   execute format('create policy community_scope_insert on public.%I as restrictive for insert to authenticated with check(public.brain_can((select auth.uid()),property_id,''manage''))',t.table_name);
   execute format('create policy community_scope_update on public.%I as restrictive for update to authenticated using(public.brain_can((select auth.uid()),property_id,''manage''))with check(public.brain_can((select auth.uid()),property_id,''manage''))',t.table_name);
   execute format('create policy community_scope_delete on public.%I as restrictive for delete to authenticated using(public.brain_can((select auth.uid()),property_id,''manage''))',t.table_name);
  end if;
 end loop;
end$$;
create function public.brain_list_communities(p_actor_id uuid,p_capability text default 'read')returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'capabilities',g.capabilities)order by p.name,p.id),'[]')from public.community_access_grants g join public.properties p on p.id=g.property_id
 where g.actor_id=p_actor_id and public.brain_can(p_actor_id,p.id,p_capability)
$$;
create table public.community_portfolio_sessions(
 id uuid primary key,actor_id uuid not null references auth.users(id),org_id uuid not null references public.organizations(id),
 property_ids uuid[] not null,permission_hash text not null,title text not null,created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '30 days',check(cardinality(property_ids)between 1 and 500)
);
create table public.community_portfolio_messages(
 id uuid primary key,session_id uuid not null references public.community_portfolio_sessions(id)on delete cascade,
 role text not null check(role in('user','assistant')),body text not null check(length(body)<=20000),evidence jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(),check(octet_length(evidence::text)<=1000000)
);
create index community_portfolio_messages_session on public.community_portfolio_messages(session_id,created_at,id);
create function public.brain_portfolio_session(p_scope_id uuid,p_session_id uuid,p_title text default 'Portfolio research')returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;v public.community_portfolio_sessions;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'portfolio'or not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 insert into public.community_portfolio_sessions(id,actor_id,org_id,property_ids,permission_hash,title)values(p_session_id,s.actor_id,s.org_id,s.property_ids,s.permission_hash,left(p_title,160))on conflict(id)do nothing;
 select *into v from public.community_portfolio_sessions where id=p_session_id;
 if v.actor_id<>s.actor_id or v.property_ids<>s.property_ids or v.org_id<>s.org_id or v.permission_hash<>s.permission_hash or v.expires_at<=clock_timestamp()then raise insufficient_privilege using message='Combined history is unavailable after an access or selection change';end if;
 return to_jsonb(v);end$$;
create function public.brain_portfolio_history(p_scope_id uuid,p_session_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform public.brain_portfolio_session(p_scope_id,p_session_id);
 return(select coalesce(jsonb_agg(to_jsonb(q)order by created_at,id),'[]')from(select id,role,body,evidence,created_at from public.community_portfolio_messages where session_id=p_session_id order by created_at desc,id desc limit 40)q);end$$;
create function public.brain_portfolio_append(p_scope_id uuid,p_session_id uuid,p_id uuid,p_role text,p_body text,p_evidence jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;begin
 perform public.brain_portfolio_session(p_scope_id,p_session_id);
 select *into s from public.community_task_scopes where id=p_scope_id;
 if p_evidence->'propertyIds'is distinct from to_jsonb(s.property_ids)then raise exception 'Portfolio evidence membership does not match the selected communities';end if;
 insert into public.community_portfolio_messages(id,session_id,role,body,evidence)values(p_id,p_session_id,p_role,p_body,p_evidence)on conflict(id)do nothing;
 if not exists(select 1 from public.community_portfolio_messages where id=p_id and session_id=p_session_id and role=p_role and body=p_body and evidence=p_evidence)then raise exception 'Portfolio message identity conflict';end if;
 return jsonb_build_object('state','saved','id',p_id);end$$;
create function public.brain_portfolio_assets(p_scope_id uuid,p_property_id uuid,p_plans boolean,p_offset integer default 0)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare s public.community_task_scopes;items jsonb;n bigint;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'portfolio'or not public.brain_scope_current(s.id,p_property_id)or p_offset not between 0 and 100000 then raise insufficient_privilege;end if;
 if p_plans then
  select count(*)into n from public.property_units where property_id=p_property_id and active;
  select coalesce(jsonb_agg(to_jsonb(q)order by q.name,q.id),'[]')into items from(
   select u.id,u.unit_type name,u.bedrooms,u.bathrooms,u.sqft_min,u.sqft_max,u.review_status,u.last_updated_at,u.floor_plan_image_asset_id,
   case when a.asset_role='floorplan'and a.archived_at is null and coalesce(a.content_hash,'')~'^[a-f0-9]{64}$'then a.id end asset_id,
   a.content_hash,a.original_file_id,a.original_page,a.governance_revision source_revision
   from public.property_units u left join public.content_assets a on a.id=u.floor_plan_image_asset_id and a.property_id=u.property_id
   where u.property_id=p_property_id and u.active order by u.unit_type,u.id limit 100 offset p_offset)q;
 else
  select count(*)into n from public.content_assets where property_id=p_property_id and archived_at is null;
  select coalesce(jsonb_agg(to_jsonb(q)order by q.name,q.id),'[]')into items from(
   select id,id asset_id,name,asset_role,format,approval_status,rights_status,is_ai_generated,content_hash,governance_revision source_revision,original_file_id,original_page
   from public.content_assets where property_id=p_property_id and archived_at is null order by name,id limit 100 offset p_offset)q;
 end if;
 return jsonb_build_object('propertyId',p_property_id,'items',items,'total',n,'nextOffset',case when p_offset+100<n then p_offset+100 end,'readAt',statement_timestamp());end$$;

-- Provider handles are never accepted as authority. Every parent has the identical saved scope.
create table public.community_provider_objects(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.community_task_scopes(id),property_id uuid references public.properties(id),
 portfolio_session_id uuid references public.community_portfolio_sessions(id),provider text not null,project_ref text not null,
 object_kind text not null check(object_kind in('input_file','output_file','response','conversation','container')),
 object_id text not null,parents uuid[] not null default '{}',context_id uuid references public.shared_context_snapshots(id),
 state text not null default 'retained'check(state in('retained','delete_requested','deleted','deletion_unconfirmed','expired_unconfirmed')),
 policy_revision text not null,expires_at timestamptz not null,last_checked_at timestamptz,deleted_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 check(num_nonnulls(property_id,portfolio_session_id)=1),unique(provider,project_ref,object_kind,object_id)
);
create index brain_provider_cleanup on public.community_provider_objects(state,expires_at);
create function public.brain_provider_record(p_scope_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;r public.community_provider_objects;pid uuid;parents uuid[];begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 pid:=case when s.kind='community'then s.property_ids[1]end;parents:=array(select jsonb_array_elements_text(coalesce(p_input->'parents','[]')))::uuid[];
 if cardinality(parents)>20 or exists(select 1 from unnest(parents)x where not exists(select 1 from public.community_provider_objects o where o.id=x and o.scope_id=s.id and o.state='retained'and o.expires_at>clock_timestamp()))then raise insufficient_privilege using message='Provider parent belongs to another scope or expired';end if;
 if s.kind='portfolio'then perform public.brain_portfolio_session(s.id,(p_input->>'sessionId')::uuid);end if;
 if p_input->>'contextId'is not null and not exists(select 1 from public.shared_context_snapshots where id=(p_input->>'contextId')::uuid and property_id=pid and context_payload->>'scopeId'=s.id::text)then raise insufficient_privilege;end if;
 insert into public.community_provider_objects(scope_id,property_id,portfolio_session_id,provider,project_ref,object_kind,object_id,parents,context_id,policy_revision,expires_at)
 values(s.id,pid,case when s.kind='portfolio'then(p_input->>'sessionId')::uuid end,p_input->>'provider',p_input->>'project',p_input->>'kind',p_input->>'objectId',parents,(p_input->>'contextId')::uuid,p_input->>'policyRevision',(p_input->>'expiresAt')::timestamptz)
 on conflict(provider,project_ref,object_kind,object_id)do nothing returning *into r;
 if r.id is null then select *into r from public.community_provider_objects where provider=p_input->>'provider'and project_ref=p_input->>'project'and object_kind=p_input->>'kind'and object_id=p_input->>'objectId';if r.scope_id<>s.id then raise insufficient_privilege;end if;end if;
 return to_jsonb(r);end$$;
create function public.brain_provider_read(p_scope_id uuid,p_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare r public.community_provider_objects;s public.community_task_scopes;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into r from public.community_provider_objects where id=p_id;
 if not found or r.scope_id<>s.id or r.state<>'retained'or r.expires_at<=statement_timestamp()or not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 return to_jsonb(r);end$$;

-- Versioned service packages and deliverable briefs supplement native plans and writers.
create table public.community_initiatives(
 id uuid primary key,property_id uuid not null,org_id uuid not null,actor_id uuid not null references auth.users(id),name text not null,
 offering text not null,objective text not null,success_metric text not null,baseline jsonb not null,starts_on date not null,ends_on date not null,
 stop_conditions jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(id,property_id),
 foreign key(property_id,org_id)references public.properties(id,org_id),check(ends_on>=starts_on)
);
create table public.community_service_packages(
 id uuid primary key,initiative_id uuid not null,property_id uuid not null,version integer not null check(version>0),previous_id uuid,
 actor_id uuid not null references auth.users(id),brief jsonb not null,brief_hash text not null,
 state text not null default 'draft'check(state in('draft','approved','withdrawn')),ai_budget_usd numeric(12,2)not null check(ai_budget_usd>=0),
 created_at timestamptz not null default clock_timestamp(),unique(id,property_id),unique(initiative_id,version),
 foreign key(initiative_id,property_id)references public.community_initiatives(id,property_id),foreign key(previous_id,property_id)references public.community_service_packages(id,property_id),
 check(octet_length(brief::text)<=100000)
);
create table public.community_generation_briefs(
 id uuid primary key,property_id uuid not null,package_id uuid not null,actor_id uuid not null references auth.users(id),purpose text not null check(purpose in('site','social','brand','chat')),
 context_id uuid not null,org_id uuid not null,requirements jsonb not null,output_contract jsonb not null,review_criteria jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(id,property_id),foreign key(package_id,property_id)references public.community_service_packages(id,property_id),
 foreign key(context_id,property_id,org_id)references public.shared_context_snapshots(id,property_id,org_id)
);
create function public.brain_save_initiative(p_scope_id uuid,p_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])or not public.brain_can(s.actor_id,s.property_ids[1],'manage')then raise insufficient_privilege;end if;
 if octet_length(p_input::text)>100000 or length(p_input->>'objective')not between 3 and 2000 then raise exception 'Provide a bounded initiative';end if;
 insert into public.community_initiatives(id,property_id,org_id,actor_id,name,offering,objective,success_metric,baseline,starts_on,ends_on,stop_conditions)
 values(p_id,s.property_ids[1],s.org_id,s.actor_id,p_input->>'name',p_input->>'offering',p_input->>'objective',p_input->>'successMetric',p_input->'baseline',(p_input->>'start')::date,(p_input->>'end')::date,p_input->'stopConditions');
 return jsonb_build_object('state','saved','initiativeId',p_id);end$$;
create function public.brain_save_package(p_scope_id uuid,p_id uuid,p_initiative_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;prior public.community_service_packages;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])or not public.brain_can(s.actor_id,s.property_ids[1],'manage')or not exists(select 1 from public.community_initiatives where id=p_initiative_id and property_id=s.property_ids[1])then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_initiative_id::text,91));select *into prior from public.community_service_packages where initiative_id=p_initiative_id order by version desc limit 1;
 if prior.id is distinct from(p_input->>'previousId')::uuid then raise exception 'Service package changed';end if;
 insert into public.community_service_packages(id,initiative_id,property_id,version,previous_id,actor_id,brief,brief_hash,state,ai_budget_usd)
 values(p_id,p_initiative_id,s.property_ids[1],coalesce(prior.version,0)+1,prior.id,s.actor_id,p_input->'brief',public.knowledge_hash(p_input->'brief'),p_input->>'state',(p_input->>'aiBudgetUsd')::numeric);
 return jsonb_build_object('state','saved','packageId',p_id,'mediaSpendAuthorized',false);end$$;
create function public.brain_prepare_deliverable(p_scope_id uuid,p_id uuid,p_package_id uuid,p_query text,p_asset_ids uuid[],p_requirements jsonb,p_output jsonb,p_review jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
 declare s public.community_task_scopes;pkg public.community_service_packages;c jsonb;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into pkg from public.community_service_packages where id=p_package_id and state='approved'and property_id=s.property_ids[1];
 if s.kind is distinct from'community'or s.purpose not in('site','social','brand','chat')or pkg.id is null then raise insufficient_privilege;end if;
 if exists(select 1 from public.community_service_packages where initiative_id=pkg.initiative_id and version>pkg.version)then raise exception 'Use the current service package version';end if;
 c:=public.brain_save_context(s.id,pkg.property_id,p_query,p_asset_ids,null);
 insert into public.community_generation_briefs(id,property_id,package_id,actor_id,purpose,context_id,org_id,requirements,output_contract,review_criteria)
 values(p_id,pkg.property_id,pkg.id,s.actor_id,s.purpose,(c->>'snapshotId')::uuid,s.org_id,p_requirements,p_output,p_review);
 return jsonb_build_object('id',p_id,'packageId',pkg.id,'packageVersion',pkg.version,'brief',pkg.brief,'deliverable',p_requirements,'outputContract',p_output,'reviewCriteria',p_review,'context',c,'mediaSpendAuthorized',false);end$$;

alter table public.knowledge_materials add column next_check_at timestamptz;
alter table public.knowledge_materials add column last_check_attempt_at timestamptz;
alter table public.knowledge_materials add column last_check_success_at timestamptz;
alter table public.knowledge_materials add column last_check_changed_at timestamptz;
create index community_material_due on public.knowledge_materials(next_check_at,property_id);
create function public.brain_capture_progress()returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.source_material_id is not null and new.state in('ready','held')and old.state is distinct from new.state then
  update public.knowledge_materials set last_check_success_at=case when new.state='ready'then clock_timestamp()else last_check_success_at end,
   last_check_changed_at=case when new.state='ready'and(new.receipt->>'bodyHash')is distinct from(new.input->>'previousBodyHash')then clock_timestamp()else last_check_changed_at end
   where id=new.source_material_id and property_id=new.property_id;
 end if;return null;end$$;
create trigger brain_capture_progress after update on public.knowledge_web_captures for each row execute function public.brain_capture_progress();
-- Due times are operational metadata; updating them must not invalidate facts or enqueue memory.
drop trigger brain_material_memory on public.knowledge_materials;
create trigger brain_material_memory after update of active_version_id,latest_version_id,last_release_id,updated_at on public.knowledge_materials for each row execute function public.brain_enqueue_memory();
drop trigger brain_canonical_invalidate on public.knowledge_materials;
create trigger brain_canonical_invalidate after update of active_version_id,last_release_id or delete on public.knowledge_materials for each row execute function public.brain_invalidate_canonical();

CREATE OR REPLACE FUNCTION "public"."dispatch_knowledge_web_checks"("p_limit" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare q public.knowledge_web_policies;m record;v_policy_id uuid;v_origin jsonb;v_count int;v_id uuid;v_event uuid;v_input jsonb;v_requests jsonb:='[]';v_now timestamptz:=clock_timestamp();
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Use a batch of at most 100 captures';end if;
 perform pg_advisory_xact_lock(hashtextextended('knowledge.web.schedule',992));
 for v_policy_id in select property_id from public.knowledge_web_policies where enabled and public.brain_can(owner_id,property_id,'manage') order by coalesce((select min(m.next_check_at)from public.knowledge_materials m where m.property_id=knowledge_web_policies.property_id),'-infinity'::timestamptz),property_id loop
  perform pg_advisory_xact_lock(hashtextextended(v_policy_id::text,12));
  select policy.*into q from public.knowledge_web_policies policy join public.properties p on p.id=policy.property_id and p.org_id=policy.org_id join public.profiles u on u.id=policy.owner_id and u.org_id=policy.org_id and u.role in('admin','manager')where policy.property_id=v_policy_id and policy.enabled for update of policy,p for share of u;
  if not found then continue;end if;
  select count(*)into v_count from public.knowledge_web_captures where property_id=q.property_id and org_id=q.org_id and origin='scheduled'and created_at>=date_trunc('day',v_now at time zone'UTC')at time zone'UTC';
  if v_count>=q.daily_limit then continue;end if;
  for m in select material.id,material.active_version_id,v.title from public.knowledge_materials material join public.knowledge_material_versions v on v.id=material.active_version_id where material.property_id=q.property_id and material.org_id=q.org_id and(material.next_check_at is null or material.next_check_at<=v_now)order by material.next_check_at nulls first,material.id loop
   if exists(select 1 from public.knowledge_web_captures where source_material_id=m.id and state in('queued','running'))then continue;end if;
   v_origin:=public.knowledge_version_web_origin(m.active_version_id);
   if v_origin is null or(v_origin->>'fetchedAt')::timestamptz>v_now-make_interval(hours=>q.interval_hours)then continue;end if;
   v_id:=gen_random_uuid();v_input:=jsonb_build_object('title',m.title,'url',v_origin->>'url','materialId',m.id,'parentCaptureId',v_origin->>'captureId','previousBodyHash',v_origin->>'bodyHash','sourceOriginHash',public.knowledge_hash(v_origin),'policyOwnerId',q.owner_id,'reason','Scheduled capture under the reviewed published-source policy');
   insert into public.knowledge_web_captures(id,property_id,org_id,actor_id,input,input_hash,parent_capture_id,origin,policy_id,policy_revision,source_material_id,source_version_id)
   values(v_id,q.property_id,q.org_id,null,v_input,public.knowledge_hash(v_input),(v_origin->>'captureId')::uuid,'scheduled',q.property_id,q.revision,m.id,m.active_version_id);
   v_event:=md5('knowledge.web.scheduled:'||v_id::text)::uuid;
   insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(v_event,q.org_id,q.property_id,'knowledge.web.schedule','workflow');
   insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(v_event,v_event,q.org_id,q.property_id,'knowledge.web.schedule','knowledge','knowledge.web.scheduled','server_confirmed','succeeded',jsonb_build_object('policyRevision',q.revision,'materialId',m.id,'sourceVersionId',m.active_version_id,'inputHash',public.knowledge_hash(v_input)),jsonb_build_object('captureId',v_id,'captureState','queued','published',false));
   update public.knowledge_materials set last_check_attempt_at=v_now,next_check_at=v_now+make_interval(hours=>q.interval_hours)where id=m.id and property_id=q.property_id;
   v_requests:=v_requests||jsonb_build_array(jsonb_build_object('id',v_id,'propertyId',q.property_id));v_count:=v_count+1;
   if jsonb_array_length(v_requests)>=p_limit then return jsonb_build_object('state','ready','requests',v_requests);end if;
   exit; -- At most one due source per community in a sweep; oldest due communities lead the next sweep.
  end loop;
 end loop;
 return jsonb_build_object('state','ready','requests',v_requests);
end$$;


CREATE OR REPLACE FUNCTION "public"."assistant_source_snapshot"("p_property_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
 select jsonb_build_object('property',jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'city',p.settings->'city','additionalWebsites',p.settings->'additionalUrls','propertyType',p.property_type,'website',p.website_url,'unitCount',p.unit_count,'yearBuilt',p.year_built,'amenities',p.amenities,'petPolicy',p.pet_policy,'parking',p.parking_info,'specialFeatures',p.special_features,'brandVoice',p.brand_voice,'audience',p.target_audience,'officeHours',p.office_hours),
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'floorplan',u.unit_type,'bedrooms',u.bedrooms,'bathrooms',u.bathrooms,'sqftMin',u.sqft_min,'sqftMax',u.sqft_max,'priceMin',u.rent_min,'priceMax',u.rent_max,'deposit',u.deposit,'available',u.available_count,'specials',u.move_in_specials,'source',u.source,'sourceUrl',u.source_url,'sourceIdentity',u.source_identity,'updatedAt',u.last_updated_at,'effectiveAt',u.effective_at,'expiresAt',u.expires_at,'active',u.active,'reviewStatus',u.review_status,'eligible',u.active and u.review_status='approved'and(u.effective_at is null or u.effective_at<=now())and(u.expires_at is null or u.expires_at>now()))order by u.id)from public.property_units u where u.property_id=p.id and u.org_id=p.org_id and u.active and u.review_status='approved'and(u.expires_at is null or u.expires_at>now())),'[]'),
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'type',k.source_type,'name',k.source_name,'url',k.source_url,'status',k.status,'lastSyncedAt',k.last_synced_at,'materialId',k.extracted_data->>'knowledge_material_id','versionId',k.extracted_data->>'active_version_id','releaseId',k.extracted_data->>'last_release_id')order by k.id)from public.knowledge_sources k where k.property_id=p.id),'[]'),
 'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'content',d.content,'title',coalesce(d.metadata->>'title',d.original_file_name,d.metadata->>'source','Untitled saved source'),'source',d.metadata->>'source','sourceId',d.metadata->>'knowledge_source_id','materialId',d.metadata->>'knowledge_material_id','versionId',d.metadata->>'version_id','runId',d.metadata->>'ingestion_run_id','chunkIndex',d.metadata->'chunk_index','createdAt',d.created_at,'identity',case when exists(select 1 from public.knowledge_materials m where m.property_id=p.id and m.org_id=p.org_id and m.id::text=d.metadata->>'knowledge_material_id'and m.active_version_id::text=d.metadata->>'version_id')then'reviewed_text_publication'else'legacy_recorded_material'end)order by d.id)from public.documents d where d.property_id=p.id and public.brain_evidence_eligible(d.evidence_id,p.id,'chat','public')),'[]'))
 from public.properties p where p.id=p_property_id
$$;



do $$declare t text;f regprocedure;begin
 foreach t in array array['community_portfolio_sessions','community_portfolio_messages','community_provider_objects','community_initiatives','community_service_packages','community_generation_briefs']loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,community_brain_worker',t);execute format('grant select,insert,update,delete on public.%I to service_role',t);end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'brain\_%'escape '\'and p.proname not in('brain_can','brain_storage_owner')loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;
end$$;
commit;
