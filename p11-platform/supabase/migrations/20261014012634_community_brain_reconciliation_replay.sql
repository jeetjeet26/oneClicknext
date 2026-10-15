begin;
create table public.community_replay_runs(
 id uuid primary key,property_id uuid not null references public.properties(id),actor_id uuid not null references auth.users(id),
 scope_id uuid not null references public.community_task_scopes(id),request_hash text not null,records jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.community_replay_runs enable row level security;
revoke all on public.community_replay_runs from public,anon,authenticated;
grant select on public.community_replay_runs to service_role;
create function public.brain_replay_candidates(p_property_id uuid)returns table(kind text,id uuid,source_hash text,eligible boolean)
language sql stable security definer set search_path=''as $$
 select 'knowledge_materials',m.id,public.knowledge_hash(to_jsonb(m)),exists(select 1 from public.community_source_reviews r where r.version_id=m.active_version_id and r.property_id=m.property_id and r.review_after>statement_timestamp()and(r.expires_at is null or r.expires_at>statement_timestamp()))from public.knowledge_materials m where m.property_id=p_property_id
 union all select 'content_assets',a.id,public.knowledge_hash(to_jsonb(a)),public.brain_asset_current(a.id,a.property_id)from public.content_assets a where a.property_id=p_property_id
 union all select 'property_intelligence_documents',d.id,public.knowledge_hash(to_jsonb(d)),d.kind='creative'and d.status='approved'from public.property_intelligence_documents d where d.property_id=p_property_id and d.kind='creative'
 union all select 'competitor_content_chunks',c.id,public.knowledge_hash(to_jsonb(c)),exists(select 1 from public.market_source_captures s join public.competitors co on co.id=s.competitor_id and co.property_id=s.property_id where s.id=c.capture_id and s.property_id=c.property_id and co.is_active and s.status='captured'and s.content_hash~'^[a-f0-9]{64}$'and s.captured_at>statement_timestamp()-interval '7 days')from public.competitor_content_chunks c where c.property_id=p_property_id
$$;
create function public.brain_replay_catalog(p_scope_id uuid,p_offset integer default 0)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s public.community_task_scopes;items jsonb;n bigint;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])or not public.brain_can(s.actor_id,s.property_ids[1],'manage')then raise insufficient_privilege;end if;
 if p_offset not between 0 and 100000 then raise exception 'Invalid replay page';end if;
 select count(*)into n from public.brain_replay_candidates(s.property_ids[1]);
 select coalesce(jsonb_agg(to_jsonb(x)order by x.kind,x.id),'[]')into items from(select *from public.brain_replay_candidates(s.property_ids[1])order by kind,id limit 100 offset p_offset)x;
 return jsonb_build_object('items',items,'total',n,'nextOffset',case when p_offset+100<n then p_offset+100 end,'automaticApproval',false);
end$$;
create function public.brain_replay_sources(p_scope_id uuid,p_id uuid,p_records jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.community_task_scopes;r public.community_replay_runs;x jsonb;c record;event_id uuid;job_id uuid;ids jsonb:='[]';h text;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])or not public.brain_can(s.actor_id,s.property_ids[1],'manage')then raise insufficient_privilege;end if;
 if jsonb_typeof(p_records)is distinct from'array'or jsonb_array_length(p_records)not between 1 and 100 then raise exception 'Select 1 to 100 eligible source identities';end if;
 h:=public.knowledge_hash(p_records);perform pg_advisory_xact_lock(hashtextextended(p_id::text,101));
 select *into r from public.community_replay_runs where id=p_id;
 if found then if r.actor_id<>s.actor_id or r.property_id<>s.property_ids[1]or r.request_hash<>h then raise insufficient_privilege;end if;return r.result;end if;
 for x in select *from jsonb_array_elements(p_records)loop
  select *into c from public.brain_replay_candidates(s.property_ids[1])where kind=x->>'kind'and id=(x->>'id')::uuid;
  if not found or not c.eligible or c.source_hash is distinct from x->>'source_hash'then raise exception 'A source changed or needs review; reload this replay page';end if;
  event_id:=md5(p_id||':'||c.kind||':'||c.id)::uuid;job_id:=md5('replay-job:'||event_id)::uuid;
  insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,dedupe_key,payload)
   values(job_id,s.org_id,s.property_ids[1],'community_brain','memory_projection',c.id::text,event_id::text,jsonb_build_object('eventId',event_id,'sourceTable',c.kind,'sourceId',c.id,'sourceHash',c.source_hash,'operation','REPLAY'));
  insert into public.community_memory_events(id,property_id,org_id,source_table,source_id,source_hash,operation,job_id)
   values(event_id,s.property_ids[1],s.org_id,c.kind,c.id,public.knowledge_hash(jsonb_build_array(p_id,c.source_hash)),'REPLAY',job_id);
  ids:=ids||jsonb_build_array(job_id);
 end loop;
 insert into public.community_replay_runs(id,property_id,actor_id,scope_id,request_hash,records,result)
 values(p_id,s.property_ids[1],s.actor_id,s.id,h,p_records,jsonb_build_object('state','queued','jobIds',ids,'automaticApproval',false))returning *into r;
 return r.result;
end$$;
revoke all on function public.brain_replay_candidates(uuid),public.brain_replay_catalog(uuid,integer),public.brain_replay_sources(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.brain_replay_catalog(uuid,integer),public.brain_replay_sources(uuid,uuid,jsonb)to service_role;
commit;
