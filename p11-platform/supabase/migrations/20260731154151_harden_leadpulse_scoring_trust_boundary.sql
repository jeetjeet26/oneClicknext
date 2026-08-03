-- Keep engagement weights server-controlled, bounded, and inspectable.
update public.lead_engagement_events
set score_weight = greatest(-25, least(40, coalesce(score_weight, 0)))
where score_weight is null
   or score_weight < -25
   or score_weight > 40;

alter table public.lead_engagement_events
  alter column score_weight set default 0,
  alter column score_weight set not null;

alter table public.lead_engagement_events
  drop constraint if exists lead_engagement_events_score_weight_bounds;

alter table public.lead_engagement_events
  add constraint lead_engagement_events_score_weight_bounds
  check (score_weight between -25 and 40);

comment on constraint lead_engagement_events_score_weight_bounds
  on public.lead_engagement_events
  is 'Bounds server-assigned LeadPulse event weights before score aggregation.';

create or replace function public.score_lead(p_lead_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
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
    'v2-bounded-event-weights'
  )
  returning id into v_score_id;

  return v_score_id;
end;
$$;
