create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create function public.tour_calendar_binding_context(p_property_id uuid,p_booking_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('bookingId',b.id,'version',b.schedule_version,'status',b.status,'date',b.scheduled_date,'time',b.scheduled_time,'duration',b.duration_minutes,'timezone',b.schedule_timezone,'bindingCount',(select count(*) from public.calendar_events where tour_booking_id=b.id))
 from public.tour_bookings b where b.property_id=p_property_id and b.id=p_booking_id;
$$;
create function public.bind_tour_calendar_event(p_property_id uuid,p_booking_id uuid,p_actor_id uuid,p_request_id uuid,p_version integer,p_calendar_id uuid,p_credential_version bigint,p_provider_event_id text,p_reason text,p_verified_at timestamptz default null,p_remote jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.tour_bookings;c public.agent_calendars;j public.luma_delivery_jobs;prior public.shared_action_events;
 input jsonb;r jsonb;before_state jsonb;after_state jsonb;recorded jsonb;schedule jsonb;code text;event_id uuid;action_id uuid;digest text;
begin
 if p_request_id is null or p_actor_id is null or p_calendar_id is null or p_version is null or p_version<1 or p_credential_version is null or p_credential_version<1
  or p_provider_event_id is null or length(p_provider_event_id) not between 1 and 1024 or p_provider_event_id ~ '[[:space:]]' or nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Invalid calendar binding';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('bookingId',p_booking_id,'requestId',p_request_id,'version',p_version,'calendarId',p_calendar_id,'credentialVersion',p_credential_version,'providerEventId',p_provider_event_id,'reasonHash',encode(sha256(convert_to(trim(p_reason),'UTF8')),'hex'));
 select * into prior from public.shared_action_events where id=p_request_id;
 if found then
  if (prior.property_id,prior.actor_id,prior.action,prior.request) is distinct from (p_property_id,p_actor_id,'tour.calendar_event.bound',input) then return '{"state":"request_conflict"}';end if;
  if not exists(select 1 from public.calendar_events where id=(prior.result->>'eventId')::uuid and tour_booking_id=p_booking_id and agent_calendar_id=p_calendar_id and coalesce(provider_event_id,google_event_id)=p_provider_event_id) then return '{"state":"binding_conflict"}';end if;
  return prior.result||jsonb_build_object('state','replayed','actionEventId',prior.id);
 end if;
 select * into b from public.tour_bookings where property_id=p_property_id and id=p_booking_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into c from public.agent_calendars where property_id=p_property_id and id=p_calendar_id for share;
 if not found then return '{"state":"calendar_unavailable"}';end if;
 before_state:=public.tour_action_snapshot(p_property_id,'tour_bookings',b.id)||jsonb_build_object('calendarStatus',coalesce((select sync_status from public.calendar_events where tour_booking_id=b.id order by id limit 1),'unbound'));
 if b.schedule_version<>p_version then code:='stale';
 elsif b.status is null or b.status not in ('scheduled','confirmed') then code:='conflict';
 elsif b.schedule_timezone is null then code:='needs_timezone';
 elsif c.retired_at is not null or not coalesce(c.sync_enabled,false) or c.token_status is distinct from 'healthy' or public.integration_permission_state(c.provider,'calendar',c.scopes,c.provider_metadata->>'scopeEvidence')<>'confirmed' then code:='calendar_unavailable';
 elsif c.credential_version<>p_credential_version then code:='stale_connection';
 elsif exists(select 1 from public.calendar_events where tour_booking_id=b.id or (agent_calendar_id=c.id and coalesce(provider_event_id,google_event_id)=p_provider_event_id)) then code:='binding_conflict';
 else code:=public.tour_delivery_block(p_property_id,'tour_bookings',b.id);end if;
 if code is null then
  select * into j from public.luma_delivery_jobs where property_id=p_property_id and booking_id=b.id for update;
  if found and (j.schedule_version<>b.schedule_version or j.payload->>'calendarId' is distinct from c.id::text or j.payload->>'providerCalendarId' is distinct from c.calendar_id or j.payload->>'provider' is distinct from c.provider) then code:='delivery_binding_conflict';end if;
 end if;
 if code is null then
  schedule:=public.tour_outcome_schedule(p_property_id,'tour_bookings',b.id);
  if schedule->>'startsAt' is null or (schedule->>'startsAt')::timestamptz<=clock_timestamp() then code:='not_future';
  elsif p_verified_at is null then return '{"state":"verification_required"}';
  elsif p_verified_at>clock_timestamp()+interval '5 seconds' or p_verified_at<clock_timestamp()-interval '60 seconds' then code:='verification_expired';
  elsif jsonb_typeof(p_remote) is distinct from 'object' or length(p_remote::text)>4096 or p_remote-array['id','status','startDateTime','endDateTime']<>'{}'
   or p_remote->>'id' is distinct from p_provider_event_id or coalesce(p_remote->>'status','') not in ('confirmed','tentative') then code:='provider_changed';
  else
   begin
    if (p_remote->>'startDateTime')::timestamptz is distinct from (schedule->>'startsAt')::timestamptz or (p_remote->>'endDateTime')::timestamptz is distinct from (schedule->>'endsAt')::timestamptz then code:='provider_changed';end if;
   exception when invalid_datetime_format or datetime_field_overflow then code:='provider_changed';end;
  end if;
 end if;
 if code is null then
  insert into public.calendar_events(agent_calendar_id,tour_booking_id,provider_event_id,google_event_id,sync_status,last_synced_at,remote_snapshot,observed_schedule_version)
   values(c.id,b.id,p_provider_event_id,p_provider_event_id,'synced',p_verified_at,p_remote,b.schedule_version) returning id into event_id;
  -- A provider event was observed; this is not a new provider-send receipt.
  update public.tour_schedule_work set state='skipped',error_code='existing_calendar_event_bound',receipt=null
   where property_id=p_property_id and tour_source='tour_bookings' and tour_id=b.id and schedule_version=b.schedule_version and kind in ('calendar','calendar_reconcile') and state in ('queued','review') and started_at is null;
  update public.luma_delivery_jobs set calendar_confirmed=true where id=j.id and schedule_version=b.schedule_version;
  r:=jsonb_build_object('state','applied','eventId',event_id,'providerEvidence','existing_event_observed','queued',0,'notificationRequested',false);
 else r:=jsonb_build_object('state',code);end if;
 after_state:=public.tour_action_snapshot(p_property_id,'tour_bookings',b.id)||jsonb_build_object('calendarStatus',coalesce((select sync_status from public.calendar_events where tour_booking_id=b.id order by id limit 1),'unbound'));
 action_id:=p_request_id;
 if code is not null then digest:=md5('calendar-binding/'||p_request_id::text||input::text||code);action_id:=(substr(digest,1,12)||'3'||substr(digest,14,3)||'8'||substr(digest,18))::uuid;end if;
 if not exists(select 1 from public.shared_action_events where id=action_id) then
  recorded:=public.append_shared_action_event(action_id,p_request_id,p_property_id,p_actor_id,'tourspark','tour.calendar_event.bound','server_confirmed',case when code is null then 'succeeded' else 'failed' end,input,before_state,after_state,r||jsonb_build_object('verifiedAt',p_verified_at));
  if recorded->>'state' not in ('recorded','replayed') then raise exception 'Calendar binding could not be recorded';end if;
 end if;
 return r||jsonb_build_object('actionEventId',action_id);
end; $$;
revoke all on function public.tour_calendar_binding_context(uuid,uuid),public.bind_tour_calendar_event(uuid,uuid,uuid,uuid,integer,uuid,bigint,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.tour_calendar_binding_context(uuid,uuid),public.bind_tour_calendar_event(uuid,uuid,uuid,uuid,integer,uuid,bigint,text,text,timestamptz,jsonb) to service_role;
notify pgrst,'reload schema';
