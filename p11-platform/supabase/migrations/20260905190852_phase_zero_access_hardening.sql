-- Phase 0: close the audited public access paths. Apply only with deployment approval.
-- Keep the old signature as a disabled compatibility stub: no role can use it to run SQL.
create or replace function public.execute_readonly_query(query_text text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Arbitrary SQL queries are disabled. Use query_marketing_analytics.'
    using errcode = '0A000';
end;
$$;
revoke all on function public.execute_readonly_query(text) from public, anon, authenticated, service_role;

revoke create on schema public from public, anon, authenticated;

-- Privileged helpers are backend-only. The organization lookup is used by RLS below.
do $$
declare helper record;
begin
  for helper in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname <> 'get_user_org_id'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', helper.signature);
    execute format('grant execute on function %s to service_role', helper.signature);
  end loop;
end;
$$;

create or replace function public.get_user_org_id(user_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.org_id from public.profiles p
  where p.id = user_id
    and (user_id = (select auth.uid()) or (select auth.role()) = 'service_role')
  limit 1;
$$;
revoke all on function public.get_user_org_id(uuid) from public, anon;
grant execute on function public.get_user_org_id(uuid) to authenticated, service_role;

-- Profile ownership does not authorize changing identity or membership.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, preferences) on public.profiles to authenticated;

create or replace function public.protect_profile_authorization()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and
     (new.id, new.org_id, new.role, new.created_at)
       is distinct from (old.id, old.org_id, old.role, old.created_at) then
    raise exception 'Profile authorization fields require a trusted administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_profile_authorization() from public, anon, authenticated;
drop trigger if exists protect_profile_authorization on public.profiles;
create trigger protect_profile_authorization before update on public.profiles
for each row execute function public.protect_profile_authorization();

-- Fixed SQL, caller permissions, mandatory property ownership, bounded dates/results.
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
        when 'campaign' then f.campaign_id
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

-- Remove the audited permissive storage policies, including the mislabeled public ALL policy.
drop policy if exists "Service role full access for brand assets" on storage.objects;
drop policy if exists "Authenticated delete brand-assets" on storage.objects;
drop policy if exists "Authenticated delete content-assets" on storage.objects;
drop policy if exists "Authenticated delete documents" on storage.objects;
drop policy if exists "Authenticated read documents" on storage.objects;
drop policy if exists "Authenticated update brand-assets" on storage.objects;
drop policy if exists "Authenticated update content-assets" on storage.objects;
drop policy if exists "Authenticated update documents" on storage.objects;
drop policy if exists "Authenticated upload brand-assets" on storage.objects;
drop policy if exists "Authenticated upload content-assets" on storage.objects;
drop policy if exists "Authenticated upload documents" on storage.objects;

create policy "Members manage their property assets" on storage.objects
for all to authenticated using (
  bucket_id in ('brand-assets', 'content-assets', 'documents') and exists (
    select 1 from public.properties p
    where p.id::text = (storage.foldername(storage.objects.name))[1]
      and p.org_id = public.get_user_org_id((select auth.uid()))
  )
) with check (
  bucket_id in ('brand-assets', 'content-assets', 'documents') and exists (
    select 1 from public.properties p
    where p.id::text = (storage.foldername(storage.objects.name))[1]
      and p.org_id = public.get_user_org_id((select auth.uid()))
  )
);
