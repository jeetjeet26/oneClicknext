-- Products are available by default; authorization remains in brain_can and scope checks.
begin;
create or replace function public.brain_feature_enabled(p_property_id uuid,p_purpose text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_purpose=any(array['manage','research','portfolio','ingestion','download','feedback','site','chat','social','brand'])
 and exists(select 1 from public.properties where id=p_property_id)
$$;
-- Keep compatibility columns for older clients, but they can no longer disable products.
create or replace function public.brain_remember_chat_adoption() returns trigger
language plpgsql set search_path='' as $$
begin
 new.context_enabled:=true;
 new.ingestion_enabled:=true;
 new.portfolio_enabled:=true;
 new.private_delivery_enabled:=true;
 new.feedback_enabled:=true;
 new.consumers:=array['site','chat','social','brand'];
 if tg_op='UPDATE' then new.chat_activated_at:=coalesce(old.chat_activated_at,clock_timestamp());
 else new.chat_activated_at:=clock_timestamp();end if;
 return new;
end$$;
alter table public.community_brain_settings
 alter column context_enabled set default true,
 alter column ingestion_enabled set default true,
 alter column portfolio_enabled set default true,
 alter column private_delivery_enabled set default true,
 alter column feedback_enabled set default true,
 alter column consumers set default array['site','chat','social','brand'];
insert into public.community_brain_settings(property_id)
select id from public.properties on conflict do nothing;
update public.community_brain_settings set policy_revision=policy_revision+1,updated_at=clock_timestamp();
-- The compatibility endpoint remains authorized and read-only.
create or replace function public.brain_rollout(p_actor_id uuid,p_property_id uuid,p_input jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.community_brain_settings;org uuid;admin boolean;begin
 select org_id into org from public.properties where id=p_property_id;
 admin:=public.team_admin_current(org,p_actor_id);
 if not public.brain_can(p_actor_id,p_property_id,'read') and not coalesce(admin,false) then raise insufficient_privilege;end if;
 select *into r from public.community_brain_settings where property_id=p_property_id;
 if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('settings',to_jsonb(r),'canManage',false,'externalActionAuthority',false);
end$$;
commit;
