-- Product changes update the existing invitation; the shared link is unchanged.
alter table public.client_portal_invitations add column revision integer not null default 1 check (revision>0);
create or replace function public.read_client_access(p_actor_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor public.profiles;begin
 select *into actor from public.profiles where id=p_actor_id;
 if actor.org_id is null or coalesce((public.team_member_view(p_actor_id)->>'accessBlocked')::boolean,true) then return '{"state":"forbidden"}';end if;
 return jsonb_build_object('state','ready','orgId',actor.org_id,'canManage',public.team_admin_current(actor.org_id,p_actor_id),
 'properties',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)order by name,id),'[]')from public.properties where org_id=actor.org_id),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.user_id,'name',a.display_name,'email',a.email,'status',a.status,'revision',a.revision,'products',a.portal_products,'properties',(select coalesce(jsonb_agg(g.property_id order by g.property_id),'[]')from public.client_portal_property_access g where g.user_id=a.user_id))order by a.created_at desc),'[]')from public.client_portal_accounts a where org_id=actor.org_id),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.display_name,'email',i.email,'revision',i.revision,'products',i.portal_products,'status',case when i.status='pending'and i.expires_at<=now()then'expired'else i.status end,'properties',i.property_ids,'expiresAt',i.expires_at)order by i.created_at desc),'[]')from public.client_portal_invitations i where org_id=actor.org_id));
end $$;

create or replace function public.decide_client_access(p_id uuid,p_actor_id uuid,p_input jsonb,p_token_hash text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor public.profiles; saved public.client_portal_access_events; a public.client_portal_accounts; inv public.client_portal_invitations; ids uuid[];op text:=p_input->>'operation';result jsonb;begin
 select *into actor from public.profiles where id=p_actor_id for share;
 if actor.org_id is null or not public.team_admin_current(actor.org_id,p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor.org_id::text,63));
 select *into saved from public.client_portal_access_events where id=p_id;
 if found then
  if saved.actor_id<>p_actor_id or saved.org_id<>actor.org_id or saved.request<>p_input then return '{"state":"request_conflict"}';end if;
  return saved.result||'{"state":"replayed"}'::jsonb;
 end if;
 if op in('invite','update','update_invitation_products')then
  if not (p_input ? 'products') or jsonb_typeof(p_input->'products') <> 'array' then return '{"state":"invalid_input"}'; end if;
  if exists(select 1 from jsonb_array_elements(p_input->'products') x where jsonb_typeof(x)<>'string' or x #>> '{}' not in ('reporting','lumaleasing','marketvision','reviewflow')) or (select count(*)<>count(distinct x) from jsonb_array_elements(p_input->'products') x) then return '{"state":"invalid_input"}';end if;
 end if;
 if op in('invite','update')then
  if jsonb_typeof(p_input->'propertyIds')<>'array' then return '{"state":"invalid_input"}';end if;
  select array_agg(value::uuid order by value::uuid)into ids from jsonb_array_elements_text(p_input->'propertyIds');
  if coalesce(cardinality(ids),0)not between 1 and 100 or cardinality(ids)<>(select count(distinct x)from unnest(ids)x) or exists(select 1 from unnest(ids)x where not exists(select 1 from public.properties where id=x and org_id=actor.org_id))then return '{"state":"invalid_properties"}';end if;
  perform id from public.properties where id=any(ids)and org_id=actor.org_id for share;
 end if;
 if op='invite'then
  if length(trim(p_input->>'name'))not between 1 and 120 or (p_input->>'email')!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_input->>'email')>254 or p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$'then return '{"state":"invalid_input"}';end if;
  if exists(select 1 from public.client_portal_invitations where org_id=actor.org_id and email=lower(trim(p_input->>'email'))and status='pending'and expires_at>now())or exists(select 1 from public.client_portal_accounts where org_id=actor.org_id and email=lower(trim(p_input->>'email')))then return '{"state":"already_exists"}';end if;
  insert into public.client_portal_invitations(id,org_id,email,display_name,property_ids,token_hash,created_by,expires_at,portal_products)values(p_id,actor.org_id,lower(trim(p_input->>'email')),trim(p_input->>'name'),ids,p_token_hash,p_actor_id,now()+interval'7 days',array(select jsonb_array_elements_text(p_input->'products')));
  result:=jsonb_build_object('state','saved','id',p_id,'expiresAt',now()+interval'7 days');
 elsif op='update_invitation_products'then
  select *into inv from public.client_portal_invitations where id=(p_input->>'targetId')::uuid and org_id=actor.org_id for update;
  if not found or inv.status<>'pending' or inv.expires_at<=now() or inv.revision is distinct from (p_input->>'revision')::integer then return '{"state":"changed"}';end if;
  -- Keep the exact invitation token, recipient, property scope and expiry.
  update public.client_portal_invitations set portal_products=array(select jsonb_array_elements_text(p_input->'products')),revision=revision+1 where id=inv.id;
  result:=jsonb_build_object('state','saved','id',inv.id);
 elsif op='revoke_invitation'then
  select *into inv from public.client_portal_invitations where id=(p_input->>'targetId')::uuid and org_id=actor.org_id for update;
  if not found or inv.status<>'pending'then return '{"state":"changed"}';end if;
  update public.client_portal_invitations set status='revoked'where id=inv.id;
  result:=jsonb_build_object('state','saved','id',inv.id);
 elsif op in('update','revoke')then
  select *into a from public.client_portal_accounts where user_id=(p_input->>'targetId')::uuid and org_id=actor.org_id for update;
  if not found or a.revision is distinct from(p_input->>'revision')::integer then return '{"state":"changed"}';end if;
  if op='update'then
   delete from public.client_portal_property_access where user_id=a.user_id;
   insert into public.client_portal_property_access(user_id,property_id)select a.user_id,x from unnest(ids)x;
  end if;
  update public.client_portal_accounts set portal_products=case when op='update' then array(select jsonb_array_elements_text(p_input->'products')) else portal_products end,status=case when op='revoke'then'revoked'else'active'end,revision=revision+1,updated_at=clock_timestamp()where user_id=a.user_id;
  result:=jsonb_build_object('state','saved','id',a.user_id);
 else return '{"state":"invalid_input"}';end if;
 insert into public.client_portal_access_events(id,org_id,actor_id,operation,request,result)values(p_id,actor.org_id,p_actor_id,op,p_input,result);
 return result;
end $$;

