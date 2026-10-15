begin;
create function pg_temp.check_it(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
insert into public.organizations(id,name)values('ca000000-0000-4000-8000-000000000001','Chat cutover test');
insert into public.properties(id,org_id,name)values
 ('cb000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','Chat A'),
 ('cb000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000001','Chat B');
insert into public.lumaleasing_config(id,property_id,api_key)values
 ('cc000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','cutover-key-a'),
 ('cc000000-0000-4000-8000-000000000002','cb000000-0000-4000-8000-000000000002','cutover-key-b');
insert into public.widget_sessions(id,property_id,visitor_id)values
 ('cd000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','cutover-test');
set local role service_role;
select pg_temp.check_it(public.brain_chat_release('cc000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001')->>'mode'='legacy','unadopted existing chat retains reviewed legacy engine');
do $$begin
 begin perform public.brain_chat_release('cc000000-0000-4000-8000-000000000002','cd000000-0000-4000-8000-000000000001');raise exception 'Foreign config accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update public.community_brain_settings set context_enabled=true,consumers=array['chat'],policy_revision=2 where property_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.check_it(public.brain_chat_release('cc000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001')->>'mode'='brain','adopted chat uses Brain');
select pg_temp.check_it((select chat_activated_at is not null from public.community_brain_settings where property_id='cb000000-0000-4000-8000-000000000001'),'adoption recorded');
insert into public.conversations(id,property_id,widget_session_id,channel)values('ce000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001','widget');
do $$declare p uuid:='cb000000-0000-4000-8000-000000000001';r uuid:='cf000000-0000-4000-8000-000000000001';claim jsonb;intent jsonb;c jsonb;s jsonb;body text:='{"messages":[{"role":"user","content":"Available homes?"}]}';key_hash text:=encode(sha256(convert_to('cutover-key-a','UTF8')),'hex');begin
 claim:=public.claim_recorded_luma_request(p,r,'chat',body,'cutover-fixture',key_hash);
 perform pg_temp.check_it(claim->>'state'='claimed','replay fixture admitted');
 c:=public.brain_public_context('cc000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001','Available homes?');
 s:=jsonb_build_object('conversationId','ce000000-0000-4000-8000-000000000001','modeRevision',0,'communityRequest',jsonb_build_object('configId','cc000000-0000-4000-8000-000000000001','sessionId','cd000000-0000-4000-8000-000000000001','query','Available homes?'),'assistantContext',jsonb_build_object('chatRelease',jsonb_build_object('mode','brain','revision',2),'contextJson',jsonb_build_object('propertyId',p,'canonical',(c->'canonical')-'asOf','evidence',c->'evidence','currentDate',left(c->>'asOf',10))));
 intent:=public.claim_luma_model(p,r,(claim->>'token')::uuid,'answer','{"model":"fixture","messages":[],"max_tokens":400}',s,2000,100000);
 perform pg_temp.check_it(intent->>'state'='claimed','replay model admitted with exact community context');
 perform public.finish_luma_model((intent->>'id')::uuid,p,r,(claim->>'token')::uuid,'received','{"choices":[{"message":{"content":"Contact sales"}}]}',null);
 perform public.finish_recorded_luma_request(p,r,(claim->>'token')::uuid,'{"content":"Contact sales"}',200);
 perform pg_temp.check_it(public.claim_recorded_luma_request(p,r,'chat',body,'cutover-fixture',key_hash)->>'state'='completed','unchanged current answer replays without another model call');
 update public.properties set name='Chat A updated'where id=p;
 perform pg_temp.check_it(public.claim_recorded_luma_request(p,r,'chat',body,'cutover-fixture',key_hash)->>'state'='review','changed facts block a completed answer replay');
end$$;
update public.community_brain_settings set context_enabled=false,chat_activated_at=null,policy_revision=3 where property_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.check_it(public.brain_chat_release('cc000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001')->>'mode'='withheld','suspension cannot revive legacy facts');
set local role anon;
do $$begin
 begin perform public.brain_chat_release('cc000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001');raise exception 'Anonymous release lookup accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update public.widget_sessions set session_end=now() where id='cd000000-0000-4000-8000-000000000001';
do $$begin
 begin perform public.brain_chat_release('cc000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001');raise exception 'Ended session accepted';exception when insufficient_privilege then null;end;
end$$;
rollback;
