-- Exact reconciliation snapshots and reversible exclusions. Original facts are not rewritten.
create table public.bi_data_reviews(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),source jsonb not null,source_hash text not null,created_at timestamptz not null default clock_timestamp());
create table public.bi_data_commands(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),review_id uuid references public.bi_data_reviews(id)on delete cascade,input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.bi_data_row_state(property_id uuid not null references public.properties(id)on delete cascade,kind text not null check(kind in('daily','dimension')),row_id uuid not null,excluded boolean not null,decision_id uuid not null references public.bi_data_commands(id)on delete cascade deferrable initially deferred,updated_at timestamptz not null default clock_timestamp(),primary key(property_id,kind,row_id));
create index bi_data_reviews_history on public.bi_data_reviews(property_id,created_at desc,id desc);
create index bi_data_reviews_org on public.bi_data_reviews(org_id);create index bi_data_reviews_actor on public.bi_data_reviews(actor_id);
create index bi_data_commands_history on public.bi_data_commands(property_id,created_at desc,id desc);
create index bi_data_commands_org on public.bi_data_commands(org_id);create index bi_data_commands_actor on public.bi_data_commands(actor_id);create index bi_data_commands_review on public.bi_data_commands(review_id);create index bi_data_row_state_decision on public.bi_data_row_state(decision_id);
alter table public.bi_data_reviews enable row level security;alter table public.bi_data_commands enable row level security;alter table public.bi_data_row_state enable row level security;
revoke all on public.bi_data_reviews,public.bi_data_commands,public.bi_data_row_state from anon,authenticated;grant all on public.bi_data_reviews,public.bi_data_commands,public.bi_data_row_state to service_role;
grant select on public.bi_data_row_state to authenticated;
create policy bi_data_row_state_read on public.bi_data_row_state for select to authenticated using(property_id in(select p.id from public.properties p join public.profiles u on u.org_id=p.org_id where u.id=(select auth.uid())));
create function public.guard_bi_data_records()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if exists(select 1 from public.properties where id=old.property_id)then raise exception 'Retained reconciliation evidence cannot be deleted';end if;return old;end if;
 if current_setting('p11.bi_data_scope',true)is distinct from new.property_id::text then raise exception 'Recorded data review required';end if;
 if tg_op='UPDATE'and tg_table_name<>'bi_data_row_state'then raise exception 'Reconciliation evidence is immutable';end if;return new;
end$$;
create trigger recorded_bi_data_review before insert or update or delete on public.bi_data_reviews for each row execute function public.guard_bi_data_records();
create trigger recorded_bi_data_command before insert or update or delete on public.bi_data_commands for each row execute function public.guard_bi_data_records();
create trigger recorded_bi_data_state before insert or update or delete on public.bi_data_row_state for each row execute function public.guard_bi_data_records();

create function public.guard_excluded_marketing_fact()returns trigger language plpgsql security invoker set search_path=''as $$
declare k text:=case when tg_table_name='fact_marketing_performance'then'daily'else'dimension'end;
begin
 -- All writers share the same lock with imports and explicit data decisions.
 if tg_op='INSERT'then perform pg_advisory_xact_lock(hashtextextended(new.property_id::text,817));return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(old.property_id::text,817));
 if exists(select 1 from public.bi_data_row_state s where s.property_id=old.property_id and s.kind=k and s.row_id=old.id and s.excluded)and exists(select 1 from public.properties where id=old.property_id)then raise exception 'This row is excluded. Review and restore it before replacing its source.'using errcode='23514';end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger excluded_marketing_fact before insert or update or delete on public.fact_marketing_performance for each row execute function public.guard_excluded_marketing_fact();
create trigger excluded_marketing_dimension before insert or update or delete on public.fact_marketing_extended for each row execute function public.guard_excluded_marketing_fact();

create function public.bi_data_source(p_property_id uuid,p_start date,p_end date)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare items jsonb;n integer;result jsonb;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Choose a complete period of at most 366 days'using errcode='22023';end if;
 with facts as(
 select 'daily'::text kind,f.id,to_jsonb(f)source from public.fact_marketing_performance f where f.property_id=p_property_id and f.date between p_start and p_end
 union all select 'dimension',f.id,to_jsonb(f)from public.fact_marketing_extended f where f.property_id=p_property_id and(f.date_range_start is null or f.date_range_start<=p_end)and(f.date_range_end is null or f.date_range_end>=p_start)
 ),rows as(select f.*,coalesce(s.excluded,false)excluded,s.decision_id from facts f left join public.bi_data_row_state s on s.property_id=p_property_id and s.kind=f.kind and s.row_id=f.id order by f.kind,f.id limit 50001),annotated as(
 select *,array_remove(array[
 case when nullif(source->>'source_account_id','')is null then'Confirm the source account'end,
 case when source->>'currency_code'is distinct from'USD'and not(kind='daily'and source->>'channel_id'='ga4'and(source->>'spend')::numeric=0 and source->>'currency_code'is null)then'Confirm the reporting currency'end,
 case when kind='dimension'and(source->>'date_range_start'is null or source->>'date_range_end'is null)then'Confirm the reporting period'end,
 case when nullif(source->>'campaign_id','')is null then'Confirm the campaign ID'end,
 case when source->>'raw_source'='mcp'or(kind='dimension'and source->>'retained_import_id'is null)then'Compare the earlier source with its provider export'end,
 case when kind='daily'and(source->>'spend'is null or source->>'clicks'is null or source->>'impressions'is null or source->>'conversions'is null or(source->>'spend')::numeric<0 or(source->>'clicks')::numeric<0 or(source->>'impressions')::numeric<0 or(source->>'conversions')::numeric<0)then'Review missing or invalid metrics'end
 ],null)reasons from rows)
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'source',source,'excluded',excluded,'decisionId',decision_id,'reasons',to_jsonb(reasons),'rowHash',public.knowledge_hash(jsonb_build_object('source',source,'excluded',excluded,'decisionId',decision_id)))order by kind,id),'[]'),count(*)into items,n from annotated;
 if n>50000 then raise exception 'More than 50000 rows need review. Choose a shorter period.'using errcode='22023';end if;
 result:=jsonb_build_object('version','bi-data-review-v1','propertyId',p_property_id,'startDate',p_start,'endDate',p_end,'complete',true,'rows',items,'count',n);
 if octet_length(result::text)>12582912 then raise exception 'The complete source is too large. Choose a shorter period.'using errcode='22023';end if;return result;
end$$;

create function public.read_bi_data_review(p_actor_id uuid,p_property_id uuid,p_start date default null,p_end date default null,p_review_id uuid default null,p_command_id uuid default null,p_kind text default'current',p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;role_name text;src jsonb;items jsonb;all_items jsonb;hash text;r public.bi_data_reviews;saved_command public.bi_data_commands;
begin
 select p.org_id,u.role into organization,role_name from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 or p_kind not in('current','history','decisions','rows')then return'{"state":"invalid_input"}';end if;
 if p_command_id is not null then select*into saved_command from public.bi_data_commands where id=p_command_id and property_id=p_property_id and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return saved_command.result;end if;
 if p_review_id is not null then select*into r from public.bi_data_reviews where id=p_review_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;end if;
 if p_kind in('current','rows')then
  if p_review_id is null then src:=public.bi_data_source(p_property_id,p_start,p_end);else src:=r.source;end if;
  hash:=public.knowledge_hash(src);all_items:=src->'rows';
 elsif p_kind='history'then
  select coalesce(jsonb_agg(to_jsonb(q)order by q.created_at desc,q.id desc),'[]')into all_items from(select id,actor_id,created_at,source_hash,source->>'startDate'as start_date,source->>'endDate'as end_date,(source->>'count')::integer row_count from public.bi_data_reviews where property_id=p_property_id)q;hash:=public.knowledge_hash(all_items);
 else select coalesce(jsonb_agg((to_jsonb(c)-'result'||jsonb_build_object('result',c.result-'artifact'))order by c.created_at desc,c.id desc),'[]')into all_items from public.bi_data_commands c where c.property_id=p_property_id and(p_review_id is null or c.review_id=p_review_id);hash:=public.knowledge_hash(all_items);
 end if;
 if p_hash is not null and p_hash is distinct from hash then return'{"state":"source_changed"}';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]')into items from jsonb_array_elements(all_items)with ordinality q(value,ordinal)where ordinal>p_offset and ordinal<=p_offset+25;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canManage',role_name in('admin','manager'),'kind',p_kind,'reviewId',p_review_id,'items',items,'count',jsonb_array_length(all_items),'offset',p_offset,'hash',hash,'complete',true,'startDate',coalesce(r.source->>'startDate',p_start::text),'endDate',coalesce(r.source->>'endDate',p_end::text));
end$$;

create function public.decide_bi_data_review(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;role_name text;op text:=p_input->>'operation';src jsonb;r public.bi_data_reviews;c public.bi_data_commands;before_value jsonb;after_value jsonb;result jsonb;event jsonb;rid uuid;target_row_id uuid;target_kind text;action text;artifact jsonb;current_entry jsonb;source_row jsonb;
begin
 select p.org_id,u.role into organization,role_name from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or op is null or op not in('save','exclude','restore','export','report','cancel')then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,984));select*into c from public.bi_data_commands where id=p_id;
 if found then if(c.actor_id,c.property_id)is distinct from(p_actor_id,p_property_id)then return'{"state":"request_conflict"}';end if;if c.input->>'operation'<>'cancel'and op<>'cancel'and c.input is distinct from p_input then return'{"state":"request_conflict"}';end if;return c.result;end if;
 if op in('exclude','restore')and role_name not in('admin','manager')then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,817));perform set_config('p11.bi_data_scope',p_property_id::text,true);
 if op='cancel'then result:=jsonb_build_object('status','cancelled');action:='bi.data.request_cancelled';
 elsif op='save'then
  src:=public.bi_data_source(p_property_id,(p_input->>'startDate')::date,(p_input->>'endDate')::date);
  if public.knowledge_hash(src)is distinct from p_input->>'sourceHash'then return'{"state":"source_changed"}';end if;
  rid:=p_id;insert into public.bi_data_reviews(id,property_id,org_id,actor_id,source,source_hash)values(rid,p_property_id,organization,p_actor_id,src,public.knowledge_hash(src));result:=jsonb_build_object('status','saved_review');action:='bi.data.review_saved';
 else
  rid:=(p_input->>'reviewId')::uuid;select*into r from public.bi_data_reviews where id=rid and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  if op in('exclude','restore')then
   if length(btrim(coalesce(p_input->>'reason','')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
   if exists(select 1 from public.import_jobs where property_id=p_property_id and status='running')then return'{"state":"import_running"}';end if;
   target_row_id:=(p_input->>'rowId')::uuid;target_kind:=p_input->>'kind';select value into before_value from jsonb_array_elements(r.source->'rows')where value->>'id'=target_row_id::text and value->>'kind'=target_kind;if not found then return'{"state":"not_found"}';end if;
   if target_kind='daily'then select to_jsonb(f)into source_row from public.fact_marketing_performance f where f.property_id=p_property_id and f.id=target_row_id for update;
   else select to_jsonb(f)into source_row from public.fact_marketing_extended f where f.property_id=p_property_id and f.id=target_row_id for update;end if;
   if source_row is null then return'{"state":"source_changed"}';end if;
   select jsonb_build_object('source',source_row,'excluded',coalesce(s.excluded,false),'decisionId',s.decision_id)into current_entry from(select 1)x left join public.bi_data_row_state s on s.property_id=p_property_id and s.kind=target_kind and s.row_id=target_row_id;
   if public.knowledge_hash(current_entry)is distinct from before_value->>'rowHash'then return'{"state":"source_changed"}';end if;
   if (before_value->>'excluded')::boolean is not distinct from(op='exclude')then return'{"state":"review_required"}';end if;
   -- Restoring historical rows may reintroduce double counting. Hold when a newer overlapping source exists.
   if op='restore'and target_kind='daily'then
    if exists(select 1 from public.fact_marketing_performance f where f.property_id=p_property_id and f.id<>target_row_id and f.date=(source_row->>'date')::date and f.campaign_id=source_row->>'campaign_id'and not exists(select 1 from public.bi_data_row_state s where s.property_id=f.property_id and s.kind='daily'and s.row_id=f.id and s.excluded)and(source_row->>'source_account_id'is null or f.source_account_id is null or f.source_account_id=source_row->>'source_account_id')and(source_row->>'channel_id'is null or lower(source_row->>'channel_id')in('unknown','','mcp')or f.channel_id=source_row->>'channel_id'or(f.channel_id='google_ads'and lower(source_row->>'channel_id')in('google','googleads'))or(f.channel_id='meta_ads'and lower(source_row->>'channel_id')in('meta','facebook_ads','instagram_ads'))))then return'{"state":"overlap_requires_review"}';end if;
   elsif op='restore'and target_kind='dimension'then
    if exists(select 1 from public.fact_marketing_extended f where f.property_id=p_property_id and f.id<>target_row_id and f.report_type=source_row->>'report_type'and f.dimension_value=source_row->>'dimension_value'and not exists(select 1 from public.bi_data_row_state s where s.property_id=f.property_id and s.kind='dimension'and s.row_id=f.id and s.excluded)and(source_row->>'campaign_id'is null or f.campaign_id is null or f.campaign_id=source_row->>'campaign_id')and(source_row->>'source_account_id'is null or f.source_account_id is null or f.source_account_id=source_row->>'source_account_id')and(source_row->>'date_range_start'is null or f.date_range_end>=(source_row->>'date_range_start')::date)and(source_row->>'date_range_end'is null or f.date_range_start<=(source_row->>'date_range_end')::date))then return'{"state":"overlap_requires_review"}';end if;
   end if;
   insert into public.bi_data_row_state(property_id,kind,row_id,excluded,decision_id)values(p_property_id,target_kind,target_row_id,op='exclude',p_id)on conflict(property_id,kind,row_id)do update set excluded=excluded.excluded,decision_id=excluded.decision_id,updated_at=clock_timestamp();
   after_value:=jsonb_build_object('source',source_row,'excluded',op='exclude','decisionId',p_id);
   result:=jsonb_build_object('status',case when op='exclude'then'excluded'else'restored'end,'rowId',target_row_id,'kind',target_kind);action:=case when op='exclude'then'bi.data.row_excluded'else'bi.data.row_restored'end;
  elsif op='export'then artifact:=jsonb_build_object('reviewId',r.id,'savedAt',r.created_at,'savedBy',r.actor_id,'sourceHash',r.source_hash,'source',r.source,'notice','Staff reconciliation snapshot; provider attribution and business outcomes are not independently verified.');result:=jsonb_build_object('status','export_prepared','artifact',artifact,'artifactHash',public.knowledge_hash(artifact));action:='bi.data.export_prepared';
  else
   select*into c from public.bi_data_commands where id=(p_input->>'exportId')::uuid and property_id=p_property_id and actor_id=p_actor_id and review_id=rid and input->>'operation'='export';
   if not found or p_input->>'artifactHash'is distinct from c.result->>'artifactHash'or p_input->>'outcome'not in('initiated','failed')or p_input->>'outcome'is null then return'{"state":"invalid_input"}';end if;
   if exists(select 1 from public.bi_data_commands d where d.property_id=p_property_id and d.actor_id=p_actor_id and d.input->>'operation'='report'and d.input->>'exportId'=c.id::text)then return'{"state":"review_required"}';end if;
   result:=jsonb_build_object('status','reported','outcome',p_input->>'outcome');action:='bi.data.export_reported';
  end if;
 end if;
 result:=result||jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'reviewId',rid);
 insert into public.bi_data_commands(id,property_id,org_id,actor_id,review_id,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,rid,p_input,before_value,after_value,result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi',action,case when op='report'then'browser_observed'else'server_confirmed'end,case when op='report'then'observed'else'succeeded'end,jsonb_build_object('reviewId',rid,'rowId',target_row_id,'kind',target_kind),null,null,result-array['artifact']);
 if event->>'state'not in('recorded','replayed')then raise exception 'Data decision recording failed';end if;return result;
exception when invalid_text_representation or datetime_field_overflow then return'{"state":"invalid_input"}';
end$$;

create or replace function public.read_marketing_facts(
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
    where not exists(select 1 from public.bi_data_row_state s where s.property_id=f.property_id and s.kind='daily'and s.row_id=f.id and s.excluded) and f.property_id = p_property_id and f.date between p_start_date and p_end_date
      and (p_channel is null or f.channel_id = p_channel)
    group by 1 order by 1 nulls last limit p_limit
  ) aggregated;
  return result;
end;
$$;
create or replace function public.guard_marketing_legacy_overlap()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.fact_marketing_performance f
    where f.property_id = new.property_id and f.date = new.date
      and f.campaign_id = new.campaign_id and f.source_account_id is null
      and f.id <> new.id and not exists(select 1 from public.bi_data_row_state s where s.property_id=f.property_id and s.kind='daily'and s.row_id=f.id and s.excluded)
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
create or replace function public.bi_csv_targets(p_property_id uuid,p_preview jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare result jsonb;
begin
 if p_preview->>'kind'='daily'then
  select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('_excluded',coalesce(s.excluded,false))order by f.id),'[]')into result from public.fact_marketing_performance f left join public.bi_data_row_state s on s.property_id=f.property_id and s.kind='daily'and s.row_id=f.id where f.property_id=p_property_id and(f.source_account_id=p_preview->>'sourceAccountId'or f.source_account_id is null)and(lower(btrim(f.channel_id))=p_preview->>'platform'or f.channel_id is null or lower(btrim(f.channel_id))in('unknown','','meta','google','googleads','facebook_ads','instagram_ads'))and exists(select 1 from jsonb_array_elements(p_preview->'rows')r where f.date=(r->>'date')::date and f.campaign_id=r->>'campaign_id');
 else
  select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('_excluded',coalesce(s.excluded,false))order by f.id),'[]')into result from public.fact_marketing_extended f left join public.bi_data_row_state s on s.property_id=f.property_id and s.kind='dimension'and s.row_id=f.id where f.property_id=p_property_id and(f.source_account_id=p_preview->>'sourceAccountId'or f.source_account_id is null)and(f.channel_id=p_preview->>'platform'or(f.channel_id='meta'and p_preview->>'platform'='meta_ads'))and f.report_type=p_preview->>'reportType'and exists(select 1 from jsonb_array_elements(p_preview->'rows')r where(f.campaign_id=r->>'campaign_id'or f.campaign_id is null)and(f.dimension_key=r->>'dimension_key'or f.retained_import_id is null)and f.dimension_value=r->>'dimension_value'and(f.date_range_start=(r->>'date_range_start')::date or f.date_range_start is null)and(f.date_range_end=(r->>'date_range_end')::date or f.date_range_end is null));
 end if;return result;
end$$;
create or replace function public.decide_bi_csv(p_id uuid,p_actor_id uuid,p_property_id uuid,p_import_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;r public.bi_csv_imports;c public.bi_csv_commands;before_value jsonb;after_value jsonb;result jsonb;op text:=p_input->>'operation';rows_count integer;value jsonb;
begin
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or op not in('apply','discard','cancel')then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,975));select*into c from public.bi_csv_commands where id=p_id;
 if found then
  if(c.property_id,c.actor_id)is distinct from(p_property_id,p_actor_id)then return'{"state":"request_conflict"}';end if;
  if c.input->>'operation'<>'cancel'and op<>'cancel'and(c.import_id,c.input)is distinct from(p_import_id,p_input)then return'{"state":"request_conflict"}';end if;return c.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,817));perform set_config('p11.bi_csv_scope',p_property_id::text,true);
 if op='cancel'then result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'status','cancelled_request');
 else
  select*into r from public.bi_csv_imports where id=p_import_id and property_id=p_property_id and org_id=organization for update;if not found then return'{"state":"not_found"}';end if;
  if r.state<>'preview'then return'{"state":"review_required"}';end if;
  if p_input->>'previewHash'is distinct from r.preview_hash or p_input->>'targetHash'is distinct from r.target_hash or length(btrim(coalesce(p_input->>'reason','')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
  if op='apply'then
   if exists(select 1 from public.import_jobs where property_id=p_property_id and status='running')then return'{"state":"import_running"}';end if;
   before_value:=public.bi_csv_targets(p_property_id,r.preview);
   if public.knowledge_hash(before_value)is distinct from r.target_hash then return'{"state":"source_changed"}';end if;
   if exists(select 1 from jsonb_array_elements(before_value)v where coalesce((v->>'_excluded')::boolean,false)and v->>'source_account_id'=r.preview->>'sourceAccountId'and(r.preview->>'kind'='daily'or v->>'retained_import_id'is not null))then return'{"state":"excluded_review_required"}';end if;
   if exists(select 1 from jsonb_array_elements(before_value)v where not coalesce((v->>'_excluded')::boolean,false)and(v->>'source_account_id'is null or v->>'currency_code'is distinct from'USD'or(r.preview->>'kind'='dimension'and v->>'retained_import_id'is null)))then return'{"state":"legacy_review_required"}';end if;
   if r.preview->>'kind'='daily'then
    insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions,raw_source)
    select(v->>'date')::date,p_property_id,r.preview->>'platform',r.preview->>'sourceAccountId','USD',v->>'campaign_id',v->>'campaign_name',(v->>'impressions')::bigint,(v->>'clicks')::bigint,(v->>'spend')::numeric,(v->>'conversions')::numeric,'csv_import:'||r.id::text from jsonb_array_elements(r.preview->'rows')v
    on conflict(date,property_id,channel_id,source_account_id,campaign_id)do update set campaign_name=excluded.campaign_name,impressions=excluded.impressions,clicks=excluded.clicks,spend=excluded.spend,conversions=excluded.conversions,currency_code=excluded.currency_code,raw_source=excluded.raw_source;
   else
    insert into public.fact_marketing_extended(property_id,channel_id,source_account_id,currency_code,campaign_id,campaign_name,report_type,dimension_key,dimension_value,date_range_start,date_range_end,metrics,raw_source,retained_import_id)
    select p_property_id,r.preview->>'platform',r.preview->>'sourceAccountId','USD',v->>'campaign_id',v->>'campaign_name',r.preview->>'reportType',v->>'dimension_key',v->>'dimension_value',(v->>'date_range_start')::date,(v->>'date_range_end')::date,v->'metrics','csv_import:'||r.id::text,r.id from jsonb_array_elements(r.preview->'rows')v
    on conflict(property_id,channel_id,source_account_id,campaign_id,report_type,dimension_key,dimension_value,date_range_start,date_range_end)where retained_import_id is not null do update set campaign_name=excluded.campaign_name,metrics=excluded.metrics,raw_source=excluded.raw_source,retained_import_id=excluded.retained_import_id;
   end if;
   get diagnostics rows_count=row_count;if rows_count<>jsonb_array_length(r.preview->'rows')then raise exception 'Complete import was not confirmed';end if;
   after_value:=public.bi_csv_targets(p_property_id,r.preview);
   insert into public.marketing_data_uploads(property_id,platform,report_type,file_name,date_range_start,date_range_end,rows_imported,uploaded_by,retained_import_id)values(p_property_id,r.preview->>'platform',r.preview->>'reportType',r.original->>'filename',(r.preview->'dateRange'->>'start')::date,(r.preview->'dateRange'->>'end')::date,rows_count,p_actor_id,r.id);
  end if;
  update public.bi_csv_imports set state=case when op='apply'then'applied'else'discarded'end,target_after=after_value,decided_at=clock_timestamp()where id=r.id;
  result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'importId',r.id,'status',case when op='apply'then'applied'else'discarded'end,'rowsApplied',coalesce(rows_count,0));
 end if;
 insert into public.bi_csv_commands(id,property_id,org_id,actor_id,import_id,input,result)values(p_id,p_property_id,organization,p_actor_id,case when op<>'cancel'then p_import_id end,p_input,result);
 perform public.record_bi_csv_action(p_id,p_actor_id,p_property_id,case op when'apply'then'bi.csv.applied'when'discard'then'bi.csv.discarded'else'bi.csv.request_cancelled'end,p_import_id,jsonb_build_object('status',result->>'status','rowsApplied',coalesce(rows_count,0)));
 return result;
end$$;
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('bi.data.review_saved','bi.data.row_excluded','bi.data.row_restored','bi.data.export_prepared','bi.data.export_reported','bi.data.request_cancelled','bi.csv.preview_saved','bi.csv.applied','bi.csv.discarded','bi.csv.request_cancelled','audit.analysis.requested','audit.analysis.retried','audit.analysis.cancelled','audit.analysis.stopped','audit.analysis.discarded','audit.analysis.resumed','audit.analysis.applied','audit.evaluation.requested','audit.evaluation.cancelled','audit.evaluation.applied','audit.evaluation.discarded','audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'readiness.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid readiness review evidence';end if;
 elsif p_action like 'neighborhood.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid neighborhood review evidence';end if;
 elsif p_action like 'legal.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid legal review evidence';end if;
 elsif p_action like 'checklist.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid checklist evidence';end if;
 elsif p_action like 'property.unit.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid floor-plan evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('organization.setup.completed','property.setup.saved','property.created','property.onboarding.completed') then
  if p_product<>'property' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid property evidence';end if;
 elsif p_action like 'pipeline.%' then
  if p_product<>'pipelines'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid pipeline evidence';end if;
 elsif p_action like 'bi.%' then
  if p_product<>'bi' or(p_action in('bi.export.reported','bi.data.export_reported')and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action not in('bi.export.reported','bi.data.export_reported')and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid BI report evidence';end if;
 elsif p_action like 'site.%' then
  if p_product<>'siteforge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid brief evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.note.%' then
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid internal note evidence';end if;
 elsif p_action='audit.report.reported'then
  if p_product<>'propertyaudit'or p_evidence<>'browser_observed'or p_phase<>'observed'then raise exception 'Invalid report observation';end if;
 elsif p_action like 'audit.%' then
  if p_product<>'propertyaudit'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid audit decision evidence';end if;
 elsif p_action like 'lead.record.%' then
  if p_product<>'tourspark'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid lead record evidence';end if;
 elsif p_action like 'lead.%' then
  if p_product<>'leadpulse' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid scoring evidence';end if;
 elsif p_action like 'brand.%' then
  if p_product<>'brandforge' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid brand evidence';end if;
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
 origin:=case when p_action like 'audit.%'then'console' when p_action like 'bi.%'then'console' when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
revoke all on function public.guard_bi_data_records()from public,anon,authenticated;grant execute on function public.guard_bi_data_records()to service_role;
revoke all on function public.guard_excluded_marketing_fact()from public,anon,authenticated;grant execute on function public.guard_excluded_marketing_fact()to service_role;
revoke all on function public.bi_data_source(uuid,date,date)from public,anon,authenticated;grant execute on function public.bi_data_source(uuid,date,date)to service_role;
revoke all on function public.read_bi_data_review(uuid,uuid,date,date,uuid,uuid,text,integer,text)from public,anon,authenticated;grant execute on function public.read_bi_data_review(uuid,uuid,date,date,uuid,uuid,text,integer,text)to service_role;
revoke all on function public.decide_bi_data_review(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.decide_bi_data_review(uuid,uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
