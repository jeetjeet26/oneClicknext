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
insert into st values('context',public.brain_save_context((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','policy','{}',null));
select pg_temp.check_it(public.brain_context_current((select(v->>'snapshotId')::uuid from st where k='context'),'bb000000-0000-4000-8000-000000000002'),'unchanged context current');
insert into public.siteforge_package_jobs(id,property_id,org_id,actor_id,target,instructions,request_hash,source_hash,source_snapshot,brain_context_id)
select 'bd000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002','standalone','Synthetic candidate only',repeat('a',64),repeat('a',64),jsonb_build_object('communityBrain',jsonb_build_object('readSetHash',v->>'readSetHash')),(v->>'snapshotId')::uuid from st where k='context';
select pg_temp.check_it(public.brain_generation_current('site_package','bd000000-0000-4000-8000-000000000001'),'native job has atomic common context binding');
update public.siteforge_package_jobs set state='preparing'where id='bd000000-0000-4000-8000-000000000001';
update public.siteforge_package_jobs set state='starting'where id='bd000000-0000-4000-8000-000000000001';
insert into st values('provider',public.brain_provider_record((select(v->>'id')::uuid from st where k='scope'),jsonb_build_object('provider','openai','project','synthetic-project','kind','input_file','objectId','file-fixture-A','parents','[]'::jsonb,'contextId',(select v->>'snapshotId'from st where k='context'),'policyRevision','test-v1','expiresAt',clock_timestamp()+interval '1 hour')));
insert into st values('renewed',public.brain_resolve_scope('bb000000-0000-4000-8000-000000000002',array['bc000000-0000-4000-8000-000000000001']::uuid[],'site'));
select pg_temp.check_it(public.brain_provider_read((select(v->>'id')::uuid from st where k='renewed'),(select(v->>'id')::uuid from st where k='provider'))->>'object_id'='file-fixture-A','renewed scope can read only its exact task provider state');
insert into st values('secondContext',public.brain_save_context((select(v->>'id')::uuid from st where k='renewed'),'bc000000-0000-4000-8000-000000000001','other task','{}',null));
do $$begin begin perform public.brain_provider_lookup((select(v->>'id')::uuid from st where k='renewed'),'synthetic-project','input_file','file-fixture-A',(select(v->>'snapshotId')::uuid from st where k='secondContext'),null);raise exception 'Cross-task provider reuse succeeded';exception when insufficient_privilege then null;end;end$$;
-- Even a same-org employee with A/B authority cannot attach combined history to a community job.
do $$begin begin perform public.brain_save_context((select(value->>'id')::uuid from brain_test_scopes),'bc000000-0000-4000-8000-000000000001','policy','{}',null);raise exception 'Portfolio writeback succeeded';exception when insufficient_privilege then null;end;end$$;
select public.brain_portfolio_session((select(value->>'id')::uuid from brain_test_scopes),'bd000000-0000-4000-8000-000000000020','Selected A and B');
select public.brain_portfolio_append((select(value->>'id')::uuid from brain_test_scopes),'bd000000-0000-4000-8000-000000000020','bd000000-0000-4000-8000-000000000021','assistant','Synthetic combined observation',jsonb_build_object('propertyIds',(select value->'property_ids'from brain_test_scopes)));
select pg_temp.check_it(jsonb_array_length(public.brain_portfolio_history((select(value->>'id')::uuid from brain_test_scopes),'bd000000-0000-4000-8000-000000000020'))=1,'authorized combined history available');
-- Native file intake and a genuinely constrained database worker.
insert into auth.users(id,email,email_confirmed_at)values('bb000000-0000-4000-8000-000000000004','brain-worker@example.invalid',now());
insert into public.community_worker_grants(principal_id,property_id,expires_at)values('bb000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000001',now()+interval '1 hour');
select pg_temp.check_it(public.begin_knowledge_file('bd000000-0000-4000-8000-000000000030','bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',jsonb_build_object('title','Exact drawing','fileName','drawing.png','mimeType','image/png','size',100,'byteHash',repeat('a',64),'materialId',null,'reason','Synthetic retained original'))->>'state'='saved','common intake accepts a retained image original');
select pg_temp.check_it(public.finish_knowledge_file_storage('bd000000-0000-4000-8000-000000000030','bb000000-0000-4000-8000-000000000002',repeat('a',64),100)->>'state'='ready','verified image finalized');
select pg_temp.check_it(public.decide_knowledge_file('bd000000-0000-4000-8000-000000000031','bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002',jsonb_build_object('fileId','bd000000-0000-4000-8000-000000000030','operation','extract','expectedRevision',(select revision from public.knowledge_files where id='bd000000-0000-4000-8000-000000000030'),'reason','Process this retained original'))->>'state'='saved','native extraction saved');
select public.brain_enqueue_extraction('bd000000-0000-4000-8000-000000000031');
grant select,insert,update on st to community_brain_worker;
set local role community_brain_worker;
set local request.jwt.claims='{"sub":"bb000000-0000-4000-8000-000000000004","role":"community_brain_worker"}';
select pg_temp.check_it(not has_table_privilege(current_user,'public.documents','select'),'worker cannot read arbitrary evidence tables');
select pg_temp.check_it(not has_function_privilege(current_user,'public.brain_resolve_scope(uuid,uuid[],text)','execute'),'worker cannot mint arbitrary scopes');
insert into st values('workerClaim',public.brain_claim_work('bb000000-0000-4000-8000-000000000004/fixture-instance',1));
select pg_temp.check_it(jsonb_array_length(v->'jobs')=1 and v#>>'{jobs,0,job,property_id}'='bc000000-0000-4000-8000-000000000001','worker claims only assigned community')from st where k='workerClaim';
select pg_temp.check_it(public.brain_worker_object('bc000000-0000-4000-8000-000000000001/bd000000-0000-4000-8000-000000000030/community-file-v1/page-1.png',true),'lease allows only its rendition prefix');
select pg_temp.check_it(not public.brain_worker_object('bc000000-0000-4000-8000-000000000002/bd000000-0000-4000-8000-000000000030/community-file-v1/page-1.png',true),'worker cannot write another community');
select pg_temp.check_it(not public.brain_worker_object('bc000000-0000-4000-8000-000000000001/other-original/secret.txt',false),'worker cannot read another original in its community');
reset role;
update public.community_worker_grants set revoked_at=clock_timestamp()where principal_id='bb000000-0000-4000-8000-000000000004';
set local role community_brain_worker;
select pg_temp.check_it(not public.brain_worker_object('bc000000-0000-4000-8000-000000000001/bd000000-0000-4000-8000-000000000030/community-file-v1/page-1.png',true),'revoked worker immediately loses storage');
do $$begin begin perform public.brain_finish_extraction((select(v#>>'{jobs,0,job,id}')::uuid from st where k='workerClaim'),'bb000000-0000-4000-8000-000000000004/fixture-instance',(select(v#>>'{jobs,0,claim,claimToken}')::uuid from st where k='workerClaim'),'{}','[]');raise exception 'Late revoked worker callback succeeded';exception when insufficient_privilege then null;end;end$$;
reset role;
set local request.jwt.claims='{}';
-- Real retrieval intents are bounded, owner-specific and never replay an uncertain invocation.
insert into st values('query',public.brain_prepare_query((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','private amenities'));
select pg_temp.check_it((select v->>'state'='invoke_once'from st where k='query'),'first query owns one embedding intent');
select pg_temp.check_it(public.brain_prepare_query((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','private amenities')->>'state'='invoking','uncertain query not submitted twice');
select public.brain_finish_query((select(v->>'id')::uuid from st where k='scope'),(select(v->>'id')::uuid from st where k='query'),'text-embedding-3-small',null);
select pg_temp.check_it(public.brain_prepare_query((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','private amenities')->>'state'='uncertain','failed query remains explicit lexical fallback');
do $$begin begin perform public.brain_prepare_query((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000002','another community');raise exception 'Cross-community query accepted';exception when insufficient_privilege then null;end;end$$;
select pg_temp.check_it(public.brain_measurement_hash('[{"date":"2026-01-01","campaign_id":"1","currency_code":"USD","spend":1,"clicks":2,"impressions":3,"conversions":0}]')=public.brain_measurement_hash('[{"date":"2026-01-01","campaign_id":"1","currency_code":"USD","spend":1.00,"clicks":2.0,"impressions":3.0,"conversions":0.0000}]'),'report hashes normalize database numeric scale');
select pg_temp.check_it(public.brain_measurement_coverage((select(v->>'id')::uuid from st where k='scope'),'bc000000-0000-4000-8000-000000000001','2026-01-01','2026-01-07')->>'state'='unconfigured','missing provider accounts are not complete zero reports');

-- Complete folder inventory binds exact native originals; withdrawal immediately
-- stops downstream serving while retaining the original for audit.
insert into public.siteforge_asset_sources(id,property_id,org_id,provider,status,external_folder_id)values('be000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','google_drive','active','synthetic-folder');
insert into st values('intake',public.brain_resolve_scope('bb000000-0000-4000-8000-000000000002',array['bc000000-0000-4000-8000-000000000001']::uuid[],'ingestion'));
select public.brain_source_sync((select(v->>'id')::uuid from st where k='intake'),'be000000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002','begin');
select public.brain_source_sync((select(v->>'id')::uuid from st where k='intake'),'be000000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002','observe','{"files":[{"id":"provider-A","revision":"1"}]}');
select public.brain_source_sync((select(v->>'id')::uuid from st where k='intake'),'be000000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002','bind','{"fileId":"bd000000-0000-4000-8000-000000000030","providerFileId":"provider-A","providerRevision":"1","metadata":{"provider":"google_drive"}}');
select pg_temp.check_it(public.brain_connected_file_current('bd000000-0000-4000-8000-000000000030'),'exact connected original current');
select public.brain_source_sync((select(v->>'id')::uuid from st where k='intake'),'be000000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002','observe','{"files":[]}');
select pg_temp.check_it(not public.brain_connected_file_current('bd000000-0000-4000-8000-000000000030'),'provider removal withdraws original immediately');
select public.brain_source_sync((select(v->>'id')::uuid from st where k='intake'),'be000000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002','finish','{"imported":1,"unchanged":0,"remaining":0}');
select pg_temp.check_it((select count(*)=1 from public.knowledge_files where id='bd000000-0000-4000-8000-000000000030'),'withdrawal preserves retained original identity');
update public.properties set name='Community A corrected'where id='bc000000-0000-4000-8000-000000000001';
select pg_temp.check_it(not public.brain_generation_current('site_package','bd000000-0000-4000-8000-000000000001'),'source correction holds native generation');
do $$begin begin update public.siteforge_package_jobs set state='generating'where id='bd000000-0000-4000-8000-000000000001';raise exception 'Expected generation hold'using errcode='P0002';exception when sqlstate'P0001'then if sqlerrm not like 'Generation sources%'then raise;end if;end;end$$;
select public.brain_set_access('bb000000-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000003',array['read'],null,true,'Revoke one contributor');
do $$begin begin perform public.brain_portfolio_history((select(value->>'id')::uuid from brain_test_scopes),'bd000000-0000-4000-8000-000000000020');raise exception 'Revoked combined prose was exposed';exception when insufficient_privilege then null;end;end$$;

-- Recurring connections remain bound to their scheduling actor and exact config.
select public.brain_source_schedule((select(v->>'id')::uuid from st where k='intake'),'be000000-0000-4000-8000-000000000001',true,24,0);
insert into st values('dueSources',public.brain_due_connected_sources(2));
select pg_temp.check_it(jsonb_array_length(v)=1,'scheduled source claimed once')from st where k='dueSources';
select pg_temp.check_it(jsonb_array_length(public.brain_due_connected_sources(2))=0,'active scheduled lease prevents duplicate dispatch');
select public.brain_finish_source_schedule('be000000-0000-4000-8000-000000000001',(select(v#>>'{0,leaseToken}')::uuid from st where k='dueSources'),'succeeded');
select pg_temp.check_it((select next_due_at>clock_timestamp()+interval '23 hours'from public.community_source_schedules where source_id='be000000-0000-4000-8000-000000000001'),'completed schedule advances its due time');
update public.community_source_schedules set next_due_at=clock_timestamp()-interval '1 second'where source_id='be000000-0000-4000-8000-000000000001';
update public.siteforge_asset_sources set external_folder_id='changed-folder'where id='be000000-0000-4000-8000-000000000001';
select pg_temp.check_it(jsonb_array_length(public.brain_due_connected_sources(2))=0,'changed source configuration cannot inherit scheduled authority');
select pg_temp.check_it((select not enabled and last_state='authorization_or_source_changed'from public.community_source_schedules where source_id='be000000-0000-4000-8000-000000000001'),'source change visibly pauses the schedule');
rollback;
