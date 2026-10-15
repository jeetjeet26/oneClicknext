begin;
alter table public.community_brain_settings add column private_delivery_enabled boolean not null default false,add column feedback_enabled boolean not null default false,
 add column consumers text[]not null default '{}'check(consumers<@array['site','chat','social','brand']);
create table public.community_rollout_events(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),actor_id uuid not null references auth.users(id),before_state jsonb,after_state jsonb not null,reason text not null,created_at timestamptz not null default clock_timestamp());
alter table public.community_rollout_events enable row level security;revoke all on public.community_rollout_events from public,anon,authenticated;grant select on public.community_rollout_events to service_role;
create function public.brain_default_settings()returns trigger language plpgsql security definer set search_path=''as $$begin insert into public.community_brain_settings(property_id)values(new.id)on conflict do nothing;return null;end$$;
create trigger brain_property_settings after insert on public.properties for each row execute function public.brain_default_settings();
create function public.brain_feature_enabled(p_property_id uuid,p_purpose text)returns boolean language sql stable security definer set search_path=''as $$
 select case when p_purpose in('manage','research')then true else coalesce((select case p_purpose when'portfolio'then portfolio_enabled when'ingestion'then ingestion_enabled when'download'then private_delivery_enabled when'feedback'then feedback_enabled else context_enabled and p_purpose=any(consumers)end from public.community_brain_settings where property_id=p_property_id),false)end
$$;
alter function public.brain_permission_hash(uuid,uuid[])rename to _brain_permission_hash_v1;
create function public.brain_permission_hash(p_actor_id uuid,p_properties uuid[])returns text language sql stable security definer set search_path=''as $$
 select public.knowledge_hash(jsonb_build_array(public._brain_permission_hash_v1(p_actor_id,p_properties),(select jsonb_agg(jsonb_build_array(property_id,policy_revision)order by property_id)from public.community_brain_settings where property_id=any(p_properties))))
$$;
alter function public.brain_resolve_scope(uuid,uuid[],text)rename to _brain_resolve_scope_v1;
create function public.brain_resolve_scope(p_actor_id uuid,p_property_ids uuid[],p_purpose text)returns jsonb language plpgsql security definer set search_path=''as $$begin
 if exists(select 1 from unnest(p_property_ids)p where not public.brain_feature_enabled(p,p_purpose))then raise insufficient_privilege using message='This community capability has not been activated';end if;
 return public._brain_resolve_scope_v1(p_actor_id,p_property_ids,p_purpose);
end$$;
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_scope_current(uuid,uuid,uuid)'::regprocedure)into definition;
 execute replace(definition,'where not public.brain_can(s.actor_id,id,public.brain_scope_capability(s.purpose))','where not public.brain_feature_enabled(id,s.purpose)or not public.brain_can(s.actor_id,id,public.brain_scope_capability(s.purpose))');
 select pg_get_functiondef('public.brain_public_context(uuid,uuid,text)'::regprocedure)into definition;
 execute replace(definition,'if pid is null then','if pid is null or not public.brain_feature_enabled(pid,''chat'')then');
 select pg_get_functiondef('public.brain_read_asset(uuid,uuid)'::regprocedure)into definition;
 execute replace(definition,'if not found or','if not found or not public.brain_feature_enabled(a.property_id,''download'')or');
 select pg_get_functiondef('public.brain_evidence_eligible(uuid,uuid,text,text)'::regprocedure)into definition;
 execute replace(definition,'where e.id=p_id and e.property_id=p_property_id','where e.id=p_id and e.property_id=p_property_id and((e.creative_id is null and e.origin<>''generated'')or public.brain_feature_enabled(e.property_id,''feedback''))');
end$$;
create function public.brain_rollout(p_actor_id uuid,p_property_id uuid,p_input jsonb default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r public.community_brain_settings;before_state jsonb;org uuid;admin boolean;begin
 select org_id into org from public.properties where id=p_property_id;
 admin:=public.team_admin_current(org,p_actor_id);
 if not public.brain_can(p_actor_id,p_property_id,'read')and not admin then raise insufficient_privilege;end if;
 insert into public.community_brain_settings(property_id)values(p_property_id)on conflict do nothing;
 select *into r from public.community_brain_settings where property_id=p_property_id for update;before_state:=to_jsonb(r);
 if p_input is not null then
  if not admin then raise insufficient_privilege;end if;
  if length(coalesce(p_input->>'reason',''))not between 3 and 2000 or (p_input->>'revision')::integer is distinct from r.policy_revision
   or p_input-array['revision','context','ingestion','portfolio','privateDelivery','feedback','consumers','reason']<>'{}'
   or exists(select 1 from unnest(array['context','ingestion','portfolio','privateDelivery','feedback'])k where jsonb_typeof(p_input->k)is distinct from'boolean')then raise exception 'Reload and explicitly review each rollout capability';end if;
  update public.community_brain_settings set context_enabled=(p_input->>'context')::boolean,ingestion_enabled=(p_input->>'ingestion')::boolean,portfolio_enabled=(p_input->>'portfolio')::boolean,
   private_delivery_enabled=(p_input->>'privateDelivery')::boolean,feedback_enabled=(p_input->>'feedback')::boolean,consumers=array(select jsonb_array_elements_text(p_input->'consumers')),
   policy_revision=policy_revision+1,updated_at=clock_timestamp()where property_id=p_property_id returning *into r;
  insert into public.community_rollout_events(property_id,actor_id,before_state,after_state,reason)values(p_property_id,p_actor_id,before_state,to_jsonb(r),p_input->>'reason');
 end if;
 return jsonb_build_object('settings',to_jsonb(r),'canManage',admin,'externalActionAuthority',false);
end$$;
create trigger brain_rollout_invalidation after update on public.community_brain_settings for each row execute function public.brain_invalidate_canonical();
revoke all on function public.brain_default_settings(),public.brain_feature_enabled(uuid,text),public._brain_permission_hash_v1(uuid,uuid[]),public._brain_resolve_scope_v1(uuid,uuid[],text),public.brain_permission_hash(uuid,uuid[]),public.brain_resolve_scope(uuid,uuid[],text),public.brain_rollout(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.brain_resolve_scope(uuid,uuid[],text),public.brain_rollout(uuid,uuid,jsonb)to service_role;
commit;
