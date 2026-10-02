-- Phase 0 follow-through. Apply after the prepared access and account-identity repairs.
-- A JSON envelope keeps one consistent database snapshot independent of Data API row caps.
create function public.read_marketing_facts(
  p_property_id uuid, p_start_date date default null, p_end_date date default null,
  p_channels text[] default null, p_campaign_id text default null, p_source_account_id text default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare rows jsonb; total integer;
begin
  if current_user <> 'service_role' and ((select auth.uid()) is null or not exists (
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
    from public.fact_marketing_performance
    where property_id=p_property_id
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
revoke all on function public.read_marketing_facts(uuid,date,date,text[],text,text) from public,anon,service_role;
grant execute on function public.read_marketing_facts(uuid,date,date,text[],text,text) to authenticated,service_role;
notify pgrst, 'reload schema';

-- New work is explicitly versioned. Historical jobs never enter automatic recovery.
alter table public.import_jobs
  add column recovery_version integer,
  add column connection_ids uuid[],
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column attempts integer not null default 0;
create index import_jobs_recovery_queue on public.import_jobs(created_at)
  where recovery_version=1 and status in ('pending','running');
create table public.marketing_import_checkpoints (
  job_id uuid primary key references public.import_jobs(id) on delete cascade,
  accounts jsonb not null check(jsonb_typeof(accounts)='array')
);
alter table public.marketing_import_checkpoints enable row level security;
revoke all on public.marketing_import_checkpoints from public,anon,authenticated;
grant all on public.marketing_import_checkpoints to service_role;

create function public.claim_marketing_import(p_job_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.import_jobs; plan jsonb;
begin
  if p_token is null then raise exception 'Worker token required'; end if;
  select * into j from public.import_jobs where id=p_job_id for update;
  if not found or j.recovery_version is distinct from 1 or j.status not in ('pending','running') then return null; end if;
  if j.status='running' and (j.lease_expires_at is null or j.lease_expires_at>clock_timestamp()) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.property_id::text, 817));
  if exists(select 1 from public.import_jobs where property_id=j.property_id and id<>j.id and status='running') then return null; end if;
  if j.attempts>=5 then
    update public.import_jobs set status=case when records_imported>0 then 'partial' else 'failed' end,
      completed_at=clock_timestamp(),current_step='Import requires review',lease_token=null,lease_expires_at=null,
      error_message='Import stopped after repeated worker interruptions. Review stored data before starting another import.' where id=j.id;
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('connection_id',id,'platform',platform,'account_id',account_id,'records',null,'offset',0,'done',false,'error',null) order by id),'[]'::jsonb)
    into plan from public.ad_account_connections where property_id=j.property_id and is_active and platform=any(j.channels) and (j.connection_ids is null or id=any(j.connection_ids));
  insert into public.marketing_import_checkpoints(job_id,accounts) values(j.id,plan) on conflict(job_id) do nothing;
  update public.import_jobs set status='running',started_at=coalesce(started_at,clock_timestamp()),
    lease_token=p_token,lease_expires_at=clock_timestamp()+interval '90 seconds',attempts=attempts+1,
    current_step=case when attempts>0 then 'Resuming saved import' else 'Preparing account reports' end
    where id=j.id returning * into j;
  select accounts into plan from public.marketing_import_checkpoints where job_id=j.id;
  return jsonb_build_object('job',to_jsonb(j),'accounts',plan);
end;
$$;

create function public.assert_marketing_import_lease(p_job_id uuid,p_token uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.import_jobs where id=p_job_id and status='running' and recovery_version=1
    and lease_token=p_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'Import worker no longer owns this job' using errcode='55000'; end if;
end;
$$;

create function public.renew_marketing_import(p_job_id uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform public.assert_marketing_import_lease(p_job_id,p_token);
  update public.import_jobs set lease_expires_at=clock_timestamp()+interval '90 seconds' where id=p_job_id;
  return true;
end;
$$;

create function public.save_marketing_import_report(p_job_id uuid,p_token uuid,p_connection_id uuid,p_records jsonb,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.import_jobs; a jsonb; idx integer; expected_id text;
begin
  perform public.assert_marketing_import_lease(p_job_id,p_token);
  select * into j from public.import_jobs where id=p_job_id;
  select value,(ordinality-1)::integer into a,idx from public.marketing_import_checkpoints c,
    jsonb_array_elements(c.accounts) with ordinality where c.job_id=p_job_id and value->>'connection_id'=p_connection_id::text;
  if a is null then raise exception 'Account is outside this import'; end if;
  if a->'records'<>'null'::jsonb then return; end if;
  if p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>50000 then raise exception 'Invalid account report'; end if;
  expected_id=case when a->>'platform'='google_ads' then replace(a->>'account_id','-','') else regexp_replace(a->>'account_id','^act_','') end;
  if exists(select 1 from jsonb_array_elements(p_records) r where
    r->>'property_id' is distinct from j.property_id::text or r->>'channel_id' is distinct from a->>'platform'
    or r->>'source_account_id' is distinct from expected_id) then raise exception 'Report identity does not match this job'; end if;
  if p_error is not null and jsonb_array_length(p_records)>0 then raise exception 'Failed report cannot contain writeable rows'; end if;
  a=jsonb_set(a,'{records}',p_records)||jsonb_build_object('error',p_error);
  update public.marketing_import_checkpoints set accounts=jsonb_set(accounts,array[idx::text],a) where job_id=p_job_id;
end;
$$;

-- Direct/legacy/CSV writers cannot race a running tracked import for this property.
create function public.guard_marketing_import_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.import_jobs where property_id=new.property_id and status='running'
    and (lease_token is null or lease_token::text is distinct from current_setting('p11.marketing_worker_token',true))) then
    raise exception 'An import is already running for this property. Wait for it to finish.' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_marketing_import_write() from public,anon,authenticated;
create trigger marketing_import_write_guard before insert or update on public.fact_marketing_performance
  for each row execute function public.guard_marketing_import_write();

create function public.commit_marketing_import_batch(p_job_id uuid,p_token uuid,p_connection_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.import_jobs; a jsonb; idx integer; batch jsonb; start_offset integer; end_offset integer; n integer; connected boolean;
begin
  perform public.assert_marketing_import_lease(p_job_id,p_token);
  select * into j from public.import_jobs where id=p_job_id;
  select value,(ordinality-1)::integer into a,idx from public.marketing_import_checkpoints c,
    jsonb_array_elements(c.accounts) with ordinality where c.job_id=p_job_id and value->>'connection_id'=p_connection_id::text;
  if a is null or a->'records'='null'::jsonb then raise exception 'Saved report required'; end if;
  if (a->>'done')::boolean then return a - 'records'; end if;
  start_offset=(a->>'offset')::integer; end_offset=least(start_offset+250,jsonb_array_length(a->'records'));
  if a->>'error' is null then
    select exists(select 1 from public.ad_account_connections where id=p_connection_id and property_id=j.property_id and is_active
      and platform=a->>'platform' and account_id=a->>'account_id') into connected;
    if not connected then raise exception 'The source account changed during this import'; end if;
    perform set_config('p11.marketing_worker_token',p_token::text,true);
    select coalesce(jsonb_agg(value),'[]'::jsonb) into batch from jsonb_array_elements(a->'records') with ordinality where ordinality>start_offset and ordinality<=end_offset;
    insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions,raw_source)
      select r.date,r.property_id,r.channel_id,r.source_account_id,r.currency_code,r.campaign_id,r.campaign_name,r.impressions,r.clicks,r.spend,r.conversions,r.raw_source
      from jsonb_to_recordset(batch) r(date date,property_id uuid,channel_id text,source_account_id text,currency_code text,campaign_id text,campaign_name text,impressions bigint,clicks bigint,spend numeric,conversions numeric,raw_source text)
      on conflict(date,property_id,channel_id,source_account_id,campaign_id) do update set
        campaign_name=excluded.campaign_name,impressions=excluded.impressions,clicks=excluded.clicks,spend=excluded.spend,conversions=excluded.conversions,currency_code=excluded.currency_code,raw_source=excluded.raw_source;
    get diagnostics n=row_count;
    if n<>end_offset-start_offset then raise exception 'Stored batch count was not confirmed'; end if;
    update public.import_jobs set records_imported=coalesce(records_imported,0)+n,current_step='Saving verified account reports',lease_expires_at=clock_timestamp()+interval '90 seconds' where id=p_job_id;
    if end_offset=jsonb_array_length(a->'records') then
      update public.ad_account_connections set last_synced_at=clock_timestamp(),
        last_imported_at=case when end_offset>0 then clock_timestamp() else last_imported_at end,
        last_error=null,error_count=0 where id=p_connection_id and property_id=j.property_id;
    end if;
  end if;
  a=a||jsonb_build_object('offset',end_offset,'done',end_offset=jsonb_array_length(a->'records'));
  update public.marketing_import_checkpoints set accounts=jsonb_set(accounts,array[idx::text],a) where job_id=p_job_id;
  return a - 'records';
end;
$$;

create function public.fail_marketing_import_account(p_job_id uuid,p_token uuid,p_connection_id uuid,p_error text)
returns void language plpgsql security invoker set search_path='' as $$
declare a jsonb;idx integer;
begin
  perform public.assert_marketing_import_lease(p_job_id,p_token);
  select value,(ordinality-1)::integer into a,idx from public.marketing_import_checkpoints c,
    jsonb_array_elements(c.accounts) with ordinality where c.job_id=p_job_id and value->>'connection_id'=p_connection_id::text;
  if a is null then raise exception 'Account is outside this import'; end if;
  a=a||jsonb_build_object('error',p_error,'done',true);
  update public.marketing_import_checkpoints set accounts=jsonb_set(accounts,array[idx::text],a) where job_id=p_job_id;
end;
$$;

create function public.finish_marketing_import(p_job_id uuid,p_token uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare j public.import_jobs; plan jsonb; errors text; good integer; state text; campaigns integer;
begin
  perform public.assert_marketing_import_lease(p_job_id,p_token);
  select * into j from public.import_jobs where id=p_job_id;
  select accounts into plan from public.marketing_import_checkpoints where job_id=p_job_id;
  if exists(select 1 from jsonb_array_elements(plan) a where not (a->>'done')::boolean) then raise exception 'Account work is incomplete'; end if;
  select string_agg((a->>'platform')||': '||(a->>'error'),'; '),count(*) filter(where a->>'error' is null)
    into errors,good from jsonb_array_elements(plan) a;
  if jsonb_array_length(plan)=0 then errors='No active accounts match this import'; end if;
  if exists(select 1 from unnest(j.channels) ch where not exists(select 1 from jsonb_array_elements(plan) a where a->>'platform'=ch)) then
    errors=concat_ws('; ',errors,'Some requested channels have no connected account');
  end if;
  state=case when errors is null then 'complete' when good>0 or j.records_imported>0 then 'partial' else 'failed' end;
  select count(distinct jsonb_build_array(r->>'channel_id',r->>'source_account_id',r->>'campaign_id')) into campaigns
    from jsonb_array_elements(plan) a,jsonb_array_elements(a->'records') with ordinality as rows(r,position) where position<=(a->>'offset')::integer;
  update public.import_jobs set status=state,completed_at=clock_timestamp(),progress_pct=100,campaigns_found=campaigns,
    error_message=errors,current_step=case when state='complete' then 'Complete' else 'Import requires review' end,
    lease_token=null,lease_expires_at=null where id=p_job_id;
  return state;
end;
$$;

create function public.pending_marketing_imports()
returns jsonb language sql volatile security invoker set search_path='' as $$
  select coalesce(jsonb_agg(id),'[]'::jsonb) from (
    select id from public.import_jobs where recovery_version=1 and
      (status='pending' or (status='running' and lease_expires_at<clock_timestamp()))
    order by case when status='running' then 0 else 1 end,created_at limit 20
  ) jobs;
$$;

do $$declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
    ('claim_marketing_import','assert_marketing_import_lease','renew_marketing_import','save_marketing_import_report','commit_marketing_import_batch','finish_marketing_import','pending_marketing_imports','fail_marketing_import_account')
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature); end loop;
end$$;
notify pgrst,'reload schema';
