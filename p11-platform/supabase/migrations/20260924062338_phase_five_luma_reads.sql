BEGIN;
create function public.read_luma_overview(p_actor_id uuid,p_property_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare sessions bigint;linked bigint;leads bigint;booked bigint;conversations bigint;tours bigint;recent jsonb;
begin
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id)then return'{"state":"forbidden"}';end if;
 select count(*),count(*)filter(where s.lead_id is not null),count(distinct s.lead_id) into sessions,linked,leads from public.widget_sessions s where s.property_id=p_property_id;
 select count(*)into conversations from public.conversations c where c.property_id=p_property_id and c.channel='widget';
 select count(*)into tours from public.tour_bookings t where t.property_id=p_property_id and t.source='lumaleasing';
 select count(distinct s.lead_id)into booked from public.widget_sessions s where s.property_id=p_property_id and exists(select 1 from public.tour_bookings t where t.property_id=p_property_id and t.lead_id=s.lead_id and t.source='lumaleasing' and t.status<>'cancelled');
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'created_at',c.created_at,'is_human_mode',coalesce(c.is_human_mode,false),'lead_name',case when l.property_id=p_property_id then nullif(btrim(concat_ws(' ',l.first_name,l.last_name)),'')else null end,'lead_email',case when l.property_id=p_property_id then l.email else null end,'message_count',(select count(*)from public.messages m where m.conversation_id=c.id),'last_message',(select left(m.content,160)from public.messages m where m.conversation_id=c.id order by m.created_at desc nulls last,m.id desc limit 1))order by c.created_at desc nulls last,c.id desc),'[]')into recent from(select*from public.conversations where property_id=p_property_id and channel='widget'order by created_at desc nulls last,id desc limit 5)c left join public.leads l on l.id=c.lead_id;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'complete',true,'asOf',statement_timestamp(),'totalSessions',sessions,'totalConversations',conversations,'linkedSessions',linked,'uniqueLeads',leads,'toursBooked',tours,'tourLeads',booked,'conversionRate',case when sessions>0 then round(100.0*linked/sessions,1)else null end,'tourBookingRate',case when leads>0 then round(100.0*booked/leads,1)else null end,'avgResponseTime',null,'conversations',recent);
end$$;
revoke all on function public.read_luma_overview(uuid,uuid)from public,anon,authenticated;
grant execute on function public.read_luma_overview(uuid,uuid)to service_role;

-- The route checks the current key and session freshness before this service-only read.
-- A cursor is a stored message ID, scoped again to the selected conversation.
create function public.read_luma_visitor_messages(p_property_id uuid,p_conversation_id uuid,p_before_id uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare cursor_row public.messages;page jsonb;more boolean;
begin
 if not exists(select 1 from public.conversations where id=p_conversation_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;
 if p_before_id is not null then
  select*into cursor_row from public.messages where id=p_before_id and conversation_id=p_conversation_id and role in('user','assistant')and content is not null and content<>'';
  if not found then return'{"state":"source_changed"}';end if;
 end if;
 with eligible as(select m.*from public.messages m where m.conversation_id=p_conversation_id and m.role in('user','assistant')and m.content is not null and m.content<>'' and(p_before_id is null or(coalesce(m.created_at,'-infinity'::timestamptz),m.id)<(coalesce(cursor_row.created_at,'-infinity'::timestamptz),cursor_row.id))order by m.created_at desc nulls last,m.id desc limit 201),numbered as(select*,row_number()over(order by created_at desc nulls last,id desc)as position from eligible)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'content',content,'createdAt',created_at)order by created_at asc nulls first,id asc)filter(where position<=200),'[]'),count(*)>200 into page,more from numbered;
 return jsonb_build_object('state','ready','messages',page,'hasEarlierMessages',more,'nextBeforeId',case when more then page->0->>'id'else null end);
end$$;
revoke all on function public.read_luma_visitor_messages(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.read_luma_visitor_messages(uuid,uuid,uuid)to service_role;

create or replace function public.read_luma_conversations(p_actor_id uuid,p_property_id uuid,p_conversation_id uuid default null,p_kind text default'list',p_command_id uuid default null,p_offset integer default 0,p_hash text default null,p_archived boolean default false,p_lead_id uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare role_name text;all_items jsonb;items jsonb;source jsonb;hash text;command public.luma_conversation_commands;convo public.conversations;
begin
 select u.role into role_name from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id;if not found then return'{"state":"forbidden"}';end if;
 if p_offset<0 or p_offset>100000 or p_kind not in('list','messages','history','command','service')then return'{"state":"invalid_input"}';end if;
 if p_lead_id is not null and not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;
 if p_kind='command'then
  select*into command from public.luma_conversation_commands where id=p_command_id and property_id=p_property_id;
  if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canManage',role_name in('admin','manager'),'command',to_jsonb(command),'complete',true);
 end if;
 if p_conversation_id is not null then select*into convo from public.conversations where id=p_conversation_id and property_id=p_property_id and(p_lead_id is null or lead_id=p_lead_id);if not found then return'{"state":"not_found"}';end if;end if;
 if p_kind='list'then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'createdAt',c.created_at,'humanMode',coalesce(c.is_human_mode,false),'archivedAt',c.inbox_archived_at,'lead',case when l.property_id=p_property_id then jsonb_build_object('id',l.id,'name',btrim(concat_ws(' ',l.first_name,l.last_name)),'email',l.email)else null end,'messageCount',(select count(*)from public.messages m where m.conversation_id=c.id),'lastMessage',(select jsonb_build_object('content',left(m.content,160),'role',m.role,'createdAt',m.created_at)from public.messages m where m.conversation_id=c.id order by m.created_at desc nulls last,m.id desc limit 1))order by c.created_at desc nulls last,c.id desc),'[]')into all_items from public.conversations c left join public.leads l on l.id=c.lead_id where c.property_id=p_property_id and (p_archived or c.inbox_archived_at is null)and(p_lead_id is null or c.lead_id=p_lead_id);
 elsif p_kind='messages'then
  if convo.id is null then return'{"state":"invalid_input"}';end if;
  source:=public.luma_conversation_source(p_property_id,convo.id);all_items:=source->'messages';
 elsif p_kind='history'then
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'conversationId',d.conversation_id,'createdAt',d.created_at,'operation',d.input->>'operation','actorId',d.actor_id,'actorName',case when u.id is null then'Former team member'else coalesce(nullif(u.full_name,''),'Team member')end,'status',d.result->>'status')order by d.created_at desc,d.id desc),'[]')into all_items from public.luma_conversation_commands d left join public.profiles u on u.id=d.actor_id where d.property_id=p_property_id and(p_conversation_id is null or d.conversation_id=p_conversation_id)and(p_lead_id is null or exists(select 1 from public.conversations c where c.id=d.conversation_id and c.lead_id=p_lead_id));
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'conversationId',e.conversation_id,'kind',e.kind,'detail',e.detail,'createdAt',e.created_at)order by e.created_at desc,e.id desc),'[]')into all_items from public.luma_conversation_service_events e where e.property_id=p_property_id and(p_conversation_id is null or e.conversation_id=p_conversation_id)and(p_lead_id is null or exists(select 1 from public.conversations c where c.id=e.conversation_id and c.lead_id=p_lead_id));
 end if;
 hash:=encode(sha256(convert_to(coalesce(source,all_items)::text,'UTF8')),'hex');
 if p_hash is not null and p_hash<>hash then return'{"state":"source_changed"}';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]')into items from jsonb_array_elements(all_items)with ordinality row(value,ordinal)where ordinal>p_offset and ordinal<=p_offset+25;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canManage',role_name in('admin','manager'),'kind',p_kind,'conversation',case when source is not null then source-'messages'else null end,'items',items,'count',jsonb_array_length(all_items),'offset',p_offset,'hash',hash,'complete',true);
end$$;
COMMIT;
