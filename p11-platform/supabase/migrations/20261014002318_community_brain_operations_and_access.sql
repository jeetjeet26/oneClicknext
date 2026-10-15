begin;
create function public.brain_read_access(p_actor_id uuid,p_property_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$declare oid uuid;begin
 select org_id into oid from public.properties where id=p_property_id;
 if oid is null or not public.team_admin_current(oid,p_actor_id)then raise insufficient_privilege;end if;
 return jsonb_build_object('propertyId',p_property_id,'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.full_name,u.email,'Team member'),'role',p.role,'capabilities',coalesce(g.capabilities,'{}'),'revoked',g.actor_id is null or g.revoked_at is not null or coalesce(g.expires_at<=statement_timestamp(),false))order by p.full_name,p.id),'[]')from public.profiles p join auth.users u on u.id=p.id left join public.community_access_grants g on g.actor_id=p.id and g.property_id=p_property_id where p.org_id=oid));end$$;
revoke all on function public.brain_read_access(uuid,uuid)from public,anon,authenticated;
grant execute on function public.brain_read_access(uuid,uuid)to service_role;

-- Install as the Supabase custom access-token hook only after reconciling any
-- existing hook. Trusted auth app_metadata and live worker grants are both required.
create function public.community_brain_access_token_hook(event jsonb)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare claims jsonb:=event->'claims';uid uuid:=(event->>'user_id')::uuid;begin
 if exists(select 1 from auth.users u where u.id=uid and u.raw_app_meta_data->>'community_worker'='true'and u.deleted_at is null and(u.banned_until is null or u.banned_until<statement_timestamp()))then
  if not exists(select 1 from public.community_worker_grants where principal_id=uid and revoked_at is null and expires_at>statement_timestamp())then raise insufficient_privilege using message='Worker assignments expired';end if;
  claims:=jsonb_set(claims,'{role}','"community_brain_worker"');
  claims:=jsonb_set(claims,'{exp}',to_jsonb(least((claims->>'exp')::bigint,extract(epoch from statement_timestamp()+interval '1 hour')::bigint)));
  return jsonb_set(event,'{claims}',claims);
 end if;
 return event;end$$;
revoke all on function public.community_brain_access_token_hook(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.community_brain_access_token_hook(jsonb)to supabase_auth_admin;

create table public.community_operation_receipts(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),
 operation text not null,request_id uuid,source_hash text,status text not null,
 duration_ms integer,counts jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
 check(duration_ms is null or duration_ms>=0),check(octet_length(counts::text)<=16000)
);
alter table public.community_operation_receipts enable row level security;
revoke all on public.community_operation_receipts from public,anon,authenticated,community_brain_worker;
grant select,insert on public.community_operation_receipts to service_role;
create index brain_operation_community_time on public.community_operation_receipts(property_id,created_at);
create function public.brain_record_operation(p_scope_id uuid,p_operation text,p_status text,p_duration_ms integer,p_counts jsonb)returns boolean language plpgsql security definer set search_path='' as $$declare s public.community_task_scopes;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 if p_operation not in('context','retrieval','download','source_sync')or p_status not in('ready','empty','incomplete','failed')or p_counts-array['evidence','assets','bytes','missing','latencyMs']<>'{}'then raise exception 'Use aggregate operation metrics only';end if;
 insert into public.community_operation_receipts(property_id,operation,status,duration_ms,counts)values(s.property_ids[1],p_operation,p_status,p_duration_ms,p_counts);return true;end$$;
revoke all on function public.brain_record_operation(uuid,text,text,integer,jsonb)from public,anon,authenticated;
grant execute on function public.brain_record_operation(uuid,text,text,integer,jsonb)to service_role;
alter table public.community_file_renditions drop constraint community_file_renditions_kind_check;
alter table public.community_file_renditions add constraint community_file_renditions_kind_check check(kind in('page','preview','poster','sanitized','embedded'));
commit;
