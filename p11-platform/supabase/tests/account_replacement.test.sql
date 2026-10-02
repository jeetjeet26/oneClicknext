begin;
create temp table checks(label text);
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$begin if ok is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture(external boolean default false,caps text[] default array['calendar','email']) returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();actor uuid;request uuid:=gen_random_uuid();invite uuid;ctx jsonb;
begin
 actor:=gen_random_uuid();insert into auth.users(id,email)values(actor,actor::text||'@fixture.invalid');update public.profiles set org_id='22222222-2222-2222-2222-222222222222' where id=actor;
 insert into public.properties(id,name,org_id,settings) values(p,'Authorization SQL fixture','22222222-2222-2222-2222-222222222222','{"timezone":"UTC"}');
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

create function pg_temp.connected(cap text default 'email') returns jsonb language plpgsql as $$
declare f jsonb;r jsonb;
begin
 f:=pg_temp.fixture(false,array[cap]);perform pg_temp.claim(f);r:=pg_temp.finish(f);
 return f||jsonb_build_object('cap',cap,'old',case when cap='email' then r->>'emailConfigId' else r->>'calendarId' end);
end$$;
create function pg_temp.decision(f jsonb,provider text default 'google',account text default 'replacement@example.invalid') returns jsonb language plpgsql as $$
declare r jsonb;request uuid:=gen_random_uuid();
begin
 r:=public.integration_replacement_review((f->>'p')::uuid,(f->>'actor')::uuid,f->>'cap');
 return public.request_recorded_integration_replacement((f->>'p')::uuid,(f->>'actor')::uuid,request,f->>'cap',provider,account,r->>'revision')||jsonb_build_object('revision',r->>'revision','provider',provider);
end$$;
create function pg_temp.authorize(f jsonb,d jsonb) returns jsonb language plpgsql as $$
declare ctx jsonb;request uuid:=gen_random_uuid();r jsonb;
begin
 ctx:=(f->'context')||jsonb_build_object('replacementId',d->>'replacementId','provider',d->>'provider');
 r:=public.begin_integration_authorization(request,ctx);
 perform pg_temp.check(r->>'state'='ready','reviewed replacement begins');
 return f||jsonb_build_object('context',ctx,'id',request);
end$$;
create function pg_temp.new_grant() returns jsonb language sql as $$select pg_temp.grant()||'{"accountEmail":"replacement@example.invalid","subject":"replacement-subject"}'::jsonb$$;

do $$declare f jsonb;d jsonb;r jsonb;review jsonb;next jsonb;g jsonb;thread uuid;event uuid;new_id uuid;decision_id uuid;before_version bigint;failed boolean;
begin
 f:=pg_temp.connected();
 perform pg_temp.check(public.integration_replacement_review((f->>'p')::uuid,gen_random_uuid(),'email')->>'state'='forbidden','review enforces property membership');
 review:=public.integration_replacement_review((f->>'p')::uuid,(f->>'actor')::uuid,'email');
 perform pg_temp.check(review->'blockers'='[]' and review->>'historyCount'='0','single mailbox without linked work is reviewable');
 perform pg_temp.check(review::text not like '%fixture-access%' and review::text not like '%fixture-refresh%' and review::text not like '%provider-subject%','review contains no credential or subject');
 perform pg_temp.check(pg_temp.decision(f,'google','fixture@example.invalid')->>'state'='use_reconnect','same account renewal is not replacement');
 insert into public.email_threads(email_configuration_id,property_id,gmail_thread_id,provider_thread_id,status) values((f->>'old')::uuid,(f->>'p')::uuid,'old-thread','old-thread','awaiting_internal_reply') returning id into thread;
 r:=pg_temp.decision(f);
 perform pg_temp.check(r->>'state'='linked_work_requires_review','unresolved thread blocks replacement');
 perform pg_temp.check((select phase='failed' from public.shared_action_events where id=(r->>'actionEventId')::uuid),'blocked decision is recorded');
 update public.email_threads set status='resolved' where id=thread;
 insert into public.email_messages(email_thread_id,gmail_message_id,provider_message_id,direction,from_email,to_emails)values(thread,'old-message','old-message','inbound','lead@example.invalid',array['fixture@example.invalid']);
 d:=pg_temp.decision(f);decision_id:=(d->>'replacementId')::uuid;
 perform pg_temp.check(d->>'state'='ready','resolved history permits replacement');
 perform pg_temp.check((select before_state::text not like '%@%' and request::text not like '%@%' from public.shared_action_events where id=decision_id),'shared replacement evidence excludes account addresses');
 r:=public.request_recorded_integration_replacement((f->>'p')::uuid,(f->>'actor')::uuid,decision_id,'email','google','replacement@example.invalid',d->>'revision');
 perform pg_temp.check(r->>'state'='replayed' and r->>'expiresAt'=d->>'expiresAt','lost decision response recovers without extending authority');
 perform pg_temp.check(public.request_recorded_integration_replacement((f->>'p')::uuid,(f->>'actor')::uuid,decision_id,'email','google','other@example.invalid',d->>'revision')->>'state'='request_conflict','decision cannot change target under same identity');
 next:=pg_temp.authorize(f,d);perform pg_temp.check(pg_temp.claim(next)->>'state'='claimed','one authorized code exchange');
 g:=pg_temp.new_grant();r:=pg_temp.finish(next,g);new_id:=(r->>'emailConfigId')::uuid;
 perform pg_temp.check(r->>'state'='saved' and new_id<>(f->>'old')::uuid,'replacement saves a new mailbox identity');
 perform pg_temp.check((select retired_at is not null and replacement_id=decision_id and not sync_enabled and access_token is null and refresh_token is null and account_email='fixture@example.invalid' from public.email_configurations where id=(f->>'old')::uuid),'old mailbox identity retained without usable tokens');
 perform pg_temp.check((select email_configuration_id=(f->>'old')::uuid from public.email_threads where id=thread),'old thread stays attached to original mailbox');
 failed:=false;begin update public.email_threads set email_configuration_id=new_id where id=thread;exception when others then failed:=true;end;perform pg_temp.check(failed,'retired mailbox history cannot be moved under a new account');
 perform pg_temp.check((select email_enabled and email_configuration_id=new_id from public.lumaleasing_config where property_id=(f->>'p')::uuid),'future email binding switches atomically');
 perform pg_temp.check((select action='integration.account.replaced' and phase='succeeded' and not training_eligible and after_state->>'retiredEmailConfigId'=f->>'old' from public.shared_action_events where id=(next->>'id')::uuid),'completed replacement and old/new bindings recorded');
 perform pg_temp.check(pg_temp.claim(next)->>'state'='replayed' and pg_temp.finish(next,g)->>'state'='replayed','lost final response replays without second retirement');
 perform pg_temp.check((select count(*)=2 from public.email_configurations where property_id=(f->>'p')::uuid),'no duplicate account after recovery');
 perform pg_temp.check(not public.email_reply_matches_account((f->>'p')::uuid,new_id,'old-thread','old-message'),'old provider thread cannot be replied to using replacement');
 perform pg_temp.check(not public.email_reply_matches_account((f->>'p')::uuid,(f->>'old')::uuid,'old-thread','old-message'),'retired account cannot reply');
 perform pg_temp.check(public.email_reply_matches_account((f->>'p')::uuid,new_id,null,null),'new account permits new conversations');
 failed:=false;begin update public.email_configurations set sync_enabled=true,access_token='bad' where id=(f->>'old')::uuid;exception when others then failed:=true;end;
 perform pg_temp.check(failed,'retired mailbox cannot be reactivated by a stale writer');
 failed:=false;begin update public.email_configurations set account_email='rewritten@example.invalid' where id=(f->>'old')::uuid;exception when others then failed:=true;end;
 perform pg_temp.check(failed,'retired account history cannot be relabeled');
 -- Ordinary reconnect ignores retired rows and only updates the new identity.
 next:=next||jsonb_build_object('id',gen_random_uuid(),'context',(next->'context')-'replacementId');
 perform pg_temp.check(public.begin_integration_authorization((next->>'id')::uuid,next->'context')->>'state'='ready','ordinary reconnect starts after replacement');perform pg_temp.claim(next);
 perform pg_temp.check(pg_temp.finish(next,g)->>'emailConfigId'=new_id::text,'same account reconnect updates current mailbox only');
 perform public.disconnect_recorded_email((f->>'p')::uuid,(f->>'actor')::uuid,gen_random_uuid());
 perform pg_temp.check((select retired_at is not null and replacement_id=decision_id from public.email_configurations where id=(f->>'old')::uuid),'disconnect preserves retirement metadata');
 -- Target must match, failed outcomes preserve existing credentials.
 f:=pg_temp.connected();d:=pg_temp.decision(f);next:=pg_temp.authorize(f,d);perform pg_temp.claim(next);r:=pg_temp.finish(next,pg_temp.new_grant()||'{"accountEmail":"unreviewed@example.invalid"}');
 perform pg_temp.check(r->>'state'='replacement_account_mismatch','unreviewed authorized account is rejected');
 perform pg_temp.check((select retired_at is null and sync_enabled from public.email_configurations where id=(f->>'old')::uuid),'mismatched grant leaves current account enabled');
 perform pg_temp.check((select action='integration.account.replaced' and phase='failed' from public.shared_action_events where id=(next->>'id')::uuid),'target mismatch recorded as failed outcome');
 -- Changed linked work is checked again after the provider exchange.
 f:=pg_temp.connected();d:=pg_temp.decision(f);next:=pg_temp.authorize(f,d);perform pg_temp.claim(next);
 insert into public.email_threads(email_configuration_id,property_id,gmail_thread_id,provider_thread_id,status)values((f->>'old')::uuid,(f->>'p')::uuid,'arrived-during-consent','arrived-during-consent','active');
 perform pg_temp.check(pg_temp.finish(next,pg_temp.new_grant())->>'state'='stale_review','new email work invalidates an already claimed replacement');
 perform pg_temp.check((select count(*)=1 from public.email_configurations where property_id=(f->>'p')::uuid),'stale review creates no replacement account');
 f:=pg_temp.connected();d:=pg_temp.decision(f);update public.integration_replacements set expires_at=clock_timestamp()-interval '1 second' where id=(d->>'replacementId')::uuid;
 perform pg_temp.check(public.begin_integration_authorization(gen_random_uuid(),(f->'context')||jsonb_build_object('replacementId',d->>'replacementId'))->>'state'='replacement_unavailable','expired decision cannot start authorization');
 f:=pg_temp.connected();d:=pg_temp.decision(f);
 perform pg_temp.check(public.begin_integration_authorization(gen_random_uuid(),(f->'context')||jsonb_build_object('replacementId',d->>'replacementId','provider','microsoft'))->>'state'='replacement_unavailable','different provider cannot reuse decision');
 perform pg_temp.check(public.begin_integration_authorization(gen_random_uuid(),(f->'context')||jsonb_build_object('replacementId',d->>'replacementId','capabilities',array['calendar','email']))->>'state'='replacement_unavailable','replacement cannot expand capabilities');
 next:=pg_temp.authorize(f,d);
 perform pg_temp.check(public.begin_integration_authorization(gen_random_uuid(),next->'context')->>'state'='replacement_unavailable','decision authorizes one request only');
 -- Calendar history is equally retained across a provider switch.
 f:=pg_temp.connected('calendar');
 update public.agent_calendars set calendar_id='old-custom-calendar',tour_duration_minutes=45,buffer_minutes=20 where id=(f->>'old')::uuid;
 insert into public.calendar_events(agent_calendar_id,google_event_id,provider_event_id,sync_status)values((f->>'old')::uuid,'historic-event','historic-event','synced') returning id into event;
 d:=pg_temp.decision(f,'microsoft');next:=pg_temp.authorize(f,d);perform pg_temp.claim(next);r:=pg_temp.finish(next,pg_temp.new_grant());new_id:=(r->>'calendarId')::uuid;
 perform pg_temp.check(r->>'state'='saved' and new_id<>(f->>'old')::uuid,'provider switch creates new calendar identity');
 perform pg_temp.check((select agent_calendar_id=(f->>'old')::uuid and provider_event_id='historic-event' from public.calendar_events where id=event),'historical event remains on original calendar');
 failed:=false;begin update public.calendar_events set agent_calendar_id=new_id where id=event;exception when others then failed:=true;end;perform pg_temp.check(failed,'retired calendar history cannot be moved under a new account');
 perform pg_temp.check((select retired_at is not null and calendar_id='old-custom-calendar' and not sync_enabled and refresh_token is null from public.agent_calendars where id=(f->>'old')::uuid),'old calendar identity kept with access disabled');
 perform pg_temp.check((select provider='microsoft' and calendar_id<>'old-custom-calendar' and tour_duration_minutes=45 and buffer_minutes=20 from public.agent_calendars where id=new_id),'new provider uses new calendar and preserves property scheduling preferences');
 failed:=false;begin update public.agent_calendars set calendar_id='different' where id=(f->>'old')::uuid;exception when others then failed:=true;end;perform pg_temp.check(failed,'retired calendar ID immutable');
 perform pg_temp.check(not has_table_privilege('authenticated','public.integration_replacements','select'),'replacement ledger private');
 perform pg_temp.check(not has_function_privilege('anon','public.integration_replacement_review(uuid,uuid,text)','execute'),'replacement review RPC private');
 perform pg_temp.check(not has_function_privilege('authenticated','public.request_recorded_integration_replacement(uuid,uuid,uuid,text,text,text,text)','execute'),'replacement mutation RPC private');
end$$;
do $$declare f jsonb;d jsonb;next jsonb;r jsonb;lead uuid;booking uuid;work uuid;other jsonb;request uuid;rev text;
begin
 f:=pg_temp.connected('calendar');lead:=gen_random_uuid();booking:=gen_random_uuid();
 insert into public.leads(id,property_id,first_name,status)values(lead,(f->>'p')::uuid,'Replacement','tour_booked');
 insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,duration_minutes,status,schedule_timezone)values(booking,(f->>'p')::uuid,lead,current_date+2,'10:00',30,'confirmed','UTC');
 perform pg_temp.check(public.integration_replacement_review((f->>'p')::uuid,(f->>'actor')::uuid,'calendar')->'blockers' ? 'active_tours','scheduled booking blocks calendar replacement');
 update public.tour_bookings set status='completed' where id=booking;
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,state)values((f->>'p')::uuid,lead,'tour_bookings',booking,1,'calendar','review') returning id into work;
 perform pg_temp.check(pg_temp.decision(f)->>'state'='linked_work_requires_review','uncertain calendar delivery blocks replacement after tour completes');
 update public.tour_schedule_work set state='completed' where id=work;
 insert into public.luma_delivery_jobs(property_id,booking_id,payload,state)values((f->>'p')::uuid,booking,'{}','review');
 perform pg_temp.check(pg_temp.decision(f)->>'state'='linked_work_requires_review','legacy delivery review also holds calendar replacement');
 update public.luma_delivery_jobs set state='completed' where booking_id=booking;
 d:=pg_temp.decision(f);next:=pg_temp.authorize(f,d);perform pg_temp.claim(next);
 insert into public.tour_bookings(property_id,lead_id,scheduled_date,scheduled_time,duration_minutes,status,schedule_timezone)values((f->>'p')::uuid,lead,current_date+3,'11:00',30,'scheduled','UTC');
 perform pg_temp.check(pg_temp.finish(next,pg_temp.new_grant())->>'state'='stale_review','booking created or reopened during consent invalidates replacement');
 f:=pg_temp.connected();d:=pg_temp.decision(f);other:=pg_temp.connected();
 perform pg_temp.check(public.begin_integration_authorization(gen_random_uuid(),(other->'context')||jsonb_build_object('replacementId',d->>'replacementId'))->>'state'='replacement_unavailable','another property cannot reuse a replacement decision');
 r:=public.integration_replacement_review((f->>'p')::uuid,(f->>'actor')::uuid,'email');rev:=r->>'revision';
 update public.email_configurations set access_token='newer-token' where id=(f->>'old')::uuid;
 perform pg_temp.check(public.request_recorded_integration_replacement((f->>'p')::uuid,(f->>'actor')::uuid,gen_random_uuid(),'email','google','another@example.invalid',rev)->>'state'='stale_review','new credentials invalidate an old review');
 perform pg_temp.check(public.begin_integration_authorization(gen_random_uuid(),(f->'context')||jsonb_build_object('replacementId',d->>'replacementId'))->>'state'='stale_review','changed connection blocks previously recorded decision before exchange');
 -- Invite authority never inherits an operator replacement decision.
 f:=pg_temp.connected();d:=pg_temp.decision(f);request:=gen_random_uuid();
 insert into public.integration_auth_invites(id,property_id,provider,requested_capabilities,token_hash,expires_at,created_by_profile_id)values(request,(f->>'p')::uuid,'google',array['email'],'fixture-invite-hash',clock_timestamp()+interval '1 hour',(f->>'actor')::uuid);
 perform pg_temp.check(public.begin_integration_authorization(gen_random_uuid(),(f->'context')||jsonb_build_object('authSource','external_invite','profileId',null,'inviteId',request,'tokenHash','fixture-invite-hash','replacementId',d->>'replacementId'))->>'state'='replacement_unavailable','external invite cannot authorize a reviewed account replacement');
end$$;
create function pg_temp.reject_replacement_record() returns trigger language plpgsql as $$begin if new.action='integration.account.replaced' then raise exception 'fixture recording failure';end if;return new;end$$;
create trigger fixture_reject_replacement before insert on public.shared_action_events for each row execute function pg_temp.reject_replacement_record();
do $$declare f jsonb;d jsonb;next jsonb;failed boolean:=false;begin
 f:=pg_temp.connected();d:=pg_temp.decision(f);next:=pg_temp.authorize(f,d);perform pg_temp.claim(next);
 begin perform pg_temp.finish(next,pg_temp.new_grant());exception when others then failed:=true;end;
 perform pg_temp.check(failed,'recording failure rejects replacement');
 perform pg_temp.check((select retired_at is null and access_token='fixture-access' from public.email_configurations where id=(f->>'old')::uuid),'recording rollback restores old credentials');
 perform pg_temp.check((select count(*)=1 from public.email_configurations where property_id=(f->>'p')::uuid),'recording rollback removes replacement row');
 perform pg_temp.check((select email_configuration_id=(f->>'old')::uuid from public.lumaleasing_config where property_id=(f->>'p')::uuid),'recording rollback restores widget binding');
 perform pg_temp.check((select completed_at is null from public.integration_replacements where id=(d->>'replacementId')::uuid),'recording rollback keeps decision uncompleted');
end$$;
select count(*) as passed from checks;
rollback;
