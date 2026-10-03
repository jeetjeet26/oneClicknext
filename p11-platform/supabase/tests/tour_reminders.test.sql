BEGIN;
create temp table checks(label text);
create function pg_temp.check(passed boolean,label text) returns void language plpgsql as $$begin
 if passed is not true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create function pg_temp.fixture(source text,tz text,starts timestamptz) returns jsonb language plpgsql as $$
declare p uuid:=gen_random_uuid();l uuid:=gen_random_uuid();t uuid:=gen_random_uuid();wall timestamp;
begin
 -- Keep the exact reminder instant while choosing a same-day test slot when
 -- the wall clock would cross midnight (which booking capacity rejects).
 wall:=starts at time zone coalesce(tz,'UTC');
 if wall::time>=time'23:30'then
  tz:=case when(starts at time zone'UTC')::time<time'23:30'then'UTC'else'Etc/GMT+1'end;
 end if;
 insert into public.properties(id,name,org_id,settings)values(p,'Reminder SQL fixture','22222222-2222-2222-2222-222222222222',jsonb_build_object('timezone',tz));
 insert into public.leads(id,property_id,first_name,email,phone,status)values(l,p,'Reminder','reminder@example.invalid','+15550000000','tour_booked');
 wall:=starts at time zone coalesce(tz,'UTC');
 if source='tours' then insert into public.tours(id,property_id,lead_id,tour_date,tour_time,status)values(t,p,l,wall::date,wall::time,'confirmed');
 else insert into public.tour_bookings(id,property_id,lead_id,scheduled_date,scheduled_time,status)values(t,p,l,wall::date,wall::time,'confirmed');end if;
 return jsonb_build_object('property',p,'lead',l,'tour',t);
end$$;
DO $$
declare f jsonb;p uuid;l uuid;t uuid;source text;actor uuid;w jsonb;job uuid;token uuid;email uuid;sms uuid;r jsonb;request uuid;input jsonb;old_token uuid;pending jsonb;value jsonb;
begin
 select id into actor from public.profiles where org_id='22222222-2222-2222-2222-222222222222' order by id limit 1;
 foreach source in array array['tours','tour_bookings'] loop
  f:=pg_temp.fixture(source,'Pacific/Kiritimati',now()+interval '24 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
  pending:=public.pending_tour_reminders(p);
  perform pg_temp.check(pending->>'reminders24h'='1',source||': property time finds confirmed tours across UTC date boundary');
  perform pg_temp.check(pending->>'reminders1h'='0',source||': counts use same due window');
  perform pg_temp.check((public.tour_reminder_schedule(p,source,t)->>'startsAt')::timestamptz=now()+interval '24 hours',source||': resolves exact instant');
  perform pg_temp.check(public.prepare_tour_reminder(p,source,t,2,'reminder_24h') is null,source||': stale version cannot claim');
  w:=public.prepare_tour_reminder(p,source,t,1,'reminder_24h');job:=(w->>'id')::uuid;token:=(w->>'lease_token')::uuid;
  perform pg_temp.check(jsonb_array_length(w->'channels')=2,source||': separate email and SMS tasks');
  perform pg_temp.check(public.prepare_tour_reminder(p,source,t,1,'reminder_24h') is null,source||': duplicate worker cannot claim');
  perform pg_temp.check(public.claim_tour_legacy_delivery(p,source,t,1,'reminder_24h') is null,source||': grouped legacy sender cannot bypass');
  select id into email from public.tour_reminder_channels where work_id=job and channel='email';
  select id into sms from public.tour_reminder_channels where work_id=job and channel='sms';
  perform pg_temp.check(public.start_tour_reminder_channel(email,gen_random_uuid(),'fixture body','fixture subject','fixture@example.invalid') is null,source||': start token required');
  value:=public.start_tour_reminder_channel(email,token,'fixture body','fixture subject','fixture@example.invalid');
  perform pg_temp.check(value->>'state'='running' and value->>'attempts'='1',source||': attempt checkpoint precedes transport');
  perform pg_temp.check(public.start_tour_reminder_channel(email,token,'fixture body','fixture subject','fixture@example.invalid') is null,source||': same live attempt cannot start again');
  perform pg_temp.check(public.finish_tour_reminder_channel(email,token,'local-email-receipt'),source||': acceptance saved');
  perform pg_temp.check(public.finish_tour_reminder_channel(email,token,'local-email-receipt'),source||': receipt retry idempotent');
  perform pg_temp.check(not public.finish_tour_reminder_channel(email,token,null),source||': saved receipt cannot be overwritten by failure');
  perform public.start_tour_reminder_channel(sms,token,'fixture SMS',null,'+15550000001');
  perform public.finish_tour_reminder_channel(sms,token,null);
  perform pg_temp.check(public.settle_tour_reminder(job,token)='review',source||': partial send held');
  perform pg_temp.check((public.tour_schedule_row(p,source,t)->>'reminder_24h_sent_at') is null,source||': partial send does not mark whole reminder sent');
  perform pg_temp.check(public.tour_delivery_block(p,source,t)='delivery_review_required',source||': uncertain attempt blocks schedule changes');
  request:=gen_random_uuid();input:='{"resolution":"not_sent","reason":"Local fixture: provider confirms no acceptance"}';
  perform pg_temp.check(public.review_tour_reminder(p,l,sms,gen_random_uuid(),request,input)->>'state'='forbidden',source||': actor scope checked in database');
  perform pg_temp.check(public.review_tour_reminder(p,gen_random_uuid(),sms,actor,request,input)->>'state'='not_found',source||': lead scope checked');
  r:=public.review_tour_reminder(p,l,sms,actor,request,input);
  perform pg_temp.check(r->>'channelState'='queued',source||': known unsent channel can requeue');
  perform pg_temp.check(public.review_tour_reminder(p,l,sms,actor,request,input)->>'state'='replayed',source||': lost review response replays');
  perform pg_temp.check(public.review_tour_reminder(p,l,sms,actor,request,input||'{"reason":"Changed evidence"}')->>'state'='request_conflict',source||': altered review cannot reuse request');
  perform pg_temp.check(not public.finish_tour_reminder_channel(sms,token,'late-old-owner'),source||': old sender cannot override review');
  perform pg_temp.check(public.tour_delivery_block(p,source,t) is null,source||': reconciled unsent attempt releases hold');
  w:=public.prepare_tour_reminder(p,source,t,1,'reminder_24h');token:=(w->>'lease_token')::uuid;
  perform pg_temp.check((select attempts=1 and state='accepted' from public.tour_reminder_channels where id=email),source||': accepted email retained during SMS retry');
  perform pg_temp.check(public.start_tour_reminder_channel(email,token,'fixture body','fixture subject','fixture@example.invalid') is null,source||': email not repeated');
  perform pg_temp.check(public.start_tour_reminder_channel(sms,token,'fixture SMS',null,'+15550000001')->>'attempts'='2',source||': only SMS attempt advances');
  perform public.finish_tour_reminder_channel(sms,token,'local-sms-receipt');
  update public.tour_schedule_work set lease_until=now()-interval '1 minute' where id=job;
  perform public.recover_tour_reminders();
  perform pg_temp.check((select state='completed' from public.tour_schedule_work where id=job),source||': interrupted all-receipt completion recovers without sending');
  perform pg_temp.check((public.tour_schedule_row(p,source,t)->>'reminder_24h_sent_at') is not null,source||': complete receipt set marks current schedule sent');
  perform pg_temp.check(public.pending_tour_reminders(p)->>'reminders24h'='0',source||': completed reminder excluded from counts');
  perform pg_temp.check((select count(*)=1 from public.tour_reminder_reviews where property_id=p),source||': one immutable review audit');
  begin update public.tour_reminder_reviews set input='{}' where property_id=p;raise exception 'FAIL: audit update accepted';exception when sqlstate '55000' then insert into checks values(source||': audit immutable');end;
 end loop;
 -- Different explicit timezones at the same instant yield the same eligibility.
 f:=pg_temp.fixture('tours','America/Adak',now()+interval '1 hour');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 perform pg_temp.check(public.pending_tour_reminders(p)->>'reminders1h'='1','negative UTC offset uses property date');
 update public.properties set settings='{}' where id=p;
 perform pg_temp.check(public.pending_tour_reminders(p)->>'needsReview'='1','unknown timezone is disclosed');
 perform pg_temp.check(public.prepare_tour_reminder(p,'tours',t,1,'reminder_1h') is null,'unknown timezone cannot send');
 update public.properties set settings='{"timezone":"America/Adak"}' where id=p;
 w:=public.prepare_tour_reminder(p,'tours',t,1,'reminder_1h');job:=(w->>'id')::uuid;token:=(w->>'lease_token')::uuid;
 select id into email from public.tour_reminder_channels where work_id=job and channel='email';
 select id into sms from public.tour_reminder_channels where work_id=job and channel='sms';
 update public.leads set email='changed@example.invalid' where id=l;
 perform pg_temp.check(public.start_tour_reminder_channel(email,token,'body','subject','from@example.invalid') is null,'changed recipient held');
 perform pg_temp.check((select state='review' and started_at is null from public.tour_reminder_channels where id=email),'unattempted recipient change distinguished');
 perform public.start_tour_reminder_channel(sms,token,'body',null,'+15550000001');
 perform pg_temp.check(public.review_tour_reminder(p,l,sms,actor,gen_random_uuid(),'{"resolution":"accepted","reason":"fixture","providerId":"r"}')->>'state'='busy','review cannot rotate an active send');
 update public.tour_schedule_work set lease_until=now()-interval '1 minute' where id=job;
 perform public.recover_tour_reminders();
 perform pg_temp.check((select state='review' from public.tour_reminder_channels where id=sms),'expired attempt becomes review, never automatic resend');
 perform pg_temp.check(public.review_tour_reminder(p,l,email,actor,gen_random_uuid(),'{"resolution":"accepted","reason":"fixture","providerId":"r"}')->>'state'='not_attempted','unattempted message cannot be marked accepted');
 r:=public.review_tour_reminder(p,l,sms,actor,gen_random_uuid(),'{"resolution":"accepted","reason":"Receipt checked in local fixture","providerId":"reconciled-sms"}');
 perform pg_temp.check(r->>'channelState'='accepted','operator can reconcile persisted late receipt');
 -- Timeliness, configuration and attempts are checked again immediately before a provider call.
 f:=pg_temp.fixture('tours','UTC',now()+interval '24 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 w:=public.prepare_tour_reminder(p,'tours',t,1,'reminder_24h');job:=(w->>'id')::uuid;token:=(w->>'lease_token')::uuid;
 select id into email from public.tour_reminder_channels where work_id=job and channel='email';
 select id into sms from public.tour_reminder_channels where work_id=job and channel='sms';
 perform pg_temp.check(public.start_tour_reminder_channel(email,token,'body','subject','') is null,'missing provider configuration never starts send');
 update public.tour_reminder_channels set state='review',attempts=3,started_at=now(),body='body',sender='+15550000001' where id=sms;
 perform public.settle_tour_reminder(job,token);
 r:=public.review_tour_reminder(p,l,sms,actor,gen_random_uuid(),'{"resolution":"not_sent","reason":"Three unsuccessful attempts checked"}');
 perform pg_temp.check(r->>'channelState'='skipped','three-attempt bound cannot be reset by review');
 -- A DST fold is not assigned an arbitrary offset. A gap is not silently shifted.
 f:=pg_temp.fixture('tours','America/New_York','2026-11-01 06:30:00Z');p:=(f->>'property')::uuid;t:=(f->>'tour')::uuid;
 perform pg_temp.check(public.tour_reminder_schedule(p,'tours',t)->>'issue'='ambiguous_time','repeated DST time held');
 f:=pg_temp.fixture('tours','UTC','2027-03-14 02:30:00Z');p:=(f->>'property')::uuid;t:=(f->>'tour')::uuid;
 update public.properties set settings='{"timezone":"America/New_York"}' where id=p;
 perform pg_temp.check(public.tour_reminder_schedule(p,'tours',t)->>'issue'='ambiguous_time','skipped DST time held');
 -- Late queues are closed without a transport attempt or false sent marker.
 f:=pg_temp.fixture('tour_bookings','UTC',now()+interval '1 hour');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 w:=public.prepare_tour_reminder(p,'tour_bookings',t,1,'reminder_1h');job:=(w->>'id')::uuid;token:=(w->>'lease_token')::uuid;
 update public.properties set settings='{"timezone":"Pacific/Kiritimati"}' where id=p;
 select id into email from public.tour_reminder_channels where work_id=job and channel='email';
 perform pg_temp.check(public.start_tour_reminder_channel(email,token,'body','subject','sender@example.invalid') is null,'changed timezone invalidates saved instant before sending');
 update public.tour_schedule_work set lease_until=now()-interval '1 minute' where id=job;
 perform public.recover_tour_reminders();
 perform pg_temp.check((select state='superseded' from public.tour_schedule_work where id=job),'late queue closed without replay');
 perform pg_temp.check((select reminder_1h_sent_at is null from public.tour_bookings where id=t),'expired unsent queue has no success marker');

 -- Contactless reminders can recover safely when contact details are supplied.
 f:=pg_temp.fixture('tours','UTC',now()+interval '24 hours');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 update public.leads set email=null,phone=null where id=l;
 perform pg_temp.check(public.prepare_tour_reminder(p,'tours',t,1,'reminder_24h') is null,'no contact does not claim a send');
 perform pg_temp.check(public.pending_tour_reminders(p)->>'held'='1','missing-contact hold is counted');
 perform pg_temp.check(public.pending_tour_reminders(p)->>'reminders24h'='0','contactless hold does not monopolize due candidates');
 update public.leads set email='new-contact@example.invalid' where id=l;
 perform pg_temp.check(public.pending_tour_reminders(p)->>'reminders24h'='1','new contact reopens only an unattempted timely reminder');
 w:=public.prepare_tour_reminder(p,'tours',t,1,'reminder_24h');job:=(w->>'id')::uuid;token:=(w->>'lease_token')::uuid;
 perform pg_temp.check(jsonb_array_length(w->'channels')=1,'new contact queues only the available channel');
 select id into email from public.tour_reminder_channels where work_id=job;
 perform public.start_tour_reminder_channel(email,token,'body','subject','sender@example.invalid');
 perform public.finish_tour_reminder_channel(email,token,null);perform public.settle_tour_reminder(job,token);
 update public.leads set email='different-contact@example.invalid' where id=l;
 perform pg_temp.check(public.review_tour_reminder(p,l,email,actor,gen_random_uuid(),'{"resolution":"not_sent","reason":"No acceptance; recipient changed"}')->>'channelState'='skipped','review never requeues a changed recipient');
 -- Recovery before any provider checkpoint releases a known-unattempted lease.
 f:=pg_temp.fixture('tour_bookings','UTC',now()+interval '1 hour');p:=(f->>'property')::uuid;l:=(f->>'lead')::uuid;t:=(f->>'tour')::uuid;
 w:=public.prepare_tour_reminder(p,'tour_bookings',t,1,'reminder_1h');job:=(w->>'id')::uuid;token:=(w->>'lease_token')::uuid;
 update public.tour_schedule_work set lease_until=now()-interval '1 minute' where id=job;
 perform public.recover_tour_reminders();
 perform pg_temp.check((select state='queued' and started_at is null from public.tour_schedule_work where id=job),'unattempted interrupted claim can recover');
 w:=public.prepare_tour_reminder(p,'tour_bookings',t,1,'reminder_1h');old_token:=token;token:=(w->>'lease_token')::uuid;
 select id into email from public.tour_reminder_channels where work_id=job and channel='email';
 perform pg_temp.check(public.start_tour_reminder_channel(email,old_token,'body','subject','sender@example.invalid') is null,'recovered claim rejects old starter');
 perform public.start_tour_reminder_channel(email,token,'body','subject','sender@example.invalid');
 perform public.finish_tour_reminder_channel(email,token,null);perform public.settle_tour_reminder(job,token);
 perform public.review_tour_reminder(p,l,email,actor,gen_random_uuid(),'{"resolution":"not_sent","reason":"Receipt absence verified"}');
 w:=public.prepare_tour_reminder(p,'tour_bookings',t,1,'reminder_1h');token:=(w->>'lease_token')::uuid;
 perform pg_temp.check(public.start_tour_reminder_channel(email,token,'Changed content','subject','sender@example.invalid') is null,'retry cannot silently change pinned content');
 perform pg_temp.check((select attempts=1 from public.tour_reminder_channels where id=email),'rejected retry does not increment provider attempts');
 perform pg_temp.check(not has_table_privilege('authenticated','public.tour_reminder_channels','SELECT'),'channel receipts service only');
 perform pg_temp.check(not has_table_privilege('anon','public.tour_reminder_reviews','INSERT'),'review audit private');
 perform pg_temp.check(not has_function_privilege('authenticated','public.review_tour_reminder(uuid,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),'no client RPC bypass');
 perform pg_temp.check(has_function_privilege('service_role','public.pending_tour_reminders(uuid,integer)','EXECUTE'),'service can query scoped pending reminders');
end$$;
select count(*) as passed from checks;
ROLLBACK;
