create table public.luma_widget_commands(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.luma_widget_assets(property_id uuid primary key references public.properties(id)on delete cascade,asset_id uuid not null references public.content_assets(id),asset_revision integer not null,content_hash text not null,file_url text not null,command_id uuid not null references public.luma_widget_commands(id)on delete cascade deferrable initially deferred,updated_at timestamptz not null default clock_timestamp());
create index luma_widget_commands_history on public.luma_widget_commands(property_id,created_at desc,id desc);create index luma_widget_commands_org on public.luma_widget_commands(org_id);create index luma_widget_commands_actor on public.luma_widget_commands(actor_id);create index luma_widget_assets_asset on public.luma_widget_assets(asset_id);create index luma_widget_assets_command on public.luma_widget_assets(command_id);
alter table public.luma_widget_commands enable row level security;alter table public.luma_widget_assets enable row level security;
revoke all on public.luma_widget_commands,public.luma_widget_assets from anon,authenticated;grant all on public.luma_widget_commands,public.luma_widget_assets to service_role;
create function public.guard_luma_widget_records()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  if tg_table_name='luma_widget_assets'and current_setting('p11.luma_widget_scope',true)=old.property_id::text then return old;end if;
  raise exception 'Retained widget decisions cannot be deleted';
 end if;
 if current_setting('p11.luma_widget_scope',true)is distinct from new.property_id::text then raise exception 'Recorded widget decision required';end if;
 if tg_op='UPDATE'and tg_table_name='luma_widget_commands'then raise exception 'Widget decisions are immutable';end if;return new;
end$$;
create trigger recorded_luma_widget_command before insert or update or delete on public.luma_widget_commands for each row execute function public.guard_luma_widget_records();
create trigger recorded_luma_widget_asset before insert or update or delete on public.luma_widget_assets for each row execute function public.guard_luma_widget_records();
create function public.guard_luma_widget_key()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if new.api_key is distinct from old.api_key and current_setting('p11.luma_widget_scope',true)is distinct from new.property_id::text then raise exception 'Use the recorded widget-key replacement decision';end if;return new;
end$$;
create trigger recorded_luma_widget_key before update on public.lumaleasing_config for each row execute function public.guard_luma_widget_key();

create function public.luma_widget_logo(p_property_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('url',case when b.property_id is null or b.file_url is distinct from c.logo_url then c.logo_url when a.property_id=c.property_id and a.approval_status='approved'and a.archived_at is null and a.duplicate_of is null and a.content_hash=b.content_hash and a.file_url=b.file_url then c.logo_url else null end,'managed',b.property_id is not null and b.file_url is not distinct from c.logo_url,'assetId',case when b.file_url is not distinct from c.logo_url then b.asset_id end,'selectedRevision',case when b.file_url is not distinct from c.logo_url then b.asset_revision end,'currentRevision',a.governance_revision,'approval',a.approval_status,'archived',a.archived_at is not null)
 from public.lumaleasing_config c left join public.luma_widget_assets b on b.property_id=c.property_id left join public.content_assets a on a.id=b.asset_id where c.property_id=p_property_id;
$$;

create function public.read_luma_widget_operations(p_actor_id uuid,p_property_id uuid,p_command_id uuid default null,p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare role_name text;cfg public.lumaleasing_config;saved_command public.luma_widget_commands;all_items jsonb;items jsonb;hash text;key_version text;
begin
 select u.role into role_name from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then return'{"state":"invalid_input"}';end if;
 select*into cfg from public.lumaleasing_config where property_id=p_property_id;if not found then return'{"state":"not_configured"}';end if;key_version:=encode(sha256(convert_to(cfg.api_key,'UTF8')),'hex');
 if p_command_id is not null then select*into saved_command from public.luma_widget_commands where id=p_command_id and property_id=p_property_id and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return saved_command.result||jsonb_build_object('isCurrent',saved_command.result->>'keyVersion'=key_version);end if;
 select coalesce(jsonb_agg((to_jsonb(w)-array['before_state','after_state','result'])||jsonb_build_object('before',w.before_state,'after',w.after_state,'result',w.result-array['artifact','isCurrent'])order by w.created_at desc,w.id desc),'[]')into all_items from public.luma_widget_commands w where w.property_id=p_property_id;
 hash:=public.knowledge_hash(all_items);if p_hash is not null and p_hash is distinct from hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]')into items from jsonb_array_elements(all_items)with ordinality q(value,ordinal)where ordinal>p_offset and ordinal<=p_offset+25;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canManage',role_name in('admin','manager'),'keyVersion',key_version,'configurationRevision',public.read_luma_configuration(p_property_id)->>'revision','logo',public.luma_widget_logo(p_property_id),'items',items,'count',jsonb_array_length(all_items),'offset',p_offset,'hash',hash,'complete',true);
end$$;

create function public.decide_luma_widget_operation(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;role_name text;op text:=p_input->>'operation';cfg public.lumaleasing_config;saved_command public.luma_widget_commands;asset public.content_assets;before_value jsonb;after_value jsonb;result jsonb;event jsonb;action text;key_version text;artifact text;origin text;source jsonb;
begin
 select p.org_id,u.role into organization,role_name from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or op is null or op not in('rotate','logo','clear_logo','prepare','report','cancel')then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,985));select*into saved_command from public.luma_widget_commands where id=p_id;
 if found then if(saved_command.actor_id,saved_command.property_id)is distinct from(p_actor_id,p_property_id)then return'{"state":"request_conflict"}';end if;if saved_command.input->>'operation'<>'cancel'and op<>'cancel'and saved_command.input is distinct from p_input then return'{"state":"request_conflict"}';end if;if saved_command.input->>'operation'='prepare'then return saved_command.result||jsonb_build_object('isCurrent',exists(select 1 from public.lumaleasing_config current_cfg where current_cfg.property_id=p_property_id and encode(sha256(convert_to(current_cfg.api_key,'UTF8')),'hex')=saved_command.result->>'keyVersion'));end if;return saved_command.result;end if;
 if op in('rotate','logo','clear_logo')and role_name not in('admin','manager')then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));perform set_config('p11.luma_widget_scope',p_property_id::text,true);
 select*into cfg from public.lumaleasing_config where property_id=p_property_id for update;
 if op<>'cancel'and cfg.id is null then return'{"state":"not_configured"}';end if;
 key_version:=encode(sha256(convert_to(cfg.api_key,'UTF8')),'hex');
 if op='cancel'then result:=jsonb_build_object('status','cancelled');action:='luma.widget.request_cancelled';
 elsif op='rotate'then
  if p_input->>'keyVersion'is distinct from key_version then return'{"state":"source_changed"}';end if;
  if p_input->'replaceInstalledKey'is distinct from'true'::jsonb or length(btrim(coalesce(p_input->>'reason','')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
  before_value:=jsonb_build_object('keyVersion',key_version);update public.lumaleasing_config set api_key='luma_'||encode(extensions.gen_random_bytes(32),'hex'),updated_at=clock_timestamp()where id=cfg.id returning*into cfg;
  key_version:=encode(sha256(convert_to(cfg.api_key,'UTF8')),'hex');after_value:=jsonb_build_object('keyVersion',key_version);result:=jsonb_build_object('status','key_replaced','keyVersion',key_version);action:='luma.widget.key_rotated';
 elsif op in('logo','clear_logo')then
  if p_input->>'configurationRevision'is distinct from public.read_luma_configuration(p_property_id)->>'revision'then return'{"state":"source_changed"}';end if;
  if length(btrim(coalesce(p_input->>'reason','')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
  before_value:=jsonb_build_object('logoUrl',cfg.logo_url,'binding',(select to_jsonb(b)from public.luma_widget_assets b where b.property_id=p_property_id));
  if op='logo'then
   select*into asset from public.content_assets where id=(p_input->>'assetId')::uuid and property_id=p_property_id for share;
   if not found or asset.asset_type not in('image','gif')or asset.approval_status<>'approved'or asset.archived_at is not null or asset.duplicate_of is not null or asset.content_hash is null or asset.governance_revision is distinct from(p_input->>'assetRevision')::integer or asset.content_hash is distinct from p_input->>'contentHash'then return'{"state":"asset_changed"}';end if;
   update public.lumaleasing_config set logo_url=asset.file_url,updated_at=clock_timestamp()where id=cfg.id;
   insert into public.luma_widget_assets(property_id,asset_id,asset_revision,content_hash,file_url,command_id)values(p_property_id,asset.id,asset.governance_revision,asset.content_hash,asset.file_url,p_id)on conflict(property_id)do update set asset_id=excluded.asset_id,asset_revision=excluded.asset_revision,content_hash=excluded.content_hash,file_url=excluded.file_url,command_id=excluded.command_id,updated_at=clock_timestamp();
   after_value:=jsonb_build_object('logoUrl',asset.file_url,'asset',to_jsonb(asset));result:=jsonb_build_object('status','logo_selected','assetId',asset.id);action:='luma.widget.logo_selected';
  else update public.lumaleasing_config set logo_url=null,updated_at=clock_timestamp()where id=cfg.id;delete from public.luma_widget_assets where property_id=p_property_id;after_value:='{"logoUrl":null}';result:='{"status":"logo_cleared"}';action:='luma.widget.logo_cleared';end if;
 elsif op='prepare'then
  if p_input->>'keyVersion'is distinct from key_version then return'{"state":"source_changed"}';end if;
  origin:=p_input->>'origin';if p_input->>'kind'not in('key','embed')or p_input->>'kind'is null or origin is null or length(origin)>255 or origin!~'^https?://[A-Za-z0-9.:-]+$'then return'{"state":"invalid_input"}';end if;
  if p_input->>'kind'='key'then artifact:=cfg.api_key;
  else artifact:='<!-- LumaLeasing Widget -->'||chr(10)||'<script>'||chr(10)||'  window.LUMALEASING_API_BASE = '||to_jsonb(origin)::text||';'||chr(10)||'  (function(w,d,s,o,f,js,fjs){'||chr(10)||'    w["LumaLeasing"]=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};'||chr(10)||'    js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];'||chr(10)||'    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);'||chr(10)||'  }(window,document,"script","lumaleasing",'||to_jsonb(origin||'/lumaleasing.js')::text||'));'||chr(10)||'  lumaleasing("init", '||replace(to_jsonb(cfg.api_key)::text,'<','\u003c')||');'||chr(10)||'</script>';end if;
  result:=jsonb_build_object('status','installation_prepared','artifact',artifact,'artifactHash',encode(sha256(convert_to(artifact,'UTF8')),'hex'),'kind',p_input->>'kind','keyVersion',key_version,'isCurrent',true);action:='luma.widget.installation_prepared';
 else
  select*into saved_command from public.luma_widget_commands where id=(p_input->>'preparationId')::uuid and actor_id=p_actor_id and property_id=p_property_id and input->>'operation'='prepare';
  if not found or p_input->>'artifactHash'is distinct from saved_command.result->>'artifactHash'or p_input->>'outcome'not in('copied','download_initiated','failed')or p_input->>'outcome'is null then return'{"state":"invalid_input"}';end if;
  result:=jsonb_build_object('status','reported','outcome',p_input->>'outcome','preparationId',saved_command.id);action:='luma.widget.installation_reported';
 end if;
 result:=result||jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id);
 insert into public.luma_widget_commands(id,property_id,org_id,actor_id,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,p_input,before_value,after_value,result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'lumaleasing',action,case when op='report'then'browser_observed'else'server_confirmed'end,case when op='report'then'observed'else'succeeded'end,jsonb_build_object('commandId',p_id),null,null,result-array['artifact','artifactHash','keyVersion','isCurrent']);
 if event->>'state'not in('recorded','replayed')then raise exception 'Widget decision recording failed';end if;return result;
exception when invalid_text_representation or numeric_value_out_of_range then return'{"state":"invalid_input"}';
end$$;

create or replace function public.luma_configuration_snapshot(p_property_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('managedLogo',public.luma_widget_logo(p_property_id),'widget',(select jsonb_object_agg(key,value) from public.lumaleasing_config c, lateral jsonb_each(to_jsonb(c)) where c.property_id=p.id and key=any(array['widget_name','primary_color','secondary_color','logo_url','agent_avatar_url','welcome_message','offline_message','auto_popup_delay_seconds','require_email_before_chat','collect_name','collect_email','collect_phone','lead_capture_prompt','floor_plans_url','availability_url','tours_enabled','tour_duration_minutes','tour_buffer_minutes','business_hours','timezone','is_active'])),
  'propertyTimezone',p.settings->'timezone','calendars',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'enabled',c.sync_enabled,'timezone',c.timezone,'duration',c.tour_duration_minutes,'buffer',c.buffer_minutes,'hours',c.working_hours) order by c.id) from public.agent_calendars c where c.property_id=p.id),'[]'))
 from public.properties p where p.id=p_property_id;
$$;
create or replace function public.save_recorded_luma_configuration(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_operation text,p_config jsonb,p_expected_revision text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.lumaleasing_config;next_config public.lumaleasing_config;e public.shared_action_events;before_state jsonb;after_state jsonb;input jsonb;result jsonb;saved jsonb;current_revision text;action text;state text:='applied';hours jsonb;zone text;key text;value jsonb;
begin
 if p_actor_id is null or p_request_id is null or p_operation not in ('initialize','save') or jsonb_typeof(p_config) is distinct from 'object' or length(p_config::text)>12000 then raise exception 'Invalid configuration request';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
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
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('luma.widget.key_rotated','luma.widget.logo_selected','luma.widget.logo_cleared','luma.widget.installation_prepared','luma.widget.installation_reported','luma.widget.request_cancelled','bi.data.review_saved','bi.data.row_excluded','bi.data.row_restored','bi.data.export_prepared','bi.data.export_reported','bi.data.request_cancelled','bi.csv.preview_saved','bi.csv.applied','bi.csv.discarded','bi.csv.request_cancelled','audit.analysis.requested','audit.analysis.retried','audit.analysis.cancelled','audit.analysis.stopped','audit.analysis.discarded','audit.analysis.resumed','audit.analysis.applied','audit.evaluation.requested','audit.evaluation.cancelled','audit.evaluation.applied','audit.evaluation.discarded','audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action like 'luma.widget.%'then
  if p_product<>'lumaleasing'or(p_action='luma.widget.installation_reported'and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action<>'luma.widget.installation_reported'and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid widget decision evidence';end if;
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
 origin:=case when p_action like 'luma.widget.%'then'console'when p_action like 'audit.%'then'console' when p_action like 'bi.%'then'console' when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
revoke all on function public.guard_luma_widget_records()from public,anon,authenticated;grant execute on function public.guard_luma_widget_records()to service_role;
revoke all on function public.guard_luma_widget_key()from public,anon,authenticated;grant execute on function public.guard_luma_widget_key()to service_role;
revoke all on function public.luma_widget_logo(uuid)from public,anon,authenticated;grant execute on function public.luma_widget_logo(uuid)to service_role;
revoke all on function public.read_luma_widget_operations(uuid,uuid,uuid,integer,text)from public,anon,authenticated;grant execute on function public.read_luma_widget_operations(uuid,uuid,uuid,integer,text)to service_role;
revoke all on function public.decide_luma_widget_operation(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.decide_luma_widget_operation(uuid,uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
