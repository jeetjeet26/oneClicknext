create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action like 'lead.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

-- Private, immutable scoring evidence. No contact values or message text are copied.
create table public.lead_score_inputs(
 score_id uuid primary key references public.lead_scores(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 rules_version text not null, input jsonb not null, input_hash text not null,
 evaluated_at timestamptz not null
);
create index lead_score_inputs_property on public.lead_score_inputs(property_id);
create index lead_score_inputs_lead on public.lead_score_inputs(lead_id,evaluated_at desc);
create table public.lead_engagement_receipts(
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade, actor_id uuid references public.profiles(id),
 origin text not null check(origin in ('operator','siteforge','lumaleasing')),
 request_key text not null, input jsonb not null, event_id uuid not null unique, result jsonb,
 created_at timestamptz not null default clock_timestamp(), unique(property_id,request_key)
);
create index lead_engagement_receipts_lead on public.lead_engagement_receipts(lead_id);
create index lead_engagement_receipts_actor on public.lead_engagement_receipts(actor_id);
create table public.lead_event_corrections(
 id uuid primary key, property_id uuid not null references public.properties(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 event_id uuid not null unique, actor_id uuid not null references public.profiles(id),
 reason text not null, result jsonb, created_at timestamptz not null default clock_timestamp()
);
create index lead_event_corrections_property on public.lead_event_corrections(property_id);
create index lead_event_corrections_lead on public.lead_event_corrections(lead_id);
create index lead_event_corrections_actor on public.lead_event_corrections(actor_id);
create function public.protect_leadpulse_history() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' and pg_trigger_depth()>1 then return old;end if;
 if tg_op='UPDATE' and tg_table_name in ('lead_engagement_receipts','lead_event_corrections') then
  if old.result is null and new.result is not null and (to_jsonb(old)-'result')=(to_jsonb(new)-'result') then return new;end if;
 end if;
 raise exception 'LeadPulse evidence is immutable';
end;$$;
create trigger lead_score_inputs_immutable before update or delete on public.lead_score_inputs for each row execute function public.protect_leadpulse_history();
create trigger lead_engagement_receipts_immutable before update or delete on public.lead_engagement_receipts for each row execute function public.protect_leadpulse_history();
create trigger lead_event_corrections_immutable before update or delete on public.lead_event_corrections for each row execute function public.protect_leadpulse_history();
CREATE OR REPLACE FUNCTION public.score_lead(p_lead_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_score_id uuid;
  v_total_score int := 0;
  v_engagement_score int := 0;
  v_timing_score int := 0;
  v_source_score int := 0;
  v_completeness_score int := 0;
  v_behavior_score int := 0;
  v_score_bucket text;
  v_factors jsonb := '[]'::jsonb;
  v_lead record;
  v_event_count int := 0;
  v_event_weight int := 0;
  v_message_count int := 0;
  v_days_since_creation int;
  v_normalized_source text;
  v_at timestamptz := clock_timestamp(); v_events jsonb; v_messages jsonb; v_tours jsonb; v_input jsonb;
  v_property uuid;
begin
  select property_id into v_property from public.leads where id=p_lead_id;
  if v_property is null then raise exception 'Lead not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_property::text,12));
  select * into v_lead
  from public.leads
  where id = p_lead_id for share;

  if not found then
    raise exception 'Lead not found: %', p_lead_id;
  end if;

  v_days_since_creation := greatest(0,floor(extract(epoch from v_at-v_lead.created_at)/86400));

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'type',e.event_type,'weight',greatest(-25,least(40,e.score_weight)),
    'createdAt',e.created_at,'origin',coalesce(r.origin,'legacy'),'receiptId',r.id) order by e.created_at,e.id),'[]') into v_events
  from public.lead_engagement_events e left join public.lead_engagement_receipts r on r.property_id=v_property and r.event_id=e.id
  where e.lead_id=p_lead_id and not exists(select 1 from public.lead_event_corrections c where c.event_id=e.id);
  select count(*)::int,coalesce(sum((e->>'weight')::int),0)::int into v_event_count,v_event_weight from jsonb_array_elements(v_events) e;
  select coalesce(jsonb_agg(m.id order by m.id),'[]') into v_messages
  from public.messages m join public.conversations c on c.id=m.conversation_id where c.lead_id=p_lead_id and m.role='user';
  v_message_count:=jsonb_array_length(v_messages);
  select coalesce(jsonb_agg(t order by t->>'id'),'[]') into v_tours from (
   select jsonb_build_object('source','tours','id',id) t from public.tours where lead_id=p_lead_id and status='completed'
   union all select jsonb_build_object('source','tour_bookings','id',id) from public.tour_bookings where lead_id=p_lead_id and status='completed'
  ) completed;

  v_engagement_score := least(
    30,
    greatest(0, v_event_weight + (v_message_count * 5))
  );

  if v_event_count > 0 then
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Recorded engagement',
      'impact', format(
        '%s bounded event point(s) across %s event(s), plus %s user message(s)',
        v_event_weight,
        v_event_count,
        v_message_count
      ),
      'type', case when v_event_weight > 0 then 'positive' else 'neutral' end
    );
  end if;

  if v_lead.created_at >= v_at-interval '24 hours' then
    v_timing_score := 25;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Brand new lead',
      'impact', 'Created within 24 hours',
      'type', 'positive'
    );
  elsif v_lead.created_at >= v_at-interval '7 days' then
    v_timing_score := 20;
  elsif v_lead.created_at >= v_at-interval '30 days' then
    v_timing_score := 10;
  else
    v_timing_score := 5;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Stale lead',
      'impact', format('Created %s days ago', v_days_since_creation),
      'type', 'negative'
    );
  end if;

  v_normalized_source := regexp_replace(
    lower(trim(coalesce(v_lead.source, ''))),
    '[^a-z0-9]+',
    '',
    'g'
  );

  case v_normalized_source
    when 'directwebsite' then v_source_score := 20;
    when 'websiteform' then v_source_score := 20;
    when 'googlead' then v_source_score := 18;
    when 'googleads' then v_source_score := 18;
    when 'facebookad' then v_source_score := 15;
    when 'facebookads' then v_source_score := 15;
    when 'lumaleasing' then v_source_score := 20;
    when 'lumaleasingwidget' then v_source_score := 20;
    when 'referral' then v_source_score := 20;
    when 'apartmentscom' then v_source_score := 12;
    when 'zillow' then v_source_score := 12;
    else v_source_score := 10;
  end case;

  v_completeness_score := 0;
  if nullif(v_lead.email, '') is not null then
    v_completeness_score := v_completeness_score + 5;
  end if;
  if nullif(v_lead.phone, '') is not null then
    v_completeness_score := v_completeness_score + 5;
  end if;
  if nullif(v_lead.first_name, '') is not null then
    v_completeness_score := v_completeness_score + 2;
  end if;
  if v_lead.move_in_date is not null then
    v_completeness_score := v_completeness_score + 3;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Has move-in date',
      'impact', 'Specific timeline provided',
      'type', 'positive'
    );
  end if;

  if v_lead.status = 'tour_booked' then
    v_behavior_score := 10;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Tour scheduled',
      'impact', 'High intent to visit',
      'type', 'positive'
    );
  elsif jsonb_array_length(v_tours)>0 then
    v_behavior_score := 10;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Tour completed',
      'impact', 'Already visited property',
      'type', 'positive'
    );
  end if;

  v_total_score :=
    v_engagement_score
    + v_timing_score
    + v_source_score
    + v_completeness_score
    + v_behavior_score;

  if v_total_score >= 70 then
    v_score_bucket := 'hot';
  elsif v_total_score >= 45 then
    v_score_bucket := 'warm';
  elsif v_total_score >= 25 then
    v_score_bucket := 'cold';
  else
    v_score_bucket := 'unqualified';
  end if;

  insert into public.lead_scores (
    lead_id,
    total_score,
    engagement_score,
    timing_score,
    source_score,
    completeness_score,
    behavior_score,
    score_bucket,
    factors,
    model_version, scored_at
  ) values (
    p_lead_id,
    v_total_score,
    v_engagement_score,
    v_timing_score,
    v_source_score,
    v_completeness_score,
    v_behavior_score,
    v_score_bucket,
    v_factors,
    'rules-v3.0-evidence', v_at
  )
  returning id into v_score_id;

  update public.leads set score=v_total_score,score_bucket=v_score_bucket where id=p_lead_id;
  v_input:=jsonb_build_object('evaluatedAt',v_at,'createdAt',v_lead.created_at,'ageDays',v_days_since_creation,
    'normalizedSource',v_normalized_source,'status',v_lead.status,
    'hasEmail',nullif(v_lead.email,'') is not null,'hasPhone',nullif(v_lead.phone,'') is not null,
    'hasFirstName',nullif(v_lead.first_name,'') is not null,'hasMoveInDate',v_lead.move_in_date is not null,
    'events',v_events,'eventWeight',v_event_weight,'userMessageIds',v_messages,'completedTours',v_tours);
  insert into public.lead_score_inputs(score_id,property_id,lead_id,rules_version,input,input_hash,evaluated_at)
  values(v_score_id,v_property,p_lead_id,'rules-v3.0-evidence',v_input,encode(sha256(convert_to(v_input::text,'UTF8')),'hex'),v_at);
  return v_score_id;
end;
$function$;


-- Mutations are service-only. Operators use the scoped, recorded API below.
revoke insert,update,delete on public.lead_scores,public.lead_engagement_events from anon,authenticated;
revoke all on function public.score_lead(uuid) from public,anon,authenticated;
grant execute on function public.score_lead(uuid) to service_role;

create function public.leadpulse_score_summary(p_score_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('scoreId',s.id,'total',s.total_score,'bucket',s.score_bucket,'rulesVersion',s.model_version,'inputHash',i.input_hash)
 from public.lead_scores s left join public.lead_score_inputs i on i.score_id=s.id where s.id=p_score_id;
$$;
create function public.record_lead_engagement(p_property_id uuid,p_lead_id uuid,p_event_type text,p_metadata jsonb,p_request_key text,p_origin text,p_actor_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.lead_engagement_receipts;input jsonb;eid uuid:=gen_random_uuid();sid uuid;weight int;before_state jsonb;after_state jsonb;a jsonb;command_result jsonb;
begin
 if p_request_key is null or length(p_request_key) not between 1 and 250 or jsonb_typeof(p_metadata) is distinct from 'object' or length(p_metadata::text)>6000
  or p_origin is null or p_origin not in ('operator','siteforge','lumaleasing') or (p_origin='operator') is distinct from (p_actor_id is not null) then raise exception 'Invalid engagement request';end if;
 if p_actor_id is not null and not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then return '{"state":"not_found"}';end if;
 input:=jsonb_build_object('leadId',p_lead_id,'eventType',p_event_type,'metadata',p_metadata);
 select * into r from public.lead_engagement_receipts where property_id=p_property_id and request_key=p_request_key;
 if found then
  if (r.lead_id,r.actor_id,r.origin,r.input) is distinct from (p_lead_id,p_actor_id,p_origin,input) then return '{"state":"request_conflict"}';end if;
  return r.result||jsonb_build_object('state','replayed');
 end if;
 if exists(select 1 from public.lead_engagement_events where property_id=p_property_id and idempotency_key=p_request_key) then return '{"state":"legacy_conflict"}';end if;
 weight:=case p_event_type when 'chat_started' then 5 when 'chat_message_sent' then 3 when 'website_lead_submitted' then 10
 when 'email_opened' then 8 when 'email_clicked' then 15 when 'sms_replied' then 20 when 'tour_scheduled' then 25
 when 'tour_completed' then 35 when 'tour_no_show' then -25 when 'application_started' then 30 when 'application_submitted' then 40
 when 'document_viewed' then 10 when 'price_check' then 12 when 'unit_favorited' then 15 when 'repeat_visit' then 10
 when 'call_inbound' then 20 when 'call_outbound_answered' then 18 end;
 if weight is null then raise exception 'Invalid engagement type';end if;
 -- Tour outcomes have dedicated evidence/correction workflows; don't let a manual entry bypass them.
 if p_origin='operator' and p_event_type in ('tour_scheduled','tour_completed','tour_no_show') then return '{"state":"use_tour_workflow"}';end if;
 select public.leadpulse_score_summary(id) into before_state from public.lead_scores where lead_id=p_lead_id order by scored_at desc,id desc limit 1;
 insert into public.lead_engagement_receipts(property_id,lead_id,actor_id,origin,request_key,input,event_id)
 values(p_property_id,p_lead_id,p_actor_id,p_origin,p_request_key,input,eid) returning * into r;
 insert into public.lead_engagement_events(id,property_id,lead_id,event_type,event_source,metadata,score_weight,idempotency_key)
 values(eid,p_property_id,p_lead_id,p_event_type,p_origin,p_metadata,weight,p_request_key);
 sid:=public.score_lead(p_lead_id);after_state:=public.leadpulse_score_summary(sid);
 command_result:=jsonb_build_object('state','applied','eventId',eid,'scoreId',sid,'scoreWeight',weight,'origin',p_origin,'createdAt',r.created_at);
 if p_actor_id is not null then
  a:=public.append_shared_action_event(r.id,r.id,p_property_id,p_actor_id,'leadpulse','lead.engagement.recorded','server_confirmed','succeeded',
   jsonb_build_object('leadId',p_lead_id,'eventType',p_event_type,'origin','operator','inputHash',encode(sha256(convert_to(input::text,'UTF8')),'hex')),before_state,after_state,command_result);
  if a->>'state' not in ('recorded','replayed') then raise exception 'Engagement history unavailable';end if;
 end if;
 update public.lead_engagement_receipts set result=command_result where id=r.id;
 return command_result;
end;$$;

create function public.correct_lead_engagement(p_property_id uuid,p_lead_id uuid,p_event_id uuid,p_actor_id uuid,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.lead_event_corrections;r public.lead_engagement_receipts;sid uuid;before_state jsonb;command_result jsonb;a jsonb;
begin
 if p_request_id is null or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'A correction reason is required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.lead_event_corrections where id=p_request_id;
 if found then
  if (c.property_id,c.lead_id,c.event_id,c.actor_id,c.reason) is distinct from (p_property_id,p_lead_id,p_event_id,p_actor_id,trim(p_reason)) then return '{"state":"request_conflict"}';end if;
  return c.result||'{"state":"replayed"}';
 end if;
 select * into r from public.lead_engagement_receipts where property_id=p_property_id and lead_id=p_lead_id and event_id=p_event_id and origin='operator';
 if not found then return '{"state":"not_reported"}';end if;
 if exists(select 1 from public.lead_event_corrections where event_id=p_event_id) then return '{"state":"already_corrected"}';end if;
 select public.leadpulse_score_summary(id) into before_state from public.lead_scores where lead_id=p_lead_id order by scored_at desc,id desc limit 1;
 insert into public.lead_event_corrections(id,property_id,lead_id,event_id,actor_id,reason)
 values(p_request_id,p_property_id,p_lead_id,p_event_id,p_actor_id,trim(p_reason));
 sid:=public.score_lead(p_lead_id);command_result:=jsonb_build_object('state','applied','eventId',p_event_id,'scoreId',sid,'correctionId',p_request_id);
 a:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'leadpulse','lead.engagement.corrected','server_confirmed','succeeded',
  jsonb_build_object('leadId',p_lead_id,'eventId',p_event_id,'reasonHash',encode(sha256(convert_to(trim(p_reason),'UTF8')),'hex')),before_state,public.leadpulse_score_summary(sid),command_result);
 if a->>'state' not in ('recorded','replayed') then raise exception 'Correction history unavailable';end if;
 update public.lead_event_corrections set result=command_result where id=p_request_id;
 return command_result;
end;$$;

create table public.lead_score_batches(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),input jsonb not null,
 rules_version text not null default 'rules-v3.0-evidence',state text not null default 'running' check(state in ('running','completed','cancelled')),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index lead_score_batches_property on public.lead_score_batches(property_id,created_at desc);
create index lead_score_batches_actor on public.lead_score_batches(actor_id);
create unique index lead_score_batches_active on public.lead_score_batches(property_id) where state='running';
create table public.lead_score_batch_items(
 batch_id uuid not null references public.lead_score_batches(id) on delete cascade,
 lead_id uuid not null, -- Keep the target manifest even when a lead is subsequently deleted or moved.
 state text not null default 'pending' check(state in ('pending','scored','failed')),
 score_id uuid, error_code text,finished_at timestamptz,primary key(batch_id,lead_id)
);
create function public.protect_lead_score_batch() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if pg_trigger_depth()>1 then return old;end if;raise exception 'Scoring history is immutable';end if;
 if tg_table_name='lead_score_batches' then
  if old.state<>'running' or (old.id,old.property_id,old.actor_id,old.input,old.rules_version,old.created_at) is distinct from (new.id,new.property_id,new.actor_id,new.input,new.rules_version,new.created_at) then raise exception 'Scoring history is immutable';end if;
 else
  if old.state<>'pending' or (old.batch_id,old.lead_id) is distinct from (new.batch_id,new.lead_id) then raise exception 'Scoring history is immutable';end if;
 end if;return new;
end;$$;
create trigger lead_score_batches_immutable before update or delete on public.lead_score_batches for each row execute function public.protect_lead_score_batch();
create trigger lead_score_batch_items_immutable before update or delete on public.lead_score_batch_items for each row execute function public.protect_lead_score_batch();

create function public.lead_score_batch_status(p_property_id uuid,p_actor_id uuid,p_batch_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b public.lead_score_batches;s jsonb;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select * into b from public.lead_score_batches where property_id=p_property_id and (p_batch_id is null or id=p_batch_id)
 order by created_at desc,id desc limit 1;
 if not found then return '{"state":"not_found"}';end if;
 select jsonb_build_object('total',count(*),'successful',count(*) filter(where state='scored'),'failed',count(*) filter(where state='failed'),
  'pending',count(*) filter(where state='pending'),'scoreId',case when count(*)=1 then max(score_id::text) end) into s from public.lead_score_batch_items where batch_id=b.id;
 return s||jsonb_build_object('state',b.state,'requestId',b.id,'propertyId',b.property_id,'rulesVersion',b.rules_version,'startedAt',b.created_at,'finishedAt',b.finished_at,
 'failures',coalesce((select jsonb_agg(jsonb_build_object('leadId',lead_id,'code',error_code)) from (select lead_id,error_code from public.lead_score_batch_items where batch_id=b.id and state='failed' order by lead_id limit 20) f),'[]'),
 'canContinue',b.actor_id=p_actor_id,'target',case when b.input->'leadIds'='null'::jsonb then 'property' else 'selection' end);
end;$$;

create function public.run_lead_score_batch(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_lead_ids uuid[] default null,p_retry_batch_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.lead_score_batches;input jsonb;item record;sid uuid;e jsonb;before_state jsonb;event_id uuid;r jsonb;targets uuid[];failure text;
begin
 if p_request_id is null or (p_lead_ids is not null and (cardinality(p_lead_ids) not between 1 and 500 or array_position(p_lead_ids,null) is not null)) or (p_lead_ids is not null and p_retry_batch_id is not null) then raise exception 'Invalid scoring request';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select array_agg(x order by x) into targets from (select distinct unnest(p_lead_ids) x) ids;
 input:=jsonb_build_object('leadIds',targets,'retryBatchId',p_retry_batch_id);
 select * into b from public.lead_score_batches where id=p_request_id;
 if found then
  if (b.property_id,b.actor_id,b.input) is distinct from (p_property_id,p_actor_id,input) then return '{"state":"request_conflict"}';end if;
  if b.state<>'running' then return public.lead_score_batch_status(p_property_id,p_actor_id,b.id);end if;
 else
  if exists(select 1 from public.lead_score_batches where property_id=p_property_id and state='running') then return '{"state":"busy"}';end if;
  if targets is not null and (select count(*) from public.leads where property_id=p_property_id and id=any(targets))<>cardinality(targets) then return '{"state":"target_conflict"}';end if;
  if p_retry_batch_id is not null and not exists(select 1 from public.lead_score_batches where id=p_retry_batch_id and property_id=p_property_id and state<>'running') then return '{"state":"target_conflict"}';end if;
  insert into public.lead_score_batches(id,property_id,actor_id,input) values(p_request_id,p_property_id,p_actor_id,input) returning * into b;
  if p_retry_batch_id is not null then
   insert into public.lead_score_batch_items(batch_id,lead_id) select b.id,lead_id from public.lead_score_batch_items where batch_id=p_retry_batch_id and state='failed';
  else
   insert into public.lead_score_batch_items(batch_id,lead_id) select b.id,id from public.leads where property_id=p_property_id and (targets is null or id=any(targets));
  end if;
  e:=public.append_shared_action_event(md5('lead-score-start/'||b.id)::uuid,b.id,p_property_id,p_actor_id,'leadpulse','lead.scoring.started','server_confirmed','succeeded',
   jsonb_build_object('requestId',b.id,'target',case when targets is null then 'property' else 'selection' end,'retryBatchId',p_retry_batch_id),null,null,
   jsonb_build_object('total',(select count(*) from public.lead_score_batch_items where batch_id=b.id),'rulesVersion',b.rules_version));
  if e->>'state' not in ('recorded','replayed') then raise exception 'Scoring history unavailable';end if;
 end if;
 if b.rules_version<>'rules-v3.0-evidence' then return '{"state":"rules_changed"}';end if;
 for item in select lead_id from public.lead_score_batch_items where batch_id=b.id and state='pending' order by lead_id limit 25 loop
  -- Each item is atomic. An item failure rolls back that score, snapshot and action, and remains visible.
  begin
   if not exists(select 1 from public.leads where id=item.lead_id and property_id=p_property_id) then raise exception using errcode='P0002',message='Target changed';end if;
   select public.leadpulse_score_summary(id) into before_state from public.lead_scores where lead_id=item.lead_id order by scored_at desc,id desc limit 1;
   sid:=public.score_lead(item.lead_id);if sid is null then raise exception 'Score was not saved';end if;
   event_id:=md5('lead-score-item/'||b.id||'/'||item.lead_id)::uuid;
   e:=public.append_shared_action_event(event_id,b.id,p_property_id,p_actor_id,'leadpulse','lead.score.recalculated','server_confirmed','succeeded',
    jsonb_build_object('leadId',item.lead_id,'requestId',b.id),before_state,public.leadpulse_score_summary(sid),jsonb_build_object('scoreId',sid));
   if e->>'state' not in ('recorded','replayed') then raise exception 'Scoring history unavailable';end if;
   update public.lead_score_batch_items set state='scored',score_id=sid,finished_at=clock_timestamp() where batch_id=b.id and lead_id=item.lead_id;
  exception when others then
   failure:=case when SQLSTATE='P0002' then 'target_changed' else 'score_failed' end;
   update public.lead_score_batch_items set state='failed',error_code=failure,finished_at=clock_timestamp() where batch_id=b.id and lead_id=item.lead_id;
  end;
 end loop;
 if not exists(select 1 from public.lead_score_batch_items where batch_id=b.id and state='pending') then
  update public.lead_score_batches set state='completed',finished_at=clock_timestamp() where id=b.id;
  r:=public.lead_score_batch_status(p_property_id,p_actor_id,b.id);
  e:=public.append_shared_action_event(md5('lead-score-complete/'||b.id)::uuid,b.id,p_property_id,p_actor_id,'leadpulse','lead.scoring.completed','server_confirmed',
   case when (r->>'failed')::int>0 then 'failed' else 'succeeded' end,jsonb_build_object('requestId',b.id),null,null,r-'failures');
  if e->>'state' not in ('recorded','replayed') then raise exception 'Scoring completion history unavailable';end if;
 end if;
 return public.lead_score_batch_status(p_property_id,p_actor_id,b.id);
end;$$;

create function public.cancel_lead_score_batch(p_property_id uuid,p_actor_id uuid,p_batch_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.lead_score_batches;e public.shared_action_events;r jsonb;saved jsonb;
begin
 if p_request_id is null then raise exception 'Decision identity required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'lead.scoring.cancelled',jsonb_build_object('requestId',p_batch_id)) then return '{"state":"request_conflict"}';end if;
  return public.lead_score_batch_status(p_property_id,p_actor_id,p_batch_id);
 end if;
 select * into b from public.lead_score_batches where id=p_batch_id and property_id=p_property_id;
 if not found then return '{"state":"not_found"}';end if;
 if b.state<>'running' then return public.lead_score_batch_status(p_property_id,p_actor_id,b.id);end if;
 update public.lead_score_batches set state='cancelled',finished_at=clock_timestamp() where id=b.id;
 r:=public.lead_score_batch_status(p_property_id,p_actor_id,b.id);
 saved:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'leadpulse','lead.scoring.cancelled','server_confirmed','succeeded',jsonb_build_object('requestId',p_batch_id),null,null,r-'failures');
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Scoring stop history unavailable';end if;
 return r;
end;$$;

alter table public.lead_score_inputs enable row level security;
create policy lead_score_inputs_service on public.lead_score_inputs for all to service_role using(true) with check(true);
revoke all on public.lead_score_inputs from public,anon,authenticated;
grant all on public.lead_score_inputs to service_role;

alter table public.lead_engagement_receipts enable row level security;
create policy lead_engagement_receipts_service on public.lead_engagement_receipts for all to service_role using(true) with check(true);
revoke all on public.lead_engagement_receipts from public,anon,authenticated;
grant all on public.lead_engagement_receipts to service_role;

alter table public.lead_event_corrections enable row level security;
create policy lead_event_corrections_service on public.lead_event_corrections for all to service_role using(true) with check(true);
revoke all on public.lead_event_corrections from public,anon,authenticated;
grant all on public.lead_event_corrections to service_role;

alter table public.lead_score_batches enable row level security;
create policy lead_score_batches_service on public.lead_score_batches for all to service_role using(true) with check(true);
revoke all on public.lead_score_batches from public,anon,authenticated;
grant all on public.lead_score_batches to service_role;

alter table public.lead_score_batch_items enable row level security;
create policy lead_score_batch_items_service on public.lead_score_batch_items for all to service_role using(true) with check(true);
revoke all on public.lead_score_batch_items from public,anon,authenticated;
grant all on public.lead_score_batch_items to service_role;

revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.protect_leadpulse_history() from public,anon,authenticated;
grant execute on function public.protect_leadpulse_history() to service_role;
revoke all on function public.score_lead(uuid) from public,anon,authenticated;
grant execute on function public.score_lead(uuid) to service_role;
revoke all on function public.leadpulse_score_summary(uuid) from public,anon,authenticated;
grant execute on function public.leadpulse_score_summary(uuid) to service_role;
revoke all on function public.record_lead_engagement(uuid,uuid,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_lead_engagement(uuid,uuid,text,jsonb,text,text,uuid) to service_role;
revoke all on function public.correct_lead_engagement(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.correct_lead_engagement(uuid,uuid,uuid,uuid,uuid,text) to service_role;
revoke all on function public.protect_lead_score_batch() from public,anon,authenticated;
grant execute on function public.protect_lead_score_batch() to service_role;
revoke all on function public.lead_score_batch_status(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.lead_score_batch_status(uuid,uuid,uuid) to service_role;
revoke all on function public.run_lead_score_batch(uuid,uuid,uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.run_lead_score_batch(uuid,uuid,uuid,uuid[],uuid) to service_role;
revoke all on function public.cancel_lead_score_batch(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_lead_score_batch(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';

create function public.read_leadpulse_score(p_property_id uuid,p_actor_id uuid,p_lead_id uuid,p_score_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s public.lead_scores;i public.lead_score_inputs;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then return '{"state":"not_found"}';end if;
 select * into s from public.lead_scores where lead_id=p_lead_id and (p_score_id is null or id=p_score_id) order by scored_at desc,id desc limit 1;
 if not found then return '{"state":"unscored","score":null}';end if;
 select * into i from public.lead_score_inputs where score_id=s.id;
 return jsonb_build_object('state','saved','score',to_jsonb(s),'provenance',case when i.score_id is null then jsonb_build_object('status','legacy') else
 jsonb_build_object('status','captured','inputHash',i.input_hash,'evaluatedAt',i.evaluated_at,'eventCount',jsonb_array_length(i.input->'events'),
 'reportedEventCount',(select count(*) from jsonb_array_elements(i.input->'events') e where e->>'origin'='operator'),
 'legacyEventCount',(select count(*) from jsonb_array_elements(i.input->'events') e where e->>'origin'='legacy'),
 'userMessageCount',jsonb_array_length(i.input->'userMessageIds')) end);
end;$$;
create function public.read_leadpulse_events(p_property_id uuid,p_actor_id uuid,p_lead_id uuid,p_offset int default 0,p_limit int default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare events jsonb;
begin
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'Invalid page';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then return '{"state":"not_found"}';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'eventType',e.event_type,'scoreWeight',e.score_weight,'createdAt',e.created_at,
  'origin',coalesce(r.origin,'legacy'),'corrected',c.id is not null,'correctionReason',c.reason,'canCorrect',r.origin='operator' and c.id is null,
  'reportedNote',case when r.origin='operator' then r.input->'metadata'->>'note' end) order by e.created_at desc,e.id desc),'[]') into events
 from (select * from public.lead_engagement_events where lead_id=p_lead_id order by created_at desc,id desc offset p_offset limit p_limit) e
 left join public.lead_engagement_receipts r on r.event_id=e.id left join public.lead_event_corrections c on c.event_id=e.id;
 return jsonb_build_object('state','saved','events',events,'total',(select count(*) from public.lead_engagement_events where lead_id=p_lead_id));
end;$$;
create function public.continue_lead_score_batch(p_property_id uuid,p_actor_id uuid,p_batch_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.lead_score_batches;targets uuid[];
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select * into b from public.lead_score_batches where id=p_batch_id and property_id=p_property_id;
 if not found then return '{"state":"not_found"}';end if;
 if b.actor_id<>p_actor_id then return '{"state":"owner_required"}';end if;
 if jsonb_typeof(b.input->'leadIds')='array' then select array_agg(value::uuid) into targets from jsonb_array_elements_text(b.input->'leadIds');end if;
 return public.run_lead_score_batch(p_property_id,p_actor_id,b.id,targets,(b.input->>'retryBatchId')::uuid);
end;$$;

revoke all on function public.read_leadpulse_score(uuid,uuid,uuid,uuid) from public,anon,authenticated;grant execute on function public.read_leadpulse_score(uuid,uuid,uuid,uuid) to service_role;

revoke all on function public.read_leadpulse_events(uuid,uuid,uuid,int,int) from public,anon,authenticated;grant execute on function public.read_leadpulse_events(uuid,uuid,uuid,int,int) to service_role;

revoke all on function public.continue_lead_score_batch(uuid,uuid,uuid) from public,anon,authenticated;grant execute on function public.continue_lead_score_batch(uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';

create function public.list_leadpulse_leads(p_property_id uuid,p_actor_id uuid,p_search text default '',p_bucket text default 'all',p_page int default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;n bigint;
begin
 if p_page<1 or p_page>100000 or length(p_search)>200 or p_bucket not in ('all','hot','warm','cold','unqualified','unscored') then raise exception 'Invalid lead page';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select count(*) into n from public.leads l where property_id=p_property_id
 and (p_search='' or position(lower(p_search) in lower(coalesce(l.first_name,'')||' '||coalesce(l.last_name,'')||' '||coalesce(l.email,'')))>0)
 and (p_bucket='all' or (p_bucket='unscored' and l.score is null) or l.score_bucket=p_bucket);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc nulls last,x.id),'[]') into rows from (
 select id,first_name,last_name,email,source,status,score,score_bucket,created_at from public.leads l where property_id=p_property_id
 and (p_search='' or position(lower(p_search) in lower(coalesce(l.first_name,'')||' '||coalesce(l.last_name,'')||' '||coalesce(l.email,'')))>0)
 and (p_bucket='all' or (p_bucket='unscored' and l.score is null) or l.score_bucket=p_bucket)
 order by score desc nulls last,id offset (p_page-1)*50 limit 50) x;
 return jsonb_build_object('state','saved','leads',rows,'total',n,'page',p_page,'pages',ceil(n/50.0));
end;$$;
create function public.read_leadpulse_insights(p_property_id uuid,p_actor_id uuid,p_days int default 30)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare output jsonb;
begin
 if p_days not between 1 and 90 then raise exception 'Invalid insight period';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 with latest as (
  select l.id,s.total_score,s.score_bucket,s.factors,s.scored_at from public.leads l left join lateral (
   select total_score,score_bucket,factors,scored_at from public.lead_scores where lead_id=l.id order by scored_at desc,id desc limit 1
  ) s on true where l.property_id=p_property_id
 ), buckets as (
  select bucket,count(l.id) n,coalesce(round(avg(l.total_score)),0) avg from unnest(array['hot','warm','cold','unqualified']) bucket
  left join latest l on l.score_bucket=bucket group by bucket
 ), factors as (
  select f->>'factor' factor,f->>'type' kind,count(*) n from latest l cross join lateral jsonb_array_elements(l.factors) f
  where l.scored_at>=now()-make_interval(days=>p_days) and f->>'type' in ('positive','negative') group by f->>'factor',f->>'type'
 ), daily as (
  -- One latest score per lead per UTC day; repeated rescoring cannot inflate the lead count.
  select distinct on(s.lead_id,(s.scored_at at time zone 'UTC')::date) s.lead_id,(s.scored_at at time zone 'UTC')::date as score_day,s.total_score,s.score_bucket
  from public.lead_scores s join public.leads l on l.id=s.lead_id where l.property_id=p_property_id and s.scored_at>=now()-make_interval(days=>least(p_days,14))
  order by s.lead_id,(s.scored_at at time zone 'UTC')::date,s.scored_at desc,s.id desc
 ), trend as (select score_day,round(avg(total_score)) avg,count(*) filter(where score_bucket='hot') hot,count(*) n from daily group by score_day)
 select jsonb_build_object('totalLeads',count(*),'scoredLeads',count(total_score),'avgScore',coalesce(round(avg(total_score)),0),
 'distribution',(select jsonb_agg(jsonb_build_object('bucket',bucket,'count',n,'avgScore',avg,'percentage',case when (select count(total_score) from latest)=0 then 0 else round(100.0*n/(select count(total_score) from latest)) end) order by bucket) from buckets),
 'topFactors',jsonb_build_object('positive',coalesce((select jsonb_agg(jsonb_build_object('factor',factor,'count',n)) from (select * from factors where kind='positive' order by n desc,factor limit 5) f),'[]'),
 'negative',coalesce((select jsonb_agg(jsonb_build_object('factor',factor,'count',n)) from (select * from factors where kind='negative' order by n desc,factor limit 5) f),'[]')),
 'recentTrend',coalesce((select jsonb_agg(jsonb_build_object('date',score_day,'avgScore',avg,'hotLeads',hot,'scoredLeads',n) order by score_day) from trend),'[]'),
 'method','Deterministic rules; latest saved score per lead. Daily trend includes only leads scored that day.','asOf',now()) into output from latest;
 return jsonb_build_object('state','saved','insights',output);
end;$$;

revoke all on function public.list_leadpulse_leads(uuid,uuid,text,text,int) from public,anon,authenticated;grant execute on function public.list_leadpulse_leads(uuid,uuid,text,text,int) to service_role;

revoke all on function public.read_leadpulse_insights(uuid,uuid,int) from public,anon,authenticated;grant execute on function public.read_leadpulse_insights(uuid,uuid,int) to service_role;

notify pgrst,'reload schema';

create table public.lead_score_reviews(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,score_id uuid not null references public.lead_scores(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),judgment text not null check(judgment in ('useful','too_high','too_low','insufficient_evidence')),
 reason text not null,created_at timestamptz not null default clock_timestamp()
);
create index lead_score_reviews_property on public.lead_score_reviews(property_id);
create index lead_score_reviews_lead on public.lead_score_reviews(lead_id,created_at desc);
create index lead_score_reviews_score on public.lead_score_reviews(score_id);
create index lead_score_reviews_actor on public.lead_score_reviews(actor_id);
alter table public.lead_score_reviews enable row level security;
create policy lead_score_reviews_service on public.lead_score_reviews for all to service_role using(true) with check(true);
revoke all on public.lead_score_reviews from public,anon,authenticated;
grant all on public.lead_score_reviews to service_role;
create trigger lead_score_reviews_immutable before update or delete on public.lead_score_reviews for each row execute function public.protect_leadpulse_history();
create function public.review_lead_score(p_property_id uuid,p_lead_id uuid,p_score_id uuid,p_actor_id uuid,p_request_id uuid,p_judgment text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.lead_score_reviews;latest uuid;e jsonb;result jsonb;
begin
 if p_request_id is null or p_judgment is null or p_judgment not in ('useful','too_high','too_low','insufficient_evidence') or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'A score judgment and reason are required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then return '{"state":"not_found"}';end if;
 select * into r from public.lead_score_reviews where id=p_request_id;
 if found then
  if (r.property_id,r.lead_id,r.score_id,r.actor_id,r.judgment,r.reason) is distinct from (p_property_id,p_lead_id,p_score_id,p_actor_id,p_judgment,trim(p_reason)) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','reviewId',r.id,'scoreId',r.score_id);
 end if;
 select id into latest from public.lead_scores where lead_id=p_lead_id order by scored_at desc,id desc limit 1;
 if latest is null or latest is distinct from p_score_id then return '{"state":"stale_score"}';end if;
 insert into public.lead_score_reviews(id,property_id,lead_id,score_id,actor_id,judgment,reason) values(p_request_id,p_property_id,p_lead_id,p_score_id,p_actor_id,p_judgment,trim(p_reason));
 result:=jsonb_build_object('state','applied','reviewId',p_request_id,'scoreId',p_score_id,'judgment',p_judgment,'evidenceKind','operator_assessment');
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'leadpulse','lead.score.reviewed','server_confirmed','succeeded',
  jsonb_build_object('leadId',p_lead_id,'scoreId',p_score_id,'reasonHash',encode(sha256(convert_to(trim(p_reason),'UTF8')),'hex')),public.leadpulse_score_summary(p_score_id),null,result);
 if e->>'state' not in ('recorded','replayed') then raise exception 'Score review history unavailable';end if;
 return result;
end;$$;
create function public.read_lead_score_reviews(p_property_id uuid,p_lead_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then return '{"state":"not_found"}';end if;
 return jsonb_build_object('state','saved','reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from
 (select id,score_id,judgment,reason,created_at from public.lead_score_reviews where property_id=p_property_id and lead_id=p_lead_id order by created_at desc,id desc limit 20) r),'[]'));
end;$$;
revoke all on function public.review_lead_score(uuid,uuid,uuid,uuid,uuid,text,text),public.read_lead_score_reviews(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.review_lead_score(uuid,uuid,uuid,uuid,uuid,text,text),public.read_lead_score_reviews(uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
