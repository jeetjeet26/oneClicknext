-- Complete private delivery histories. Read-only; no send, review or provider mutation.
create index if not exists tour_schedule_work_history_page on public.tour_schedule_work(property_id,lead_id,created_at desc,id desc);
create index if not exists workflow_deliveries_history_page on public.workflow_deliveries(property_id,lead_id,created_at desc,id desc);
create function public.read_lead_delivery_history(p_property_id uuid,p_lead_id uuid,p_actor_id uuid,p_kind text,p_cursor jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;total bigint;last_item jsonb;cursor_time timestamptz;cursor_id uuid;
begin
 if p_kind is null or p_kind not in('schedule','reminder','workflow') then raise exception 'Invalid history kind';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if not exists(select 1 from public.leads l where l.id=p_lead_id and l.property_id=p_property_id) then return '{"state":"not_found"}';end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor-array['createdAt','id','leadId','kind']<>'{}' or p_cursor->>'leadId' is distinct from p_lead_id::text or p_cursor->>'kind' is distinct from p_kind or nullif(p_cursor->>'createdAt','') is null or nullif(p_cursor->>'id','') is null then raise exception 'Invalid history cursor';end if;
  cursor_time:=(p_cursor->>'createdAt')::timestamptz;cursor_id:=(p_cursor->>'id')::uuid;
 end if;
 if p_kind='workflow' then
  select count(*) into total from public.workflow_deliveries d where d.property_id=p_property_id and d.lead_id=p_lead_id;
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into rows from(
   select d.id,d.created_at,jsonb_build_object('id',d.id,'createdAt',d.created_at,'workflowId',d.lead_workflow_id,'step',d.step_number+1,'channel',d.channel,'recipient',d.recipient,
    'state',case when d.state='running' and (d.lease_until is null or d.lease_until<=statement_timestamp()) then 'review' else d.state end,
    'attempts',d.attempts,'attempted',d.started_at is not null,'legacy',d.legacy,'providerId',d.provider_id,'errorCode',d.error_code,
    'reviewable',d.lease_until is null or d.lease_until<=statement_timestamp(),
    'reviewReason',(select r.input->>'reason' from public.workflow_delivery_reviews r where r.property_id=p_property_id and r.lead_id=p_lead_id and r.delivery_id=d.id order by r.created_at desc,r.id desc limit 1)) item
   from public.workflow_deliveries d where d.property_id=p_property_id and d.lead_id=p_lead_id and (cursor_time is null or (d.created_at,d.id)<(cursor_time,cursor_id)) order by d.created_at desc,d.id desc limit 31
  ) page;
 else
  select count(*) into total from public.tour_schedule_work w where w.property_id=p_property_id and w.lead_id=p_lead_id and(case when p_kind='schedule' then w.kind in('calendar','notice_email','notice_sms') else w.kind in('confirmation','reminder_24h','reminder_1h') end);
  select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into rows from(
   select w.id,w.created_at,jsonb_build_object('id',w.id,'createdAt',w.created_at,'kind',w.kind,'date',w.payload->>'date','time',w.payload->>'time','timezone',w.payload->>'timezone',
    'state',case when w.state='running' and (w.lease_until is null or w.lease_until<=statement_timestamp()) then 'review' else w.state end,
    'reviewable',w.state='review' or(w.state='running' and(w.lease_until is null or w.lease_until<=statement_timestamp()))) ||
    case when p_kind='schedule' then jsonb_build_object('action',w.payload->>'action','attempts',w.attempts,'attempted',w.started_at is not null,
     'recipient',case w.kind when 'notice_email' then w.payload->>'email' when 'notice_sms' then w.payload->>'phone' else w.payload->>'providerCalendarId' end,
     'providerId',coalesce(w.receipt->>'messageId',w.receipt->>'eventId'),'pinnedEventId',w.payload->>'eventId','errorCode',w.error_code,
     'reviewReason',(select r.input->>'reason' from public.tour_schedule_reviews r where r.property_id=p_property_id and r.lead_id=p_lead_id and r.work_id=w.id order by r.created_at desc,r.id desc limit 1))
    else jsonb_build_object('legacy',w.payload->'reminderVersion' is distinct from '2'::jsonb,'channels',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'recipient',c.recipient,'attempts',c.attempts,'attempted',c.started_at is not null,'providerId',c.provider_id,
     'reviewReason',(select r.input->>'reason' from public.tour_reminder_reviews r where r.property_id=p_property_id and r.lead_id=p_lead_id and r.channel_id=c.id order by r.created_at desc,r.id desc limit 1),
     'state',case when w.state='superseded' and c.state='queued' then 'skipped' when c.state='running' and(w.lease_until is null or w.lease_until<=statement_timestamp()) then 'review' else c.state end) order by c.channel,c.id) from public.tour_reminder_channels c where c.work_id=w.id),'[]')) end item
   from public.tour_schedule_work w where w.property_id=p_property_id and w.lead_id=p_lead_id and(case when p_kind='schedule' then w.kind in('calendar','notice_email','notice_sms') else w.kind in('confirmation','reminder_24h','reminder_1h') end) and(cursor_time is null or(w.created_at,w.id)<(cursor_time,cursor_id)) order by w.created_at desc,w.id desc limit 31
  ) page;
 end if;
 last_item:=rows->29;
 return jsonb_build_object('state','ready','work',case when jsonb_array_length(rows)>30 then rows-30 else rows end,'total',total,'nextCursor',case when jsonb_array_length(rows)>30 then jsonb_build_object('createdAt',last_item->'createdAt','id',last_item->'id','leadId',p_lead_id,'kind',p_kind) else null end);
end;$$;
revoke all on function public.read_lead_delivery_history(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.read_lead_delivery_history(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
