begin;
create temp table checks(label text);
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$begin if ok is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture(external boolean default false,caps text[] default array['calendar','email']) returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();actor uuid;request uuid:=gen_random_uuid();invite uuid;ctx jsonb;
begin
 actor:=gen_random_uuid();insert into auth.users(id,email)values(actor,actor::text||'@fixture.invalid');update public.profiles set org_id='22222222-2222-2222-2222-222222222222' where id=actor;
 insert into public.properties(id,name,org_id,settings) values(p,'Authorization outcomes SQL fixture','22222222-2222-2222-2222-222222222222','{"timezone":"UTC"}');
 insert into public.lumaleasing_config(property_id,api_key,timezone)values(p,'fixture-'||p::text,'UTC');
 if external then
  invite:=gen_random_uuid();insert into public.integration_auth_invites(id,property_id,provider,requested_capabilities,token_hash,expires_at,created_by_profile_id) values(invite,p,'google',caps,encode(sha256(convert_to(invite::text,'UTF8')),'hex'),clock_timestamp()+interval '1 hour',actor);
 end if;
 ctx:=jsonb_build_object('propertyId',p,'profileId',case when external then null else actor end,'provider','google','capabilities',caps,'authSource',case when external then 'external_invite' else 'dashboard' end,'inviteId',invite,'tokenHash',case when external then encode(sha256(convert_to(invite::text,'UTF8')),'hex') else null end,'redirectUri','https://app.invalid/callback','requestedScopes',array['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/gmail.modify']);
 perform public.begin_integration_authorization(request,ctx);
 return jsonb_build_object('p',p,'actor',actor,'id',request,'invite',invite,'context',ctx);
end$$;
create function pg_temp.claim(f jsonb) returns jsonb language sql as $$select public.claim_integration_authorization((f->>'id')::uuid,f->'context')$$;
create function pg_temp.grant() returns jsonb language sql as $$select jsonb_build_object('accessToken','fixture-access','refreshToken','fixture-refresh','expiresAt',now()+interval '1 hour','accountEmail','fixture@example.invalid','subject','provider-subject','timezone','UTC','scopes',array['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/gmail.modify'],'scopeEvidence','provider_response')$$;
create function pg_temp.finish(f jsonb,g jsonb default pg_temp.grant()) returns jsonb language sql as $$select public.finish_integration_authorization((f->>'id')::uuid,f->'context',g)$$;

create function pg_temp.close(f jsonb,reason text default 'authorization_denied',owner uuid default null) returns jsonb language sql as $$select public.close_integration_authorization((f->>'id')::uuid,f->'context',reason,owner)$$;
create function pg_temp.connected() returns jsonb language plpgsql as $$declare f jsonb;r uuid:=gen_random_uuid();begin f:=pg_temp.fixture();perform pg_temp.claim(f);perform pg_temp.finish(f);perform public.begin_integration_authorization(r,f->'context');return f||jsonb_build_object('id',r);end$$;

do $$declare f jsonb;r jsonb;owner uuid;event_count integer;prior text;reason text;other_org uuid;failed boolean;
begin
 f:=pg_temp.fixture(true);
 perform pg_temp.check((select count(*)=1 from public.shared_action_events where episode_id=(f->>'id')::uuid),'saving a request immediately records one start');
 perform pg_temp.check((select action='integration.authorization.started' and phase='succeeded' and result->>'state'='request_saved' and request->>'authorizer'='external_account' and not training_eligible and request::text not like '%tokenHash%' and request::text not like '%redirectUri%' and org_id='22222222-2222-2222-2222-222222222222' from public.shared_action_events where episode_id=(f->>'id')::uuid),'start evidence is bounded and has pinned invitation sponsor');
 perform pg_temp.check((select id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from public.shared_action_events where episode_id=(f->>'id')::uuid),'start event identity is valid for strict cursor validation');
 perform pg_temp.check(public.begin_integration_authorization((f->>'id')::uuid,f->'context')->>'state'='ready','same start response can be recovered');
 perform pg_temp.check((select count(*)=1 from public.shared_action_events where episode_id=(f->>'id')::uuid),'start replay emits no duplicate');
 perform pg_temp.check(pg_temp.close(f)->>'state'='authorization_denied','signed pending cancellation closes request');
 r:=pg_temp.close(f);perform pg_temp.check(r->>'requestId'=f->>'id' and r->>'actionEventId'=f->>'id','cancellation returns durable identity');
 perform pg_temp.check((select status='blocked' and finished_at is not null and failure_source='signed_callback' from public.integration_authorizations where id=(f->>'id')::uuid),'cancellation saves terminal state');
 perform pg_temp.check((select count(*)=2 from public.shared_action_events where episode_id=(f->>'id')::uuid),'cancellation replay emits no duplicate terminal event');
 perform pg_temp.check((select action='integration.authorization.cancelled' and phase='failed' and before_state->>'status'='pending' and after_state->>'authorizationChangedConnection'='false' and request->>'authorizer'='external_account' and request->>'decisionSource'='signed_callback' from public.shared_action_events where id=(f->>'id')::uuid),'cancellation action distinguishes external decision from sponsor');
 perform pg_temp.check(pg_temp.claim(f)->>'state'='authorization_denied','cancelled request never exchanges');
 perform pg_temp.check((select consumed_at is null from public.integration_auth_invites where id=(f->>'invite')::uuid),'cancelled request does not consume invitation');
 perform pg_temp.check(not exists(select 1 from public.agent_calendars where property_id=(f->>'p')::uuid),'cancellation creates no connection');
 f:=pg_temp.fixture();
 perform pg_temp.check(public.close_integration_authorization((f->>'id')::uuid,(f->'context')||'{"provider":"microsoft"}','authorization_denied')->>'state'='request_conflict','mismatched provider cannot close request');
 perform pg_temp.check(pg_temp.close(f,'permissions_incomplete')->>'state'='request_conflict','unclaimed request cannot claim exchange failure');
 perform pg_temp.check(pg_temp.close(f,'expired_state')->>'state'='request_conflict','clock drift cannot prematurely expire a database request');
 r:=pg_temp.claim(f);owner:=(r->>'claimToken')::uuid;
 perform pg_temp.check(owner is not null,'exchange claim supplies a private owner token');
 perform pg_temp.check(pg_temp.claim(f)->>'state'='authorization_unconfirmed','duplicate claimant gets no exchange authority');
 perform pg_temp.check(pg_temp.close(f)->>'state'='authorization_unconfirmed','pending denial cannot close active exchange');
 perform pg_temp.check(pg_temp.close(f,'permissions_incomplete',gen_random_uuid())->>'state'='authorization_unconfirmed','wrong owner cannot close active exchange');
 perform pg_temp.check((select status='exchanging' from public.integration_authorizations where id=(f->>'id')::uuid),'non-owner callbacks preserve active claim');
 perform pg_temp.check(pg_temp.close(f,'permissions_incomplete',owner)->>'state'='permissions_incomplete','exchange owner records bounded failure');
 perform pg_temp.check((select request->>'decisionSource'='exchange_owner' and action='integration.authorization.failed' from public.shared_action_events where id=(f->>'id')::uuid),'failure records the exchange owner source');
 perform pg_temp.check(pg_temp.finish(f)->>'state'='permissions_incomplete','late save cannot revive failed authorization');
 perform pg_temp.check((select count(*)=2 from public.shared_action_events where episode_id=(f->>'id')::uuid),'duplicate callbacks retain one start and one outcome');
 foreach reason in array array['provider_exchange_failed','authorization_unconfirmed','permissions_unconfirmed','permissions_incomplete','invalid_token_response','account_unconfirmed','authorization_save_unconfirmed'] loop
  f:=pg_temp.connected();select public.integration_connection_snapshot((f->>'p')::uuid,array['calendar','email']) into prior;
  owner:=(pg_temp.claim(f)->>'claimToken')::uuid;
  perform pg_temp.check(pg_temp.close(f,reason,owner)->>'state'=reason,'records exchange outcome '||reason);
  perform pg_temp.check(prior=public.integration_connection_snapshot((f->>'p')::uuid,array['calendar','email']),'preserves current bindings for '||reason);
  perform pg_temp.check((select access_token='fixture-access' and refresh_token='fixture-refresh' and sync_enabled from public.agent_calendars where property_id=(f->>'p')::uuid),'preserves current credentials for '||reason);
 end loop;
 foreach reason in array array['provider_error','invalid_callback'] loop
  f:=pg_temp.connected();perform pg_temp.check(pg_temp.close(f,reason)->>'state'=reason,'records pending failure '||reason);
 end loop;
 f:=pg_temp.fixture();owner:=(pg_temp.claim(f)->>'claimToken')::uuid;r:=pg_temp.finish(f);
 perform pg_temp.check(pg_temp.close(f,'authorization_save_unconfirmed',owner)->>'state'='replayed','lost save acknowledgement recovers actual completed result');
 perform pg_temp.check(pg_temp.close(f)->>'state'='replayed','late denial cannot overwrite completed result');
 perform pg_temp.check((select status='completed' and result->>'state'='saved' and failure_source is null from public.integration_authorizations where id=(f->>'id')::uuid),'successful outcome stays immutable');
 perform pg_temp.check((select count(*)=2 from public.shared_action_events where episode_id=(f->>'id')::uuid),'success plus late failures still has two lifecycle events');
 perform public.disconnect_recorded_calendar((f->>'p')::uuid,(f->>'actor')::uuid,gen_random_uuid());
 perform pg_temp.check(pg_temp.close(f)->>'state'='connection_changed','old success is not presented as current after disconnection');
 f:=pg_temp.fixture();update public.profiles set org_id=null where id=(f->>'actor')::uuid;
 perform pg_temp.check(pg_temp.claim(f)->>'state'='forbidden','loss of membership blocks before exchange');
 perform pg_temp.check((select org_id='22222222-2222-2222-2222-222222222222' and actor_id=(f->>'actor')::uuid and result->>'state'='forbidden' from public.shared_action_events where id=(f->>'id')::uuid),'membership loss records original origin without granting new authority');
 f:=pg_temp.fixture();owner:=(pg_temp.claim(f)->>'claimToken')::uuid;update public.profiles set org_id=null where id=(f->>'actor')::uuid;
 perform pg_temp.check(pg_temp.finish(f)->>'state'='forbidden','loss of membership blocks finalization with recorded outcome');
 perform pg_temp.check((select status='blocked' from public.integration_authorizations where id=(f->>'id')::uuid),'membership loss does not leave an orphaned exchange');
 f:=pg_temp.fixture();perform pg_temp.claim(f);perform pg_temp.finish(f);update public.profiles set org_id=null where id=(f->>'actor')::uuid;
 perform pg_temp.check(pg_temp.claim(f)->>'state'='forbidden','completed request membership loss cannot return stale saved authority');
 f:=pg_temp.fixture();failed:=false;begin update public.integration_authorizations set org_id=gen_random_uuid() where id=(f->>'id')::uuid;exception when others then failed:=true;end;
 perform pg_temp.check(failed,'saved authorization origin is immutable');
 perform pg_temp.close(f);failed:=false;begin update public.integration_authorizations set status='pending',result=null where id=(f->>'id')::uuid;exception when others then failed:=true;end;
 perform pg_temp.check(failed,'terminal authorization cannot be reopened');
 perform pg_temp.check(not has_function_privilege('authenticated','public.close_integration_authorization(uuid,jsonb,text,uuid)','execute'),'authenticated browser cannot close arbitrary authorization');
 perform pg_temp.check(not has_function_privilege('anon','public.expire_integration_authorizations(integer)','execute'),'anonymous browser cannot run expiry worker');
 perform pg_temp.check(not has_function_privilege('authenticated','public.record_integration_authorization_transition()','execute'),'historical origin writer is private');
end$$;

do $$declare f jsonb;g jsonb;r jsonb;before_count integer;begin
 f:=pg_temp.fixture();g:=pg_temp.fixture();perform pg_temp.claim(g);
 update public.integration_authorizations set expires_at=clock_timestamp()-interval '1 minute' where id in ((f->>'id')::uuid,(g->>'id')::uuid);
 r:=public.expire_integration_authorizations(1);
 perform pg_temp.check(r->>'state'='completed' and r->>'processed'='1' and r->>'remaining'='true','expiry obeys batch limit and exposes remaining work');
 r:=public.expire_integration_authorizations(100);
 perform pg_temp.check(r->>'processed'='1' and r->>'remaining'='false','next expiry sweep closes the remaining expired claim');
 perform pg_temp.check((select count(*)=2 from public.shared_action_events where id in ((f->>'id')::uuid,(g->>'id')::uuid) and result->>'state'='expired_state' and request->>'decisionSource'='expiry_sweep'),'expiry records system outcomes for pending and exchanging requests');
 perform pg_temp.check(pg_temp.finish(g)->>'state'='expired_state','late grant cannot complete after expiry worker');
 perform pg_temp.check(public.expire_integration_authorizations()->>'processed'='0','repeated expiry produces no duplicate outcomes');
 f:=pg_temp.fixture();perform pg_temp.check(public.expire_integration_authorizations()->>'processed'='0','fresh requests survive expiry sweep');
 update public.integration_authorizations set expires_at=clock_timestamp()-interval '1 minute' where id=(f->>'id')::uuid;
 perform pg_temp.check(pg_temp.close(f,'expired_state')->>'state'='expired_state','signed expired callback can close its own saved request');
 perform pg_temp.check((select request->>'decisionSource'='signed_callback' from public.shared_action_events where id=(f->>'id')::uuid),'signed callback expiry is separate from background expiry');
end$$;

create function pg_temp.reject_lifecycle_record() returns trigger language plpgsql as $$begin if new.action in ('integration.authorization.started','integration.authorization.failed','integration.authorization.cancelled') then raise exception 'fixture lifecycle recording failure';end if;return new;end$$;
-- Start transaction must roll back if its event cannot be saved.
create trigger fixture_reject_lifecycle before insert on public.shared_action_events for each row execute function pg_temp.reject_lifecycle_record();
do $$declare f jsonb;r uuid:=gen_random_uuid();failed boolean:=false;begin
 -- fixture creates its own start, so prepare scope with the trigger temporarily disabled.
 alter table public.shared_action_events disable trigger fixture_reject_lifecycle;f:=pg_temp.fixture();alter table public.shared_action_events enable trigger fixture_reject_lifecycle;
 begin perform public.begin_integration_authorization(r,f->'context');exception when others then failed:=true;end;
 perform pg_temp.check(failed,'start recording outage is surfaced');
 perform pg_temp.check(not exists(select 1 from public.integration_authorizations where id=r),'start recording outage rolls back saved request');
 failed:=false;begin perform pg_temp.close(f);exception when others then failed:=true;end;
 perform pg_temp.check(failed,'failure recording outage is surfaced');
 perform pg_temp.check((select status='pending' and result is null and finished_at is null from public.integration_authorizations where id=(f->>'id')::uuid),'failure recording outage rolls back terminal state');
 update public.integration_authorizations set expires_at=clock_timestamp()-interval '1 minute' where id=(f->>'id')::uuid;
 failed:=false;begin perform public.expire_integration_authorizations();exception when others then failed:=true;end;
 perform pg_temp.check(failed,'expiry recording outage is surfaced');
 perform pg_temp.check((select status='pending' from public.integration_authorizations where id=(f->>'id')::uuid),'expiry recording outage leaves work available for later cleanup');
end$$;
drop trigger fixture_reject_lifecycle on public.shared_action_events;
select count(*) as passed from checks;
rollback;
