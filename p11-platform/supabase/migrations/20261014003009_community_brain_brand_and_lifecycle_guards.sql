begin;
create table public.community_brand_contexts(
 operation_id uuid primary key references public.brand_operations(id),
 context_id uuid not null references public.shared_context_snapshots(id),
 property_id uuid not null references public.properties(id),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.community_brand_contexts enable row level security;
revoke all on public.community_brand_contexts from public,anon,authenticated;
grant select on public.community_brand_contexts to service_role;
create function public.brain_brand_context(p_scope_id uuid,p_operation_id uuid,p_prepare boolean default false)returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;o public.brand_operations;b public.community_brand_contexts;c jsonb;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 select *into o from public.brand_operations where id=p_operation_id;
 if s.kind is distinct from'community'or s.purpose is distinct from'brand'or o.property_id is distinct from s.property_ids[1]or o.actor_id is distinct from s.actor_id
 or o.state is distinct from'running'or not public.brain_scope_current(s.id,o.property_id)then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,91));
 select *into b from public.community_brand_contexts where operation_id=o.id;
 if not found and p_prepare then
  c:=public.brain_save_context(s.id,o.property_id,'Current approved community facts and brand direction','{}');
  insert into public.community_brand_contexts(operation_id,context_id,property_id,actor_id)values(o.id,(c->>'snapshotId')::uuid,o.property_id,s.actor_id)returning *into b;
 end if;
 if b.context_id is null or not public.brain_context_current(b.context_id,s.actor_id)then raise exception 'Brand sources changed; prepare a new reviewed request';end if;
 select context_payload||jsonb_build_object('snapshotId',id)into c from public.shared_context_snapshots where id=b.context_id;
 return c;end$$;
revoke all on function public.brain_brand_context(uuid,uuid,boolean)from public,anon,authenticated;
grant execute on function public.brain_brand_context(uuid,uuid,boolean)to service_role;

-- Check before the native atomic write: saving a new brand version may itself
-- invalidate the prior context, but cannot validate a stale input retroactively.
alter function public.finish_brand_operation(uuid,uuid,jsonb,jsonb,text)rename to _brain_finish_brand_operation_v1;
revoke all on function public._brain_finish_brand_operation_v1(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated,service_role;
create function public.finish_brand_operation(p_request_id uuid,p_claim_token uuid,p_updates jsonb,p_result jsonb,p_error text default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.brand_operations;b public.community_brand_contexts;begin
 select *into o from public.brand_operations where id=p_request_id;
 if o.claim_token is distinct from p_claim_token then return '{"state":"claim_conflict"}';end if;
 if o.state='running'and p_error is null and o.kind in('generate','regenerate','visuals','contract')then
  select *into b from public.community_brand_contexts where operation_id=o.id;
  if b.context_id is null or not public.brain_context_current(b.context_id,o.actor_id)then raise exception 'Current approved community context is required';end if;
 end if;
 if o.state='running'and p_error is null and not public.brain_can(o.actor_id,o.property_id,'manage')then raise insufficient_privilege;end if;
 return public._brain_finish_brand_operation_v1(p_request_id,p_claim_token,p_updates,p_result,p_error);end$$;
revoke all on function public.finish_brand_operation(uuid,uuid,jsonb,jsonb,text)from public,anon,authenticated;
grant execute on function public.finish_brand_operation(uuid,uuid,jsonb,jsonb,text)to service_role;

-- Identity fields are maintained through native community setup. Amenities,
-- commercial terms and policies must come from current approved fact records.
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_canonical_context(uuid,text,uuid[])'::regprocedure)into definition;
 definition:=replace(definition,'property_type,unit_count,amenities,pet_policy,parking_info,office_hours,updated_at','property_type,updated_at');
 execute definition;
end$$;

-- Indexing and draft edits should not cancel unrelated work. Re-evaluate the
-- exact saved read set after writes; real withdrawals remain immediate.
create or replace function public.brain_invalidate_canonical()returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;begin
 pid:=case when tg_table_name='properties'then(coalesce(to_jsonb(new),to_jsonb(old))->>'id')::uuid else(coalesce(to_jsonb(new),to_jsonb(old))->>'property_id')::uuid end;
 update public.shared_context_snapshots s set invalidated_at=clock_timestamp()
 where s.property_id=pid and s.source_domain='community_brain'and s.invalidated_at is null
 and not public.brain_context_current(s.id,s.captured_by::uuid);
 update public.shared_jobs j set cancel_requested=true,status_reason='Community source changed; refresh and review'
 where j.property_id=pid and j.lifecycle_status in('queued','running','retrying')and exists(select 1 from public.shared_context_snapshots c where c.id=j.context_snapshot_id and c.invalidated_at is not null);
 return null;end$$;

create function public.brain_provider_parent_deleted(p_id uuid)returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(bool_and(p.state='deleted'),false)from public.community_provider_objects f cross join lateral unnest(f.parents)x join public.community_provider_objects p on p.id=x where f.id=p_id and f.object_kind='output_file'and p.object_kind='container'
$$;
revoke all on function public.brain_provider_parent_deleted(uuid)from public,anon,authenticated;
grant execute on function public.brain_provider_parent_deleted(uuid)to service_role;
commit;
