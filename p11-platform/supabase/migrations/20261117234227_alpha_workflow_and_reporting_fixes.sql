create or replace function public.read_marketing_facts(
  p_property_id uuid, p_start_date date default null, p_end_date date default null,
  p_channels text[] default null, p_campaign_id text default null, p_source_account_id text default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare rows jsonb; total integer;
begin
  if current_user <> 'service_role' and current_setting('role', true) is distinct from 'service_role' and ((select auth.uid()) is null or not exists (
    select 1 from public.properties pr join public.profiles pf on pf.org_id=pr.org_id
    where pr.id=p_property_id and pf.id=(select auth.uid())
  )) then raise exception 'Property access denied' using errcode='42501'; end if;
  if (p_start_date is not null and p_end_date is not null and
      (p_end_date<p_start_date or p_end_date-p_start_date>366)) then
    raise exception 'Choose a date range of at most 366 days' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.date,f.id),'[]'::jsonb),count(*) into rows,total
  from (
    select id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,
      impressions,clicks,spend,conversions,raw_source
    from public.fact_marketing_performance f
    where property_id=p_property_id and not exists(select 1 from public.bi_data_row_state s where s.property_id=f.property_id and s.kind='daily'and s.row_id=f.id and s.excluded)
      and (p_start_date is null or date>=p_start_date)
      and (p_end_date is null or date<=p_end_date)
      and (p_channels is null or channel_id=any(p_channels))
      and (p_campaign_id is null or campaign_id=p_campaign_id)
      and (p_source_account_id is null or source_account_id=nullif(p_source_account_id,'')
           or (p_source_account_id='' and source_account_id is null))
    order by date,id limit 50001
  ) f;
  if total>50000 then
    raise exception 'This report exceeds 50000 records. Choose a shorter date range.' using errcode='22023';
  end if;
  return jsonb_build_object('rows',rows,'row_count',total,'complete',true);
end;
$$;

-- Consent is scoped to a property, lead and exact destination. A STOP applies
-- across leads and properties sharing the same sending number.
create table private.workflow_sms_consents (
  property_id uuid not null references public.properties(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  recipient text not null,
  disclosure_version text not null,
  disclosure text not null,
  received_at timestamptz not null default now(),
  primary key (property_id, lead_id, recipient)
);
create table private.workflow_sms_optouts (
  sender text not null,
  recipient text not null,
  received_at timestamptz not null default now(),
  primary key (sender, recipient)
);
revoke all on private.workflow_sms_consents, private.workflow_sms_optouts from public, anon, authenticated;
grant select, insert on private.workflow_sms_consents, private.workflow_sms_optouts to service_role;

create function private.sms_phone_key(phone text) returns text
language sql immutable strict set search_path = '' as $$
  select case
    when phone ~ '^[ ()0-9.+-]+$' and digits ~ '^[2-9][0-9]{9}$' and left(trim(phone),1) <> '+' then '+1' || digits
    when phone ~ '^[ ()0-9.+-]+$' and (left(trim(phone),1) = '+' or digits ~ '^1[0-9]{10}$') and digits ~ '^[1-9][0-9]{7,14}$' then '+' || digits
  end from (select regexp_replace(phone,'[^0-9]','','g') digits) normalized;
$$;
revoke all on function private.sms_phone_key(text) from public,anon,authenticated;
grant execute on function private.sms_phone_key(text) to service_role;

create function public.record_workflow_sms_optout(p_sender text, p_recipient text) returns void
language plpgsql security invoker set search_path = '' as $$
declare sender_key text := private.sms_phone_key(p_sender); recipient_key text := private.sms_phone_key(p_recipient);
begin
  if sender_key is null or recipient_key is null then raise exception 'Invalid sender or recipient' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(sender_key || '/' || recipient_key, 71));
  insert into private.workflow_sms_optouts(sender,recipient) values(sender_key,recipient_key) on conflict do nothing;
end;
$$;
revoke all on function public.record_workflow_sms_optout(text,text) from public,anon,authenticated;
grant execute on function public.record_workflow_sms_optout(text,text) to service_role;

create or replace function public.upsert_luma_lead(p_property_id uuid,p_email text,p_phone text,p_existing_id uuid,p_create jsonb,p_update jsonb,p_activity jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.leads; incoming public.leads; matched text; existing boolean:=false; w public.workflow_definitions; first_delay numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,11));
 select * into l from public.leads where property_id=p_property_id and id=p_existing_id;
 if found then matched:='id'; else
   select * into l from public.leads where property_id=p_property_id and lower(trim(email))=lower(nullif(trim(p_email),'')) order by created_at,id limit 1;
   if found then matched:='email'; else
     select * into l from public.leads where property_id=p_property_id and phone=nullif(trim(p_phone),'') order by created_at,id limit 1;
     if found then matched:='phone'; end if;
   end if;
 end if;
 existing:=l.id is not null;
 if existing then
   incoming:=jsonb_populate_record(l,p_update);
   if nullif(trim(p_update->>'notes'),'') is not null and position((p_update->>'notes') in coalesce(l.notes,''))=0 then
     incoming.notes:=concat_ws(E'\n\n',nullif(l.notes,''),p_update->>'notes'); end if;
   update public.leads set first_name=incoming.first_name,last_name=incoming.last_name,email=incoming.email,phone=incoming.phone,
      notes=incoming.notes,move_in_date=incoming.move_in_date,bedrooms=incoming.bedrooms,status=incoming.status,updated_at=now()
      where id=l.id returning * into l;
 else
   incoming:=jsonb_populate_record(null::public.leads,p_create);
   insert into public.leads(property_id,first_name,last_name,email,phone,source,status,notes,move_in_date,bedrooms,attribution)
     values(p_property_id,coalesce(incoming.first_name,''),coalesce(incoming.last_name,''),incoming.email,incoming.phone,incoming.source,coalesce(incoming.status,'new'),incoming.notes,incoming.move_in_date,incoming.bedrooms,coalesce(incoming.attribution,'{}'::jsonb)) returning * into l;
 end if;
 -- Preserve the original acquisition tags on repeat contact. Consent can only
 -- bind to the number supplied for this booking and still present on the lead.
 if p_create->'smsMarketingOptIn' = 'true'::jsonb and p_create->>'source' = 'LumaLeasing Tour Booking'
    and private.sms_phone_key(l.phone) = private.sms_phone_key(p_phone) then
   insert into private.workflow_sms_consents(property_id,lead_id,recipient,disclosure_version,disclosure)
     values(p_property_id,l.id,private.sms_phone_key(p_phone),'luma-booking-v1','I agree to receive automated marketing texts from this property at the number above. Consent is optional. Message frequency varies. Message and data rates may apply. Reply STOP to opt out.') on conflict do nothing;
 end if;
 -- Existing CRM retry worker owns delivery; no public request sends externally.
 update public.leads set crm_sync_status=case when crm_sync_status='processing' then crm_sync_status else 'pending' end,
   crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=l.id;
 if existing and p_activity is not null and not exists(select 1 from public.lead_activities where lead_id=l.id and description=p_activity->>'description' and created_at>now()-interval '5 minutes') then
   insert into public.lead_activities(lead_id,type,description,metadata) values(l.id,coalesce(p_activity->>'type','note'),p_activity->>'description',coalesce(p_activity->'metadata','{}'));
 end if;
 -- Only explicitly enabled follow-ups are enrolled. No default workflow is enabled here.
 if not existing then
   for w in select * from public.workflow_definitions where property_id=p_property_id and trigger_on='lead_created' and is_active loop
     if jsonb_typeof(w.steps)='array' and jsonb_array_length(w.steps)>0 then
       first_delay:=greatest(0,coalesce((w.steps->0->>'delay_hours')::numeric,0));
       insert into public.lead_workflows(lead_id,workflow_id,current_step,status,next_action_at)
         values(l.id,w.id,0,'active',now()+make_interval(secs=>(first_delay*3600)::integer));
     end if;
   end loop;
 end if;
 return jsonb_build_object('lead',to_jsonb(l),'leadId',l.id,'isExisting',existing,'matchedBy',matched);
end; $$;

create or replace function public.start_workflow_delivery(p_id uuid,p_token uuid,p_body text,p_subject text,p_sender text,p_issue text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.workflow_deliveries;w public.lead_workflows;l public.leads;definition public.workflow_definitions;t public.follow_up_templates;reason text:=p_issue;
begin
 select * into d from public.workflow_deliveries where id=p_id;if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(d.property_id::text,12));
 select * into l from public.leads where id=d.lead_id and property_id=d.property_id for update;
 select * into w from public.lead_workflows where id=d.lead_workflow_id for update;
 select * into d from public.workflow_deliveries where id=p_id for update;
 if d.state<>'running' or d.lease_token is distinct from p_token or d.lease_until<=now() or d.started_at is not null then return null;end if;
 select * into definition from public.workflow_definitions where id=w.workflow_id and property_id=d.property_id;
 select * into t from public.follow_up_templates where id=d.template_id and property_id=d.property_id;
 if d.channel='sms' then
   perform pg_advisory_xact_lock(hashtextextended(private.sms_phone_key(p_sender) || '/' || private.sms_phone_key(d.recipient),71));
 end if;
 if w.status<>'active' or w.current_step<>d.step_number then reason:='workflow_changed';
 elsif coalesce(definition.exit_conditions,'[]') ? l.status then reason:='lead_exit_condition';
 elsif not coalesce(definition.is_active,false) or definition.steps is distinct from d.snapshot->'steps' or definition.exit_conditions is distinct from d.snapshot->'exitConditions' then reason:='definition_changed';
 elsif to_jsonb(t) is distinct from d.snapshot->'template' or not coalesce(t.is_active,false) then reason:='template_changed';
 elsif d.recipient is distinct from (case d.channel when 'sms' then l.phone else l.email end) then reason:='recipient_changed';
 elsif d.channel='sms' and (coalesce((to_jsonb(l)->>'opted_out')::boolean,false) or exists (
   select 1 from private.workflow_sms_optouts where sender=private.sms_phone_key(p_sender) and recipient=private.sms_phone_key(d.recipient)
 )) then reason:='sms_opted_out';
 elsif d.channel='sms' and not exists (
   select 1 from private.workflow_sms_consents where property_id=d.property_id and lead_id=l.id and recipient=private.sms_phone_key(d.recipient)
 ) then reason:='sms_consent_required';
 elsif d.deadline<=now() or d.attempts>=3 or d.legacy then reason:='retry_limit';
 elsif nullif(trim(p_body),'') is null or nullif(trim(p_sender),'') is null or (d.channel='email' and nullif(trim(p_subject),'') is null) then reason:='configuration_missing';
 elsif d.body is not null and (d.body,d.subject,d.sender) is distinct from (p_body,p_subject,p_sender) then reason:='message_changed';end if;
 if reason is not null then
  update public.workflow_deliveries set state='review',error_code=reason,lease_token=null,lease_until=null where id=p_id;
  update public.lead_workflows set processing_started_at=null,processing_expires_at=null where id=w.id;return null;
 end if;
 update public.workflow_deliveries set started_at=now(),first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1,body=p_body,subject=p_subject,sender=p_sender where id=p_id returning * into d;
 return to_jsonb(d);
end; $$;

alter table public.tour_bookings add column attribution jsonb not null default '{}'::jsonb;

create or replace function public.reserve_luma_tour(p_property_id uuid,p_lead_id uuid,p_booking jsonb,p_delivery jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.tour_bookings; existing public.tour_bookings; slot public.tour_slots; capacity integer:=1;zone text;wall timestamp;instant timestamptz;matches integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties where id=p_property_id for share;
 perform 1 from public.agent_calendars where property_id=p_property_id and sync_enabled for share;
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then raise exception 'Lead scope mismatch'; end if;
 b:=jsonb_populate_record(null::public.tour_bookings,p_booking);
 if b.booked_via_conversation_id is not null and not exists(select 1 from public.conversations where id=b.booked_via_conversation_id and property_id=p_property_id) then raise exception 'Conversation scope mismatch'; end if;
 select * into existing from public.tour_bookings where property_id=p_property_id and lead_id=p_lead_id and scheduled_date=b.scheduled_date and scheduled_time=b.scheduled_time and status in ('scheduled','confirmed') order by created_at limit 1;
 if found then return jsonb_build_object('booking',to_jsonb(existing),'duplicate',true); end if;
 zone:=public.tour_booking_context(p_property_id)->>'timezone';
 if zone is null then raise exception 'Tour timezone needs configuration' using errcode='22023';end if;
 if b.scheduled_date is null or b.scheduled_time is null or b.duration_minutes not between 5 and 240 then raise exception 'Invalid tour schedule' using errcode='22023';end if;
 wall:=b.scheduled_date+b.scheduled_time;instant:=wall at time zone zone;
 select count(distinct candidate) into matches from (
  select (wall-((probe at time zone zone)-(probe at time zone 'UTC'))) at time zone 'UTC' candidate
  from (values(instant-interval '2 days'),(instant),(instant+interval '2 days')) x(probe)
 ) y where candidate at time zone zone=wall;
 if matches<>1 or instant<=now() then raise exception 'Tour time is not a unique future instant' using errcode='22023';end if;
 if (p_delivery ? 'timezone' and p_delivery->>'timezone' is distinct from zone)
  or (p_delivery ? 'startsAt' and (p_delivery->>'startsAt')::timestamptz is distinct from instant) then
  raise exception 'Tour timezone changed during booking' using errcode='40001';end if;
 p_delivery:=p_delivery||jsonb_build_object('timezone',zone,'startsAt',instant,'bookingDate',b.scheduled_date,'bookingTime',to_char(b.scheduled_time,'HH24:MI'),'durationMinutes',coalesce(b.duration_minutes,30));
 if b.slot_id is not null then
   select * into slot from public.tour_slots where id=b.slot_id and property_id=p_property_id and slot_date=b.scheduled_date and start_time=b.scheduled_time and is_available for update;
   if not found or coalesce(slot.current_bookings,0)>=coalesce(slot.max_bookings,1) then raise exception 'Tour slot is no longer available'; end if;
   capacity:=coalesce(slot.max_bookings,1);
 end if;
 -- The table guard checks both tour sources under the same property lock.
 insert into public.tour_bookings(property_id,lead_id,slot_id,scheduled_date,scheduled_time,duration_minutes,special_requests,source,booked_via_conversation_id,status,schedule_timezone,attribution)
   values(p_property_id,p_lead_id,b.slot_id,b.scheduled_date,b.scheduled_time,coalesce(b.duration_minutes,30),b.special_requests,b.source,b.booked_via_conversation_id,'confirmed',zone,coalesce(b.attribution,'{}'::jsonb)) returning * into b;
 insert into public.lead_activities(lead_id,type,description,metadata) values(p_lead_id,'tour_booked',format('Tour reserved for %s at %s',b.scheduled_date,b.scheduled_time),jsonb_build_object('booking_id',b.id));
 update public.leads set status=case when status in ('leased','lost','toured') then status else 'tour_booked' end,crm_sync_status=case when crm_sync_status='processing' then 'processing' else 'pending' end,crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=p_lead_id;
 insert into public.luma_delivery_jobs(property_id,booking_id,payload) values(p_property_id,b.id,p_delivery);
 return jsonb_build_object('booking',to_jsonb(b),'duplicate',false);
end; $$;

create or replace function private.delivery_funnel(p_property uuid,p_start date,p_end date) returns jsonb language sql stable security invoker set search_path='' as $$
 with cohort as (
  select l.id,l.created_at,l.attribution,coalesce(nullif(l.source,''),'Unknown') source from public.leads l join public.properties p on p.id=l.property_id
  where l.property_id=p_property and (l.org_id is null or l.org_id=p.org_id) and l.created_at>=p_start::timestamp at time zone 'UTC' and l.created_at<(p_end+1)::timestamp at time zone 'UTC'
 ), stages as (
  select c.id,'booked' stage from cohort c join public.tours t on t.lead_id=c.id and t.property_id=p_property where t.status<>'cancelled' and t.tour_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,'booked' from cohort c join public.tour_bookings t on t.lead_id=c.id and t.property_id=p_property where t.status<>'cancelled' and t.scheduled_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,'attended' from cohort c join public.tours t on t.lead_id=c.id and t.property_id=p_property where t.status='completed' and t.tour_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,'attended' from cohort c join public.tour_bookings t on t.lead_id=c.id and t.property_id=p_property where t.status='completed' and t.scheduled_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,o.stage from cohort c join public.delivery_outcomes o on o.lead_id=c.id and o.property_id=p_property join public.properties p on p.id=o.property_id and p.org_id=o.org_id where o.state='active' and o.occurred_on between (c.created_at at time zone 'UTC')::date and p_end
 ), per_lead as (
 select c.id,c.source,bool_or(s.stage='booked') booked,bool_or(s.stage='attended') attended,bool_or(s.stage='application') application,bool_or(s.stage='lease') lease from cohort c left join stages s on s.id=c.id group by c.id,c.source
 ) select jsonb_build_object('definition','inquiry-cohort-v1','start',p_start,'end',p_end,'inquiries',(select count(*)from cohort),
 'booked',(select count(*)from per_lead where booked),'attended',(select count(*)from per_lead where attended),'applications',(select count(*)from per_lead where application),'leases',(select count(*)from per_lead where lease),
 'sources',(select coalesce(jsonb_agg(to_jsonb(x)order by x.source),'[]')from(select source,count(*) inquiries,count(*)filter(where booked)booked,count(*)filter(where attended)attended,count(*)filter(where application)applications,count(*)filter(where lease)leases from per_lead group by source)x),
 'campaigns',(select coalesce(jsonb_agg(to_jsonb(x) order by x.inquiries desc,x."captureSource",x.source,x.medium,x.campaign),'[]') from (
   select c.source as "captureSource", c.attribution->>'source' as source, c.attribution->>'medium' as medium,
          c.attribution->>'campaign' as campaign, count(*) as inquiries,count(*) filter(where s.booked) as booked
   from cohort c join per_lead s on s.id=c.id
   where coalesce(nullif(c.attribution->>'source',''),nullif(c.attribution->>'medium',''),nullif(c.attribution->>'campaign','')) is not null
   group by 1,2,3,4) x),
 'bookingCampaigns',(select coalesce(jsonb_agg(to_jsonb(x) order by x.bookings desc,x.source,x.medium,x.campaign),'[]') from (
   select t.attribution->>'source' source, t.attribution->>'medium' medium, t.attribution->>'campaign' campaign, count(*) bookings
   from public.tour_bookings t
   where t.property_id=p_property and t.status<>'cancelled'
     and t.created_at >= p_start::timestamp at time zone 'UTC' and t.created_at < (p_end+1)::timestamp at time zone 'UTC'
     and coalesce(nullif(t.attribution->>'source',''),nullif(t.attribution->>'medium',''),nullif(t.attribution->>'campaign','')) is not null
   group by 1,2,3) x),
 'reportedRecords',(select count(*)from public.delivery_outcomes o join cohort c on c.id=o.lead_id join public.properties p on p.id=o.property_id and p.org_id=o.org_id where o.property_id=p_property and o.state='active' and o.occurred_on between p_start and p_end),
 'lastOutcomeUpdate',(select max(o.updated_at)from public.delivery_outcomes o join public.properties p on p.id=o.property_id and p.org_id=o.org_id where o.property_id=p_property),
 'limitations','Stored inquiry records, not deduplicated people across CRM systems. Reported applications and leases require staff evidence; no live PMS reconciliation is implied. Stages are observed separately and are not inferred. Later outcomes are excluded from this period.');
$$;

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
    when 'siteforge' then v_source_score := 20;
    when 'aichat' then v_source_score := 20;
    when 'lumaleasingtourbooking' then v_source_score := 20;
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
    'rules-v3.1-source-aliases', v_at
  )
  returning id into v_score_id;

  update public.leads set score=v_total_score,score_bucket=v_score_bucket where id=p_lead_id;
  v_input:=jsonb_build_object('evaluatedAt',v_at,'createdAt',v_lead.created_at,'ageDays',v_days_since_creation,
    'normalizedSource',v_normalized_source,'status',v_lead.status,
    'hasEmail',nullif(v_lead.email,'') is not null,'hasPhone',nullif(v_lead.phone,'') is not null,
    'hasFirstName',nullif(v_lead.first_name,'') is not null,'hasMoveInDate',v_lead.move_in_date is not null,
    'events',v_events,'eventWeight',v_event_weight,'userMessageIds',v_messages,'completedTours',v_tours);
  insert into public.lead_score_inputs(score_id,property_id,lead_id,rules_version,input,input_hash,evaluated_at)
  values(v_score_id,v_property,p_lead_id,'rules-v3.1-source-aliases',v_input,encode(sha256(convert_to(v_input::text,'UTF8')),'hex'),v_at);
  return v_score_id;
end;
$function$;

alter table public.lead_score_batches alter column rules_version set default 'rules-v3.1-source-aliases';

create or replace function public._brain_run_lead_score_batch(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_lead_ids uuid[] default null,p_retry_batch_id uuid default null)
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
 if b.rules_version<>'rules-v3.1-source-aliases' then return '{"state":"rules_changed"}';end if;
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
