-- Coordinate every fact writer/reader before release. Old identities remain unknown.
alter table public.fact_marketing_performance
  add column id uuid not null default gen_random_uuid(),
  add column source_account_id text,
  add column currency_code text,
  alter column conversions type numeric using conversions::numeric;

alter table public.fact_marketing_performance
  drop constraint fact_marketing_performance_pkey,
  add constraint fact_marketing_performance_pkey primary key (id),
  add constraint fact_marketing_account_day_key unique nulls not distinct
    (date, property_id, channel_id, source_account_id, campaign_id);

-- NOT VALID preserves pre-migration rows without inventing account or currency.
-- PostgreSQL still enforces this constraint for every new or changed row.
alter table public.fact_marketing_performance
  add constraint fact_marketing_verified_identity check (
    source_account_id is not null and source_account_id ~ '^[0-9]+$'
    and channel_id is not null
    and channel_id in ('google_ads','meta_ads','ga4','tiktok_ads','linkedin_ads','bing_ads')
    and (channel_id <> 'google_ads' or length(source_account_id) = 10)
    and (currency_code is not distinct from 'USD' or (channel_id = 'ga4' and currency_code is null and spend = 0))
    and (currency_code is not null or channel_id = 'ga4')
    and campaign_id <> ''
    and impressions is not null and impressions >= 0
    and clicks is not null and clicks >= 0
    and spend is not null and spend >= 0 and spend < 100000000
    and conversions is not null and conversions >= 0 and conversions < 1000000000000000
  ) not valid;

-- Existing unowned rows must be deliberately reconciled before overlapping writes.
-- New writers cannot create more unowned rows, so this guard has no old/new insert race.
create function public.guard_marketing_legacy_overlap()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.fact_marketing_performance f
    where f.property_id = new.property_id and f.date = new.date
      and f.campaign_id = new.campaign_id and f.source_account_id is null
      and f.id <> new.id
      and (
        f.channel_id is null or lower(btrim(f.channel_id)) in ('', 'unknown')
        or case lower(btrim(f.channel_id))
          when 'google' then 'google_ads' when 'googleads' then 'google_ads'
          when 'meta' then 'meta_ads' when 'facebook_ads' then 'meta_ads'
          when 'instagram_ads' then 'meta_ads' when 'tiktok' then 'tiktok_ads'
          when 'linkedin' then 'linkedin_ads' when 'bing' then 'bing_ads'
          when 'microsoft_ads' then 'bing_ads' else lower(btrim(f.channel_id)) end = new.channel_id
      )
  ) then
    raise exception using errcode = '23514',
      message = 'Historical campaign rows need account reconciliation before importing these dates.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_marketing_legacy_overlap() from public, anon, authenticated;
create trigger marketing_legacy_overlap before insert or update
  on public.fact_marketing_performance for each row
  execute function public.guard_marketing_legacy_overlap();
create index fact_marketing_unowned_overlap
  on public.fact_marketing_performance(property_id,date,campaign_id)
  where source_account_id is null;
comment on column public.fact_marketing_performance.source_account_id is
  'Provider account ID, normalized without Google separators or Meta act_. NULL marks historical rows needing explicit reconciliation.';
comment on column public.fact_marketing_performance.currency_code is
  'Confirmed reporting currency. New ad rows require USD; GA4 zero-spend rows may leave it NULL. No automatic currency conversion.';
notify pgrst, 'reload schema';

create or replace function public.query_marketing_analytics(
  p_property_id uuid, p_start_date date, p_end_date date,
  p_group_by text default 'none', p_channel text default null, p_limit integer default 100
) returns jsonb language plpgsql stable security invoker
set search_path = '' set statement_timeout = '5s' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.properties pr join public.profiles pf on pf.org_id = pr.org_id
    where pr.id = p_property_id and pf.id = (select auth.uid())
  ) then
    raise exception 'Property access denied' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_end_date - p_start_date > 366 then
    raise exception 'Date range must be between 0 and 366 days' using errcode = '22023';
  end if;
  if p_group_by is null or p_group_by not in ('none', 'day', 'week', 'month', 'channel', 'campaign')
     or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid analytics grouping or limit' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(aggregated)), '[]'::jsonb) into result from (
    select
      case p_group_by
        when 'day' then f.date::text
        when 'week' then date_trunc('week', f.date::timestamp)::date::text
        when 'month' then date_trunc('month', f.date::timestamp)::date::text
        when 'channel' then f.channel_id
        when 'campaign' then jsonb_build_array(f.channel_id, f.source_account_id, f.campaign_id)::text
        else 'total'
      end as dimension,
      case when p_group_by = 'campaign' then max(f.campaign_name) end as campaign_name,
      sum(f.impressions) as impressions, sum(f.clicks) as clicks,
      sum(f.spend) as spend, sum(f.conversions) as conversions,
      round(100.0 * sum(f.clicks) / nullif(sum(f.impressions), 0), 2) as ctr,
      round(sum(f.spend) / nullif(sum(f.clicks), 0), 2) as cpc,
      round(sum(f.spend) / nullif(sum(f.conversions), 0), 2) as cpa,
      round(100.0 * sum(f.conversions) / nullif(sum(f.clicks), 0), 2) as conversion_rate
    from public.fact_marketing_performance f
    where f.property_id = p_property_id and f.date between p_start_date and p_end_date
      and (p_channel is null or f.channel_id = p_channel)
    group by 1 order by 1 nulls last limit p_limit
  ) aggregated;
  return result;
end;
$$;
revoke all on function public.query_marketing_analytics(uuid, date, date, text, text, integer) from public, anon;
grant execute on function public.query_marketing_analytics(uuid, date, date, text, text, integer) to authenticated;

