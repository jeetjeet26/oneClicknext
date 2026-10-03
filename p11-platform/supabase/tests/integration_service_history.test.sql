BEGIN;
create temp table checks(label text);
create function pg_temp.check(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture(kind text)returns jsonb language plpgsql as $$declare p uuid:=gen_random_uuid();c uuid:=gen_random_uuid();actor uuid;identity jsonb;begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 insert into public.properties(id,name,org_id)values(p,'Integration service SQL fixture','22222222-2222-2222-2222-222222222222');
 if kind='calendar'then
  insert into public.agent_calendars(id,property_id,profile_id,provider,account_email,calendar_id,access_token,refresh_token,token_expires_at,sync_enabled,token_status,scopes,provider_metadata)values(c,p,actor,'microsoft','private@fixture.invalid','primary','old-private-access','old-private-refresh',now()-interval'1 minute',true,'healthy',array['User.Read','Calendars.ReadWrite','Mail.Send','Mail.Read'],'{"scopeEvidence":"provider_response"}');
  select public.calendar_credential_identity(ac)into identity from public.agent_calendars ac where id=c;
 else
  insert into public.email_configurations(id,property_id,profile_id,provider,account_email,access_token,refresh_token,token_expires_at,sync_enabled,token_status,scopes,provider_metadata)values(c,p,actor,'microsoft','private@fixture.invalid','old-private-access','old-private-refresh',now()-interval'1 minute',true,'healthy',array['User.Read','Calendars.ReadWrite','Mail.Send','Mail.Read'],'{"scopeEvidence":"provider_response"}');
  select public.email_credential_identity(ac)into identity from public.email_configurations ac where id=c;
 end if;
 return jsonb_build_object('property',p,'connection',c,'actor',actor,'identity',identity,'kind',kind);
end$$;
create function pg_temp.claim(f jsonb,id uuid)returns jsonb language plpgsql as $$declare r jsonb;begin execute format('select public.claim_%s_token_refresh($1,$2,$3,$4,$5,true)',f->>'kind')into r using(f->>'property')::uuid,(f->>'connection')::uuid,1::bigint,f->'identity',id;return r;end$$;
create function pg_temp.finish(f jsonb,id uuid,outcome text,tokens jsonb default null)returns jsonb language plpgsql as $$declare r jsonb;begin execute format('select public.finish_%s_token_refresh($1,$2,$3,$4,$5)',f->>'kind')into r using(f->>'property')::uuid,(f->>'connection')::uuid,id,outcome,tokens;return r;end$$;
do $$declare k text;f jsonb;id uuid;r jsonb;tokens jsonb;n bigint;begin
 tokens:=jsonb_build_object('accessToken','new-private-access','refreshToken','new-private-refresh','expiresAt',now()+interval'1 hour');
 foreach k in array array['calendar','email']loop
  f:=pg_temp.fixture(k);id:=gen_random_uuid();perform pg_temp.check(pg_temp.claim(f,id)->>'state'='claimed',k||': claim retained');
  perform pg_temp.check((select count(*)=1 from public.shared_action_events where property_id=(f->>'property')::uuid and action='integration.credentials.renewal_started'and actor_id is null and service_principal='integrations.credential_service'),k||': actual service starts one recorded attempt');
  perform pg_temp.check(pg_temp.claim(f,id)->>'state'='busy',k||': repeated claim cannot invoke again');
  perform pg_temp.check(pg_temp.finish(f,id,'success',tokens)->>'state'='saved',k||': credential result saved');
  perform pg_temp.check((select count(*)=1 from public.shared_action_events where property_id=(f->>'property')::uuid and action='integration.credentials.renewal_updated'and after_state->>'state'='success'and(after_state->>'resultRecorded')::boolean),k||': result recorded atomically');
  perform pg_temp.check(pg_temp.finish(f,id,'success',tokens)->>'state'='saved',k||': acknowledgement can replay');
  perform pg_temp.check((select count(*)=2 from public.shared_action_events where property_id=(f->>'property')::uuid),k||': exact replay cannot duplicate evidence');
  perform pg_temp.check((select bool_and(actor_id is null and not training_eligible and row_to_json(e)::text not like '%private%' and row_to_json(e)::text not like '%result_hash%')from public.shared_action_events e where property_id=(f->>'property')::uuid),k||': actual principal, no private account/tokens/hash, no training');
  f:=pg_temp.fixture(k);id:=gen_random_uuid();perform pg_temp.claim(f,id);perform pg_temp.finish(f,id,'unconfirmed');
  perform pg_temp.check((select count(*)=1 from public.shared_action_events where property_id=(f->>'property')::uuid and phase='failed'and after_state->>'state'='review'),k||': uncertain response remains visibly held');
  f:=pg_temp.fixture(k);id:=gen_random_uuid();perform pg_temp.claim(f,id);perform pg_temp.finish(f,id,'revoked');
  perform pg_temp.check((select count(*)=1 from public.shared_action_events where property_id=(f->>'property')::uuid and after_state->>'state'='revoked'),k||': actual revocation result recorded');
  f:=pg_temp.fixture(k);id:=gen_random_uuid();perform pg_temp.claim(f,id);
  if k='calendar'then perform public.disconnect_recorded_calendar((f->>'property')::uuid,(f->>'actor')::uuid,gen_random_uuid(),'microsoft');else perform public.disconnect_recorded_email((f->>'property')::uuid,(f->>'actor')::uuid,gen_random_uuid(),'microsoft');end if;
  perform pg_temp.check(pg_temp.finish(f,id,'success',tokens)->>'state'='connection_changed',k||': late result cannot revive removed connection');
  perform pg_temp.check((select count(*)=1 from public.shared_action_events where property_id=(f->>'property')::uuid and after_state->>'state'='superseded'),k||': late held result still has service evidence');
 end loop;
end$$;
create function pg_temp.reject_renewal_event()returns trigger language plpgsql as $$begin if new.action='integration.credentials.renewal_updated'and new.after_state->>'state'='success'then raise exception 'Injected history failure';end if;return new;end$$;
create trigger service_history_fixture_failure before insert on public.shared_action_events for each row execute function pg_temp.reject_renewal_event();
do $$declare k text;f jsonb;id uuid;failed boolean;v bigint;begin
 foreach k in array array['calendar','email']loop
  f:=pg_temp.fixture(k);id:=gen_random_uuid();perform pg_temp.claim(f,id);failed:=false;
  begin perform pg_temp.finish(f,id,'success',jsonb_build_object('accessToken','must-rollback','expiresAt',now()+interval'1 hour'));exception when others then failed:=true;end;
  perform pg_temp.check(failed,k||': history failure rejects result');
  if k='calendar'then select credential_version into v from public.agent_calendars ac where ac.id=(f->>'connection')::uuid;else select credential_version into v from public.email_configurations ec where ec.id=(f->>'connection')::uuid;end if;
  perform pg_temp.check(v=1,k||': credential change rolls back with failed evidence');
  perform pg_temp.check((select count(*)=1 from public.shared_action_events where property_id=(f->>'property')::uuid),k||': original attempt stays intact');
 end loop;
end$$;
drop trigger service_history_fixture_failure on public.shared_action_events;
select count(*)as passed_assertions from checks;
ROLLBACK;
