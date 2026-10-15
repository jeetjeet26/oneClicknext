begin;
create table public.community_query_embeddings(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),
 actor_id uuid not null references auth.users(id),purpose text not null,permission_hash text not null,
 query_hash text not null,model text not null default 'text-embedding-3-small',units integer not null,
 state text not null check(state in('invoking','received','uncertain')),embedding public.vector(1536),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '1 hour',
 check(units between 1 and 16000),check((state='received')=(embedding is not null))
);
alter table public.community_query_embeddings enable row level security;
revoke all on public.community_query_embeddings from public,anon,authenticated;
grant select on public.community_query_embeddings to service_role;
create index brain_query_cache on public.community_query_embeddings(property_id,actor_id,purpose,query_hash,created_at desc);
create function public.brain_prepare_query(p_scope_id uuid,p_property_id uuid,p_query text)returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;r public.community_query_embeddings;h text;u integer;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if not public.brain_scope_current(s.id,p_property_id)then raise insufficient_privilege;end if;
 if length(p_query)not between 1 and 4000 then raise exception 'Query length exceeded';end if;
 h:=public.knowledge_hash(to_jsonb(p_query));u:=octet_length(p_query);
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,92));
 select *into r from public.community_query_embeddings where property_id=p_property_id and actor_id=s.actor_id and purpose=s.purpose and permission_hash=s.permission_hash and query_hash=h and expires_at>statement_timestamp()order by created_at desc limit 1;
 if found then return jsonb_build_object('id',r.id,'state',r.state);end if;
 -- UTF-8 bytes conservatively bound tokens. No unbounded paid search fallback.
 if(select coalesce(sum(units),0)from public.community_query_embeddings where property_id=p_property_id and created_at>=date_trunc('day',statement_timestamp()))+u>1000000 then return '{"state":"budget_exhausted"}';end if;
 insert into public.community_query_embeddings(property_id,actor_id,purpose,permission_hash,query_hash,units,state)values(p_property_id,s.actor_id,s.purpose,s.permission_hash,h,u,'invoking')returning *into r;
 return jsonb_build_object('id',r.id,'state','invoke_once');end$$;
create function public.brain_finish_query(p_scope_id uuid,p_id uuid,p_model text,p_embedding public.vector default null)returns boolean language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;r public.community_query_embeddings;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into r from public.community_query_embeddings where id=p_id for update;
 if r.actor_id is distinct from s.actor_id or r.purpose is distinct from s.purpose or r.permission_hash is distinct from s.permission_hash or not public.brain_scope_current(s.id,r.property_id)then raise insufficient_privilege;end if;
 if p_model is distinct from r.model or(p_embedding is not null and public.vector_dims(p_embedding)<>1536)then raise exception 'Embedding namespace mismatch';end if;
 if r.state<>'invoking'then return r.state='received';end if;
 update public.community_query_embeddings set state=case when p_embedding is null then'uncertain'else'received'end,embedding=p_embedding where id=r.id;return p_embedding is not null;end$$;
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_context(uuid,uuid,text,uuid[])'::regprocedure)into definition;
 definition:=replace(definition,'v_manifest jsonb;','v_manifest jsonb;v_embedding public.vector;');
 definition:=replace(definition,'v_search:=public.brain_search(p_scope_id,p_property_id,p_query,null,null,12);',
 'select embedding into v_embedding from public.community_query_embeddings where property_id=p_property_id and actor_id=s.actor_id and purpose=s.purpose and permission_hash=s.permission_hash and query_hash=public.knowledge_hash(to_jsonb(p_query))and state=''received''and expires_at>statement_timestamp()order by created_at desc limit 1;
 v_search:=public.brain_search(p_scope_id,p_property_id,p_query,v_embedding,case when v_embedding is not null then''text-embedding-3-small''end,12);');
 execute definition;
end$$;
revoke all on function public.brain_prepare_query(uuid,uuid,text),public.brain_finish_query(uuid,uuid,text,public.vector)from public,anon,authenticated;
grant execute on function public.brain_prepare_query(uuid,uuid,text),public.brain_finish_query(uuid,uuid,text,public.vector)to service_role;

create table public.community_measurement_receipts(
 job_id uuid not null references public.import_jobs(id),connection_id uuid not null references public.ad_account_connections(id),
 property_id uuid not null references public.properties(id),platform text not null,account_id text not null,
 status text not null check(status in('fetched_complete','failed')),start_date date,end_date date,currency text,timezone text,
 fetched_count integer not null,rows_hash text not null,provider_metadata jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(job_id,connection_id),check(fetched_count between 0 and 50000)
);
alter table public.community_measurement_receipts enable row level security;
revoke all on public.community_measurement_receipts from public,anon,authenticated;
grant select on public.community_measurement_receipts to service_role;
create index brain_measurements_owner_period on public.community_measurement_receipts(property_id,start_date,end_date,created_at desc);
create function public.brain_measurement_hash(p_rows jsonb)returns text language sql immutable set search_path='' as $$
 select public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_object('date',x->>'date','campaign_id',x->>'campaign_id','currency',x->>'currency_code','spend',trim_scale((x->>'spend')::numeric),'clicks',trim_scale((x->>'clicks')::numeric),'impressions',trim_scale((x->>'impressions')::numeric),'conversions',trim_scale((x->>'conversions')::numeric))order by x->>'date',x->>'campaign_id'),'[]'))from jsonb_array_elements(p_rows)x
$$;
create function public.save_marketing_import_report_v2(p_job_id uuid,p_token uuid,p_connection_id uuid,p_records jsonb,p_receipt jsonb,p_error text default null)returns void language plpgsql security definer set search_path='' as $$
declare j public.import_jobs;a public.ad_account_connections;r public.community_measurement_receipts;h text;today date;first_day date;last_day date;begin
 perform public.assert_marketing_import_lease(p_job_id,p_token);
 select *into j from public.import_jobs where id=p_job_id;select *into a from public.ad_account_connections where id=p_connection_id and property_id=j.property_id and is_active;
 if not found then raise insufficient_privilege;end if;
 if p_receipt-array['account_id','currency','timezone','start_date','end_date','pagination_complete','pages','provider','recipe','fetched_count']<>'{}'then raise exception 'Receipt contains unexpected fields';end if;
 if p_error is null then
  if p_receipt->>'account_id'is distinct from (case when a.platform='google_ads'then replace(a.account_id,'-','')else regexp_replace(a.account_id,'^act_','')end)
  or p_receipt->>'provider'is distinct from a.platform or p_receipt->>'currency'is distinct from'USD'or p_receipt->>'recipe'is distinct from'mcp-daily-complete-v1'
  or p_receipt->'pagination_complete'is distinct from'true'::jsonb or(p_receipt->>'fetched_count')::integer is distinct from jsonb_array_length(p_records)
  or not exists(select 1 from pg_timezone_names where name=p_receipt->>'timezone')then raise exception 'Provider coverage was not confirmed';end if;
  today:=(coalesce(j.reference_at,j.created_at)at time zone(p_receipt->>'timezone'))::date;
  last_day:=case j.date_range when'TODAY'then today when'THIS_MONTH'then today when'LAST_MONTH'then date_trunc('month',today)::date-1 else today-1 end;
  first_day:=case j.date_range when'TODAY'then today when'YESTERDAY'then today-1 when'THIS_MONTH'then date_trunc('month',today)::date when'LAST_MONTH'then(date_trunc('month',today)-interval '1 month')::date when'LAST_7_DAYS'then today-7 when'LAST_14_DAYS'then today-14 when'LAST_30_DAYS'then today-30 end;
  if first_day is null or(p_receipt->>'start_date')::date is distinct from first_day or(p_receipt->>'end_date')::date is distinct from last_day then raise exception 'Provider reporting window differs from the saved request';end if;
 end if;
 h:=public.brain_measurement_hash(p_records);
 select *into r from public.community_measurement_receipts where job_id=p_job_id and connection_id=p_connection_id;
 if found then if r.rows_hash is distinct from h or r.provider_metadata is distinct from p_receipt then raise exception 'Measurement receipt changed';end if;return;end if;
 perform public.save_marketing_import_report(p_job_id,p_token,p_connection_id,p_records,p_error);
 insert into public.community_measurement_receipts(job_id,connection_id,property_id,platform,account_id,status,start_date,end_date,currency,timezone,fetched_count,rows_hash,provider_metadata)
 values(j.id,a.id,j.property_id,a.platform,case when a.platform='google_ads'then replace(a.account_id,'-','')else regexp_replace(a.account_id,'^act_','')end,case when p_error is null then'fetched_complete'else'failed'end,first_day,last_day,p_receipt->>'currency',p_receipt->>'timezone',jsonb_array_length(p_records),h,p_receipt);
end$$;
create function public.brain_measurement_coverage(p_scope_id uuid,p_property_id uuid,p_start date,p_end date)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not public.brain_scope_current(p_scope_id,p_property_id)then raise insufficient_privilege;end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>366 then raise exception 'Choose a bounded reporting period';end if;
 with confirmed as materialized(
  select r.*from public.community_measurement_receipts r join public.marketing_import_checkpoints c on c.job_id=r.job_id
  where r.property_id=p_property_id and r.status='fetched_complete'and r.start_date<=p_end and r.end_date>=p_start
  and exists(select 1 from jsonb_array_elements(c.accounts)x where x->>'connection_id'=r.connection_id::text and x->>'done'='true'and x->>'error'is null and(x->>'offset')::integer=r.fetched_count)
  and r.rows_hash=public.brain_measurement_hash((select coalesce(jsonb_agg(to_jsonb(f)),'[]')from public.fact_marketing_performance f where f.property_id=r.property_id and f.channel_id=r.platform and f.source_account_id=r.account_id and f.date between r.start_date and r.end_date))
 ), accounts as(
  select a.id,a.platform,a.account_id,(select max(created_at)from confirmed r where r.connection_id=a.id)as last_confirmed_at,
   (select count(*)from generate_series(p_start,p_end,interval '1 day')d where exists(select 1 from confirmed r where r.connection_id=a.id and d::date between r.start_date and r.end_date))as confirmed_days
  from public.ad_account_connections a where a.property_id=p_property_id and a.is_active
 )select jsonb_build_object('state',case when count(*)=0 then'unconfigured'when bool_and(confirmed_days=p_end-p_start+1)then'complete'else'incomplete'end,'accounts',coalesce(jsonb_agg(to_jsonb(accounts)order by platform,account_id),'[]'),'daysRequested',p_end-p_start+1,'definition','provider-attributed-campaign-actions-v1','currency','USD')into result from accounts;
 return result;end$$;
revoke all on function public.brain_measurement_hash(jsonb),public.save_marketing_import_report_v2(uuid,uuid,uuid,jsonb,jsonb,text),public.brain_measurement_coverage(uuid,uuid,date,date)from public,anon,authenticated;
grant execute on function public.save_marketing_import_report_v2(uuid,uuid,uuid,jsonb,jsonb,text),public.brain_measurement_coverage(uuid,uuid,date,date)to service_role;
commit;
