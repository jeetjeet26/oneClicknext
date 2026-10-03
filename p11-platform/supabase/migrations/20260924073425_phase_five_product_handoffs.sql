create or replace function public.record_lead_engagement(p_property_id uuid,p_lead_id uuid,p_event_type text,p_metadata jsonb,p_request_key text,p_origin text,p_actor_id uuid default null)
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
 else
  insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)select r.id,p.org_id,p.id,'leadpulse.source_service','workflow'from public.properties p where p.id=p_property_id;
  insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)select r.id,r.id,p.org_id,p.id,'leadpulse.source_service','leadpulse','lead.engagement.recorded','server_confirmed','succeeded',jsonb_build_object('leadId',p_lead_id,'eventType',p_event_type,'source',p_origin),jsonb_build_object('receiptId',r.id,'eventId',eid,'scoreId',sid)from public.properties p where p.id=p_property_id;
 end if;
 update public.lead_engagement_receipts set result=command_result where id=r.id;
 return command_result;
end;$$;

create or replace function public.finish_forgestudio_renewal(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare request public.forgestudio_renewals;connection public.social_connections;account jsonb;next_state text:='held';why text:='Renewal could not be confirmed. Start fresh authorization.';required text[];granted text[];event_id uuid;access_expiry timestamptz;refresh_expiry timestamptz;valid_expiry boolean:=true;begin
 select * into request from public.forgestudio_renewals where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(request.property_id::text,12));select * into request from public.forgestudio_renewals where id=p_id for update;
 if p_claim_token is null or request.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if request.result is not null then if request.result_hash=public.crm_configuration_hash(p_result) then return jsonb_build_object('state','replayed','renewalState',request.state,'reason',request.reason);end if;return '{"state":"result_conflict"}';end if;
 if request.state<>'exchanging' or jsonb_typeof(p_result) is distinct from 'object' or (p_result-'status'-'observedAt'-'accounts'-'reason'-'tokenReceipt')<>'{}'::jsonb or length(p_result::text)>524288 or coalesce(p_result->>'status','') not in('observed','failed','uncertain') or coalesce(p_result->>'observedAt','')='' then raise exception 'Invalid saved renewal result';end if;
 if not isfinite((p_result->>'observedAt')::timestamptz) or(p_result->>'observedAt')::timestamptz<request.created_at-interval '1 minute' or(p_result->>'observedAt')::timestamptz>clock_timestamp()+interval '1 minute' then raise exception 'Invalid renewal observation time';end if;
 select * into connection from public.social_connections where id=request.connection_id for update;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=request.property_id and p.org_id=request.org_id and u.id=request.actor_id and u.role in('admin','manager')) or connection.security_version<>request.connection_version or request.snapshot->'identity' is distinct from(public.forgestudio_social_identity(request.property_id,request.platform)-'connections') or connection.is_active is not true or connection.disconnected_at is not null then why:='The account or app changed during renewal. Its later state was preserved.';
 elsif p_result->>'status'='observed' and jsonb_typeof(p_result->'accounts')='array' and jsonb_array_length(p_result->'accounts')=1 then
  account:=p_result->'accounts'->0;
  required:=case request.platform when 'facebook' then array['pages_show_list','pages_read_engagement','pages_manage_posts'] when 'instagram' then array['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement'] when 'linkedin' then array['openid','profile','w_member_social'] when 'tiktok' then array['user.info.basic','video.publish'] when 'x' then array['tweet.read','tweet.write','users.read'] end;
  if jsonb_typeof(account->'scopes')='array' and jsonb_array_length(account->'scopes') between 1 and 100 and not exists(select 1 from jsonb_array_elements(account->'scopes') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200) then granted:=array(select jsonb_array_elements_text(account->'scopes'));end if;
  begin
   access_expiry:=nullif(account->>'expiresAt','')::timestamptz;refresh_expiry:=nullif(account->>'refreshExpiresAt','')::timestamptz;
   valid_expiry:=access_expiry is not null and isfinite(access_expiry) and access_expiry>clock_timestamp()+interval '10 minutes' and access_expiry<=clock_timestamp()+interval '366 days' and(refresh_expiry is null or(isfinite(refresh_expiry) and refresh_expiry>clock_timestamp() and refresh_expiry<=clock_timestamp()+interval '366 days'));
  exception when invalid_datetime_format or datetime_field_overflow then valid_expiry:=false;end;
  if jsonb_typeof(account)='object' and(account-'platform'-'accountId'-'accountName'-'accountUsername'-'accessTokenEncrypted'-'refreshTokenEncrypted'-'pageAccessTokenEncrypted'-'pageId'-'expiresAt'-'refreshExpiresAt'-'scopes'-'permissionEvidence')='{}'::jsonb and valid_expiry and account->>'accountId' is not distinct from connection.account_id and account->>'platform' is not distinct from request.platform and required<@granted and coalesce(account->>'accessTokenEncrypted','') like 'encv1:%' and length(account->>'accessTokenEncrypted')<20000 and account->'permissionEvidence'->>'source'='provider_response' and account->'permissionEvidence'->>'expiryKnown'='true' and ((account->'permissionEvidence')-'source'-'expiryKnown')='{}'::jsonb and (request.platform not in('instagram','facebook') or (account->>'pageId' is not distinct from connection.page_id and coalesce(account->>'pageAccessTokenEncrypted','') like 'encv1:%' and length(account->>'pageAccessTokenEncrypted')<20000)) and (request.platform in('instagram','facebook') or coalesce(account->>'refreshTokenEncrypted','') like 'encv1:%' and length(account->>'refreshTokenEncrypted')<20000) then
   update public.social_connections set access_token=account->>'accessTokenEncrypted',refresh_token=account->>'refreshTokenEncrypted',page_access_token=account->>'pageAccessTokenEncrypted',token_expires_at=access_expiry,refresh_token_expires_at=refresh_expiry,scopes=granted,permission_evidence=jsonb_build_object('source','provider_response','authorizationId',connection.permission_evidence->>'authorizationId','renewalId',request.id,'expiryKnown',true,'observedAt',p_result->>'observedAt'),last_error=null,error_count=0,updated_at=clock_timestamp() where id=connection.id;
   next_state:='completed';why:=null;
  else why:='Renewed account identity, permissions or expiry need fresh authorization.';end if;
 end if;
 update public.forgestudio_renewals set state=next_state,result=p_result,result_hash=public.crm_configuration_hash(p_result),reason=why,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=request.id;
 -- Actual provider-result processing belongs to the service; requestedBy remains private receipt provenance.
 event_id:=md5('studio-renewal-result:'||request.id::text)::uuid;
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(event_id,request.org_id,request.property_id,'forgestudio.credential_service','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(event_id,event_id,request.org_id,request.property_id,'forgestudio.credential_service','forgestudio','studio.credentials.renewal_completed','server_confirmed',case when next_state='completed'then'succeeded'else'failed'end,jsonb_build_object('renewalId',request.id),jsonb_build_object('renewalId',request.id,'connectionId',request.connection_id,'state',next_state));
 return jsonb_build_object('state','saved','renewalState',next_state,'reason',why);
end;$$;

create function public.record_luma_linked_engagement()returns trigger language plpgsql security invoker set search_path=''as $$
declare recorded jsonb;
begin
 if new.channel is distinct from'widget'or new.lead_id is null then return new;end if;
 if tg_op='UPDATE'then if(new.lead_id,new.property_id,new.channel)is not distinct from(old.lead_id,old.property_id,old.channel)then return new;end if;end if;
 recorded:=public.record_lead_engagement(new.property_id,new.lead_id,'chat_started',jsonb_build_object('conversation_id',new.id,'source','lumaleasing_widget'),'luma/chat-started/'||new.id||'/'||new.lead_id,'lumaleasing',null);
 if recorded->>'state'not in('applied','replayed')then raise exception 'Conversation engagement could not be recorded: %',recorded->>'state';end if;
 return new;
end$$;
create trigger recorded_luma_link_engagement after insert or update of lead_id,property_id,channel on public.conversations for each row execute function public.record_luma_linked_engagement();
create function public.link_luma_visitor_lead(p_property_id uuid,p_request_id uuid,p_token uuid,p_session_id uuid,p_conversation_id uuid,p_lead_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if not public.luma_request_authority(p_property_id,p_request_id,p_token)then return'{"state":"authority_changed"}';end if;
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;
 if p_session_id is not null then
  perform 1 from public.widget_sessions where id=p_session_id and property_id=p_property_id for update;if not found then return'{"state":"not_found"}';end if;
  if exists(select 1 from public.widget_sessions where id=p_session_id and lead_id is not null and lead_id<>p_lead_id)then return'{"state":"contact_conflict"}';end if;
 end if;
 if p_conversation_id is not null then
  perform 1 from public.conversations where id=p_conversation_id and property_id=p_property_id and channel='widget'and(p_session_id is null or widget_session_id=p_session_id)for update;if not found then return'{"state":"not_found"}';end if;
 end if;
 if exists(select 1 from public.conversations c where c.property_id=p_property_id and(c.id=p_conversation_id or c.widget_session_id=p_session_id)and c.lead_id is not null and c.lead_id<>p_lead_id)then return'{"state":"contact_conflict"}';end if;
 update public.widget_sessions set lead_id=p_lead_id,converted_at=coalesce(converted_at,clock_timestamp())where id=p_session_id and property_id=p_property_id;
 update public.conversations set lead_id=p_lead_id where property_id=p_property_id and channel='widget'and(id=p_conversation_id or widget_session_id=p_session_id)and lead_id is distinct from p_lead_id;
 return jsonb_build_object('state','saved','leadId',p_lead_id);
end$$;
revoke all on function public.record_luma_linked_engagement(),public.link_luma_visitor_lead(uuid,uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.link_luma_visitor_lead(uuid,uuid,uuid,uuid,uuid,uuid)to service_role;
