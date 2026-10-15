begin;
-- Unknown expiry is not evidence that a commercial offer remains current.
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_canonical_context(uuid,text,uuid[])'::regprocedure)into definition;
 execute replace(definition,'when u.expires_at<=statement_timestamp()','when u.expires_at is null or u.expires_at<=statement_timestamp()');
end$$;

alter table public.community_brand_contexts add column deliverable_id uuid references public.community_generation_briefs(id);
alter function public.brain_brand_context(uuid,uuid,boolean)rename to _brain_brand_context_v1;
revoke all on function public._brain_brand_context_v1(uuid,uuid,boolean)from public,anon,authenticated,service_role;
create function public.brain_brand_context(p_scope_id uuid,p_operation_id uuid,p_prepare boolean default false,p_deliverable_id uuid default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;o public.brand_operations;b public.community_brand_contexts;c jsonb;d jsonb;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into o from public.brand_operations where id=p_operation_id;
 if s.kind is distinct from'community'or s.purpose is distinct from'brand'or o.property_id is distinct from s.property_ids[1]or o.actor_id is distinct from s.actor_id or o.state is distinct from'running'or not public.brain_scope_current(s.id,o.property_id)then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,91));
 select *into b from public.community_brand_contexts where operation_id=o.id;
 if not found and p_prepare and p_deliverable_id is not null then
  d:=public.brain_read_deliverable(s.id,p_deliverable_id);c:=d->'context';
  insert into public.community_brand_contexts(operation_id,context_id,property_id,actor_id,deliverable_id)values(o.id,(c->>'snapshotId')::uuid,o.property_id,s.actor_id,p_deliverable_id)returning *into b;
 elsif not found and p_prepare then
  c:=public._brain_brand_context_v1(p_scope_id,p_operation_id,true);
  select *into b from public.community_brand_contexts where operation_id=o.id;
 end if;
 if b.context_id is null or not public.brain_context_current(b.context_id,s.actor_id)then raise exception 'Brand sources changed; prepare a new reviewed request';end if;
 if p_deliverable_id is not null and b.deliverable_id is distinct from p_deliverable_id then raise exception 'Brand package identity changed';end if;
 if b.deliverable_id is not null then d:=public.brain_read_deliverable(s.id,b.deliverable_id);end if;
 select context_payload||jsonb_build_object('snapshotId',id,'servicePackage',d)into c from public.shared_context_snapshots where id=b.context_id;
 return c;end$$;
revoke all on function public.brain_brand_context(uuid,uuid,boolean,uuid)from public,anon,authenticated;
grant execute on function public.brain_brand_context(uuid,uuid,boolean,uuid)to service_role;

create table public.community_package_budgets(
 package_id uuid primary key references public.community_service_packages(id),budget_id uuid unique not null references public.shared_execution_budgets(id)
);
create table public.community_processing_reservations(
 id uuid primary key default gen_random_uuid(),package_id uuid not null references public.community_service_packages(id),
 native_kind text not null,native_id uuid not null,operation text not null,reserved_cents integer not null check(reserved_cents>0),
 created_at timestamptz not null default clock_timestamp(),unique(native_kind,native_id,operation)
);
alter table public.community_package_budgets enable row level security;
alter table public.community_processing_reservations enable row level security;
revoke all on public.community_package_budgets,public.community_processing_reservations from public,anon,authenticated;
grant select on public.community_package_budgets,public.community_processing_reservations to service_role;
create function public.brain_reserve_package_processing(p_kind text,p_id uuid,p_operation text,p_cents integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid;pid uuid;oid uuid;k public.community_service_packages;bid uuid;b public.shared_execution_budgets;r public.community_processing_reservations;begin
 if p_kind='brand'then select deliverable_id,property_id into did,pid from public.community_brand_contexts where operation_id=p_id;
 else select deliverable_id,property_id,org_id into did,pid,oid from public.community_generation_bindings where(p_kind='site_package'and package_job_id=p_id)or(p_kind='social'and social_generation_id=p_id);end if;
 if pid is null then raise insufficient_privilege;end if;
 if did is null then return '{"state":"no_package"}';end if;
 select k1.*into k from public.community_service_packages k1 join public.community_generation_briefs d on d.package_id=k1.id where d.id=did and d.property_id=pid for update of k1;
 if not found or k.state<>'approved'or exists(select 1 from public.community_service_packages n where n.initiative_id=k.initiative_id and n.version>k.version)then raise exception 'Package approval changed';end if;
 select org_id into oid from public.properties where id=pid;
 if p_operation not in('initial','repair','visual_review')or p_cents is null or p_cents not between 1 and 10000000 then raise exception 'Configure a reviewed processing allowance before generation';end if;
 select *into r from public.community_processing_reservations where native_kind=p_kind and native_id=p_id and operation=p_operation;
 if found then if r.package_id<>k.id or r.reserved_cents<>p_cents then raise exception 'Processing reservation identity changed';end if;return jsonb_build_object('state','reserved','id',r.id,'cents',r.reserved_cents);end if;
 select budget_id into bid from public.community_package_budgets where package_id=k.id;
 if bid is null then
  insert into public.shared_execution_budgets(org_id,property_id,policy_version,max_cost_cents,max_model_attempts,max_provider_calls,metadata)
  values(oid,pid,'community-package-reservations-v1',floor(k.ai_budget_usd*100)::integer,1000,1000,jsonb_build_object('packageId',k.id,'mediaSpendAuthorized',false,'settlement','held_until_verified_provider_cost'))returning id into bid;
  insert into public.community_package_budgets values(k.id,bid);
 end if;
 select *into b from public.shared_execution_budgets where id=bid for update;
 if b.status<>'active'or b.reserved_cost_cents+b.used_cost_cents+p_cents>b.max_cost_cents or b.used_model_attempts>=b.max_model_attempts then raise exception 'The approved package processing allowance is exhausted';end if;
 update public.shared_execution_budgets set reserved_cost_cents=reserved_cost_cents+p_cents,used_model_attempts=used_model_attempts+1 where id=bid;
 insert into public.community_processing_reservations(package_id,native_kind,native_id,operation,reserved_cents)values(k.id,p_kind,p_id,p_operation,p_cents)returning *into r;
 return jsonb_build_object('state','reserved','id',r.id,'cents',r.reserved_cents);end$$;
revoke all on function public.brain_reserve_package_processing(text,uuid,text,integer)from public,anon,authenticated;
grant execute on function public.brain_reserve_package_processing(text,uuid,text,integer)to service_role;

-- Qualification is an operations-owned receipt, never a model's assertion or
-- a global switch. Existing native execution guards remain authoritative.
create table public.community_channel_qualifications(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),action text not null,
 adapter_version text not null,destination_hash text not null check(destination_hash~'^[a-f0-9]{64}$'),
 success_receipt jsonb not null,failure_receipt jsonb not null,recovery_receipt jsonb not null,
 qualified_by uuid not null references auth.users(id),qualified_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 revoked_at timestamptz,check(jsonb_typeof(success_receipt)='object'and success_receipt<>'{}'and jsonb_typeof(failure_receipt)='object'and failure_receipt<>'{}'and jsonb_typeof(recovery_receipt)='object'and recovery_receipt<>'{}'),
 check(expires_at>qualified_at)
);
alter table public.community_channel_qualifications enable row level security;
revoke all on public.community_channel_qualifications from public,anon,authenticated;
grant select on public.community_channel_qualifications to service_role;
create function public.brain_channel_readiness(p_scope_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.community_task_scopes;begin select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 return jsonb_build_object('propertyId',s.property_ids[1],'defaultMode','supervised','globalAutonomy',false,'qualifiedActions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'adapterVersion',adapter_version,'destinationHash',destination_hash,'expiresAt',expires_at)),'[]')from public.community_channel_qualifications where property_id=s.property_ids[1]and revoked_at is null and expires_at>statement_timestamp()));end$$;
revoke all on function public.brain_channel_readiness(uuid)from public,anon,authenticated;
grant execute on function public.brain_channel_readiness(uuid)to service_role;

-- Expired short-lived request data can be scrubbed independently of retained
-- approvals and source originals. Provider deletion keeps its own receipts.
create function public.brain_run_maintenance()returns jsonb language plpgsql security definer set search_path='' as $$
declare queries integer;messages integer;begin
 delete from public.community_query_embeddings where expires_at<clock_timestamp()-interval '2 days';get diagnostics queries=row_count;
 delete from public.community_portfolio_messages where session_id in(select id from public.community_portfolio_sessions where expires_at<clock_timestamp());get diagnostics messages=row_count;
 return jsonb_build_object('expiredQueriesRemoved',queries,'expiredPortfolioMessagesRemoved',messages,'originalsRemoved',0,'providerDeletionConfirmed',false);end$$;
revoke all on function public.brain_run_maintenance()from public,anon,authenticated;
grant execute on function public.brain_run_maintenance()to service_role;
commit;
