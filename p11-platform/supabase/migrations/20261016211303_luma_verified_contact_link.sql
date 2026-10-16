-- Operator actions still require a current community permission. A widget
-- source event has no human actor: authorize it from its exact retained
-- conversation instead of inventing an operator or granting browser access.
create or replace function public.record_lead_engagement(
 p_property_id uuid,p_lead_id uuid,p_event_type text,p_metadata jsonb,
 p_request_key text,p_origin text,p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_actor_id is null and p_origin='lumaleasing' and p_event_type='chat_started' then
  if not exists(
   select 1 from public.conversations c join public.leads l
    on l.id=c.lead_id and l.property_id=c.property_id
   where c.property_id=p_property_id and c.lead_id=p_lead_id and c.channel='widget'
    and p_metadata=jsonb_build_object('conversation_id',c.id,'source','lumaleasing_widget')
    and p_request_key='luma/chat-started/'||c.id||'/'||c.lead_id
  ) then return '{"state":"forbidden"}'::jsonb;end if;
 elsif not public.brain_can(p_actor_id,p_property_id,'manage') then
  return '{"state":"forbidden"}'::jsonb;
 end if;
 return public._brain_record_lead_engagement(p_property_id,p_lead_id,p_event_type,p_metadata,p_request_key,p_origin,p_actor_id);
end $$;

-- Preserve the existing service-only boundary and the private implementation.
revoke all on function public.record_lead_engagement(uuid,uuid,text,jsonb,text,text,uuid) from public,anon,authenticated,community_brain_worker;
grant execute on function public.record_lead_engagement(uuid,uuid,text,jsonb,text,text,uuid) to service_role;
