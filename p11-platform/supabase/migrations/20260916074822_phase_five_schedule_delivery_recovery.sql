-- Local qualification only. Existing ambiguous provider work stays held.
alter table public.tour_schedule_work add column attempts integer not null default 0 check(attempts between 0 and 3);
alter table public.tour_schedule_work add column dispatch jsonb;
alter table public.tour_schedule_work add column completion_token uuid;
alter table public.tour_schedule_work drop constraint tour_schedule_work_state_check;
alter table public.tour_schedule_work add constraint tour_schedule_work_state_check check(state in ('queued','running','completed','review','superseded','skipped'));
update public.tour_schedule_work set attempts=1 where kind in ('calendar','notice_email','notice_sms') and (started_at is not null or state='running');
create table public.tour_schedule_reviews (
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties on delete cascade,
 lead_id uuid not null references public.leads on delete cascade,work_id uuid not null references public.tour_schedule_work on delete cascade,
 actor_id uuid not null,request_id uuid not null,input jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 unique(property_id,request_id)
);
create index tour_schedule_reviews_lead_idx on public.tour_schedule_reviews(lead_id);
create index tour_schedule_reviews_work_idx on public.tour_schedule_reviews(work_id);
alter table public.tour_schedule_reviews enable row level security;
revoke all on public.tour_schedule_reviews from public,anon,authenticated;
grant all on public.tour_schedule_reviews to service_role;
create or replace function public.protect_tour_schedule_review() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and (not exists(select 1 from public.leads where id=old.lead_id) or not exists(select 1 from public.properties where id=old.property_id)) then return old;end if;
 raise exception 'Tour delivery review history is immutable' using errcode='55000';
end; $$;
revoke all on function public.protect_tour_schedule_review() from public,anon,authenticated;
grant execute on function public.protect_tour_schedule_review() to service_role;
drop trigger if exists protect_schedule_review_history on public.tour_schedule_reviews;
create trigger protect_schedule_review_history before update or delete on public.tour_schedule_reviews
 for each row execute function public.protect_tour_schedule_review();

create function public.tour_schedule_delivery_timely(p_id uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare w public.tour_schedule_work;s jsonb;timing jsonb;
begin
 select * into w from public.tour_schedule_work where id=p_id;
 if not found or w.kind not in ('calendar','notice_email','notice_sms') or w.created_at<now()-interval '23 hours' then return false;end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);
 if s is null or (s->>'schedule_version')::integer<>w.schedule_version then return false;end if;
 if w.kind in ('notice_email','notice_sms') and not exists(select 1 from public.leads l where l.id=w.lead_id and l.property_id=w.property_id
  and case when w.kind='notice_email' then nullif(trim(l.email),'')=w.payload->>'email' else nullif(trim(l.phone),'')=w.payload->>'phone' end) then return false;end if;
 if w.payload->>'action'='cancel' then return s->>'status'='cancelled';end if;
 if w.payload->>'action' is distinct from 'reschedule' or s->>'status' not in ('scheduled','confirmed') then return false;end if;
 timing:=public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id);
 return coalesce(timing->>'issue' is null and timing->>'timezone'=w.payload->>'timezone' and (timing->>'startsAt')::timestamptz>now(),false);
end; $$;

create function public.pending_tour_schedule_work(p_limit integer default 10) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id) order by created_at,id),'[]') from (
  select id,created_at from public.tour_schedule_work
  where kind in ('calendar','notice_email','notice_sms') and (state='queued' or (state='running' and (lease_until is null or lease_until<=now())))
  order by created_at,id limit greatest(1,least(coalesce(p_limit,10),20))
 ) due;
$$;
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
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
 origin:=case when p_action='console.page.viewed' then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

create or replace function public.claim_tour_schedule_work(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work; s jsonb;
begin
 select * into w from public.tour_schedule_work where id=p_id;
 if not found then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=p_id for update;
 if w.state='running' and (w.lease_until is null or w.lease_until<=now()) then
  update public.tour_schedule_work set state='review',error_code='delivery_unconfirmed' where id=p_id;return null;
 end if;
 if w.state<>'queued' then return null; end if;
 if w.kind in ('calendar','notice_email','notice_sms') and (w.attempts>=3 or not public.tour_schedule_delivery_timely(w.id)) then
  update public.tour_schedule_work set state='review',error_code=case when w.attempts>=3 then 'attempt_limit' else 'delivery_window_expired' end where id=p_id;return null;
 end if;
 if w.created_at<now()-interval '23 hours' then update public.tour_schedule_work set state='review',error_code='delivery_window_expired' where id=p_id;return null;end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);
 if s is null or (s->>'schedule_version')::integer<>w.schedule_version
  or (w.kind in ('confirmation','reminder_24h','reminder_1h','calendar_reconcile') and s->>'status' not in ('scheduled','confirmed'))
  or (w.kind in ('calendar','notice_email','notice_sms') and s->>'status' not in ('scheduled','confirmed','cancelled')) then
  update public.tour_schedule_work set state='superseded',error_code='schedule_superseded' where id=p_id;return null;
 end if;
 update public.tour_schedule_work set attempts=attempts+case when kind in ('calendar','notice_email','notice_sms') then 1 else 0 end,started_at=null,state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=p_id returning * into w;
 return to_jsonb(w);
end; $$;
create function public.start_tour_schedule_delivery(p_id uuid,p_token uuid,p_dispatch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work;
begin
 select * into w from public.tour_schedule_work where id=p_id;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=p_id and lease_token=p_token and state='running' and lease_until>now() and started_at is null for update;
 if not found or not public.tour_schedule_delivery_timely(p_id) then return null;end if;
 if w.kind in ('notice_email','notice_sms') then
  if jsonb_typeof(p_dispatch) is distinct from 'object' or nullif(trim(p_dispatch->>'body'),'') is null
   or nullif(trim(p_dispatch->>'from'),'') is null or nullif(trim(p_dispatch->>'to'),'') is null
   or (p_dispatch->>'to') is distinct from (case when w.kind='notice_email' then w.payload->>'email' else w.payload->>'phone' end)
   or (w.kind='notice_email' and nullif(trim(p_dispatch->>'subject'),'') is null) then raise exception 'Invalid delivery content';end if;
  if w.dispatch is not null and w.dispatch<>p_dispatch then raise exception 'Delivery content is pinned';end if;
 end if;
 update public.tour_schedule_work set started_at=now(),dispatch=coalesce(dispatch,p_dispatch) where id=p_id returning * into w;
 return to_jsonb(w);
end; $$;
create or replace function public.finish_tour_schedule_work(p_id uuid,p_token uuid,p_receipt jsonb,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work; s jsonb;
begin
 select * into w from public.tour_schedule_work where id=p_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 if exists(select 1 from public.tour_schedule_work where id=p_id and state='completed' and completion_token=p_token and receipt=p_receipt) then return p_success;end if;
 select * into w from public.tour_schedule_work where id=p_id and lease_token=p_token and state in ('running','review') for update;
 if not found then return false; end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);
 if s is null or (s->>'schedule_version')::integer<>w.schedule_version then return false; end if;
 if p_success and w.kind in ('calendar','notice_email','notice_sms') and (w.started_at is null or
  (w.kind in ('notice_email','notice_sms') and nullif(trim(p_receipt->>'messageId'),'') is null)) then raise exception 'Attempt and provider receipt required';end if;
 if p_success and (p_receipt is null or p_receipt='{}') then raise exception 'Delivery receipt is required'; end if;
 if p_success and w.kind='calendar' then
  if nullif(p_receipt->>'eventId','') is null then raise exception 'Calendar receipt is required'; end if;
  if exists(select 1 from public.calendar_events where tour_booking_id=w.tour_id and agent_calendar_id=(w.payload->>'calendarId')::uuid) then
   update public.calendar_events set sync_status='synced',last_synced_at=now() where tour_booking_id=w.tour_id and agent_calendar_id=(w.payload->>'calendarId')::uuid;
  elsif w.payload->>'action'<>'cancel' then
   insert into public.calendar_events(agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,provider_event_link,sync_status,last_synced_at)
   values((w.payload->>'calendarId')::uuid,w.tour_id,p_receipt->>'eventId',p_receipt->>'eventId',p_receipt->>'htmlLink','synced',now());
  end if;
 end if;
 update public.tour_schedule_work set completion_token=case when p_success then p_token else completion_token end,state=case when p_success then 'completed' else 'review' end,receipt=p_receipt,
  error_code=case when p_success then null when started_at is null then 'not_attempted' else 'delivery_unconfirmed' end,
  completed_at=case when p_success then now() end,lease_until=null,lease_token=case when p_success then null else lease_token end where id=p_id;
 if p_success and w.kind in ('confirmation','reminder_24h','reminder_1h') then
  if w.tour_source='tours' then update public.tours set
   confirmation_sent_at=case when w.kind='confirmation' then now() else confirmation_sent_at end,
   reminder_24h_sent_at=case when w.kind='reminder_24h' then now() else reminder_24h_sent_at end,
   reminder_sent_at=case when w.kind='reminder_1h' then now() else reminder_sent_at end where id=w.tour_id and schedule_version=w.schedule_version;
  else update public.tour_bookings set reminder_24h_sent_at=case when w.kind='reminder_24h' then now() else reminder_24h_sent_at end,
   reminder_1h_sent_at=case when w.kind='reminder_1h' then now() else reminder_1h_sent_at end where id=w.tour_id and schedule_version=w.schedule_version; end if;
 end if;
 return true;
end; $$;
create function public.review_tour_schedule_delivery(p_property_id uuid,p_lead_id uuid,p_work_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work;r public.tour_schedule_reviews;input jsonb;before_state jsonb;result jsonb;saved jsonb;
 resolution text:=p_input->>'resolution';provider_id text:=nullif(trim(p_input->>'providerId'),'');next_state text;code text;event_id uuid;provider_receipt jsonb;current_schedule jsonb;
begin
 if p_actor_id is null or p_request_id is null or jsonb_typeof(p_input) is distinct from 'object' or resolution is null or resolution not in ('accepted','not_sent')
  or nullif(trim(p_input->>'reason'),'') is null or length(p_input->>'reason')>2000 or length(provider_id)>300 or (resolution='accepted' and provider_id is null)
  or p_input-array['resolution','reason','providerId']<>'{}' then raise exception 'Invalid delivery review';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into w from public.tour_schedule_work where id=p_work_id and property_id=p_property_id and lead_id=p_lead_id and kind in ('calendar','notice_email','notice_sms') for update;
 if not found then return '{"state":"not_found"}';end if;
 input:=jsonb_build_object('leadId',p_lead_id,'workId',p_work_id,'requestId',p_request_id,'resolution',resolution,'inputHash',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'));
 select * into r from public.tour_schedule_reviews where property_id=p_property_id and request_id=p_request_id;
 if found then
  if (r.work_id,r.actor_id,r.input) is distinct from (p_work_id,p_actor_id,p_input) then return '{"state":"request_conflict"}';end if;
  return r.result||jsonb_build_object('state','replayed','workState',w.state);
 end if;
 if exists(select 1 from public.shared_action_events where id=p_request_id) then return '{"state":"request_conflict"}';end if;
 before_state:=jsonb_build_object('state',w.state,'attempts',w.attempts);
 if w.state='running' and w.lease_until>now() then code:='busy';
 elsif w.state not in ('review','running') then code:='conflict';
 elsif resolution='accepted' and w.started_at is null then code:='not_attempted';
 elsif resolution='accepted' and w.kind='calendar' and nullif(w.payload->>'eventId','') is not null and provider_id<>w.payload->>'eventId' then code:='receipt_conflict';
 else
  if resolution='accepted' then
   provider_receipt:=case when w.kind='calendar' then jsonb_build_object('eventId',provider_id,'cancelled',w.payload->>'action'='cancel') else jsonb_build_object('messageId',provider_id) end;
   current_schedule:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);
   if (current_schedule->>'schedule_version')::integer=w.schedule_version then
    if not public.finish_tour_schedule_work(w.id,w.lease_token,provider_receipt,true) then raise exception 'Receipt could not be saved';end if;
   else
    -- Historical provider acceptance is evidence, never a mutation of the current schedule/calendar binding.
    update public.tour_schedule_work set state='completed',receipt=provider_receipt,completed_at=now(),error_code=null,lease_until=null,completion_token=lease_token,lease_token=null where id=w.id;
   end if;
   next_state:='completed';
  else
   next_state:=case when w.attempts<3 and public.tour_schedule_delivery_timely(w.id) then 'queued' else 'skipped' end;
   update public.tour_schedule_work set state=next_state,lease_token=null,lease_until=null,started_at=null,receipt=null,error_code=case when next_state='skipped' then 'confirmed_not_sent' end where id=w.id;
  end if;
  result:=jsonb_build_object('state','applied','workState',next_state,'reviewRequestId',p_request_id,'actionEventId',p_request_id);
  insert into public.tour_schedule_reviews(property_id,lead_id,work_id,actor_id,request_id,input,result)values(p_property_id,p_lead_id,p_work_id,p_actor_id,p_request_id,p_input,result);
 end if;
 if code is not null then result:=jsonb_build_object('state',code);end if;
 event_id:=case when code is null then p_request_id else md5(p_request_id::text||(input->>'inputHash')||code)::uuid end;
 if not exists(select 1 from public.shared_action_events where id=event_id) then
  saved:=public.append_shared_action_event(event_id,md5('tour/'||w.tour_source||w.tour_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'tourspark','tour.schedule_delivery.reviewed','server_confirmed',case when code is null then 'succeeded' else 'failed' end,input,
   before_state,(select jsonb_build_object('state',state,'attempts',attempts) from public.tour_schedule_work where id=w.id),result||jsonb_build_object('outcomeEvidence','operator_review'));
  if saved->>'state' not in ('recorded','replayed') then raise exception 'Delivery review could not be recorded';end if;
 end if;
 return result||jsonb_build_object('actionEventId',event_id);
end; $$;

revoke all on function public.tour_schedule_delivery_timely(uuid),public.pending_tour_schedule_work(integer),public.start_tour_schedule_delivery(uuid,uuid,jsonb),public.review_tour_schedule_delivery(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tour_schedule_delivery_timely(uuid),public.pending_tour_schedule_work(integer),public.start_tour_schedule_delivery(uuid,uuid,jsonb),public.review_tour_schedule_delivery(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
