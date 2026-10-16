begin;
create function pg_temp.check_it(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
insert into public.organizations(id,name) values('ba000000-0000-4000-8000-000000000001','Brain organization A'),('ba000000-0000-4000-8000-000000000002','Brain organization B');
insert into auth.users(id,email,email_confirmed_at) values
 ('bb000000-0000-4000-8000-000000000001','brain-admin@example.invalid',now()),
 ('bb000000-0000-4000-8000-000000000002','brain-a@example.invalid',now()),
 ('bb000000-0000-4000-8000-000000000003','brain-portfolio@example.invalid',now());
insert into public.profiles(id,org_id,role) values
 ('bb000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','admin'),
 ('bb000000-0000-4000-8000-000000000002','ba000000-0000-4000-8000-000000000001','manager'),
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

-- Synthetic local fixture: exercise native publication, including its vector.
create temp table st(k text primary key,v jsonb);
select public.brain_set_access('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',array['read','manage','generate','download'],null,false,'Native publication fixture access');
do $$declare pid uuid:='bc000000-0000-4000-8000-000000000001';actor uuid:='bb000000-0000-4000-8000-000000000002';mid uuid:='bf100000-0000-4000-8000-000000000001';sid uuid:='bf100000-0000-4000-8000-000000000002';claim jsonb;receipt jsonb;scope jsonb;hash text;begin
 perform public.save_knowledge_material(mid,pid,actor,jsonb_build_object('materialId',null,'previousVersionId',null,'title','Native projection fixture','content','Verified original courtyard details.','reason','Synthetic native publication regression'));
 select content_hash into hash from public.knowledge_material_versions where id=mid;
 perform public.begin_knowledge_search(sid,pid,actor,jsonb_build_object('materialId',mid,'versionId',mid,'contentHash',hash,'confirmed',true,'reason','Synthetic native publication regression'),jsonb_build_object('model','text-embedding-3-small','dimensions',1536,'recipe','lossless-utf8-4096-v1','contentHash',hash,'chunks',jsonb_build_array('Verified original courtyard details.')));
 claim:=public.claim_knowledge_search(sid);
 receipt:=jsonb_build_object('status','received','providerRequestId','synthetic-fixture-no-model','response',jsonb_build_object('model','text-embedding-3-small','usage','{}'::jsonb,'data',jsonb_build_array(jsonb_build_object('index',0,'embedding',(select jsonb_agg(case when n=1 then 1 else 0 end order by n)from generate_series(1,1536)n)))));
 perform public.record_knowledge_search_result(sid,(claim->>'claimToken')::uuid,receipt);
 perform pg_temp.check_it(public.validate_knowledge_search(sid,(select result_hash from public.knowledge_embedding_requests where id=sid))->>'state'='ready','native receipt validated');
 scope:=public.brain_resolve_scope(actor,array[pid],'manage');
 perform public.brain_review_source((scope->>'id')::uuid,mid,jsonb_build_object('audience','public','origin','original','allowedUses',array['fact'],'purposes',array['chat','research'],'reviewAfter',now()+interval '30 days','expiresAt',null,'reason','Synthetic reviewed original'));
 perform pg_temp.check_it(public.release_knowledge_material('bf100000-0000-4000-8000-000000000003',pid,actor,jsonb_build_object('materialId',mid,'versionId',mid,'expectedLatestVersionId',mid,'expectedActiveVersionId',null,'expectedReleaseId',null,'operation','publish','resultHash',(select result_hash from public.knowledge_embedding_requests where id=sid),'confirmed',true,'reason','Publish synthetic original'))->>'state'='saved','native publication saved');
 insert into st values('original',(select jsonb_build_object('id',id,'content',content,'embedding',embedding::text,'metadata',metadata)from public.documents where metadata->>'knowledge_material_id'=mid::text));
end$$;
insert into auth.users(id,email,email_confirmed_at)values('bb000000-0000-4000-8000-000000000004','brain-worker@example.invalid',now());
insert into public.community_worker_grants(principal_id,property_id,expires_at)values('bb000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000001',now()+interval '1 hour');
create function pg_temp.drain_brain()returns void language plpgsql as $$declare batch jsonb;item jsonb;begin
 for i in 1..20 loop
 batch:=public.brain_claim_work('bb000000-0000-4000-8000-000000000004/fixture-instance',1);
 if jsonb_array_length(batch->'jobs')=0 then return;end if;
 for item in select *from jsonb_array_elements(batch->'jobs')loop perform public.brain_project_memory((item#>>'{job,id}')::uuid,'bb000000-0000-4000-8000-000000000004/fixture-instance');end loop;
 end loop;raise exception 'Projection queue did not drain';end$$;
select set_config('p11.knowledge_scope','unrelated-caller-scope',true);
set local role community_brain_worker;
set local request.jwt.claims='{"sub":"bb000000-0000-4000-8000-000000000004","role":"community_brain_worker"}';
select pg_temp.drain_brain();
select pg_temp.check_it(current_setting('p11.knowledge_scope',true)='unrelated-caller-scope','projection restores caller scope');
reset role;set local request.jwt.claims='{}';
select pg_temp.check_it((select count(*)=1 from public.documents where metadata->>'knowledge_material_id'='bf100000-0000-4000-8000-000000000001'),'native projection does not duplicate managed chunks');
select pg_temp.check_it((select evidence_id is not null and embedding_model='text-embedding-3-small' and embedding_recipe='lossless-utf8-4096-v1' from public.documents where id=((select v from st where k='original')->>'id')::uuid),'native exact vector linked to current evidence');
select pg_temp.check_it((select jsonb_build_object('id',id,'content',content,'embedding',embedding::text,'metadata',metadata)from public.documents where id=((select v from st where k='original')->>'id')::uuid)=(select v from st where k='original'),'original bytes and vector unchanged');
select pg_temp.check_it(not exists(select 1 from public.shared_jobs where domain='community_brain' and property_id='bc000000-0000-4000-8000-000000000001' and lifecycle_status<>'succeeded'),'native projection jobs complete');
do $$declare denied boolean:=false;begin
 begin update public.documents set content='unapproved replacement'where metadata->>'knowledge_material_id'='bf100000-0000-4000-8000-000000000001';exception when raise_exception then denied:=sqlerrm='Use the recorded source publication or withdrawal workflow';end;
 perform pg_temp.check_it(denied,'direct managed-content writes remain blocked after projection');
end$$;
rollback;
