-- SiteForge is a standard property capability, not a per-community rollout.
-- Scope resolution still enforces brain_can and organization/actor ownership.
-- Keeping this rule independent of settings covers future properties as well.
create or replace function public.brain_feature_enabled(p_property_id uuid,p_purpose text)
returns boolean language sql stable security definer set search_path='' as $$
 select case
  when p_purpose='site' then exists(select 1 from public.properties where id=p_property_id)
  when p_purpose in('manage','research') then true
  else coalesce((select case p_purpose
   when 'portfolio' then portfolio_enabled
   when 'ingestion' then ingestion_enabled
   when 'download' then private_delivery_enabled
   when 'feedback' then feedback_enabled
   else context_enabled and p_purpose=any(consumers)
  end from public.community_brain_settings where property_id=p_property_id),false)
 end
$$;
