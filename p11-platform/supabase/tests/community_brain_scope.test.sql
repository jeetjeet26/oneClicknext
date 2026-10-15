begin;
create function pg_temp.check_it(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
insert into public.organizations(id,name) values('ba000000-0000-4000-8000-000000000001','Brain organization A'),('ba000000-0000-4000-8000-000000000002','Brain organization B');
insert into auth.users(id,email,email_confirmed_at) values
 ('bb000000-0000-4000-8000-000000000001','brain-admin@example.invalid',now()),
 ('bb000000-0000-4000-8000-000000000002','brain-a@example.invalid',now()),
 ('bb000000-0000-4000-8000-000000000003','brain-portfolio@example.invalid',now());
insert into public.profiles(id,org_id,role) values
 ('bb000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','admin'),
 ('bb000000-0000-4000-8000-000000000002','ba000000-0000-4000-8000-000000000001','viewer'),
 ('bb000000-0000-4000-8000-000000000003','ba000000-0000-4000-8000-000000000001','manager');
insert into public.properties(id,org_id,name) values
 ('bc000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','Community A'),
 ('bc000000-0000-4000-8000-000000000002','ba000000-0000-4000-8000-000000000001','Community B'),
 ('bc000000-0000-4000-8000-000000000003','ba000000-0000-4000-8000-000000000002','Community C');
-- Explicitly activate synthetic fixtures; deployed communities default to off.
update public.community_brain_settings set context_enabled=true,ingestion_enabled=true,portfolio_enabled=true,private_delivery_enabled=true,feedback_enabled=true,consumers=array['site','chat','social','brand']where property_id in('bc000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000003');
select public.brain_set_access('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',array['read','download'],null,false,'Fixture A-only access');
select public.brain_set_access('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000003',array['read','portfolio','download'],null,false,'Fixture portfolio access');
select public.brain_set_access('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000003',array['read','portfolio','download'],null,false,'Fixture portfolio access');
insert into public.documents(property_id,content) values('bc000000-0000-4000-8000-000000000001','A private source'),('bc000000-0000-4000-8000-000000000002','B private source'),('bc000000-0000-4000-8000-000000000003','C private source');
select pg_temp.check_it(public.brain_can('bb000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000001'),'explicit A access');
select pg_temp.check_it(not public.brain_can('bb000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000002'),'same organization is insufficient');
select pg_temp.check_it(not public.brain_can('bb000000-0000-4000-8000-000000000003','bc000000-0000-4000-8000-000000000003'),'foreign organization denied');
select pg_temp.check_it(public.read_property_knowledge('bc000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000002','{}')->>'state'='forbidden','legacy privileged RPC also denies same-org B');
select pg_temp.check_it(public.read_property_knowledge('bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002','{}')->>'state'='ready','legacy privileged RPC preserves granted A reads');
create temp table brain_test_scopes as select public.brain_resolve_scope('bb000000-0000-4000-8000-000000000003',array['bc000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002']::uuid[],'portfolio') value;
select pg_temp.check_it(public.brain_scope_current((select(value->>'id')::uuid from brain_test_scopes),'bc000000-0000-4000-8000-000000000001'),'portfolio child A allowed');
select pg_temp.check_it(not public.brain_scope_current((select(value->>'id')::uuid from brain_test_scopes),'bc000000-0000-4000-8000-000000000003'),'portfolio child C denied');
select pg_temp.check_it(public.brain_context((select(value->>'id')::uuid from brain_test_scopes),'bc000000-0000-4000-8000-000000000001')->'canonical'->'property'->>'name'='Community A','context returns exact selected community');
set local role authenticated;
set local request.jwt.claims='{"sub":"bb000000-0000-4000-8000-000000000002","role":"authenticated"}';
select pg_temp.check_it((select count(*)=1 from public.documents),'direct table RLS excludes same-org B and other-org C');
select pg_temp.check_it((select content='A private source' from public.documents),'direct table returns only A bytes');
select pg_temp.check_it(not public.brain_can('bb000000-0000-4000-8000-000000000003','bc000000-0000-4000-8000-000000000002'),'authenticated actor cannot impersonate portfolio user');
do $$begin
 begin perform public.brain_resolve_scope('bb000000-0000-4000-8000-000000000003',array['bc000000-0000-4000-8000-000000000002']::uuid[],'research');raise exception 'Authenticated scope forgery succeeded';exception when insufficient_privilege then null;end;
 begin update public.documents set property_id='bc000000-0000-4000-8000-000000000002' where property_id='bc000000-0000-4000-8000-000000000001';if found then raise exception 'Unauthorized move succeeded';end if;exception when insufficient_privilege then null;end;
end$$;
reset role;
select public.brain_set_access('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000003',array['read'],null,true,'Revoke fixture access');
select pg_temp.check_it(not public.brain_scope_current((select(value->>'id')::uuid from brain_test_scopes),'bc000000-0000-4000-8000-000000000001'),'revoking one contributing community invalidates the entire combined scope');
select pg_temp.check_it((select count(*)=0 from public.match_documents(array_fill(1::real,array[1536])::public.vector,0,10,'bc000000-0000-4000-8000-000000000001')),'unknown legacy evidence excluded');
rollback;
