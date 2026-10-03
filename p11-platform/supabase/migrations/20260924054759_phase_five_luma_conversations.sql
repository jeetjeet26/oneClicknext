alter table public.conversations add column mode_revision bigint not null default 0,add column inbox_archived_at timestamptz;
create table public.luma_conversation_commands(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id)on delete cascade,actor_id uuid not null,
 conversation_id uuid,input jsonb not null,source jsonb,before_state jsonb,after_state jsonb,result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index luma_conversation_commands_property on public.luma_conversation_commands(property_id,created_at desc,id);
create index luma_conversation_commands_conversation on public.luma_conversation_commands(conversation_id,created_at desc,id);
create table public.luma_conversation_service_events(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id)on delete cascade,conversation_id uuid not null,
 kind text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index luma_conversation_service_property on public.luma_conversation_service_events(property_id,created_at desc,id);
alter table public.luma_conversation_commands enable row level security;
alter table public.luma_conversation_service_events enable row level security;
revoke all on public.luma_conversation_commands,public.luma_conversation_service_events from public,anon,authenticated;
grant all on public.luma_conversation_commands,public.luma_conversation_service_events to service_role;

create function public.guard_luma_conversation_records()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if exists(select 1 from public.properties where id=old.property_id)then raise exception 'Conversation evidence is immutable';end if;return old;
 end if;
 if tg_op='UPDATE'then raise exception 'Conversation evidence is immutable';end if;
 if current_setting('p11.luma_conversation_scope',true)is distinct from new.property_id::text or not exists(select 1 from public.properties where id=new.property_id and org_id=new.org_id)then raise exception 'Recorded conversation scope required';end if;
 if new.conversation_id is not null and not exists(select 1 from public.conversations where id=new.conversation_id and property_id=new.property_id)then raise exception 'Conversation property mismatch';end if;
 return new;
end$$;
create trigger luma_conversation_commands_guard before insert or update or delete on public.luma_conversation_commands for each row execute function public.guard_luma_conversation_records();
create trigger luma_conversation_service_guard before insert or update or delete on public.luma_conversation_service_events for each row execute function public.guard_luma_conversation_records();

create function public.guard_luma_conversation_control()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if(new.is_human_mode,new.mode_revision,new.inbox_archived_at)is distinct from(old.is_human_mode,old.mode_revision,old.inbox_archived_at)and current_setting('p11.luma_conversation_scope',true)is distinct from new.property_id::text then raise exception 'Use recorded conversation controls';end if;
 return new;
end$$;
create trigger luma_conversation_control_guard before update on public.conversations for each row execute function public.guard_luma_conversation_control();

create function public.luma_conversation_source(p_property_id uuid,p_conversation_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('conversation',to_jsonb(c),'lead',case when l.property_id=p_property_id then jsonb_build_object('id',l.id,'first_name',l.first_name,'last_name',l.last_name,'email',l.email,'phone',l.phone)else null end,'messages',coalesce((select jsonb_agg(to_jsonb(m)order by m.created_at nulls first,m.id)from public.messages m where m.conversation_id=c.id),'[]'))from public.conversations c left join public.leads l on l.id=c.lead_id where c.id=p_conversation_id and c.property_id=p_property_id;
$$;

create function public.record_luma_conversation_service(p_property_id uuid,p_conversation_id uuid,p_kind text,p_detail jsonb)returns uuid language plpgsql security invoker set search_path=''as $$
declare event_id uuid:=gen_random_uuid();organization uuid;
begin
 select p.org_id into organization from public.properties p join public.conversations c on c.property_id=p.id where p.id=p_property_id and c.id=p_conversation_id;
 if organization is null or p_kind not in('message_saved','inbox_reopened','reply_held')or jsonb_typeof(p_detail)is distinct from'object'then raise exception 'Invalid conversation service evidence';end if;
 perform set_config('p11.luma_conversation_scope',p_property_id::text,true);
 insert into public.luma_conversation_service_events(id,property_id,org_id,conversation_id,kind,detail)values(event_id,p_property_id,organization,p_conversation_id,p_kind,p_detail);
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(event_id,organization,p_property_id,'lumaleasing.message_store','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(event_id,event_id,organization,p_property_id,'lumaleasing.message_store','lumaleasing','luma.conversation.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('conversationId',p_conversation_id),jsonb_build_object('serviceEventId',event_id));
 return event_id;
end$$;

create function public.record_luma_message_insert()returns trigger language plpgsql security invoker set search_path=''as $$
declare convo public.conversations;prior_scope text:=current_setting('p11.luma_conversation_scope',true);
begin
 select*into convo from public.conversations where id=new.conversation_id for update;
 if convo.property_id is null then return new;end if;
 -- Staff decisions retain their attributed message in the same transaction.
 if current_setting('p11.luma_staff_message',true)=new.id::text then return new;end if;
 perform public.record_luma_conversation_service(convo.property_id,convo.id,'message_saved',jsonb_build_object('message',to_jsonb(new),'modeRevision',convo.mode_revision,'writer','message_store','actorProvenance','not_supplied'));
 if new.role='user'and convo.inbox_archived_at is not null then
  update public.conversations set inbox_archived_at=null where id=convo.id;
  perform public.record_luma_conversation_service(convo.property_id,convo.id,'inbox_reopened',jsonb_build_object('messageId',new.id,'priorArchivedAt',convo.inbox_archived_at));
 end if;
 perform set_config('p11.luma_conversation_scope',coalesce(prior_scope,''),true);return new;
end$$;
create trigger luma_message_insert_record after insert on public.messages for each row execute function public.record_luma_message_insert();

create function public.save_luma_message_at_revision(p_property_id uuid,p_conversation_id uuid,p_role text,p_content text,p_mode_revision bigint)returns jsonb language plpgsql security invoker set search_path=''as $$
declare convo public.conversations;mid uuid;
begin
 select*into convo from public.conversations where id=p_conversation_id and property_id=p_property_id for update;
 if not found then raise exception 'Conversation not found';end if;
 if p_role not in('user','assistant')or p_content is null or length(p_content)not between 1 and 20000 then raise exception 'Invalid saved message';end if;
 if p_role='assistant'and(coalesce(convo.is_human_mode,false)or p_mode_revision is distinct from convo.mode_revision)then
  perform public.record_luma_conversation_service(p_property_id,p_conversation_id,'reply_held',jsonb_build_object('content',p_content,'expectedModeRevision',p_mode_revision,'actualModeRevision',convo.mode_revision,'humanMode',convo.is_human_mode));
  return jsonb_build_object('saved',false,'human',coalesce(convo.is_human_mode,false),'stale',true,'modeRevision',convo.mode_revision);
 end if;
 insert into public.messages(conversation_id,role,content)values(convo.id,p_role,p_content)returning id into mid;
 return jsonb_build_object('saved',true,'human',coalesce(convo.is_human_mode,false),'id',mid,'modeRevision',convo.mode_revision);
end$$;

create function public.read_luma_conversations(p_actor_id uuid,p_property_id uuid,p_conversation_id uuid default null,p_kind text default'list',p_command_id uuid default null,p_offset integer default 0,p_hash text default null,p_archived boolean default false,p_lead_id uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare role_name text;all_items jsonb;items jsonb;source jsonb;hash text;command public.luma_conversation_commands;convo public.conversations;
begin
 select u.role into role_name from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id;if not found then return'{"state":"forbidden"}';end if;
 if p_offset<0 or p_offset>100000 or p_kind not in('list','messages','history','command','service')then return'{"state":"invalid_input"}';end if;
 if p_kind='command'then
  select*into command from public.luma_conversation_commands where id=p_command_id and property_id=p_property_id;
  if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canManage',role_name in('admin','manager'),'command',to_jsonb(command),'complete',true);
 end if;
 if p_conversation_id is not null then select*into convo from public.conversations where id=p_conversation_id and property_id=p_property_id;if not found then return'{"state":"not_found"}';end if;end if;
 if p_kind='list'then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'createdAt',c.created_at,'humanMode',coalesce(c.is_human_mode,false),'archivedAt',c.inbox_archived_at,'lead',case when l.property_id=p_property_id then jsonb_build_object('id',l.id,'name',btrim(concat_ws(' ',l.first_name,l.last_name)),'email',l.email)else null end,'messageCount',(select count(*)from public.messages m where m.conversation_id=c.id),'lastMessage',(select jsonb_build_object('content',left(m.content,160),'role',m.role,'createdAt',m.created_at)from public.messages m where m.conversation_id=c.id order by m.created_at desc nulls last,m.id desc limit 1))order by c.created_at desc nulls last,c.id desc),'[]')into all_items from public.conversations c left join public.leads l on l.id=c.lead_id where c.property_id=p_property_id and (p_archived or c.inbox_archived_at is null)and(p_lead_id is null or c.lead_id=p_lead_id);
 elsif p_kind='messages'then
  if convo.id is null then return'{"state":"invalid_input"}';end if;
  source:=public.luma_conversation_source(p_property_id,convo.id);all_items:=source->'messages';
 elsif p_kind='history'then
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'conversationId',d.conversation_id,'createdAt',d.created_at,'operation',d.input->>'operation','actorId',d.actor_id,'actorName',case when u.id is null then'Former team member'else coalesce(nullif(u.full_name,''),'Team member')end,'status',d.result->>'status')order by d.created_at desc,d.id desc),'[]')into all_items from public.luma_conversation_commands d left join public.profiles u on u.id=d.actor_id where d.property_id=p_property_id and(p_conversation_id is null or d.conversation_id=p_conversation_id);
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'conversationId',e.conversation_id,'kind',e.kind,'detail',e.detail,'createdAt',e.created_at)order by e.created_at desc,e.id desc),'[]')into all_items from public.luma_conversation_service_events e where e.property_id=p_property_id and(p_conversation_id is null or e.conversation_id=p_conversation_id);
 end if;
 hash:=encode(sha256(convert_to(coalesce(source,all_items)::text,'UTF8')),'hex');
 if p_hash is not null and p_hash<>hash then return'{"state":"source_changed"}';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]')into items from jsonb_array_elements(all_items)with ordinality row(value,ordinal)where ordinal>p_offset and ordinal<=p_offset+25;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canManage',role_name in('admin','manager'),'kind',p_kind,'conversation',case when source is not null then source-'messages'else null end,'items',items,'count',jsonb_array_length(all_items),'offset',p_offset,'hash',hash,'complete',true);
end$$;

create function public.decide_luma_conversation(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;role_name text;op text:=p_input->>'operation';convo public.conversations;command public.luma_conversation_commands;source jsonb;before_value jsonb;after_value jsonb;result jsonb;action text;event jsonb;message_id uuid:=gen_random_uuid();body text;prior public.luma_conversation_commands;
begin
 select p.org_id,u.role into organization,role_name from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or op is null or op not in('takeover','release','reply','archive','restore','review','export','report','cancel')then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,987));select*into command from public.luma_conversation_commands where id=p_id;
 if found then
  if(command.actor_id,command.property_id)is distinct from(p_actor_id,p_property_id)then return'{"state":"request_conflict"}';end if;
  if command.input->>'operation'<>'cancel'and op<>'cancel'and command.input is distinct from p_input then return'{"state":"request_conflict"}';end if;
  return command.result;
 end if;
 if op in('takeover','release','reply','archive','restore')and role_name not in('admin','manager')then return'{"state":"forbidden"}';end if;
 -- Shared action writers take this property lock; acquire it before the conversation row.
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));perform set_config('p11.luma_conversation_scope',p_property_id::text,true);
 if op='cancel'then result:='{"status":"cancelled"}';action:='request_cancelled';
 elsif op='report'then
  select*into prior from public.luma_conversation_commands where id=(p_input->>'preparationId')::uuid and property_id=p_property_id and actor_id=p_actor_id and input->>'operation'='export';
  if not found or p_input->>'artifactHash'is distinct from prior.result->>'artifactHash'or p_input->>'outcome'not in('download_initiated','failed')or p_input->>'outcome'is null then return'{"state":"invalid_input"}';end if;
  convo.id:=prior.conversation_id;result:=jsonb_build_object('status','reported','preparationId',prior.id,'outcome',p_input->>'outcome');action:='export_reported';
 else
  select*into convo from public.conversations where id=(p_input->>'conversationId')::uuid and property_id=p_property_id for update;if not found then return'{"state":"not_found"}';end if;
  if op='export'then
   select*into prior from public.luma_conversation_commands where id=(p_input->>'reviewId')::uuid and property_id=p_property_id and conversation_id=convo.id and input->>'operation'='review';
   if not found then return'{"state":"not_found"}';end if;source:=prior.source;body:=jsonb_build_object('reviewId',prior.id,'capturedAt',prior.created_at,'source',source)::text;result:=jsonb_build_object('status','export_prepared','artifact',body,'artifactHash',encode(sha256(convert_to(body,'UTF8')),'hex'),'reviewId',prior.id);action:='export_prepared';
  else
   source:=public.luma_conversation_source(p_property_id,convo.id);
   if p_input->>'sourceHash'is distinct from encode(sha256(convert_to(source::text,'UTF8')),'hex')then return'{"state":"source_changed"}';end if;
   before_value:=to_jsonb(convo);
   if op='review'then result:=jsonb_build_object('status','review_saved','messageCount',jsonb_array_length(source->'messages'));action:='reviewed';
   elsif op in('takeover','release')then
    if coalesce(convo.is_human_mode,false)is not distinct from(op='takeover')then return'{"state":"mode_changed"}';end if;
    if length(btrim(coalesce(p_input->>'reason','')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
    update public.conversations set is_human_mode=(op='takeover'),mode_revision=mode_revision+1,inbox_archived_at=null where id=convo.id returning*into convo;
    body:=case when op='takeover'then'A team member has joined the chat and will continue assisting you.'else'Luma AI is back to assist you.'end;
    perform set_config('p11.luma_staff_message',message_id::text,true);insert into public.messages(id,conversation_id,role,content)values(message_id,convo.id,'system',body);
    result:=jsonb_build_object('status',case when op='takeover'then'taken_over'else'released'end,'messageId',message_id);action:=case when op='takeover'then'taken_over'else'released'end;
   elsif op='reply'then
    if not coalesce(convo.is_human_mode,false)or convo.inbox_archived_at is not null then return'{"state":"mode_changed"}';end if;
    body:=btrim(p_input->>'content');if body is null or length(body)not between 1 and 10000 then return'{"state":"invalid_input"}';end if;
    perform set_config('p11.luma_staff_message',message_id::text,true);insert into public.messages(id,conversation_id,role,content)values(message_id,convo.id,'assistant',body);
    result:=jsonb_build_object('status','reply_saved','messageId',message_id);action:='replied';
   else
    if length(btrim(coalesce(p_input->>'reason','')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
    if(convo.inbox_archived_at is not null)is not distinct from(op='archive')then return'{"state":"source_changed"}';end if;
    update public.conversations set inbox_archived_at=case when op='archive'then clock_timestamp()else null end where id=convo.id returning*into convo;
    result:=jsonb_build_object('status',case when op='archive'then'archived'else'restored'end);action:=case when op='archive'then'archived'else'restored'end;
   end if;
   after_value:=to_jsonb(convo);
  end if;
 end if;
 result:=result||jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'conversationId',convo.id);
 insert into public.luma_conversation_commands(id,property_id,org_id,actor_id,conversation_id,input,source,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,convo.id,p_input,source,before_value,after_value,result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'lumaleasing','luma.conversation.'||action,case when op='report'then'browser_observed'else'server_confirmed'end,case when op='report'then'observed'else'succeeded'end,jsonb_build_object('commandId',p_id,'conversationId',convo.id),null,null,result-array['artifact','artifactHash']);
 if event->>'state'not in('recorded','replayed')then raise exception 'Conversation action recording failed';end if;return result;
exception when invalid_text_representation or numeric_value_out_of_range then return'{"state":"invalid_input"}';
end$$;

create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('luma.conversation.taken_over','luma.conversation.released','luma.conversation.replied','luma.conversation.archived','luma.conversation.restored','luma.conversation.reviewed','luma.conversation.export_prepared','luma.conversation.export_reported','luma.conversation.request_cancelled','luma.widget.key_rotated','luma.widget.logo_selected','luma.widget.logo_cleared','luma.widget.installation_prepared','luma.widget.installation_reported','luma.widget.request_cancelled','bi.data.review_saved','bi.data.row_excluded','bi.data.row_restored','bi.data.export_prepared','bi.data.export_reported','bi.data.request_cancelled','bi.csv.preview_saved','bi.csv.applied','bi.csv.discarded','bi.csv.request_cancelled','audit.analysis.requested','audit.analysis.retried','audit.analysis.cancelled','audit.analysis.stopped','audit.analysis.discarded','audit.analysis.resumed','audit.analysis.applied','audit.evaluation.requested','audit.evaluation.cancelled','audit.evaluation.applied','audit.evaluation.discarded','audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action like 'luma.conversation.%'then
  if p_product<>'lumaleasing'or(p_action='luma.conversation.export_reported'and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action<>'luma.conversation.export_reported'and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid conversation evidence';end if;
 elsif p_action like 'luma.widget.%'then
  if p_product<>'lumaleasing'or(p_action='luma.widget.installation_reported'and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action<>'luma.widget.installation_reported'and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid widget decision evidence';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'readiness.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid readiness review evidence';end if;
 elsif p_action like 'neighborhood.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid neighborhood review evidence';end if;
 elsif p_action like 'legal.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid legal review evidence';end if;
 elsif p_action like 'checklist.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid checklist evidence';end if;
 elsif p_action like 'property.unit.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid floor-plan evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('organization.setup.completed','property.setup.saved','property.created','property.onboarding.completed') then
  if p_product<>'property' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid property evidence';end if;
 elsif p_action like 'pipeline.%' then
  if p_product<>'pipelines'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid pipeline evidence';end if;
 elsif p_action like 'bi.%' then
  if p_product<>'bi' or(p_action in('bi.export.reported','bi.data.export_reported')and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action not in('bi.export.reported','bi.data.export_reported')and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid BI report evidence';end if;
 elsif p_action like 'site.%' then
  if p_product<>'siteforge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid brief evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.note.%' then
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid internal note evidence';end if;
 elsif p_action='audit.report.reported'then
  if p_product<>'propertyaudit'or p_evidence<>'browser_observed'or p_phase<>'observed'then raise exception 'Invalid report observation';end if;
 elsif p_action like 'audit.%' then
  if p_product<>'propertyaudit'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid audit decision evidence';end if;
 elsif p_action like 'lead.record.%' then
  if p_product<>'tourspark'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid lead record evidence';end if;
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
 origin:=case when p_action like 'luma.conversation.%'then'console'when p_action like 'luma.widget.%'then'console'when p_action like 'audit.%'then'console' when p_action like 'bi.%'then'console' when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
revoke all on function public.guard_luma_conversation_records()from public,anon,authenticated;grant execute on function public.guard_luma_conversation_records()to service_role;
revoke all on function public.guard_luma_conversation_control()from public,anon,authenticated;grant execute on function public.guard_luma_conversation_control()to service_role;
revoke all on function public.luma_conversation_source(uuid,uuid)from public,anon,authenticated;grant execute on function public.luma_conversation_source(uuid,uuid)to service_role;
revoke all on function public.record_luma_conversation_service(uuid,uuid,text,jsonb)from public,anon,authenticated;grant execute on function public.record_luma_conversation_service(uuid,uuid,text,jsonb)to service_role;
revoke all on function public.record_luma_message_insert()from public,anon,authenticated;grant execute on function public.record_luma_message_insert()to service_role;
revoke all on function public.save_luma_message_at_revision(uuid,uuid,text,text,bigint)from public,anon,authenticated;grant execute on function public.save_luma_message_at_revision(uuid,uuid,text,text,bigint)to service_role;
revoke all on function public.read_luma_conversations(uuid,uuid,uuid,text,uuid,integer,text,boolean,uuid)from public,anon,authenticated;grant execute on function public.read_luma_conversations(uuid,uuid,uuid,text,uuid,integer,text,boolean,uuid)to service_role;
revoke all on function public.decide_luma_conversation(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.decide_luma_conversation(uuid,uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
