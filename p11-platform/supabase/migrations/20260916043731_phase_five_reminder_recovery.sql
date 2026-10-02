-- Phase 5 local reminder recovery. No provider calls or historical backlog replay.
create table if not exists public.tour_reminder_channels (
 id uuid primary key default gen_random_uuid(), work_id uuid not null references public.tour_schedule_work(id) on delete cascade,
 channel text not null check(channel in ('email','sms')), recipient text not null,
 state text not null default 'queued' check(state in ('queued','running','accepted','review','skipped')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 body text, subject text, sender text, provider_id text, error_code text,
 started_at timestamptz, accepted_at timestamptz, unique(work_id,channel)
);
create table if not exists public.tour_reminder_reviews (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties on delete cascade,
 lead_id uuid not null references public.leads on delete cascade, channel_id uuid not null references public.tour_reminder_channels on delete cascade,
 actor_id uuid not null, request_id uuid not null, input jsonb not null, result jsonb not null,
 transaction_id bigint not null default txid_current(), created_at timestamptz not null default now(), unique(property_id,request_id)
);
create index if not exists tour_reminder_reviews_lead_idx on public.tour_reminder_reviews(lead_id);
create index if not exists tour_reminder_reviews_channel_idx on public.tour_reminder_reviews(channel_id);
alter table public.tour_reminder_channels enable row level security;
alter table public.tour_reminder_reviews enable row level security;
revoke all on public.tour_reminder_channels,public.tour_reminder_reviews from public,anon,authenticated;
grant all on public.tour_reminder_channels,public.tour_reminder_reviews to service_role;
drop trigger if exists protect_reminder_review_history on public.tour_reminder_reviews;
create trigger protect_reminder_review_history before update or delete on public.tour_reminder_reviews for each row execute function public.protect_tour_correction_history();

-- Resolve the same explicit timezone as tour outcomes, rejecting gaps and folds.
-- Probe offsets on either side of the date rather than guessing a one-hour DST shift.
create or replace function public.tour_reminder_schedule(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s jsonb; wall timestamp; instant timestamptz; matches integer; tz text;
begin
 s:=public.tour_outcome_schedule(p_property_id,p_source,p_tour_id);
 if s is null then return null;end if;
 tz:=s->>'timezone';
 if tz is null then return s||'{"issue":"needs_timezone"}';end if;
 wall:=(s->>'date')::date+(s->>'time')::time;instant:=wall at time zone tz;
 select count(distinct candidate) into matches from (
  select (wall-((probe at time zone tz)-(probe at time zone 'UTC'))) at time zone 'UTC' candidate
  from (values(instant-interval '2 days'),(instant),(instant+interval '2 days')) x(probe)
 ) y where candidate at time zone tz=wall;
 if matches<>1 then return s||'{"issue":"ambiguous_time"}';end if;
 return s||jsonb_build_object('startsAt',instant,'issue',null);
end; $$;

create or replace function public.tour_reminder_window(p_schedule jsonb,p_kind text,p_now timestamptz default now())
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(p_schedule->>'issue' is null and p_schedule->>'timezone' is not null and
 case p_kind when 'reminder_24h' then (p_schedule->>'startsAt')::timestamptz-p_now between interval '22 hours' and interval '25 hours'
 when 'reminder_1h' then (p_schedule->>'startsAt')::timestamptz-p_now between interval '30 minutes' and interval '90 minutes' else false end,false);
$$;

-- Read-only candidate/count contract; no dependence on the application host timezone.
create or replace function public.pending_tour_reminders(p_property_id uuid default null,p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 with tours as (
  select id,property_id,'tours'::text source,schedule_version,tour_date as scheduled_day,reminder_24h_sent_at,reminder_sent_at as reminder_1h_sent_at
   from public.tours where status in ('scheduled','confirmed') and (p_property_id is null or property_id=p_property_id)
  union all select id,property_id,'tour_bookings',schedule_version,scheduled_date,reminder_24h_sent_at,reminder_1h_sent_at
   from public.tour_bookings where status in ('scheduled','confirmed') and (p_property_id is null or property_id=p_property_id)
 ), schedules as materialized (
  select t.*,public.tour_reminder_schedule(property_id,source,id) schedule from tours t
  where scheduled_day between (now() at time zone 'UTC')::date-1 and (now() at time zone 'UTC')::date+2
 ), due as (
  select s.*,kind from schedules s cross join (values('reminder_24h'),('reminder_1h')) k(kind)
  where public.tour_reminder_window(schedule,kind) and
   case kind when 'reminder_24h' then reminder_24h_sent_at is null else reminder_1h_sent_at is null end
   and not exists(select 1 from public.tour_schedule_work w where w.tour_source=s.source and w.tour_id=s.id and w.schedule_version=s.schedule_version and w.kind=k.kind and w.state in ('completed','review','superseded') and not (w.state='review' and w.error_code='no_recipient' and exists(select 1 from public.leads l where l.id=(s.schedule->>'leadId')::uuid and (nullif(trim(l.email),'') is not null or nullif(trim(l.phone),'') is not null))))
 ), limited as (select * from due order by schedule->>'startsAt',source,id,kind limit greatest(1,least(p_limit,200)))
 select jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('propertyId',property_id,'source',source,'tourId',id,'version',schedule_version,'kind',kind)) from limited),'[]'),
  'reminders24h',(select count(*) from due where kind='reminder_24h'),'reminders1h',(select count(*) from due where kind='reminder_1h'),
  'needsReview',(select count(*) from schedules where schedule->>'issue' is not null),
  'held',(select count(*) from public.tour_schedule_work where kind in ('reminder_24h','reminder_1h') and (p_property_id is null or property_id=p_property_id) and
    (state='review' or (state='running' and lease_until<=now()))));
$$;

create or replace function public.prepare_tour_reminder(p_property_id uuid,p_source text,p_tour_id uuid,p_version integer,p_kind text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; schedule jsonb; w public.tour_schedule_work; l public.leads; property public.properties; claim jsonb;
begin
 if p_kind not in ('reminder_24h','reminder_1h') then raise exception 'Invalid reminder kind';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 s:=public.tour_schedule_row(p_property_id,p_source,p_tour_id);schedule:=public.tour_reminder_schedule(p_property_id,p_source,p_tour_id);
 if s is null or s->>'status' not in ('scheduled','confirmed') or (s->>'schedule_version')::integer<>p_version then return null;end if;
 if not public.tour_reminder_window(schedule,p_kind) then return null;end if;
 if (p_kind='reminder_24h' and s->>'reminder_24h_sent_at' is not null) or (p_kind='reminder_1h' and coalesce(s->>'reminder_1h_sent_at',s->>'reminder_sent_at') is not null) then return null;end if;
 select * into l from public.leads where id=(s->>'lead_id')::uuid and property_id=p_property_id;
 if not found then return null;end if;
 select * into property from public.properties where id=p_property_id;
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
 values(p_property_id,l.id,p_source,p_tour_id,p_version,p_kind,schedule||jsonb_build_object('reminderVersion',2,'firstName',l.first_name,'propertyName',property.name,'address',property.address))
 on conflict(tour_source,tour_id,schedule_version,kind) do nothing;
 select * into w from public.tour_schedule_work where tour_source=p_source and tour_id=p_tour_id and schedule_version=p_version and kind=p_kind for update;
 -- Older grouped attempts need their existing review path; never infer per-channel receipts.
 if w.payload->>'reminderVersion' is distinct from '2' then return null;end if;
 if w.state='review' and w.error_code='no_recipient' and w.started_at is null and (nullif(trim(l.email),'') is not null or nullif(trim(l.phone),'') is not null) then
  update public.tour_schedule_work set state='queued',error_code=null where id=w.id;w.state:='queued';
 end if;
 if w.state='queued' and not exists(select 1 from public.tour_reminder_channels where work_id=w.id) then
  if nullif(trim(l.email),'') is not null then insert into public.tour_reminder_channels(work_id,channel,recipient)values(w.id,'email',l.email) on conflict do nothing;end if;
  if nullif(trim(l.phone),'') is not null then insert into public.tour_reminder_channels(work_id,channel,recipient)values(w.id,'sms',l.phone) on conflict do nothing;end if;
  if not exists(select 1 from public.tour_reminder_channels where work_id=w.id) then
   update public.tour_schedule_work set state='review',error_code='no_recipient' where id=w.id;return null;
  end if;
 end if;
 claim:=public.claim_tour_schedule_work(w.id);
 if claim is null then
  if w.state='running' and w.lease_until<=now() then update public.tour_reminder_channels set state='review',error_code='delivery_unconfirmed' where work_id=w.id and state='running';end if;
  return null;
 end if;
 return claim||jsonb_build_object('channels',(select jsonb_agg(to_jsonb(c) order by channel) from public.tour_reminder_channels c where work_id=w.id));
end; $$;

-- Durable content + sender checkpoint before crossing the provider boundary.
create or replace function public.start_tour_reminder_channel(p_id uuid,p_token uuid,p_body text,p_subject text,p_sender text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.tour_reminder_channels;w public.tour_schedule_work;s jsonb;l public.leads; schedule jsonb;
begin
 select * into c from public.tour_reminder_channels where id=p_id;if not found then return null;end if;
 select * into w from public.tour_schedule_work where id=c.work_id;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=c.work_id for update;
 select * into c from public.tour_reminder_channels where id=p_id for update;
 if w.state<>'running' or w.lease_token is distinct from p_token or w.lease_until<=now() or c.state<>'queued' then return null;end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);schedule:=public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id);
 select * into l from public.leads where id=w.lead_id and property_id=w.property_id;
 if s is null or s->>'status' not in ('scheduled','confirmed') or (s->>'schedule_version')::integer<>w.schedule_version
   or not public.tour_reminder_window(schedule,w.kind) or schedule->>'timezone' is distinct from w.payload->>'timezone'
   or (schedule->>'startsAt')::timestamptz is distinct from (w.payload->>'startsAt')::timestamptz then
  update public.tour_reminder_channels set state='skipped',error_code='reminder_window_changed' where id=p_id;return null;
 end if;
 if c.recipient is distinct from (case c.channel when 'email' then l.email else l.phone end) then
  update public.tour_reminder_channels set state='review',error_code='recipient_changed' where id=p_id;return null;
 end if;
 if c.attempts>=3 or nullif(trim(p_sender),'') is null or nullif(trim(p_body),'') is null or (c.channel='email' and nullif(trim(p_subject),'') is null) then
  update public.tour_reminder_channels set state='review',error_code='configuration_or_retry_limit' where id=p_id;return null;
 end if;
 if c.body is not null and (c.body,c.subject,c.sender) is distinct from (p_body,p_subject,p_sender) then
  update public.tour_reminder_channels set state='review',error_code='message_changed' where id=p_id;return null;
 end if;
 update public.tour_reminder_channels set state='running',body=p_body,subject=p_subject,sender=p_sender,attempts=attempts+1,started_at=now(),error_code=null where id=p_id returning * into c;
 update public.tour_schedule_work set started_at=coalesce(started_at,now()) where id=w.id;
 return to_jsonb(c);
end; $$;

create or replace function public.finish_tour_reminder_channel(p_id uuid,p_token uuid,p_provider_id text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.tour_reminder_channels;w public.tour_schedule_work;
begin
 select * into c from public.tour_reminder_channels where id=p_id;if not found then return false;end if;
 select * into w from public.tour_schedule_work where id=c.work_id;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=c.work_id for update;
 select * into c from public.tour_reminder_channels where id=p_id for update;
 if w.lease_token is distinct from p_token or w.state not in ('running','review') then return false;end if;
 if c.state='accepted' then return coalesce(c.provider_id=p_provider_id,false);end if;
 if c.state not in ('running','review') or c.started_at is null then return false;end if;
 update public.tour_reminder_channels set state=case when nullif(trim(p_provider_id),'') is null then 'review' else 'accepted' end,
  provider_id=nullif(trim(p_provider_id),''),accepted_at=case when nullif(trim(p_provider_id),'') is not null then now() end,
  error_code=case when nullif(trim(p_provider_id),'') is null then 'delivery_unconfirmed' end where id=p_id;
 return true;
end; $$;

-- Aggregate only persisted channel evidence; a partial reminder is never marked sent.
create or replace function public.settle_tour_reminder(p_id uuid,p_token uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work;receipt jsonb;uncertain boolean;queued boolean;
begin
 select * into w from public.tour_schedule_work where id=p_id;if not found then return 'missing';end if;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=p_id for update;
 if w.lease_token is distinct from p_token or w.state not in ('running','review') then return 'stale';end if;
 if exists(select 1 from public.tour_reminder_channels where work_id=p_id and state='running') and w.lease_until>now() then return 'running';end if;
 update public.tour_reminder_channels set state='review',error_code='delivery_unconfirmed' where work_id=p_id and state='running';
 if exists(select 1 from public.tour_reminder_channels where work_id=p_id) and not exists(select 1 from public.tour_reminder_channels where work_id=p_id and state<>'accepted') then
  select jsonb_object_agg(channel,provider_id) into receipt from public.tour_reminder_channels where work_id=p_id;
  if not public.finish_tour_schedule_work(p_id,p_token,receipt,true) then raise exception 'Reminder completion not saved';end if;return 'completed';
 end if;
 uncertain:=exists(select 1 from public.tour_reminder_channels where work_id=p_id and state='review' and started_at is not null);
 queued:=exists(select 1 from public.tour_reminder_channels where work_id=p_id and state='queued');
 update public.tour_schedule_work set state=case when exists(select 1 from public.tour_reminder_channels where work_id=p_id and state='review') then 'review' when queued then 'queued' else 'superseded' end,
  error_code=case when uncertain then 'delivery_unconfirmed' when queued then null else 'reminder_incomplete' end,
  started_at=case when uncertain then started_at else null end,
  lease_until=null,lease_token=case when uncertain then lease_token else null end where id=p_id returning * into w;
 return w.state;
end; $$;

-- Explicit evidence-based operator reconciliation. Does not send anything.
create or replace function public.review_tour_reminder(p_property_id uuid,p_lead_id uuid,p_channel_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.tour_reminder_channels;w public.tour_schedule_work;r public.tour_reminder_reviews;resolution text:=p_input->>'resolution';result jsonb;next_state text;token uuid;
begin
 if p_request_id is null or p_actor_id is null or resolution is null or resolution not in ('accepted','not_sent') or nullif(trim(p_input->>'reason'),'') is null or length(p_input->>'reason')>2000
 or (resolution='accepted' and (nullif(trim(p_input->>'providerId'),'') is null or length(p_input->>'providerId')>300)) then raise exception 'Invalid reminder review';end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into r from public.tour_reminder_reviews where property_id=p_property_id and request_id=p_request_id;
 if found then
  if r.channel_id<>p_channel_id or r.lead_id<>p_lead_id or r.input<>p_input then return '{"state":"request_conflict"}';end if;
  return r.result||jsonb_build_object('state','replayed','channelState',(select state from public.tour_reminder_channels where id=p_channel_id));
 end if;
 select * into c from public.tour_reminder_channels where id=p_channel_id;
 select * into w from public.tour_schedule_work where id=c.work_id and property_id=p_property_id and lead_id=p_lead_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into c from public.tour_reminder_channels where id=p_channel_id for update;
 if w.state='running' and w.lease_until>now() then return '{"state":"busy"}';end if;
 if c.state not in ('review','running') or w.state not in ('review','running') then return '{"state":"conflict"}';end if;
 if resolution='accepted' and c.started_at is null then return '{"state":"not_attempted"}';end if;
 next_state:=case when resolution='accepted' then 'accepted'
  when c.attempts<3 and w.created_at>now()-interval '23 hours' and public.tour_reminder_window(public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id),w.kind)
    and (public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id)->>'schedule_version')::integer=w.schedule_version
    and public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id)->>'status' in ('scheduled','confirmed')
    and exists(select 1 from public.leads l where l.id=w.lead_id and c.recipient=(case c.channel when 'email' then l.email else l.phone end)) then 'queued' else 'skipped' end;
 update public.tour_reminder_channels set state=next_state,provider_id=case when next_state='accepted' then trim(p_input->>'providerId') end,
  accepted_at=case when next_state='accepted' then now() end,error_code=null,
  started_at=case when next_state='accepted' then started_at end where id=p_channel_id;
 -- Rotate ownership so an old sender cannot overwrite the operator's decision.
 token:=gen_random_uuid();update public.tour_schedule_work set state='review',lease_token=token,lease_until=null where id=w.id;
 perform public.settle_tour_reminder(w.id,token);
 result:=jsonb_build_object('state','applied','channelState',next_state);
 insert into public.tour_reminder_reviews(property_id,lead_id,channel_id,actor_id,request_id,input,result)
 values(p_property_id,p_lead_id,p_channel_id,p_actor_id,p_request_id,p_input,result);
 return result;
end; $$;

revoke all on function public.tour_reminder_schedule(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.tour_reminder_schedule(uuid,text,uuid) to service_role;

revoke all on function public.tour_reminder_window(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.tour_reminder_window(jsonb,text,timestamptz) to service_role;

revoke all on function public.pending_tour_reminders(uuid,integer) from public,anon,authenticated;
grant execute on function public.pending_tour_reminders(uuid,integer) to service_role;

revoke all on function public.prepare_tour_reminder(uuid,text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.prepare_tour_reminder(uuid,text,uuid,integer,text) to service_role;

revoke all on function public.start_tour_reminder_channel(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.start_tour_reminder_channel(uuid,uuid,text,text,text) to service_role;

revoke all on function public.finish_tour_reminder_channel(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_tour_reminder_channel(uuid,uuid,text) to service_role;

revoke all on function public.settle_tour_reminder(uuid,uuid) from public,anon,authenticated;
grant execute on function public.settle_tour_reminder(uuid,uuid) to service_role;

revoke all on function public.review_tour_reminder(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.review_tour_reminder(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;

-- An old grouped sender must not bypass the per-channel checkpoint contract.
create or replace function public.claim_tour_legacy_delivery(p_property_id uuid,p_source text,p_tour_id uuid,p_version integer,p_kind text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s jsonb; work_id uuid; result jsonb;
begin
 if p_kind not in ('confirmation','reminder_24h','reminder_1h','calendar_reconcile') then raise exception 'Invalid delivery kind'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if exists(select 1 from public.tour_schedule_work where tour_source=p_source and tour_id=p_tour_id and schedule_version=p_version and kind=p_kind and payload->>'reminderVersion'='2') then return null;end if;
 s:=public.tour_schedule_row(p_property_id,p_source,p_tour_id);
 if s is null or s->>'status' not in ('scheduled','confirmed') or (s->>'schedule_version')::integer<>p_version then return null; end if;
 if p_kind='calendar_reconcile' and (p_version>1 or exists(select 1 from public.luma_delivery_jobs where booking_id=p_tour_id)) then return null;end if;
 if p_kind='confirmation' and s->>'confirmation_sent_at' is not null then return null; end if;
 if p_kind='reminder_24h' and s->>'reminder_24h_sent_at' is not null then return null; end if;
 if p_kind='reminder_1h' and coalesce(s->>'reminder_1h_sent_at',s->>'reminder_sent_at') is not null then return null; end if;
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
 values(p_property_id,(s->>'lead_id')::uuid,p_source,p_tour_id,p_version,p_kind,s) on conflict(tour_source,tour_id,schedule_version,kind) do nothing;
 select id into work_id from public.tour_schedule_work where tour_source=p_source and tour_id=p_tour_id and schedule_version=p_version and kind=p_kind;
 result:=public.claim_tour_schedule_work(work_id);
 if result is not null then update public.tour_schedule_work set started_at=now() where id=work_id; end if;
 return result;
end; $$;


-- Recover persisted receipts and abandoned claims without contacting any provider.
create or replace function public.recover_tour_reminders(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work;token uuid;n integer:=0;
begin
 for w in select * from public.tour_schedule_work where payload->>'reminderVersion'='2'
  and ((state='running' and lease_until<=now()) or (state='queued' and not public.tour_reminder_window(public.tour_reminder_schedule(property_id,tour_source,tour_id),kind)))
  order by created_at,id limit greatest(1,least(p_limit,200)) loop
  perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
  select * into w from public.tour_schedule_work where id=w.id for update;
  if (w.state='running' and w.lease_until<=now()) or (w.state='queued' and not public.tour_reminder_window(public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id),w.kind)) then
   token:=coalesce(w.lease_token,gen_random_uuid());
   update public.tour_schedule_work set state='running',lease_token=token,lease_until=now()-interval '1 second' where id=w.id;
   if not public.tour_reminder_window(public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id),w.kind) then
    update public.tour_reminder_channels set state='skipped',error_code='reminder_window_closed' where work_id=w.id and state='queued';
   end if;
   perform public.settle_tour_reminder(w.id,token);n:=n+1;
  end if;
 end loop;
 return n;
end; $$;
revoke all on function public.recover_tour_reminders(integer) from public,anon,authenticated;
grant execute on function public.recover_tour_reminders(integer) to service_role;
