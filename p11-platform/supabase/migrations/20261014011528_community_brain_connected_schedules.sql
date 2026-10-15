begin;
create table public.community_source_schedules(
 source_id uuid primary key references public.siteforge_asset_sources(id),
 property_id uuid not null references public.properties(id),actor_id uuid not null references auth.users(id),
 enabled boolean not null default false,interval_hours integer not null check(interval_hours between 1 and 168),
 config_hash text not null,revision bigint not null default 1,next_due_at timestamptz not null default clock_timestamp(),
 lease_token uuid,lease_until timestamptz,last_completed_at timestamptz,last_state text,
 failures integer not null default 0 check(failures>=0),updated_at timestamptz not null default clock_timestamp()
);
alter table public.community_source_schedules enable row level security;
revoke all on public.community_source_schedules from public,anon,authenticated;
grant select on public.community_source_schedules to service_role;
create index community_source_schedules_due on public.community_source_schedules(next_due_at,source_id)where enabled;
create function public.brain_source_schedule(p_scope_id uuid,p_source_id uuid,p_enabled boolean,p_hours integer,p_revision bigint)returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;c public.siteforge_asset_sources;r public.community_source_schedules;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 select *into c from public.siteforge_asset_sources where id=p_source_id for update;
 if s.kind is distinct from'community'or c.property_id is distinct from s.property_ids[1]or not public.brain_scope_current(s.id,c.property_id)or not public.brain_can(s.actor_id,c.property_id,'manage')then raise insufficient_privilege;end if;
 if c.provider not in('google_drive','dropbox')or(p_enabled and c.status in('revoked','paused'))then raise exception 'Reconnect this supported source before scheduling';end if;
 select *into r from public.community_source_schedules where source_id=c.id for update;
 if coalesce(r.revision,0)<>p_revision then raise exception 'Reload the changed source schedule';end if;
 insert into public.community_source_schedules(source_id,property_id,actor_id,enabled,interval_hours,config_hash)
 values(c.id,c.property_id,s.actor_id,p_enabled,p_hours,public.brain_source_config(c.id))
 on conflict(source_id)do update set actor_id=excluded.actor_id,enabled=excluded.enabled,interval_hours=excluded.interval_hours,
 config_hash=excluded.config_hash,revision=community_source_schedules.revision+1,next_due_at=clock_timestamp(),updated_at=clock_timestamp(),last_state='configured';
 return(select to_jsonb(x)-'config_hash'-'lease_token'from public.community_source_schedules x where source_id=c.id);
end$$;
create function public.brain_due_connected_sources(p_limit integer default 2)returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.community_source_schedules;items jsonb:='[]';begin
 for r in select q.*from public.community_source_schedules q
 where q.enabled and q.next_due_at<=clock_timestamp()and(q.lease_until is null or q.lease_until<=clock_timestamp())
 order by q.next_due_at,q.source_id for update skip locked limit greatest(1,least(p_limit,2))loop
  if not public.brain_can(r.actor_id,r.property_id,'manage')or r.config_hash is distinct from public.brain_source_config(r.source_id)
   or not exists(select 1 from public.siteforge_asset_sources c where c.id=r.source_id and c.property_id=r.property_id and c.status in('active','error'))then
   update public.community_source_schedules set enabled=false,revision=revision+1,last_state='authorization_or_source_changed',updated_at=clock_timestamp()where source_id=r.source_id;
   continue;
  end if;
  update public.community_source_schedules set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '8 minutes',next_due_at=clock_timestamp()+interval '8 minutes',last_state='running'
   where source_id=r.source_id returning *into r;
  items:=items||jsonb_build_array(jsonb_build_object('sourceId',r.source_id,'propertyId',r.property_id,'actorId',r.actor_id,'leaseToken',r.lease_token));
 end loop;return items;
end$$;
create function public.brain_finish_source_schedule(p_source_id uuid,p_lease_token uuid,p_state text)returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_state not in('succeeded','partial','failed')then raise exception 'Invalid schedule receipt';end if;
 update public.community_source_schedules set lease_until=clock_timestamp(),last_completed_at=clock_timestamp(),last_state=p_state,
 failures=case when p_state='succeeded'then 0 else failures+1 end,
 next_due_at=clock_timestamp()+case when p_state='succeeded'then make_interval(hours=>interval_hours)when p_state='partial'then interval '15 minutes'else interval '30 minutes'end,
 updated_at=clock_timestamp()where source_id=p_source_id and lease_token=p_lease_token and lease_until>clock_timestamp();
 if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('state','saved');
end$$;
revoke all on function public.brain_source_schedule(uuid,uuid,boolean,integer,bigint),public.brain_due_connected_sources(integer),public.brain_finish_source_schedule(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.brain_source_schedule(uuid,uuid,boolean,integer,bigint),public.brain_due_connected_sources(integer),public.brain_finish_source_schedule(uuid,uuid,text)to service_role;
commit;
