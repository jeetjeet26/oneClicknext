create function public.guard_meta_campaign_reporting_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_ids jsonb;
begin
  for campaign_ids in
    select connection.platform_metadata -> 'campaign_ids'
    from public.ad_account_connections connection
    where connection.platform = 'meta_ads'
      and connection.is_active
      and connection.property_id = new.property_id
      and connection.account_id in (new.source_account_id, 'act_' || new.source_account_id)
      and connection.platform_metadata ? 'campaign_ids'
    for share
  loop
    if jsonb_typeof(campaign_ids) is distinct from 'array'
       or not coalesce(campaign_ids ? new.campaign_id, false) then
      raise exception 'Meta Ads campaign is outside the property reporting scope'
        using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.guard_meta_campaign_reporting_scope() from public, anon, authenticated;

create trigger guard_meta_campaign_reporting_scope
before insert or update of property_id, channel_id, source_account_id, campaign_id
on public.fact_marketing_performance
for each row when (new.channel_id = 'meta_ads')
execute function public.guard_meta_campaign_reporting_scope();
