begin;
-- Auth executes the worker token hook through this schema.
grant usage on schema public to supabase_auth_admin;
-- A first-party generated page remains derived evidence when it is crawled back
-- into the platform. Resolve provenance from retained native publications.
create function public.brain_generated_web_origin(p_property_id uuid,p_url text) returns boolean
language sql stable security definer set search_path='' as $$
 with origins as (
  select wp_url url from public.property_websites where property_id=p_property_id and deployed_artifact_version_id is not null
  union all select deployed_url from public.siteforge_artifact_deployments where property_id=p_property_id and deployed_at is not null
  union all select target_snapshot->>'url' from public.siteforge_package_releases where property_id=p_property_id and kind in('preview','deploy') and state in('succeeded','uncertain')
 ), normalized as(select lower(regexp_replace(url,'^(https?://[^/]+).*$','\1')) host from origins where url~'^https?://[^/]+' )
 select p_url~'^https?://' and exists(select 1 from normalized where host=lower(regexp_replace(p_url,'^(https?://[^/]+).*$','\1')))
$$;
revoke all on function public.brain_generated_web_origin(uuid,text) from public,anon,authenticated,service_role;
alter function public.brain_review_source(uuid,uuid,jsonb) rename to _brain_review_source_v1;
revoke all on function public._brain_review_source_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.brain_review_source(p_scope_id uuid,p_version_id uuid,p_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;v public.knowledge_material_versions;web jsonb;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 select *into v from public.knowledge_material_versions where id=p_version_id;
 if s.kind is distinct from 'community' or v.property_id is distinct from s.property_ids[1] or not public.brain_scope_current(s.id,v.property_id) or not public.brain_can(s.actor_id,v.property_id,'manage') then raise insufficient_privilege;end if;
 web:=public.knowledge_version_web_origin(v.id);
 if p_review->>'origin'='original' and (public.brain_generated_web_origin(v.property_id,web->>'url') or public.brain_generated_web_origin(v.property_id,web->>'requestedUrl')) then
  raise exception 'A generated website is derived creative evidence. Verify its facts against an independent original.';
 end if;
 return public._brain_review_source_v1(p_scope_id,p_version_id,p_review);
end$$;
revoke all on function public.brain_review_source(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.brain_review_source(uuid,uuid,jsonb)to service_role;

-- A later decision may lower an original's authority, never erase generated ancestry.
do $$declare definition text;begin
 select pg_get_functiondef('public._brain_review_source_v1(uuid,uuid,jsonb)'::regprocedure)into definition;
 execute replace(definition,'set actor_id=excluded.actor_id,audience=excluded.audience','set origin=excluded.origin,actor_id=excluded.actor_id,audience=excluded.audience');
 select pg_get_functiondef('public.brain_project_memory(uuid,text)'::regprocedure)into definition;
 definition:=replace(definition,'update public.documents d set','update public.documents indexed_doc set');
 definition:=replace(definition,'d.property_id=j.property_id','indexed_doc.property_id=j.property_id');
 definition:=replace(definition,'d.metadata->>','indexed_doc.metadata->>');
 definition:=replace(definition,'d.content=(ch.value','indexed_doc.content=(ch.value');
 definition:=replace(definition,'d.embedding=(emb','indexed_doc.embedding=(emb');
 definition:=replace(definition,'indexed_doc.embedding=(emb','indexed_doc.embedding operator(public.=) (emb');
 execute replace(definition,'set review_status=excluded.review_status,audience=excluded.audience','set authority=excluded.authority,origin=excluded.origin,review_status=excluded.review_status,audience=excluded.audience');
end$$;

-- One serving decision covers canonical manifests, portfolio cards and downloads.
create function public.brain_asset_current(p_asset_id uuid,p_property_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.content_assets a where a.id=p_asset_id and a.property_id=p_property_id
 and a.approval_status='approved'and a.curation_status in('approved','selected')and a.archived_at is null and a.duplicate_of is null
 and a.rights_status in('owned','licensed','generated')and(a.expires_at is null or a.expires_at>statement_timestamp())
 and coalesce(a.content_hash,'')~'^[a-f0-9]{64}$'and a.storage_bucket in('knowledge-originals','property-assets','content-assets','brand-assets')
 and public.brain_storage_owner(a.storage_path)=a.property_id and public.brain_connected_file_current(a.original_file_id))
$$;
revoke all on function public.brain_asset_current(uuid,uuid)from public,anon,authenticated,service_role;
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_canonical_context(uuid,text,uuid[])'::regprocedure)into definition;
 execute replace(definition,'where a.id=any(p_asset_ids) and','where a.id=any(p_asset_ids) and public.brain_asset_current(a.id,a.property_id) and');
 select pg_get_functiondef('public.brain_read_asset(uuid,uuid)'::regprocedure)into definition;
 execute replace(definition,'if not found or a.archived_at is not null','if not found or not public.brain_asset_current(a.id,a.property_id) or a.archived_at is not null');
 select pg_get_functiondef('public.brain_portfolio_assets(uuid,uuid,boolean,integer)'::regprocedure)into definition;
 definition:=replace(definition,'where property_id=p_property_id and active','where property_id=p_property_id and active and review_status=''approved''');
 definition:=replace(definition,'where u.property_id=p_property_id and u.active','where u.property_id=p_property_id and u.active and u.review_status=''approved''');
 definition:=replace(definition,'a.asset_role=''floorplan''and','a.asset_role=''floorplan''and public.brain_asset_current(a.id,a.property_id)and');
 definition:=replace(definition,'where property_id=p_property_id and archived_at is null','where property_id=p_property_id and public.brain_asset_current(id,property_id)and archived_at is null');
 execute definition;
end$$;

-- Changing source use must take effect at read time, before its index catches up.
alter table public.community_evidence add column asset_revision bigint;
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_evidence_eligible(uuid,uuid,text,text)'::regprocedure)into definition;
 definition:=replace(definition,'and e.review_status=''approved''',
 'and (e.material_version_id is null or exists(select 1 from public.community_source_reviews r where r.version_id=e.material_version_id and r.property_id=e.property_id and r.origin=e.origin and r.audience=e.audience and r.allowed_uses=e.allowed_uses and r.purposes=e.purposes and r.review_after=e.review_after and r.expires_at is not distinct from e.expires_at)) and e.review_status=''approved''');
 definition:=replace(definition,'and a.content_hash=e.content_hash','and a.content_hash=e.content_hash and a.governance_revision=e.asset_revision and public.brain_asset_current(a.id,a.property_id)');
 execute definition;
 select pg_get_functiondef('public.brain_project_memory(uuid,text)'::regprocedure)into definition;
 definition:=replace(definition,'md5(''asset:''||a.id::text||h)::uuid','md5(''asset:''||a.id::text||h||'':r''||a.governance_revision)::uuid');
 definition:=replace(definition,'community_evidence(id,property_id,org_id,asset_id,authority','community_evidence(id,property_id,org_id,asset_id,asset_revision,authority');
 definition:=replace(definition,'values(eid,j.property_id,j.org_id,a.id,''creative''','values(eid,j.property_id,j.org_id,a.id,a.governance_revision,''creative''');
 execute definition;
end$$;
create trigger brain_source_review_invalidation after insert or update or delete on public.community_source_reviews for each row execute function public.brain_invalidate_canonical();
create trigger brain_connected_file_invalidation after insert or update or delete on public.community_connected_files for each row execute function public.brain_invalidate_canonical();
create trigger brain_connected_source_invalidation after update or delete on public.siteforge_asset_sources for each row execute function public.brain_invalidate_canonical();

-- Close the last approval race in the native brand commit, within its write transaction.
create or replace function public.finish_brand_operation(p_request_id uuid,p_claim_token uuid,p_updates jsonb,p_result jsonb,p_error text default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.brand_operations;b public.community_brand_contexts;k public.community_service_packages;begin
 select *into o from public.brand_operations where id=p_request_id for update;
 if o.claim_token is distinct from p_claim_token then return '{"state":"claim_conflict"}';end if;
 if o.state='running'and p_error is null and o.kind in('generate','regenerate','visuals','contract')then
  select *into b from public.community_brand_contexts where operation_id=o.id;
  if b.context_id is null or not public.brain_context_current(b.context_id,o.actor_id)then raise exception 'Current approved community context is required';end if;
  if b.deliverable_id is not null then
   select k1.*into k from public.community_service_packages k1 join public.community_generation_briefs d on d.package_id=k1.id where d.id=b.deliverable_id and d.property_id=o.property_id;
   if k.id is null or k.state<>'approved' or exists(select 1 from public.community_service_packages n where n.initiative_id=k.initiative_id and n.version>k.version)then raise exception 'Package approval changed';end if;
  end if;
 end if;
 if o.state='running'and p_error is null and not public.brain_can(o.actor_id,o.property_id,'manage')then raise insufficient_privilege;end if;
 return public._brain_finish_brand_operation_v1(p_request_id,p_claim_token,p_updates,p_result,p_error);end$$;

-- Reservations cannot grant authority to a stale generation request.
alter function public.brain_reserve_package_processing(text,uuid,text,integer)rename to _brain_reserve_package_processing_v1;
revoke all on function public._brain_reserve_package_processing_v1(text,uuid,text,integer)from public,anon,authenticated,service_role;
create function public.brain_reserve_package_processing(p_kind text,p_id uuid,p_operation text,p_cents integer)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_kind='brand'then
  if not exists(select 1 from public.community_brand_contexts b join public.brand_operations o on o.id=b.operation_id where o.id=p_id and o.state='running'and public.brain_context_current(b.context_id,o.actor_id))then raise insufficient_privilege;end if;
 elsif not public.brain_generation_current(p_kind,p_id)then raise insufficient_privilege;end if;
 return public._brain_reserve_package_processing_v1(p_kind,p_id,p_operation,p_cents);
end$$;
revoke all on function public.brain_reserve_package_processing(text,uuid,text,integer)from public,anon,authenticated;
grant execute on function public.brain_reserve_package_processing(text,uuid,text,integer)to service_role;

create or replace function public.brain_run_maintenance()returns jsonb language plpgsql security definer set search_path='' as $$
declare queries integer;messages integer;responses integer;begin
 delete from public.community_query_embeddings where expires_at<clock_timestamp()-interval '2 days';get diagnostics queries=row_count;
 delete from public.community_portfolio_messages where session_id in(select id from public.community_portfolio_sessions where expires_at<clock_timestamp());get diagnostics messages=row_count;
 update public.community_model_calls set response=null where response is not null and portfolio_session_id in(select id from public.community_portfolio_sessions where expires_at<clock_timestamp());get diagnostics responses=row_count;
 return jsonb_build_object('expiredQueriesRemoved',queries,'expiredPortfolioMessagesRemoved',messages,'expiredModelResponsesScrubbed',responses,'originalsRemoved',0,'providerDeletionConfirmed',false);end$$;

create function public.brain_read_processing_budgets(p_scope_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.community_task_scopes;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('packageId',p.id,'version',p.version,'approvedUsd',p.ai_budget_usd,'reservedCents',coalesce(b.reserved_cost_cents,0),'verifiedCostCents',coalesce(b.used_cost_cents,0),'status',coalesce(b.status,'unused'),'settlement','Unknown provider costs remain reserved.','mediaSpendAuthorized',false)order by p.created_at desc),'[]')from public.community_service_packages p left join public.community_package_budgets m on m.package_id=p.id left join public.shared_execution_budgets b on b.id=m.budget_id where p.property_id=s.property_ids[1]);end$$;
revoke all on function public.brain_read_processing_budgets(uuid)from public,anon,authenticated;
grant execute on function public.brain_read_processing_budgets(uuid)to service_role;
commit;
