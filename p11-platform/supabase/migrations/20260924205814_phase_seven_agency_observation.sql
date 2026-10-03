-- Phase 7 observation only: no provider calls, jobs, permissions, rewards or training eligibility.
create table public.agency_observation_reviews (
 id uuid primary key,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('review','cancel_unused')),
 input jsonb not null, input_hash text not null,
 evidence jsonb, decision text check(decision in ('investigate','watch','not_actionable')),
 reason text, created_at timestamptz not null default clock_timestamp(),
 sequence bigint generated always as identity,
 check((kind='review' and evidence is not null and decision is not null and length(reason) between 3 and 2000)
    or(kind='cancel_unused' and evidence is null and decision is null and reason is null))
);
create index agency_observation_property_history on public.agency_observation_reviews(property_id,org_id,sequence desc);
create index agency_observation_actor on public.agency_observation_reviews(actor_id);
create index agency_observation_org on public.agency_observation_reviews(org_id);
alter table public.agency_observation_reviews enable row level security;
revoke all on public.agency_observation_reviews from public,anon,authenticated;
grant select,insert,delete on public.agency_observation_reviews to service_role;
grant usage,select on sequence public.agency_observation_reviews_sequence_seq to service_role;
create trigger agency_observation_review_immutable before update or delete on public.agency_observation_reviews
 for each row execute function public.protect_shared_action_history();

create function public.agency_observation_products() returns text[] language sql immutable security invoker set search_path='' as $$
 select array['siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','platform']::text[]
$$;

-- Counts are complete within the dated property/org window; only the five newest failure references are displayed.
-- Browser observations never enter the review fingerprint or the failure recommendation.
create function public.agency_observation_evidence(p_property_id uuid,p_org_id uuid,p_product text)
 returns jsonb language sql stable security invoker set search_path='' as $$
 with bounds as(select (date_trunc('day',statement_timestamp() at time zone 'UTC')-interval '6 days') at time zone 'UTC' as since),
 events as materialized(
  select e.id,e.episode_id,e.action,e.phase,e.evidence,e.created_at from public.shared_action_events e,bounds b
  where e.property_id=p_property_id and e.org_id=p_org_id and e.product=p_product
    and e.created_at>=b.since and e.created_at<=statement_timestamp()
 ), facts as(select jsonb_build_object(
  'ruleVersion','recorded-failures-v1','propertyId',p_property_id,'orgId',p_org_id,'product',p_product,
  'windowStart',(select since from bounds),
  'confirmedCount',count(*) filter(where evidence='server_confirmed'),
  'failedCount',count(*) filter(where evidence='server_confirmed' and phase='failed'),
  'latestConfirmedAt',max(created_at) filter(where evidence='server_confirmed'),
  'eventFingerprint',md5(coalesce(string_agg(id::text,',' order by id) filter(where evidence='server_confirmed'),'')),
  'failures',coalesce((select jsonb_agg(to_jsonb(f) order by f."recordedAt" desc,f."eventId" desc) from
    (select id as "eventId",episode_id as "episodeId",action,created_at as "recordedAt" from events
     where evidence='server_confirmed' and phase='failed' order by created_at desc,id desc limit 5) f),'[]'::jsonb)
 ) as value, count(*) filter(where evidence='browser_observed') as observations from events)
 select value||jsonb_build_object('sourceHash',encode(extensions.digest(value::text,'sha256'),'hex'),
  'observedCount',observations,'capturedAt',statement_timestamp()) from facts
$$;

create function public.read_agency_observation(p_property_id uuid,p_actor_id uuid,p_input jsonb default '{}')
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;actor_role text;items jsonb;record public.agency_observation_reviews;boundary bigint;
begin
 select p.org_id,u.role into organization,actor_role from public.properties p join public.profiles u on u.org_id=p.org_id
 where p.id=p_property_id and u.id=p_actor_id for share of p,u;
 if organization is null then return '{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then return '{"state":"invalid"}';end if;
 if coalesce(p_input->>'kind','board')='board' then
  select jsonb_agg(jsonb_build_object('evidence',e.value,'review',
   (select jsonb_build_object('id',r.id,'decision',r.decision,'reason',r.reason,'createdAt',r.created_at)
    from public.agency_observation_reviews r where r.property_id=p_property_id and r.org_id=organization and r.kind='review'
    and r.evidence->>'product'=e.value->>'product' and r.evidence->>'sourceHash'=e.value->>'sourceHash' order by r.sequence desc limit 1)) order by e.ordinal)
  into items from(select public.agency_observation_evidence(p_property_id,organization,product) as value,ordinal
   from unnest(public.agency_observation_products()) with ordinality as products(product,ordinal)) e;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',actor_role in('admin','manager'),
   'mode','observe','items',items);
 elsif p_input->>'kind'='decision' then
  select * into record from public.agency_observation_reviews where id=(p_input->>'decisionId')::uuid
   and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;
  if not found then return jsonb_build_object('state','not_found','propertyId',p_property_id);end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'decisionId',record.id,'record',to_jsonb(record));
 elsif p_input->>'kind'='history' then
  boundary:=coalesce((p_input->>'before')::bigint,9223372036854775807);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sequence desc),'[]') into items from
   (select * from public.agency_observation_reviews where property_id=p_property_id and org_id=organization and sequence<boundary order by sequence desc limit 21)r;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'items',case when jsonb_array_length(items)>20 then items-20 else items end,
   'nextBefore',case when jsonb_array_length(items)>20 then items->19->>'sequence' end);
 end if;
 return '{"state":"invalid"}';
end$$;

create function public.decide_agency_observation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)
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
  if(facts->>'failedCount')::bigint<1 then return '{"state":"no_recommendation"}';end if;
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

revoke all on function public.agency_observation_products(),public.agency_observation_evidence(uuid,uuid,text),public.read_agency_observation(uuid,uuid,jsonb),public.decide_agency_observation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.agency_observation_products(),public.agency_observation_evidence(uuid,uuid,text),public.read_agency_observation(uuid,uuid,jsonb),public.decide_agency_observation(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
