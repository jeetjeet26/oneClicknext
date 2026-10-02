BEGIN;
create function pg_temp.check_it(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Assertion failed: %',label;end if;end$$;
create temp table test_state(k text primary key,v jsonb);
insert into public.properties(id,org_id,name)values('ed100000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222','Knowledge inventory SQL fixture');
insert into public.knowledge_sources(id,property_id,source_type,source_name,status,documents_created,source_url)
 select gen_random_uuid(),'ed100000-0000-4000-8000-000000000001','manual','Source '||n,case when n%2=0 then'completed'else'failed'end,999,case when n=1 then'https://example.test'else null end from generate_series(1,1031)n;
insert into public.documents(id,property_id,content,metadata)
 select gen_random_uuid(),'ed100000-0000-4000-8000-000000000001','Exact content '||n,jsonb_build_object('title','Repeated title','source','pasted_text','ingestion_run_id',case when n<=1021 then'large-run'else'run-'||n end,'chunk_index',n-1)from generate_series(1,1046)n;
insert into public.documents(id,property_id,content,metadata)values
 ('ed100000-0000-4000-8000-000000000002','ed100000-0000-4000-8000-000000000001','Legacy content','{"title":"Legacy first","source":"pasted_text"}'),
 ('ed100000-0000-4000-8000-000000000003','ed100000-0000-4000-8000-000000000001','Other legacy content','{"title":"Legacy second","source":"pasted_text"}'),
 ('ed100000-0000-4000-8000-000000000004','ed100000-0000-4000-8000-000000000001',repeat('x',12001),'{}');
update public.knowledge_sources set extracted_data='{"generated_by":"siteforge","artifact_id":"artifact-fixture","provenance_identity":"source-fixture","last_attempt_at":"2026-09-22T00:00:00Z"}'where property_id='ed100000-0000-4000-8000-000000000001';
insert into public.property_units(property_id,org_id,canonical_key,unit_type,bedrooms)select'ed100000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222','unit-'||n,'Fixture floorplan '||n,0 from generate_series(1,1001)n;
insert into test_state values('sources',public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111'));
select pg_temp.check_it((v->>'state')='ready','current organization read')from test_state where k='sources';
select pg_temp.check_it((v->'summary'->>'sourceCount')::int=1031,'complete sources beyond REST cap')from test_state where k='sources';
select pg_temp.check_it((v->'summary'->>'chunkCount')::int=1049,'complete chunk count')from test_state where k='sources';
select pg_temp.check_it((v->'summary'->>'documentGroups')::int=29,'ingestion and legacy groups stay distinct')from test_state where k='sources';
select pg_temp.check_it((v->'summary'->>'embeddedChunks')::int=0,'no invented embeddings')from test_state where k='sources';
select pg_temp.check_it(jsonb_array_length(v->'items')=20 and(v->>'nextOffset')::int=20,'bounded first page')from test_state where k='sources';
select pg_temp.check_it((v->'summary'->'sourceStatuses'->>'failed')::int=516,'recorded failure counts')from test_state where k='sources';
select pg_temp.check_it((v->'items'->0->>'documents_created')::int=999,'reported counts are distinct from actual chunk totals')from test_state where k='sources';
insert into test_state select'last',public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',jsonb_build_object('offset',1020,'expectedHash',v->>'inventoryHash'))from test_state where k='sources';
select pg_temp.check_it(jsonb_array_length(v->'items')=11 and v->'nextOffset'='null','tail beyond 1000 is reachable')from test_state where k='last';
insert into test_state values('groups',public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','{"kind":"documents"}'));
select pg_temp.check_it((v->>'total')::int=29 and jsonb_array_length(v->'items')=20,'group pagination with exact total')from test_state where k='groups';
select pg_temp.check_it(public.knowledge_document_group('{"ingestion_run_id":"a","source":"pasted_text"}','ed100000-0000-4000-8000-000000000002')<>public.knowledge_document_group('{"ingestion_run_id":"b","source":"pasted_text"}','ed100000-0000-4000-8000-000000000002'),'same generic source does not merge separate runs');
select pg_temp.check_it(public.knowledge_document_group('{"title":"a","source":"pasted_text"}','ed100000-0000-4000-8000-000000000002')<>public.knowledge_document_group('{"title":"b","source":"pasted_text"}','ed100000-0000-4000-8000-000000000002'),'legacy titles are distinct');
insert into test_state values('chunks',public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',jsonb_build_object('kind','chunks','groupKey',public.knowledge_document_group('{"ingestion_run_id":"large-run"}','ed100000-0000-4000-8000-000000000002'),'offset',1020)));
select pg_temp.check_it((v->>'total')::int=1021 and jsonb_array_length(v->'items')=1 and v->'items'->0->>'content'='Exact content 1021','all original chunks reachable without reconstruction')from test_state where k='chunks';
insert into test_state values('long',public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',jsonb_build_object('kind','chunks','groupKey',public.knowledge_document_group('{}','ed100000-0000-4000-8000-000000000004'))));
select pg_temp.check_it(length(v->'items'->0->>'content')=10000 and(v->'items'->0->>'characterCount')::int=12001 and v->'items'->0->'previewTruncated'='true','bounded previews disclose truncation')from test_state where k='long';
select pg_temp.check_it((public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','{"kind":"chunks","groupKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')->>'state')='not_found','unknown group not empty success');
update public.documents set content='A concurrent edit without timestamp'where id='ed100000-0000-4000-8000-000000000002';
select pg_temp.check_it((public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',jsonb_build_object('offset',20,'expectedHash',v->>'inventoryHash'))->>'state')='inventory_changed','content-only changes invalidate continuation')from test_state where k='sources';
select pg_temp.check_it((public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff')->>'state')='forbidden','unknown actor denied');
select pg_temp.check_it((public.read_property_knowledge('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-1111-1111-111111111111')->>'state')='forbidden','unknown property denied');
select pg_temp.check_it(not has_function_privilege('anon','public.read_property_knowledge(uuid,uuid,jsonb)','EXECUTE')and not has_function_privilege('authenticated','public.read_property_knowledge(uuid,uuid,jsonb)','EXECUTE'),'native reads service only');
select pg_temp.check_it(not exists(select 1 from public.shared_action_events where property_id='ed100000-0000-4000-8000-000000000001'),'reads do not fabricate actions');
select pg_temp.check_it((select count(*)from public.documents where property_id='ed100000-0000-4000-8000-000000000001')=1049,'reads do not mutate knowledge');
select pg_temp.check_it((public.read_property_knowledge('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111')->'summary'->>'sourceCount')::int<>1031,'isolated property counts');
select pg_temp.check_it(v->'items'->0->'provenance'->>'artifactId'='artifact-fixture'and v->'items'->0->'provenance'->>'reportedOrigin'='siteforge'and v->'items'->0->'provenance'->>'sourceIdentity'='source-fixture','prior recorded provenance preserved')from test_state where k='sources';
insert into test_state values('units',public.read_property_knowledge('ed100000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','{"kind":"units"}'));
select pg_temp.check_it(jsonb_array_length(v->'items')=1001 and(v->>'total')::int=1001 and v->'nextOffset'='null','floorplan compatibility read is complete beyond REST cap')from test_state where k='units';
select 24 as passed_assertions;
ROLLBACK;
