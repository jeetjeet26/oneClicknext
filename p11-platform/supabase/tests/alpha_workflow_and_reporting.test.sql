-- Run against the local seeded database. The fixture never contacts a provider.
begin;
create function pg_temp.check_it(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Failed: %', message; end if;
end $$;

do $$
declare
  p uuid := gen_random_uuid();
  org uuid := '22222222-2222-2222-2222-222222222222';
  l uuid;
  saved_score uuid;
  first_score uuid;
  label text;
  saved jsonb;
  stages jsonb;
  template uuid := gen_random_uuid();
  definition uuid := gen_random_uuid();
  workflow uuid;
  delivery jsonb;
  attempt jsonb;
  error_reason text;
  scenario text;
  fixture_phone text := '+12025550111';
  sender text := '+12025550112';
  tags jsonb := '{"source":"fixture-search","medium":"cpc","campaign":"open-house"}';
begin
  insert into public.properties(id,org_id,name,settings) values(p,org,'Alpha workflow fixture','{"timezone":"UTC"}');
  saved := public.upsert_luma_lead(p,'visitor@example.invalid',fixture_phone,null,
    jsonb_build_object('email','visitor@example.invalid','phone',fixture_phone,'source','LumaLeasing Widget','attribution',tags),'{}');
  l := (saved->>'leadId')::uuid;
  perform pg_temp.check_it((select source='LumaLeasing Widget' and attribution=tags from public.leads where id=l),'acquisition tags and channel retained');
  perform pg_temp.check_it(not exists(select 1 from private.workflow_sms_consents where lead_id=l),'phone alone does not authorize marketing');

  foreach label in array array['SiteForge','AI Chat','LumaLeasing Tour Booking','unrecognized'] loop
    update public.leads set source=label where id=l;
    saved_score:=public.score_lead(l);
    perform pg_temp.check_it((select source_score=case when label='unrecognized' then 10 else 20 end and model_version='rules-v3.1-source-aliases' from public.lead_scores where id=saved_score),'score for '||label);
    perform pg_temp.check_it((select rules_version='rules-v3.1-source-aliases' from public.lead_score_inputs where lead_score_inputs.score_id=saved_score),'score version recorded');
    if first_score is null then first_score:=saved_score;end if;
  end loop;
  perform pg_temp.check_it((select source_score=20 from public.lead_scores where id=first_score),'previous score still readable');
  update public.leads set source='LumaLeasing Widget' where id=l;

  perform public.upsert_luma_lead(p,'visitor@example.invalid',fixture_phone,l,
    jsonb_build_object('source','LumaLeasing Tour Booking','attribution','{"source":"later"}'::jsonb),'{}');
  perform pg_temp.check_it((select attribution=tags from public.leads where id=l),'repeat visit preserves acquisition campaign');
  insert into public.tour_bookings(property_id,lead_id,scheduled_date,scheduled_time,duration_minutes,status,source,schedule_timezone,attribution)
    values(p,l,current_date,'10:00',30,'confirmed','lumaleasing','UTC','{"source":"later"}');
  stages:=private.delivery_funnel(p,current_date,current_date);
  perform pg_temp.check_it(stages#>>'{campaigns,0,captureSource}'='LumaLeasing Widget' and stages#>>'{campaigns,0,source}'='fixture-search' and stages#>>'{campaigns,0,booked}'='1','tagged inquiry links to one booked tour');

  perform pg_temp.check_it(stages#>>'{bookingCampaigns,0,source}'='later' and stages#>>'{bookingCampaigns,0,bookings}'='1','returning visitor booking is credited separately');

  insert into public.follow_up_templates(id,property_id,slug,name,channel,body,is_active) values(template,p,'alpha','Fixture','sms','Fixture text',true);
  insert into public.workflow_definitions(id,property_id,name,trigger_on,steps,exit_conditions,is_active)
    values(definition,p,'Fixture marketing','lead_created','[{"id":0,"delay_hours":0,"action":"sms","template_slug":"alpha"}]','[]',true);
  foreach scenario in array array['no_proof','consented','changed_number','optout'] loop
    if scenario='consented' then
      perform public.upsert_luma_lead(p,'visitor@example.invalid',fixture_phone,l,
        '{"source":"LumaLeasing Tour Booking","smsMarketingOptIn":true}','{}');
    end if;
    update public.leads set phone=case when scenario='changed_number' then '+12025550113' else fixture_phone end where id=l;
    workflow:=gen_random_uuid();
    insert into public.lead_workflows(id,lead_id,workflow_id,current_step,status,next_action_at) values(workflow,l,definition,0,'active',now()-interval '1 minute');
    delivery:=public.prepare_workflow_delivery(workflow);
    if scenario='optout' then
      perform public.record_workflow_sms_optout(sender,fixture_phone);
      perform public.record_workflow_sms_optout(sender,fixture_phone);
    end if;
    attempt:=public.start_workflow_delivery((delivery->>'id')::uuid,(delivery->>'lease_token')::uuid,'Fixture text',null,sender);
    if scenario='consented' then
      perform pg_temp.check_it(attempt->>'attempts'='1','explicit consent allows a controlled attempt');
    else
      select error_code into error_reason from public.workflow_deliveries where id=(delivery->>'id')::uuid;
      perform pg_temp.check_it(attempt is null and error_reason=case when scenario='optout' then 'sms_opted_out' else 'sms_consent_required' end,'marketing gate: '||scenario);
    end if;
    update public.lead_workflows set status='stopped' where id=workflow;
  end loop;
  perform pg_temp.check_it(not has_function_privilege('authenticated','public.record_workflow_sms_optout(text,text)','execute'),'inbound suppression is service-only');
end $$;
rollback;
