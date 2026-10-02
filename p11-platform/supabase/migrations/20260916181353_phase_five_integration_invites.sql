create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','calendar.disconnected','integration.authorization.completed','email.disconnected','integration.invite.created','integration.invite.revoked','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','email.disconnected','integration.invite.created','integration.invite.revoked') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action in ('luma.configuration.created','luma.configuration.saved') then
  if p_product<>'lumaleasing' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid configuration evidence';end if;
 else
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid workflow evidence';end if;
 end if;
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id;
 if organization is null then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 job:=nullif(p_links->>'jobId','')::uuid;attempt:=nullif(p_links->>'attemptId','')::uuid;context_id:=nullif(p_links->>'contextId','')::uuid;
 select * into e from public.shared_action_events where id=p_id;
 if found then
  if (e.episode_id,e.property_id,e.actor_id,e.product,e.action,e.evidence,e.phase,e.request,e.before_state,e.after_state,e.result,e.shared_job_ref,e.shared_attempt_ref,e.context_snapshot_ref)
   is distinct from (p_episode_id,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','eventId',e.id);
 end if;
 if job is not null and not exists(select 1 from public.shared_jobs where id=job and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 if attempt is not null and not exists(select 1 from public.shared_action_attempts where id=attempt and org_id=organization and property_id=p_property_id and (job is null or job_id=job)) then return '{"state":"link_conflict"}';end if;
 if context_id is not null and not exists(select 1 from public.shared_context_snapshots where id=context_id and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 origin:=case when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;




create function public.integration_invite_summary(i public.integration_auth_invites) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',i.id,'property_id',i.property_id,'provider',i.provider,'requested_capabilities',i.requested_capabilities,'expires_at',i.expires_at,'created_at',i.created_at,'consumed_at',i.consumed_at,'revoked_at',i.revoked_at,
 'state',case when i.consumed_at is not null then 'used' when i.revoked_at is not null then 'revoked' when i.expires_at<=clock_timestamp() then 'expired' else 'pending' end);
$$;
create function public.create_recorded_integration_invite(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_provider text,p_capabilities text[],p_token_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i public.integration_auth_invites;e public.shared_action_events;input jsonb;r jsonb;recorded jsonb;caps text[];
begin
 if p_request_id is null or p_actor_id is null or p_property_id is null or p_provider is null or p_provider not in ('google','microsoft') or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
  or cardinality(p_capabilities) is null or cardinality(p_capabilities) not between 1 and 2 or not p_capabilities<@array['calendar','email'] or array_position(p_capabilities,null) is not null then raise exception 'Invalid integration invitation';end if;
 select array_agg(distinct cap order by cap) into caps from unnest(p_capabilities) cap;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('requestId',p_request_id,'provider',p_provider,'capabilities',caps);
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'integration.invite.created',input) then return '{"state":"request_conflict"}';end if;
  select * into i from public.integration_auth_invites where id=p_request_id and property_id=p_property_id for update;
  if not found or i.token_hash<>p_token_hash or i.expires_at<=clock_timestamp() or i.consumed_at is not null or i.revoked_at is not null then return '{"state":"link_unavailable"}';end if;
  return jsonb_build_object('state','replayed','invite',public.integration_invite_summary(i),'actionEventId',p_request_id);
 end if;
 if exists(select 1 from public.integration_auth_invites where id=p_request_id) then return '{"state":"request_conflict"}';end if;
 insert into public.integration_auth_invites(id,property_id,provider,requested_capabilities,token_hash,expires_at,created_by_profile_id,metadata)
 values(p_request_id,p_property_id,p_provider,caps,p_token_hash,clock_timestamp()+interval '7 days',p_actor_id,'{"issuedVia":"recorded_v1"}') returning * into i;
 r:=jsonb_build_object('state','created','inviteId',i.id);
 recorded:=public.append_shared_action_event(p_request_id,md5('integration-invite/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'integrations','integration.invite.created','server_confirmed','succeeded',input,null,public.integration_invite_summary(i),r);
 if recorded->>'state' not in ('recorded','replayed') then raise exception 'Invitation could not be recorded';end if;
 return jsonb_build_object('state','created','invite',public.integration_invite_summary(i),'actionEventId',p_request_id);
end; $$;
create function public.revoke_recorded_integration_invite(p_property_id uuid,p_actor_id uuid,p_invite_id uuid,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i public.integration_auth_invites;e public.shared_action_events;input jsonb;r jsonb;recorded jsonb;before_state jsonb;
begin
 if p_request_id is null or p_actor_id is null or p_invite_id is null or p_property_id is null then raise exception 'Invalid invitation revocation';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('requestId',p_request_id,'inviteId',p_invite_id);
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'integration.invite.revoked',input) then return '{"state":"request_conflict"}';end if;
  return e.result||jsonb_build_object('replayed',true,'actionEventId',p_request_id);
 end if;
 select * into i from public.integration_auth_invites where id=p_invite_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 before_state:=public.integration_invite_summary(i);
 if i.consumed_at is not null then r:='{"state":"already_used"}';
 else
  update public.integration_auth_invites set revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp() where id=i.id returning * into i;
  update public.integration_authorizations set status='blocked',result='{"state":"invite_unavailable"}' where property_id=p_property_id and context->>'inviteId'=p_invite_id::text and status in ('pending','exchanging');
  r:='{"state":"revoked"}';
 end if;
 recorded:=public.append_shared_action_event(p_request_id,md5('integration-invite/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'integrations','integration.invite.revoked','server_confirmed',case when i.consumed_at is null then 'succeeded' else 'failed' end,input,before_state,public.integration_invite_summary(i),r);
 if recorded->>'state' not in ('recorded','replayed') then raise exception 'Invitation revocation could not be recorded';end if;
 return r||jsonb_build_object('actionEventId',p_request_id);
end; $$;
revoke all on function public.integration_invite_summary(public.integration_auth_invites),public.create_recorded_integration_invite(uuid,uuid,uuid,text,text[],text),public.revoke_recorded_integration_invite(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.integration_invite_summary(public.integration_auth_invites),public.create_recorded_integration_invite(uuid,uuid,uuid,text,text[],text),public.revoke_recorded_integration_invite(uuid,uuid,uuid,uuid) to service_role;
create index integration_invites_page_idx on public.integration_auth_invites(property_id,created_at desc,id desc);
notify pgrst,'reload schema';
