-- Complete, property-scoped measurement reads from immutable execution context.
-- Summary scope is the latest two completed non-synthetic runs PER surface.
create function public.read_geo_measurements(p_actor_id uuid,p_property_id uuid,p_input jsonb default '{}')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare kind text:=coalesce(p_input->>'kind','summary');selected_ids uuid[];target_batch uuid;latest_id uuid;
 query_id_value uuid;page_offset integer:=coalesce((p_input->>'offset')::integer,0);row_count bigint;items jsonb;source_hash text;result jsonb;
begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id)then return'{"state":"forbidden"}';end if;
 if kind not in('summary','batch','query')or page_offset not between 0 and 1000000 then return'{"state":"invalid_input"}';end if;
 if kind='query'then
  query_id_value:=(p_input->>'queryId')::uuid;
  if not exists(select 1 from public.geo_queries q where q.id=query_id_value and q.property_id=p_property_id)then return'{"state":"not_found"}';end if;
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(a),r.archived_at,r.status)order by a.created_at desc,a.id desc),'[]'))into row_count,source_hash
   from public.geo_answers a join public.geo_runs r on r.id=a.run_id where a.query_id=query_id_value and r.property_id=p_property_id;
  if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>source_hash then return'{"state":"source_changed"}';end if;
  select coalesce(jsonb_agg(jsonb_build_object('answer',to_jsonb(a),'run',jsonb_build_object('id',r.id,'surface',r.surface,'model_name',r.model_name,'status',r.status,'archived_at',r.archived_at,'measurement_mode',r.measurement_mode),
   'query',(select i.query_snapshot from public.geo_execution_items i where i.answer_id=a.id and i.run_id=r.id limit 1),
   'citations',coalesce((select jsonb_agg(to_jsonb(c)order by c.id)from public.geo_citations c where c.answer_id=a.id),'[]'))order by a.created_at desc,a.id desc),'[]')into items
   from(select a.*from public.geo_answers a join public.geo_runs r on r.id=a.run_id where a.query_id=query_id_value and r.property_id=p_property_id order by a.created_at desc,a.id desc offset page_offset limit 25)a join public.geo_runs r on r.id=a.run_id;
  result:=jsonb_build_object('state','ready','propertyId',p_property_id,'items',items,'count',row_count,'hash',source_hash,'offset',page_offset,'nextOffset',case when page_offset+25<row_count then page_offset+25 else null end,'scope','This page of retained answers, including archived and synthetic history. Original question context is shown when retained; current wording is never substituted.');
 else
  if kind='summary'then
   select array_agg(id order by started_at desc,id desc)into selected_ids from(select r.id,r.started_at,row_number()over(partition by r.surface order by r.started_at desc,r.id desc)n from public.geo_runs r where r.property_id=p_property_id and r.status='completed'and r.archived_at is null and r.measurement_mode is distinct from'local_fixture')ranked where n<=2;
  else
   target_batch:=(p_input->>'batchId')::uuid;
   if target_batch is null then
    select r.id,r.batch_id into latest_id,target_batch from public.geo_runs r where r.property_id=p_property_id and r.archived_at is null and r.measurement_mode is distinct from'local_fixture'order by r.started_at desc,r.id desc limit 1;
   end if;
   select array_agg(r.id order by r.started_at desc,r.id desc)into selected_ids from public.geo_runs r where r.property_id=p_property_id and(r.batch_id=target_batch or r.id=latest_id)and(p_input->>'batchId'is not null or(r.archived_at is null and r.measurement_mode is distinct from'local_fixture'));
  end if;
  select coalesce(jsonb_agg(public.geo_operator_run_source(r.id)||jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'ordinal',i.ordinal,'query',i.query_snapshot,'state',i.state,'answerId',i.answer_id,'errorCode',i.error_code)order by i.ordinal)from public.geo_execution_items i where i.run_id=r.id),'[]'))order by r.started_at desc,r.id desc),'[]')into items from public.geo_runs r where r.id=any(selected_ids);
  result:=jsonb_build_object('state','ready','propertyId',p_property_id,'batchId',target_batch,'runs',items,'hash',public.knowledge_hash(items),'scope',case when kind='summary'then'Latest two completed, unarchived, non-synthetic runs per surface. Metrics use retained answers and captured question context; missing answers are not counted as negative answers.'else'All runs in the selected batch, including failed and unfinished work. Archived and synthetic runs are labelled.'end);
 end if;
 if octet_length(result::text)>33554432 then return'{"state":"source_too_large"}';end if;
 return result;
end$$;
revoke all on function public.read_geo_measurements(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_geo_measurements(uuid,uuid,jsonb)to service_role;
