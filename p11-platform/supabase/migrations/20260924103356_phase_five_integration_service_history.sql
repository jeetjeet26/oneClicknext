-- Record actual managed renewal audit transitions; no historical backfill or provider invocation.
create function public.record_integration_renewal_history()returns trigger language plpgsql security invoker set search_path=''as $$
declare source jsonb:=to_jsonb(new);previous jsonb;category text;connection_id uuid;property_id uuid;organization uuid;episode_id uuid;event_id uuid;before_state jsonb;after_state jsonb;action_name text;existing public.shared_action_episodes;
begin
 if source->>'request_id' is null or source->>'credential_version' is null then return new;end if;
 category:=case tg_table_name when'calendar_token_refreshes'then'calendar'when'email_token_refreshes'then'email'else null end;
 if category is null then raise exception 'Unknown renewal source';end if;
 if category='calendar' then
  connection_id:=(source->>'agent_calendar_id')::uuid;select c.property_id into property_id from public.agent_calendars c where c.id=connection_id;
 else
  connection_id:=(source->>'email_configuration_id')::uuid;select c.property_id into property_id from public.email_configurations c where c.id=connection_id;
 end if;
 if property_id is null then return new;end if;
 select p.org_id into organization from public.properties p where p.id=property_id;
 if organization is null then raise exception 'Renewal property unavailable';end if;
 if tg_op='UPDATE' then previous:=to_jsonb(old);end if;
 if previous is not null then before_state:=jsonb_build_object('state',previous->'refresh_status','credentialVersion',previous->'credential_version','completedVersion',previous->'completed_version','resultRecorded',previous->>'result_hash' is not null);end if;
 after_state:=jsonb_build_object('state',source->'refresh_status','credentialVersion',source->'credential_version','completedVersion',source->'completed_version','resultRecorded',source->>'result_hash' is not null);
 if before_state is not distinct from after_state then return new;end if;
 episode_id:=md5('integration-renewal/'||category||'/'||(source->>'request_id'))::uuid;
 select * into existing from public.shared_action_episodes where id=episode_id;
 if found then
  if(existing.property_id,existing.org_id,existing.service_principal)is distinct from(property_id,organization,'integrations.credential_service'::text)then raise exception 'Renewal history scope changed';end if;
 else
  insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(episode_id,organization,property_id,'integrations.credential_service','workflow');
 end if;
 action_name:=case when previous is null then'integration.credentials.renewal_started'else'integration.credentials.renewal_updated'end;
 event_id:=md5('integration-renewal-event/'||episode_id||'/'||coalesce(before_state::text,'null')||'/'||after_state::text)::uuid;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result)
 values(event_id,episode_id,organization,property_id,'integrations.credential_service','integrations',action_name,'server_confirmed',case when source->>'refresh_status' in('running','success')then'succeeded'else'failed'end,
 jsonb_build_object('kind',category,'connectionId',connection_id,'requestId',source->'request_id','auditId',source->'id'),before_state,after_state,jsonb_build_object('state',source->'refresh_status','resultRecorded',source->>'result_hash' is not null))on conflict(id)do nothing;
 return new;
end;$$;
revoke all on function public.record_integration_renewal_history()from public,anon,authenticated;
grant execute on function public.record_integration_renewal_history()to service_role;
create trigger calendar_renewal_recorded_history after insert or update on public.calendar_token_refreshes for each row execute function public.record_integration_renewal_history();
create trigger email_renewal_recorded_history after insert or update on public.email_token_refreshes for each row execute function public.record_integration_renewal_history();
notify pgrst,'reload schema';
