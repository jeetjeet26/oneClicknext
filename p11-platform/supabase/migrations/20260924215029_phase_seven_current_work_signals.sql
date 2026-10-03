-- Current work signals are observation-only. No underlying work, provider, permission or history mutation.
create function public.agency_current_work(p_property_id uuid,p_org_id uuid,p_product text)
returns table(source text,id uuid,category text,state text,version_token text,opened_at timestamptz,changed_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select 'website_incident',r.id,'incident',r.status,md5(jsonb_build_array(r.status,r.severity,r.updated_at)::text),r.created_at,r.updated_at
 from public.siteforge_incidents r where p_product='siteforge' and r.property_id=p_property_id and r.org_id=p_org_id and r.status in('open','acknowledged','repairing')
 union all
 select 'social_publication',r.id,'unconfirmed',r.status,md5(jsonb_build_array(r.status,r.updated_at)::text),r.created_at,r.updated_at
 from public.social_publications r where p_product='forgestudio' and r.property_id=p_property_id and r.org_id=p_org_id and r.status='reconciling'
 union all
 select 'review_publication',r.id,case when r.state='held'then'unconfirmed'else'held'end,r.state,r.version::text,r.created_at,r.updated_at
 from public.reviewflow_publications r where p_product='reviewflow' and r.property_id=p_property_id and r.org_id=p_org_id and r.state in('held','awaiting_confirmation')
 union all
 select 'market_source',r.id,'held',r.state,r.version::text,r.created_at,r.updated_at
 from public.marketvision_source_requests r where p_product='marketvision' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'market_extraction',r.id,'held',r.state,r.version::text,r.created_at,r.updated_at
 from public.marketvision_extraction_requests r where p_product='marketvision' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'market_brand',r.id,'held',r.state,r.version::text,r.created_at,r.updated_at
 from public.marketvision_brand_requests r where p_product='marketvision' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'knowledge_search',r.id,'held',r.state,r.revision::text,r.created_at,r.updated_at
 from public.knowledge_embedding_requests r where p_product='knowledge' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'report_delivery',r.id,'unconfirmed',r.state,md5(jsonb_build_array(r.state,r.closed,r.updated_at)::text),r.attempted_at,r.updated_at
 from public.bi_schedule_deliveries r where p_product='bi' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='unknown' and not r.closed
 union all
 -- CRM transfers predate an org column; the immutable shared job retains the original organization.
 select 'crm_transfer',r.id,'unconfirmed',r.state,r.revision::text,r.requested_at,null::timestamptz
 from public.crm_handoffs r join public.shared_jobs j on j.id=r.job_id and j.property_id=r.property_id and j.org_id=p_org_id
 where p_product='crm' and r.property_id=p_property_id and r.state='needs_reconciliation'
$$;

create function public.agency_work_summary(p_property_id uuid,p_org_id uuid,p_product text)
returns jsonb language sql stable security invoker set search_path='' as $$
 with rows as materialized(select * from public.agency_current_work(p_property_id,p_org_id,p_product))
 select jsonb_build_object(
  'checkedSources',case p_product
   when 'siteforge'then array['website_incident'] when 'forgestudio'then array['social_publication']
   when 'reviewflow'then array['review_publication'] when 'marketvision'then array['market_source','market_extraction','market_brand']
   when 'knowledge'then array['knowledge_search'] when 'bi'then array['report_delivery'] when 'crm'then array['crm_transfer']else array[]::text[] end,
  'total',count(*),'heldCount',count(*)filter(where category='held'),'unconfirmedCount',count(*)filter(where category='unconfirmed'),
  'incidentCount',count(*)filter(where category='incident'),'oldestOpenedAt',min(opened_at),
  'fingerprint',md5(coalesce(string_agg(to_jsonb(rows)::text,','order by source,id),'')),
  'items',coalesce((select jsonb_agg(to_jsonb(r)order by r.opened_at nulls first,r.source,r.id)from
   (select * from rows order by opened_at nulls first,source,id limit 5)r),'[]'::jsonb)
 )from rows
$$;

create or replace function public.agency_observation_evidence(p_property_id uuid,p_org_id uuid,p_product text)
 returns jsonb language sql stable security invoker set search_path='' as $$
 with bounds as(select (date_trunc('day',statement_timestamp() at time zone 'UTC')-interval '6 days') at time zone 'UTC' as since),
 events as materialized(
  select e.id,e.episode_id,e.action,e.phase,e.evidence,e.created_at from public.shared_action_events e,bounds b
  where e.property_id=p_property_id and e.org_id=p_org_id and e.product=p_product
    and e.created_at>=b.since and e.created_at<=statement_timestamp()
 ), facts as(select jsonb_build_object(
  'ruleVersion','recorded-work-v2','propertyId',p_property_id,'orgId',p_org_id,'product',p_product,
  'windowStart',(select since from bounds),
  'confirmedCount',count(*) filter(where evidence='server_confirmed'),
  'failedCount',count(*) filter(where evidence='server_confirmed' and phase='failed'),
  'latestConfirmedAt',max(created_at) filter(where evidence='server_confirmed'),
  'eventFingerprint',md5(coalesce(string_agg(id::text,',' order by id) filter(where evidence='server_confirmed'),'')),
  'failures',coalesce((select jsonb_agg(to_jsonb(f) order by f."recordedAt" desc,f."eventId" desc) from
    (select id as "eventId",episode_id as "episodeId",action,created_at as "recordedAt" from events
     where evidence='server_confirmed' and phase='failed' order by created_at desc,id desc limit 5) f),'[]'::jsonb)
 ) as value, count(*) filter(where evidence='browser_observed') as observations from events),
 combined as(select value||jsonb_build_object('currentWork',public.agency_work_summary(p_property_id,p_org_id,p_product)) as value,observations from facts)
 select value||jsonb_build_object('sourceHash',encode(extensions.digest(value::text,'sha256'),'hex'),
  'observedCount',observations,'capturedAt',statement_timestamp()) from combined
$$;

create or replace function public.decide_agency_observation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;record public.agency_observation_reviews;facts jsonb;input_digest text;result jsonb;kind text;decision text;reason text;
begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id
 where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager') for share of p,u;
 if organization is null then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input) is distinct from 'object' or length(p_input::text)>8192 then return '{"state":"invalid"}';end if;
 kind:=p_input->>'operation';decision:=p_input->>'decision';reason:=p_input->>'reason';
 if kind='review' then
  if p_input-array['operation','product','sourceHash','decision','reason']<>'{}'
   or coalesce(p_input->>'product','')<>all(public.agency_observation_products())
   or coalesce(p_input->>'sourceHash','')!~'^[a-f0-9]{64}$'
   or coalesce(decision,'') not in('investigate','watch','not_actionable')
   or coalesce(length(btrim(reason)),0) not between 3 and 2000 then return '{"state":"invalid"}';end if;
 elsif kind='cancel_unused' then
  if p_input-array['operation','inputHash']<>'{}' or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$' then return '{"state":"invalid"}';end if;
 else return '{"state":"invalid"}';end if;
 input_digest:=encode(extensions.digest(p_input::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into record from public.agency_observation_reviews where id=p_id;
 if found then
  if(record.property_id,record.org_id,record.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return '{"state":"request_conflict"}';end if;
  if kind<>'cancel_unused' and record.kind='cancel_unused' then return '{"state":"decision_cancelled"}';end if;
  if kind<>'cancel_unused' and record.input is distinct from p_input then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','propertyId',p_property_id,'decisionId',p_id,'record',to_jsonb(record));
 end if;
 if kind='review' then
  facts:=public.agency_observation_evidence(p_property_id,organization,p_input->>'product');
  if facts->>'sourceHash' is distinct from p_input->>'sourceHash' then return '{"state":"evidence_changed"}';end if;
  if(facts->>'failedCount')::bigint+coalesce((facts->'currentWork'->>'total')::bigint,0)<1 then return '{"state":"no_recommendation"}';end if;
 end if;
 insert into public.agency_observation_reviews(id,property_id,org_id,actor_id,kind,input,input_hash,evidence,decision,reason)
 values(p_id,p_property_id,organization,p_actor_id,kind,p_input,input_digest,facts,decision,reason) returning * into record;
 -- The private note and source payload stay in the scoped review. The shared stream retains references and the human choice.
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin) values(p_id,organization,p_property_id,p_actor_id,'console');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,after_state,result)
 values(p_id,p_id,organization,p_property_id,p_actor_id,'agency',case when kind='review'then'agency.observation.reviewed'else'agency.observation.cancelled'end,
  'server_confirmed','succeeded',jsonb_build_object('reviewId',p_id,'sourceHash',facts->>'sourceHash','product',facts->>'product'),
  jsonb_build_object('decision',decision),jsonb_build_object('reviewId',p_id,'mode','observe','executionAuthorized',false));
 return jsonb_build_object('state','saved','propertyId',p_property_id,'decisionId',p_id,'record',to_jsonb(record));
end$$;

revoke all on function public.agency_current_work(uuid,uuid,text),public.agency_work_summary(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.agency_current_work(uuid,uuid,text),public.agency_work_summary(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
