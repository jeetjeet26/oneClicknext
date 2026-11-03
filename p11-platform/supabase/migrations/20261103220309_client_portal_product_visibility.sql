-- Visibility is independent of operational activation. Preserve existing portal access.
alter table public.client_portal_accounts add column portal_products text[] not null default array['reporting','lumaleasing']::text[] check (portal_products <@ array['reporting','lumaleasing','marketvision','reviewflow']::text[]);
alter table public.client_portal_invitations add column portal_products text[] not null default array['reporting','lumaleasing']::text[] check (portal_products <@ array['reporting','lumaleasing','marketvision','reviewflow']::text[]);
create or replace function public.read_client_access(p_actor_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor public.profiles;begin
 select *into actor from public.profiles where id=p_actor_id;
 if actor.org_id is null or coalesce((public.team_member_view(p_actor_id)->>'accessBlocked')::boolean,true) then return '{"state":"forbidden"}';end if;
 return jsonb_build_object('state','ready','orgId',actor.org_id,'canManage',public.team_admin_current(actor.org_id,p_actor_id),
 'properties',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)order by name,id),'[]')from public.properties where org_id=actor.org_id),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.user_id,'name',a.display_name,'email',a.email,'status',a.status,'revision',a.revision,'products',a.portal_products,'properties',(select coalesce(jsonb_agg(g.property_id order by g.property_id),'[]')from public.client_portal_property_access g where g.user_id=a.user_id))order by a.created_at desc),'[]')from public.client_portal_accounts a where org_id=actor.org_id),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.display_name,'email',i.email,'products',i.portal_products,'status',case when i.status='pending'and i.expires_at<=now()then'expired'else i.status end,'properties',i.property_ids,'expiresAt',i.expires_at)order by i.created_at desc),'[]')from public.client_portal_invitations i where org_id=actor.org_id));
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
 if op in('invite','update')then
  if not (p_input ? 'products') or jsonb_typeof(p_input->'products') <> 'array' then return '{"state":"invalid_input"}'; end if;
  if exists(select 1 from jsonb_array_elements(p_input->'products') x where jsonb_typeof(x)<>'string' or x #>> '{}' not in ('reporting','lumaleasing','marketvision','reviewflow')) or (select count(*)<>count(distinct x) from jsonb_array_elements(p_input->'products') x) then return '{"state":"invalid_input"}';end if;
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

create or replace function public.join_client_portal(p_id uuid,p_actor_id uuid,p_token_hash text,p_accept boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.client_portal_invitations;actor public.profiles;u jsonb;saved public.client_portal_access_events;result jsonb;begin
 select *into inv from public.client_portal_invitations where token_hash=p_token_hash for update;
 if not found then return '{"state":"unavailable"}';end if;
 u:=public.team_member_view(p_actor_id);
 if u is null or coalesce((u->>'emailConfirmed')::boolean,false)=false or lower(u->>'email')<>inv.email or coalesce((u->>'accessBlocked')::boolean,true)then return '{"state":"recipient_required"}';end if;
 if inv.status='accepted'and inv.accepted_by=p_actor_id then return '{"state":"joined"}';end if;
 if inv.status<>'pending'or inv.expires_at<=now()or not public.team_admin_current(inv.org_id,inv.created_by)then return '{"state":"unavailable"}';end if;
 select *into actor from public.profiles where id=p_actor_id for update;
 if not found or actor.org_id is not null or exists(select 1 from public.client_portal_accounts where user_id=p_actor_id)then return '{"state":"account_conflict"}';end if;
 if exists(select 1 from unnest(inv.property_ids)x where not exists(select 1 from public.properties where id=x and org_id=inv.org_id))then return '{"state":"unavailable"}';end if;
 perform id from public.properties where id=any(inv.property_ids)and org_id=inv.org_id for share;
 if not p_accept then return jsonb_build_object('state','ready','name',inv.display_name,'organization',(select name from public.organizations where id=inv.org_id),'properties',(select jsonb_agg(name order by name)from public.properties where id=any(inv.property_ids)),'expiresAt',inv.expires_at);end if;
 update public.profiles set role='viewer'where id=p_actor_id;
 insert into public.client_portal_accounts(user_id,org_id,display_name,email,portal_products)values(p_actor_id,inv.org_id,inv.display_name,inv.email,inv.portal_products);
 insert into public.client_portal_property_access(user_id,property_id)select p_actor_id,x from unnest(inv.property_ids)x;
 update public.client_portal_invitations set status='accepted',accepted_by=p_actor_id where id=inv.id;
 result:=jsonb_build_object('state','joined','id',p_actor_id);
 insert into public.client_portal_access_events(id,org_id,actor_id,operation,request,result)values(p_id,inv.org_id,p_actor_id,'joined',jsonb_build_object('invitationId',inv.id),result);
 return result;
end $$;

create or replace function public.read_client_portal_scope(p_actor_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.client_portal_accounts;begin
 select c.*into a from public.client_portal_accounts c join public.profiles p on p.id=c.user_id where c.user_id=p_actor_id and p.org_id is null and p.role='viewer'and coalesce((public.team_member_view(p_actor_id)->>'accessBlocked')::boolean,true)=false and coalesce((public.team_member_view(p_actor_id)->>'emailConfirmed')::boolean,false);
 if not found or a.status<>'active'then return '{"state":"forbidden"}';end if;
 return jsonb_build_object('state','ready','name',a.display_name,'orgId',a.org_id,'revision',a.revision,'products',a.portal_products,'properties',(
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'address',jsonb_build_object('street',p.address->>'street','city',p.address->>'city','state',p.address->>'state','zip',p.address->>'zip'))order by p.name,p.id),'[]')
  from public.client_portal_property_access g join public.properties p on p.id=g.property_id where g.user_id=p_actor_id and p.org_id=a.org_id));
end $$;
revoke all on function public.read_client_access(uuid),public.decide_client_access(uuid,uuid,jsonb,text),public.join_client_portal(uuid,uuid,text,boolean),public.read_client_portal_scope(uuid)from public,anon,authenticated;
grant execute on function public.read_client_access(uuid),public.decide_client_access(uuid,uuid,jsonb,text),public.join_client_portal(uuid,uuid,text,boolean),public.read_client_portal_scope(uuid)to service_role;
