"""Rollback-only synthetic exact/lexical capacity probe; not a semantic relevance evaluation."""
import argparse,json,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--database',required=True);a=p.parse_args()
if not a.database.startswith('community_brain_')or not a.database.replace('_','').isalnum():raise ValueError('Isolated Community Brain database required')
root=Path(__file__).resolve().parents[1]
base=(root/'tests/community_brain_execution.test.sql').read_text().split("insert into st values('scope'")[0]
sql=base+"""
set local statement_timeout='120s';
create temp table capacity_properties as select n,md5('brain-capacity-property-'||n)::uuid id from generate_series(1,500)n;
insert into public.properties(id,org_id,name)select id,'ba000000-0000-4000-8000-000000000001','Synthetic community '||n from capacity_properties;
update public.community_brain_settings set portfolio_enabled=true,feedback_enabled=true where property_id in(select id from capacity_properties);
insert into public.community_access_grants(actor_id,property_id,capabilities,granted_by)
 select 'bb000000-0000-4000-8000-000000000003',id,array['read','portfolio'],'bb000000-0000-4000-8000-000000000001'from capacity_properties;
insert into public.property_intelligence_documents(id,property_id,org_id,kind,key,payload,status,actor_id)
 select md5(p.id||':'||g)::uuid,p.id,'ba000000-0000-4000-8000-000000000001','creative','capacity.'||g,
 jsonb_build_object('copy',case g when 1 then 'Pet policy cats and dogs'when 2 then 'Office hours and community contact'when 3 then 'Exact floorplan drawings and dimensions'else 'Historical reference garden courtyard landscaping '||g end),
 'approved','bb000000-0000-4000-8000-000000000003'from capacity_properties p cross join lateral generate_series(1,case when p.n=1 then 803 else 3 end)g;
insert into public.community_evidence(id,property_id,org_id,creative_id,authority,audience,purposes,allowed_uses,content_hash,review_status,review_after,origin)
 select d.id,d.property_id,d.org_id,d.id,'creative','internal',array['research','portfolio'],array['style'],public.knowledge_hash(d.payload),'approved',now()+interval '1 day','generated'
 from public.property_intelligence_documents d join capacity_properties p on p.id=d.property_id;
insert into public.documents(id,property_id,content,metadata,evidence_id)
 select d.id,d.property_id,d.payload->>'copy','{"recipe":"synthetic-lexical-capacity-only"}',d.id
 from public.property_intelligence_documents d join capacity_properties p on p.id=d.property_id;
analyze public.documents;analyze public.community_evidence;
create temp table capacity_times(ms numeric,items integer,foreign_items integer,query text);
do $$declare s jsonb;c jsonb;t timestamptz;p record;q text;begin
 s:=public.brain_resolve_scope('bb000000-0000-4000-8000-000000000003',(select array_agg(id order by id)from capacity_properties),'portfolio');
 for p in select *from capacity_properties order by n loop
  q:=case p.n%3 when 1 then 'pet policy'when 2 then 'office hours'else 'floorplan drawings'end;t:=clock_timestamp();
  c:=public.brain_context((s->>'id')::uuid,p.id,q);
  insert into capacity_times values(extract(epoch from clock_timestamp()-t)*1000,jsonb_array_length(c->'evidence'),(select count(*)from jsonb_array_elements(c->'evidence')x where x->>'propertyId'<>p.id::text),q);
 end loop;
end$$;
select jsonb_build_object('state',case when sum(foreign_items)=0 and count(*)filter(where items>0)=500 then 'passed'else'failed'end,
 'communities',500,'indexedChunks',2300,'largestCommunityChunks',803,'requests',count(*),'lexicalFixtureMatches',count(*)filter(where items>0),'crossCommunityResults',sum(foreign_items),
 'p50Ms',percentile_cont(0.5)within group(order by ms),'p95Ms',percentile_cont(0.95)within group(order by ms),'maxMs',max(ms),'qualification','Sequential synthetic lexical context only; no semantic relevance or concurrent production-load claim')from capacity_times;
rollback;
"""
r=subprocess.run(['docker','exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d',a.database,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
if r.returncode:raise RuntimeError(r.stderr[-2000:])
result=next(json.loads(line)for line in reversed(r.stdout.splitlines())if '"qualification"'in line)
print(json.dumps(result));raise SystemExit(0 if result['state']=='passed'else 1)
