-- Local-only qualification. Configuration, calendars and action evidence commit together.
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
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

create function public.luma_configuration_snapshot(p_property_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('widget',(select jsonb_object_agg(key,value) from public.lumaleasing_config c, lateral jsonb_each(to_jsonb(c)) where c.property_id=p.id and key=any(array['widget_name','primary_color','secondary_color','logo_url','agent_avatar_url','welcome_message','offline_message','auto_popup_delay_seconds','require_email_before_chat','collect_name','collect_email','collect_phone','lead_capture_prompt','floor_plans_url','availability_url','tours_enabled','tour_duration_minutes','tour_buffer_minutes','business_hours','timezone','is_active'])),
  'propertyTimezone',p.settings->'timezone','calendars',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'enabled',c.sync_enabled,'timezone',c.timezone,'duration',c.tour_duration_minutes,'buffer',c.buffer_minutes,'hours',c.working_hours) order by c.id) from public.agent_calendars c where c.property_id=p.id),'[]'))
 from public.properties p where p.id=p_property_id;
$$;

create function public.read_luma_configuration(p_property_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('config',(select to_jsonb(c) from public.lumaleasing_config c where c.property_id=p_property_id),
  'effectiveTimezone',public.tour_booking_context(p_property_id)->'timezone',
  'revision',encode(sha256(convert_to(public.luma_configuration_snapshot(p_property_id)::text,'UTF8')),'hex'));
$$;

create function public.save_recorded_luma_configuration(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_operation text,p_config jsonb,p_expected_revision text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.lumaleasing_config;next_config public.lumaleasing_config;e public.shared_action_events;before_state jsonb;after_state jsonb;input jsonb;result jsonb;saved jsonb;current_revision text;action text;state text:='applied';hours jsonb;zone text;key text;value jsonb;
begin
 if p_actor_id is null or p_request_id is null or p_operation not in ('initialize','save') or jsonb_typeof(p_config) is distinct from 'object' or length(p_config::text)>12000 then raise exception 'Invalid configuration request';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if p_config-array['widget_name','primary_color','secondary_color','logo_url','agent_avatar_url','welcome_message','offline_message','auto_popup_delay_seconds','require_email_before_chat','collect_name','collect_email','collect_phone','lead_capture_prompt','floor_plans_url','availability_url','tours_enabled','tour_duration_minutes','tour_buffer_minutes','business_hours','timezone','is_active']<>'{}' then return '{"state":"invalid_configuration"}';end if;
 if p_operation='initialize' and p_config<>'{}' then return '{"state":"invalid_configuration"}';end if;
 -- Validate independently of the HTTP caller; this private function is the authoritative writer.
 for key,value in select * from jsonb_each(p_config) loop
  if key=any(array['require_email_before_chat','collect_name','collect_email','collect_phone','tours_enabled','is_active']) and jsonb_typeof(value)<>'boolean' then return '{"state":"invalid_configuration"}';end if;
  if key=any(array['widget_name','welcome_message','offline_message','lead_capture_prompt','primary_color','secondary_color','timezone']) and jsonb_typeof(value)<>'string' then return '{"state":"invalid_configuration"}';end if;
  if key=any(array['logo_url','agent_avatar_url','floor_plans_url','availability_url']) and jsonb_typeof(value) not in ('string','null') then return '{"state":"invalid_configuration"}';end if;
  if key=any(array['auto_popup_delay_seconds','tour_duration_minutes','tour_buffer_minutes']) and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$') then return '{"state":"invalid_configuration"}';end if;
 end loop;
 if (p_config->>'tour_duration_minutes')::integer not between 15 and 180 or (p_config->>'tour_buffer_minutes')::integer not between 0 and 60 or (p_config->>'auto_popup_delay_seconds')::integer not between 0 and 300
  or length(p_config->>'widget_name')>100 or length(p_config->>'welcome_message')>500 or length(p_config->>'offline_message')>500 or length(p_config->>'lead_capture_prompt')>500
  or (p_config ? 'primary_color' and p_config->>'primary_color' !~ '^#[0-9A-Fa-f]{6}$') or (p_config ? 'secondary_color' and p_config->>'secondary_color' !~ '^#[0-9A-Fa-f]{6}$') then return '{"state":"invalid_configuration"}';end if;
 if p_config ? 'timezone' and not exists(select 1 from pg_timezone_names where name=p_config->>'timezone') then return '{"state":"invalid_timezone"}';end if;
 if p_config ? 'business_hours' then
  if jsonb_typeof(p_config->'business_hours')<>'object' or (p_config->'business_hours')-array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']<>'{}' then return '{"state":"invalid_hours"}';end if;
  for key,value in select * from jsonb_each(p_config->'business_hours') loop
   if value<>'null'::jsonb and (jsonb_typeof(value)<>'object' or value-array['start','end']<>'{}' or coalesce(value->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(value->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or value->>'start'>=value->>'end') then return '{"state":"invalid_hours"}';end if;
  end loop;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties where id=p_property_id for update;
 perform 1 from public.agent_calendars where property_id=p_property_id order by id for update;
 select * into c from public.lumaleasing_config where property_id=p_property_id for update;
 action:=case when p_operation='initialize' then 'luma.configuration.created' else 'luma.configuration.saved' end;
 input:=jsonb_build_object('operation',p_operation,'configHash',encode(sha256(convert_to(p_config::text,'UTF8')),'hex'),'expectedRevision',p_expected_revision);
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,action,input) then return '{"state":"request_conflict"}';end if;
  return public.read_luma_configuration(p_property_id)||e.result||jsonb_build_object('state',case when e.phase='succeeded' then 'replayed' else e.result->>'state' end,'actionEventId',e.id);
 end if;
 before_state:=public.luma_configuration_snapshot(p_property_id);
 current_revision:=encode(sha256(convert_to(before_state::text,'UTF8')),'hex');
 if p_expected_revision is distinct from current_revision then state:='stale_configuration';
 elsif p_operation='initialize' and c.id is not null then state:='already_configured';
 elsif p_operation='save' and c.id is null then state:='not_configured';
 end if;
 zone:=public.tour_booking_context(p_property_id)->>'timezone';
 if state='applied' and p_config ? 'timezone' and (p_config->>'timezone') is distinct from zone and (
  exists(select 1 from public.tours where property_id=p_property_id and status in ('scheduled','confirmed') and schedule_timezone is null) or
  exists(select 1 from public.tour_bookings where property_id=p_property_id and status in ('scheduled','confirmed') and schedule_timezone is null)) then state:='legacy_timezone_review';end if;
 if state='applied' then
  if p_operation='initialize' then
   insert into public.lumaleasing_config(property_id,api_key,timezone) values(p_property_id,'luma_'||replace(gen_random_uuid()::text,'-',''),zone) returning * into c;
  else
   next_config:=jsonb_populate_record(c,p_config);
   update public.lumaleasing_config set widget_name=next_config.widget_name,primary_color=next_config.primary_color,secondary_color=next_config.secondary_color,logo_url=next_config.logo_url,agent_avatar_url=next_config.agent_avatar_url,welcome_message=next_config.welcome_message,offline_message=next_config.offline_message,auto_popup_delay_seconds=next_config.auto_popup_delay_seconds,require_email_before_chat=next_config.require_email_before_chat,collect_name=next_config.collect_name,collect_email=next_config.collect_email,collect_phone=next_config.collect_phone,lead_capture_prompt=next_config.lead_capture_prompt,floor_plans_url=next_config.floor_plans_url,availability_url=next_config.availability_url,tours_enabled=next_config.tours_enabled,tour_duration_minutes=next_config.tour_duration_minutes,tour_buffer_minutes=next_config.tour_buffer_minutes,business_hours=next_config.business_hours,timezone=next_config.timezone,is_active=next_config.is_active,updated_at=clock_timestamp() where id=c.id returning * into c;
   if p_config ? 'timezone' then update public.properties set settings=coalesce(settings,'{}')||jsonb_build_object('timezone',p_config->>'timezone') where id=p_property_id;end if;
   if p_config ? 'business_hours' then
    select jsonb_object_agg(short,case when p_config->'business_hours'->day is null or p_config->'business_hours'->day='null'::jsonb then '{"start":"00:00","end":"00:00","enabled":false}'::jsonb else (p_config->'business_hours'->day)||'{"enabled":true}'::jsonb end) into hours
    from (values('monday','mon'),('tuesday','tue'),('wednesday','wed'),('thursday','thu'),('friday','fri'),('saturday','sat'),('sunday','sun')) days(day,short);
   end if;
   update public.agent_calendars set timezone=case when p_config ? 'timezone' then c.timezone else timezone end,
    tour_duration_minutes=case when p_config ? 'tour_duration_minutes' then c.tour_duration_minutes else tour_duration_minutes end,
    buffer_minutes=case when p_config ? 'tour_buffer_minutes' then c.tour_buffer_minutes else buffer_minutes end,
    working_hours=case when p_config ? 'business_hours' then hours else working_hours end,updated_at=clock_timestamp()
   where property_id=p_property_id and sync_enabled and p_config ?| array['timezone','tour_duration_minutes','tour_buffer_minutes','business_hours'];
  end if;
 end if;
 after_state:=public.luma_configuration_snapshot(p_property_id);
 result:=jsonb_build_object('state',state,'configurationId',c.id);
 saved:=public.append_shared_action_event(p_request_id,md5('luma-config/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'lumaleasing',action,'server_confirmed',case when state='applied' then 'succeeded' else 'failed' end,input,before_state,after_state,result);
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Configuration decision could not be recorded';end if;
 return public.read_luma_configuration(p_property_id)||result||jsonb_build_object('actionEventId',p_request_id);
end; $$;
revoke all on function public.luma_configuration_snapshot(uuid),public.read_luma_configuration(uuid),public.save_recorded_luma_configuration(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.luma_configuration_snapshot(uuid),public.read_luma_configuration(uuid),public.save_recorded_luma_configuration(uuid,uuid,uuid,text,jsonb,text) to service_role;
notify pgrst,'reload schema';
