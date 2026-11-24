create or replace function public.read_marketing_facts(
  p_property_id uuid, p_start_date date default null, p_end_date date default null,
  p_channels text[] default null, p_campaign_id text default null, p_source_account_id text default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare rows jsonb; total integer;
begin
  -- A service-role request keeps its SET ROLE through the guarded BI wrapper,
  -- while CURRENT_USER changes to the SECURITY DEFINER owner inside it.
  if current_user <> 'service_role'
      and current_setting('role', true) is distinct from 'service_role'
      and ((select auth.uid()) is null or not exists (
    select 1 from public.properties pr join public.profiles pf on pf.org_id=pr.org_id
    where pr.id=p_property_id and pf.id=(select auth.uid())
  )) then raise exception 'Property access denied' using errcode='42501'; end if;
  if (p_start_date is not null and p_end_date is not null and
      (p_end_date<p_start_date or p_end_date-p_start_date>366)) then
    raise exception 'Choose a date range of at most 366 days' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.date,f.id),'[]'::jsonb),count(*) into rows,total
  from (
    select id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,
      impressions,clicks,spend,conversions,raw_source
    from public.fact_marketing_performance f
    where property_id=p_property_id and not exists(select 1 from public.bi_data_row_state s where s.property_id=f.property_id and s.kind='daily'and s.row_id=f.id and s.excluded)
      and (p_start_date is null or date>=p_start_date)
      and (p_end_date is null or date<=p_end_date)
      and (p_channels is null or channel_id=any(p_channels))
      and (p_campaign_id is null or campaign_id=p_campaign_id)
      and (p_source_account_id is null or source_account_id=nullif(p_source_account_id,'')
           or (p_source_account_id='' and source_account_id is null))
    order by date,id limit 50001
  ) f;
  if total>50000 then
    raise exception 'This report exceeds 50000 records. Choose a shorter date range.' using errcode='22023';
  end if;
  return jsonb_build_object('rows',rows,'row_count',total,'complete',true);
end;
$$;
