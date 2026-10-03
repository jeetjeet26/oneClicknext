-- Explicit, audited correction of an erroneous no-show to completed.
-- Provider calls do not run in this transaction.
create table if not exists public.tour_outcome_corrections (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 tour_source text not null check(tour_source in ('tours','tour_bookings')),
 tour_id uuid not null,
 request_id uuid not null,
 actor_id uuid not null,
 reason text not null check(length(trim(reason)) between 1 and 2000),
 recorded_at timestamptz not null default now(),
 transaction_id bigint not null default txid_current(),
 previous_outcome jsonb,
 previous_events jsonb not null default '[]',
 stopped_workflow_ids uuid[] not null default '{}',
 previous_delivery text not null check(previous_delivery in ('none','sent','unknown')),
 result jsonb,
 unique(property_id,request_id),
 unique(tour_source,tour_id)
);
create index if not exists tour_outcome_corrections_lead on public.tour_outcome_corrections(lead_id);
alter table public.tour_outcome_corrections enable row level security;
revoke all on public.tour_outcome_corrections from public,anon,authenticated;
grant all on public.tour_outcome_corrections to service_role;

create or replace function public.protect_tour_correction_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
   -- Permit scoped parent cleanup; ordinary audit deletion is not an operator action.
   if exists(select 1 from public.leads where id=old.lead_id) and exists(select 1 from public.properties where id=old.property_id) then
     raise exception 'Tour correction history is immutable' using errcode='55000';
   end if;
   return old;
 end if;
 if old.transaction_id<>txid_current() or old.result is not null or new.result is null
   or (to_jsonb(new)-'result') is distinct from (to_jsonb(old)-'result') then
   raise exception 'Tour correction history is immutable' using errcode='55000';
 end if;
 return new;
end; $$;
drop trigger if exists protect_tour_correction_history on public.tour_outcome_corrections;
create trigger protect_tour_correction_history before update or delete on public.tour_outcome_corrections
 for each row execute function public.protect_tour_correction_history();

create or replace function public.protect_recorded_tour_outcome() returns trigger
language plpgsql security invoker set search_path='' as $$
declare schedule_changed boolean;
begin
 schedule_changed:=case when tg_table_name='tours' then
   (to_jsonb(new)->>'tour_date',to_jsonb(new)->>'tour_time') is distinct from (to_jsonb(old)->>'tour_date',to_jsonb(old)->>'tour_time')
 else (to_jsonb(new)->>'scheduled_date',to_jsonb(new)->>'scheduled_time',to_jsonb(new)->>'duration_minutes') is distinct from
      (to_jsonb(old)->>'scheduled_date',to_jsonb(old)->>'scheduled_time',to_jsonb(old)->>'duration_minutes') end;
 if old.status in ('completed','no_show') and (new.status is distinct from old.status or schedule_changed) then
   -- The correction RPC inserts a private audit row in this transaction before
   -- restoring eligibility for the existing atomic completion operation.
   if old.status='no_show' and new.status='confirmed' and not schedule_changed then
     if exists(select 1 from public.tour_outcome_corrections c where c.property_id=old.property_id
       and c.lead_id=old.lead_id and c.tour_source=tg_table_name and c.tour_id=old.id
       and c.transaction_id=txid_current() and c.result is null) then return new; end if;
   end if;
   raise exception 'Recorded tour outcome requires a deliberate correction' using errcode='55000';
 end if;
 return new;
end; $$;

create or replace function public.correct_tour_no_show(
 p_property_id uuid,p_lead_id uuid,p_source text,p_tour_id uuid,p_request_id uuid,p_actor_id uuid,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 prior public.tour_outcomes; correction public.tour_outcome_corrections;
 s jsonb; event_ids uuid[]:='{}'; prior_events jsonb:='[]'; workflow_ids uuid[]:='{}';
 delivery text:='none'; completion jsonb; final_result jsonb; corrected_id uuid:=gen_random_uuid();
 reason text:=trim(p_reason); workflow_row public.lead_workflows;
begin
 if p_source is null or p_source not in ('tours','tour_bookings') or p_request_id is null or p_actor_id is null
   or reason is null or length(reason) not between 1 and 2000 then raise exception 'Invalid tour correction input'; end if;
 -- The API derives actor_id from the authenticated session. Check tenant scope again.
 if not exists(select 1 from public.profiles pr join public.properties p on p.org_id=pr.org_id
   where pr.id=p_actor_id and p.id=p_property_id) then return jsonb_build_object('state','forbidden'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into correction from public.tour_outcome_corrections where property_id=p_property_id and request_id=p_request_id;
 if found then
   if correction.lead_id<>p_lead_id or correction.tour_source<>p_source or correction.tour_id<>p_tour_id
     or correction.actor_id<>p_actor_id or correction.reason<>reason then return jsonb_build_object('state','request_conflict'); end if;
   return correction.result || jsonb_build_object('state','replayed','leadStatus',(select status from public.leads where id=p_lead_id and property_id=p_property_id));
 end if;
 if p_source='tours' then
   perform 1 from public.tours where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update;
 else
   perform 1 from public.tour_bookings where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update;
 end if;
 if not found then return jsonb_build_object('state','not_found'); end if;
 perform 1 from public.leads where id=p_lead_id and property_id=p_property_id for update;
 if not found then return jsonb_build_object('state','not_found'); end if;
 s:=public.tour_outcome_schedule(p_property_id,p_source,p_tour_id);
 if s->>'status'<>'no_show' then return jsonb_build_object('state','conflict'); end if;
 if s->>'startsAt' is not null and (s->>'startsAt')::timestamptz>now() then return jsonb_build_object('state','not_due'); end if;
 -- Legacy metadata without a source is only usable for an unambiguous identifier.
 if exists(select 1 from public.tours where id=p_tour_id) and exists(select 1 from public.tour_bookings where id=p_tour_id) then
   return jsonb_build_object('state','history_conflict');
 end if;
 select * into prior from public.tour_outcomes where tour_source=p_source and tour_id=p_tour_id for update;
 if found and (prior.outcome<>'no_show' or prior.property_id<>p_property_id or prior.lead_id<>p_lead_id) then
   return jsonb_build_object('state','history_conflict');
 end if;
 -- Stop only this lead's no-show follow-ups. A completed visit supersedes those
 -- even if an older record lacks a workflow link. Other workflow kinds are retained.
 for workflow_row in select lw.* from public.lead_workflows lw join public.workflow_definitions d on d.id=lw.workflow_id
   where lw.lead_id=p_lead_id and d.property_id=p_property_id and d.trigger_on='tour_no_show'
     and (lw.status in ('active','paused') or lw.processing_started_at is not null or lw.processing_expires_at is not null) order by lw.id for update of lw loop
   if workflow_row.processing_started_at is not null or workflow_row.processing_expires_at is not null then
     if workflow_row.processing_expires_at>now() then return jsonb_build_object('state','delivery_busy');
     else return jsonb_build_object('state','delivery_review_required'); end if;
   end if;
   if workflow_row.status in ('active','paused') then workflow_ids:=array_append(workflow_ids,workflow_row.id); end if;
 end loop;
 if p_source='tour_bookings' then
   perform 1 from public.luma_delivery_jobs where booking_id=p_tour_id for update;
   if exists(select 1 from public.luma_delivery_jobs where booking_id=p_tour_id and state='running' and lease_until>now()) then
     return jsonb_build_object('state','delivery_busy');
   end if;
 end if;
 -- Evidence of prior sends is kept honest; an already accepted message cannot be recalled.
 if exists(select 1 from public.workflow_actions a join public.lead_workflows lw on lw.id=a.lead_workflow_id
     join public.workflow_definitions d on d.id=lw.workflow_id where lw.lead_id=p_lead_id and d.property_id=p_property_id
     and d.trigger_on='tour_no_show' and a.status='sent' and nullif(a.external_id,'') is not null)
   or (p_source='tours' and exists(select 1 from public.tours where id=p_tour_id and noshow_followup_sent_at is not null)) then delivery:='sent';
 elsif prior.id is null or prior.followup_state='legacy' or exists(select 1 from public.workflow_actions a
     join public.lead_workflows lw on lw.id=a.lead_workflow_id join public.workflow_definitions d on d.id=lw.workflow_id
     where lw.lead_id=p_lead_id and d.property_id=p_property_id and d.trigger_on='tour_no_show'
       and (a.status is distinct from 'skipped')) then delivery:='unknown';
 end if;
 -- Lock and preserve precisely the no-show events for this tour; other penalties stay intact.
 perform 1 from public.lead_engagement_events e where e.lead_id=p_lead_id and (e.property_id=p_property_id or e.property_id is null)
   and e.event_type='tour_no_show' and (e.idempotency_key='tour-outcome/'||p_source||'/'||p_tour_id or
     (coalesce(e.metadata->>'tour_id',e.metadata->>'booking_id')=p_tour_id::text and coalesce(e.metadata->>'tour_source',p_source)=p_source)) for update;
 select coalesce(array_agg(e.id),'{}'),coalesce(jsonb_agg(to_jsonb(e)),'[]') into event_ids,prior_events
   from public.lead_engagement_events e where e.lead_id=p_lead_id and (e.property_id=p_property_id or e.property_id is null)
   and e.event_type='tour_no_show' and (e.idempotency_key='tour-outcome/'||p_source||'/'||p_tour_id or
     (coalesce(e.metadata->>'tour_id',e.metadata->>'booking_id')=p_tour_id::text and coalesce(e.metadata->>'tour_source',p_source)=p_source));
 if exists(select 1 from public.lead_engagement_events e where e.lead_id=p_lead_id and e.event_type='tour_completed'
   and coalesce(e.metadata->>'tour_id',e.metadata->>'booking_id')=p_tour_id::text) then return jsonb_build_object('state','history_conflict'); end if;
 insert into public.tour_outcome_corrections(id,property_id,lead_id,tour_source,tour_id,request_id,actor_id,reason,previous_outcome,previous_events,stopped_workflow_ids,previous_delivery)
   values(corrected_id,p_property_id,p_lead_id,p_source,p_tour_id,p_request_id,p_actor_id,reason,coalesce(to_jsonb(prior),'{}')||jsonb_build_object('_schedule',s),prior_events,workflow_ids,delivery);
 update public.lead_workflows set status='stopped',next_action_at=null,updated_at=now() where id=any(workflow_ids);
 update public.lead_engagement_events set score_weight=0,idempotency_key='tour-correction/'||corrected_id||'/'||id,
   metadata=coalesce(metadata,'{}')||jsonb_build_object('reversed_by_correction',corrected_id,'previous_score_weight',score_weight)
   where id=any(event_ids);
 delete from public.tour_outcomes where tour_source=p_source and tour_id=p_tour_id;
 if p_source='tours' then update public.tours set status='confirmed' where id=p_tour_id;
 else update public.tour_bookings set status='confirmed' where id=p_tour_id; end if;
 completion:=public.record_tour_outcome(p_property_id,p_lead_id,p_source,p_tour_id,'completed',reason,false);
 if completion->>'state'<>'applied' then raise exception 'Correction completion was not confirmed'; end if;
 insert into public.lead_activities(lead_id,type,description,metadata,created_by) values(p_lead_id,'tour_outcome_corrected',
   'No-show corrected to completed: '||reason,
   jsonb_build_object('tour_id',p_tour_id,'_tour_source',p_source,'_correction_id',corrected_id,'_previous_delivery',delivery),p_actor_id);
 final_result:=completion||jsonb_build_object('correction',jsonb_build_object('id',corrected_id,'reason',reason,'recordedAt',now(),
   'previousDelivery',delivery,'stoppedWorkflows',cardinality(workflow_ids),'reversedEvents',cardinality(event_ids)));
 update public.tour_outcome_corrections set result=final_result where id=corrected_id;
 return final_result;
end; $$;
revoke all on function public.protect_tour_correction_history(),public.correct_tour_no_show(uuid,uuid,text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.protect_tour_correction_history(),public.correct_tour_no_show(uuid,uuid,text,uuid,uuid,uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.score_lead(p_lead_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
begin
  select * into v_lead
  from public.leads
  where id = p_lead_id;

  if not found then
    raise exception 'Lead not found: %', p_lead_id;
  end if;

  v_days_since_creation := extract(day from now() - v_lead.created_at);

  select
    count(*)::int,
    coalesce(sum(greatest(-25, least(40, score_weight))), 0)::int
  into v_event_count, v_event_weight
  from public.lead_engagement_events
  where lead_id = p_lead_id;

  select count(*)::int into v_message_count
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where c.lead_id = p_lead_id
    and m.role = 'user';

  v_engagement_score := least(
    30,
    greatest(0, v_event_weight + (v_message_count * 5))
  );

  if v_event_count > 0 then
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Audited engagement',
      'impact', format(
        '%s bounded event point(s) across %s event(s), plus %s user message(s)',
        v_event_weight,
        v_event_count,
        v_message_count
      ),
      'type', case when v_event_weight > 0 then 'positive' else 'neutral' end
    );
  end if;

  if v_days_since_creation <= 1 then
    v_timing_score := 25;
    v_factors := v_factors || jsonb_build_object(
      'factor', 'Brand new lead',
      'impact', 'Created within 24 hours',
      'type', 'positive'
    );
  elsif v_days_since_creation <= 7 then
    v_timing_score := 20;
  elsif v_days_since_creation <= 30 then
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
  elsif exists (
    select 1
    from public.tours
    where lead_id = p_lead_id
      and status = 'completed'
  ) or exists (
    select 1 from public.tour_bookings
    where lead_id = p_lead_id and status = 'completed'
  ) then
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
    model_version
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
    'v2.1-tour-source-parity'
  )
  returning id into v_score_id;

  return v_score_id;
end;
$function$;

notify pgrst,'reload schema';
