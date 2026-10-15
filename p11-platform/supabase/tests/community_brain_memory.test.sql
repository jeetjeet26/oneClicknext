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

create temp table st(k text primary key,v jsonb);
select public.brain_set_access('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',array['read','manage','generate','download'],null,false,'Manage exact fixture originals');

insert into st values('scope',public.brain_resolve_scope('bb000000-0000-4000-8000-000000000002',array['bc000000-0000-4000-8000-000000000001']::uuid[],'site'));
insert into st values('reviewScope',public.brain_resolve_scope('bb000000-0000-4000-8000-000000000002',array['bc000000-0000-4000-8000-000000000001']::uuid[],'manage'));
insert into st values('source',public.save_knowledge_material('bf000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002','{"materialId":null,"previousVersionId":null,"title":"Retained handbook","content":"Conifer courtyard pet policy: cats allowed. This is an independent source fixture.","reason":"Create reviewed synthetic evidence"}'));
select pg_temp.check_it((select v->>'state'='saved'from st where k='source'),'native material saved');
-- Native release requires an actual embedding receipt. For the isolated projection
-- fixture only, set its approved pointer directly without making a provider call.
update public.knowledge_materials set active_version_id=latest_version_id where id=(select(v->>'materialId')::uuid from st where k='source');
insert into public.property_intelligence_documents(id,property_id,org_id,kind,key,payload,status,actor_id)values
('bf000000-0000-4000-8000-000000000002','bc000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','creative','fixture.creative','{"copy":"Conifer courtyard luxury imaginative lifestyle","visibility":"public"}','approved','bb000000-0000-4000-8000-000000000002');
insert into auth.users(id,email,email_confirmed_at)values('bb000000-0000-4000-8000-000000000004','brain-worker@example.invalid',now());
insert into public.community_worker_grants(principal_id,property_id,expires_at)values('bb000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000001',now()+interval '1 hour');
create function pg_temp.drain_brain()returns void language plpgsql as $$declare batch jsonb;item jsonb;begin
 for i in 1..50 loop
 batch:=public.brain_claim_work('bb000000-0000-4000-8000-000000000004/fixture-instance',1);
 if jsonb_array_length(batch->'jobs')=0 then return;end if;
 for item in select *from jsonb_array_elements(batch->'jobs')loop perform public.brain_project_memory((item#>>'{job,id}')::uuid,'bb000000-0000-4000-8000-000000000004/fixture-instance');end loop;
 end loop;raise exception 'Projection queue did not drain';end$$;
set local role community_brain_worker;
set local request.jwt.claims='{"sub":"bb000000-0000-4000-8000-000000000004","role":"community_brain_worker"}';
select pg_temp.drain_brain();
reset role;set local request.jwt.claims='{}';
select pg_temp.check_it(not exists(select 1 from public.community_evidence where material_version_id=(select(v->>'versionId')::uuid from st where k='source')),'unreviewed active text never enters searchable evidence');
select pg_temp.check_it(exists(select 1 from public.community_evidence where creative_id='bf000000-0000-4000-8000-000000000002'and allowed_uses=array['style']and origin='generated'),'approved creative automatically becomes style-only memory');
select public.brain_review_source((select(v->>'id')::uuid from st where k='reviewScope'),(select(v->>'versionId')::uuid from st where k='source'),jsonb_build_object('audience','public','origin','original','allowedUses',array['fact'],'purposes',array['site','chat','research','portfolio'],'reviewAfter',now()+interval '30 days','expiresAt',null,'reason','Confirm source identity and policy'));
set local role community_brain_worker;
set local request.jwt.claims='{"sub":"bb000000-0000-4000-8000-000000000004","role":"community_brain_worker"}';
select pg_temp.drain_brain();
reset role;set local request.jwt.claims='{}';
select pg_temp.check_it(exists(select 1 from public.community_evidence where material_version_id=(select(v->>'versionId')::uuid from st where k='source')and allowed_uses=array['fact']and origin='original'),'reviewed active text projected with exact authority');
select pg_temp.check_it(jsonb_array_length(public.brain_search((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','cats')->'items')=1,'eligible lexical retrieval works without paid embeddings');
select public.brain_review_source((select(v->>'id')::uuid from st where k='reviewScope'),(select(v->>'versionId')::uuid from st where k='source'),jsonb_build_object('audience','internal','origin','original','allowedUses',array['research'],'purposes',array['research','portfolio'],'reviewAfter',now()+interval '30 days','expiresAt',null,'reason','Restrict source to internal research'));
select pg_temp.check_it(jsonb_array_length(public.brain_search((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','cats')->'items')=0,'policy downgrade blocks old index entries immediately');
select public.brain_review_source((select(v->>'id')::uuid from st where k='reviewScope'),(select(v->>'versionId')::uuid from st where k='source'),jsonb_build_object('audience','public','origin','original','allowedUses',array['fact'],'purposes',array['site','chat','research','portfolio'],'reviewAfter',now()+interval '30 days','expiresAt',null,'reason','Restore exactly reviewed public use'));
set local role community_brain_worker;
set local request.jwt.claims='{"sub":"bb000000-0000-4000-8000-000000000004","role":"community_brain_worker"}';
select pg_temp.drain_brain();
reset role;set local request.jwt.claims='{}';
insert into st values('context',public.brain_save_context((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','cats','{}',null));
update public.knowledge_materials set active_version_id=null where id=(select(v->>'materialId')::uuid from st where k='source');
select pg_temp.check_it(jsonb_array_length(public.brain_search((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','cats')->'items')=0,'withdrawal blocks retrieval before the index worker runs');
select pg_temp.check_it(not public.brain_context_current((select(v->>'snapshotId')::uuid from st where k='context'),'bb000000-0000-4000-8000-000000000002'),'withdrawal invalidates only dependent context');
select public.brain_review_source((select(v->>'id')::uuid from st where k='reviewScope'),(select(v->>'versionId')::uuid from st where k='source'),jsonb_build_object('audience','public','origin','generated','allowedUses',array['style'],'purposes',array['site'],'reviewAfter',now()+interval '30 days','expiresAt',null,'reason','Correct provenance to generated'));
do $$begin begin perform public.brain_review_source((select(v->>'id')::uuid from st where k='reviewScope'),(select(v->>'versionId')::uuid from st where k='source'),jsonb_build_object('audience','public','origin','original','allowedUses',array['fact'],'purposes',array['site'],'reviewAfter',now()+interval '30 days','expiresAt',null,'reason','Attempt to promote creative'));raise exception 'Generated ancestry was erased' using errcode='P0002';exception when sqlstate 'P0001'then if sqlerrm not like 'Generated lineage%'then raise;end if;end;end$$;
select pg_temp.check_it((select count(*)=count(distinct event_id)from public.community_memory_receipts),'memory event receipts are idempotent');

-- A competitor's amenity is searchable research, never a community amenity.
insert into public.competitors(id,property_id,name,website_url,is_active)values('bf000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000001','Competitor One','https://competitor.example.invalid',true);
insert into public.market_source_captures(id,property_id,competitor_id,source_type,source_url,content_hash,status)values('bf000000-0000-4000-8000-000000000011','bc000000-0000-4000-8000-000000000001','bf000000-0000-4000-8000-000000000010','website','https://competitor.example.invalid',repeat('a',64),'captured');
insert into public.competitor_content_chunks(id,competitor_id,property_id,capture_id,page_url,page_type,chunk_index,content,content_hash)values('bf000000-0000-4000-8000-000000000012','bf000000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000001','bf000000-0000-4000-8000-000000000011','https://competitor.example.invalid','amenities',0,'Competitor One has a rooftop swimming pool. This observation describes the competitor only.',repeat('b',64));
set local role community_brain_worker;
set local request.jwt.claims='{"sub":"bb000000-0000-4000-8000-000000000004","role":"community_brain_worker"}';
select pg_temp.drain_brain();reset role;set local request.jwt.claims='{}';
insert into st values('research',public.brain_resolve_scope('bb000000-0000-4000-8000-000000000002',array['bc000000-0000-4000-8000-000000000001']::uuid[],'research'));
select pg_temp.check_it(jsonb_array_length(public.brain_search((select(v->>'id')::uuid from st where k='research'),'bc000000-0000-4000-8000-000000000001','rooftop swimming')->'items')=1,'competitor capture available as internal research');
select pg_temp.check_it(jsonb_array_length(public.brain_search((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','rooftop swimming')->'items')=0,'competitor pool cannot establish a community feature');
update public.market_source_captures set status='failed'where id='bf000000-0000-4000-8000-000000000011';
select pg_temp.check_it(jsonb_array_length(public.brain_search((select(v->>'id')::uuid from st where k='research'),'bc000000-0000-4000-8000-000000000001','rooftop swimming')->'items')=0,'withdrawn competitor capture denied immediately');

insert into st values('replayRecords',(select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'source_hash',source_hash))from public.brain_replay_candidates('bc000000-0000-4000-8000-000000000001')where eligible));
insert into st values('replayResult',public.brain_replay_sources((select(v->>'id')::uuid from st where k='reviewScope'),'bf000000-0000-4000-8000-000000000020',(select v from st where k='replayRecords')));
select pg_temp.check_it((select v->>'state'='queued'and jsonb_array_length(v->'jobIds')=1 from st where k='replayResult'),'eligible creative memory replay queued; unreviewed history excluded');
select pg_temp.check_it(public.brain_replay_sources((select(v->>'id')::uuid from st where k='reviewScope'),'bf000000-0000-4000-8000-000000000020',(select v from st where k='replayRecords'))=(select v from st where k='replayResult'),'repeated replay request creates no duplicate jobs');
do $$declare denied boolean:=false;begin
 begin perform public.brain_replay_sources((select(v->>'id')::uuid from st where k='reviewScope'),'bf000000-0000-4000-8000-000000000021',jsonb_set((select v from st where k='replayRecords'),'{0,source_hash}',to_jsonb(repeat('0',64))));exception when raise_exception then denied:=sqlerrm like'A source changed%';end;
 perform pg_temp.check_it(denied,'changed source hashes cannot be silently backfilled');
end$$;

select public.brain_rollout('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','{"revision":1,"context":false,"ingestion":true,"portfolio":true,"privateDelivery":false,"feedback":false,"consumers":[],"reason":"Pause this synthetic community after qualification"}');
select pg_temp.check_it(not public.brain_scope_current((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001'),'community suspension invalidates existing generation scopes');
do $$begin begin perform public.brain_resolve_scope('bb000000-0000-4000-8000-000000000002',array['bc000000-0000-4000-8000-000000000001']::uuid[],'site');raise exception 'Disabled consumer received a scope';exception when insufficient_privilege then null;end;end$$;
select pg_temp.check_it(public.brain_resolve_scope('bb000000-0000-4000-8000-000000000002',array['bc000000-0000-4000-8000-000000000001']::uuid[],'manage')->>'purpose'='manage','review and repair remain available while consumers are suspended');
rollback;
