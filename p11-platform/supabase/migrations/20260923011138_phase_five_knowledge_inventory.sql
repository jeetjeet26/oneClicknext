-- Property knowledge reads are side-effect free. Legacy group labels are not original-file identities.
create function public.knowledge_document_group(p_metadata jsonb,p_id uuid)returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest((case
  when jsonb_typeof(p_metadata->'ingestion_run_id')='string'and length(p_metadata->>'ingestion_run_id')between 1 and 500 then jsonb_build_array('ingestion_run',p_metadata->>'ingestion_run_id')
  when jsonb_typeof(p_metadata->'knowledge_source_id')='string'and length(p_metadata->>'knowledge_source_id')between 1 and 500 then jsonb_build_array('source',p_metadata->>'knowledge_source_id')
  when jsonb_typeof(p_metadata->'source')='string'or jsonb_typeof(p_metadata->'title')='string' then jsonb_build_array('legacy_labels',p_metadata->>'source',p_metadata->>'title')
  else jsonb_build_array('individual_chunk',p_id)end)::text,'sha256'),'hex')
$$;

create function public.read_property_knowledge(p_property_id uuid,p_actor_id uuid,p_input jsonb default '{}')returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_kind text:=coalesce(p_input->>'kind','sources');v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_hash text;v_summary jsonb;v_items jsonb;v_total bigint;v_group text:=p_input->>'groupKey';v_result jsonb;v_limit integer:=case when coalesce(p_input->>'kind','sources')='units'then 2000 else 20 end;
begin
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id for share of p,u;
 if v_org is null then return '{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','offset','expectedHash','groupKey']<>'{}'or v_kind not in('sources','documents','chunks','units')or v_offset<0 or v_offset>1000000 or(p_input?'expectedHash'and coalesce(p_input->>'expectedHash','')!~'^[a-f0-9]{64}$')or(v_kind='chunks'and coalesce(v_group,'')!~'^[a-f0-9]{64}$')or(v_kind<>'chunks'and p_input?'groupKey')then raise exception 'Invalid knowledge inventory request';end if;
 -- A single statement materializes the inventory version and each page, so the continuation
 -- fence describes exactly the rows inspected, including content/metadata changes without timestamps.
 with sources as materialized(select s.* from public.knowledge_sources s where s.property_id=p_property_id),
 docs as materialized(select d.*,public.knowledge_document_group(d.metadata,d.id)group_key from public.documents d where d.property_id=p_property_id),
 units as materialized(select u.* from public.property_units u where u.property_id=p_property_id and u.org_id=v_org),
 groups as materialized(select group_key,count(*)chunk_count,count(*)filter(where embedding is not null)embedded_count,min(created_at)first_at,max(created_at)last_at,
  min(coalesce(nullif(metadata->>'title',''),nullif(metadata->>'source',''),'Untitled stored material'))title,min(metadata->>'source')source,
  case when bool_or(jsonb_typeof(metadata->'ingestion_run_id')='string'and length(metadata->>'ingestion_run_id')between 1 and 500)then 'ingestion_run'
   when bool_or(jsonb_typeof(metadata->'knowledge_source_id')='string'and length(metadata->>'knowledge_source_id')between 1 and 500)then 'source'
   when bool_or(jsonb_typeof(metadata->'source')='string'or jsonb_typeof(metadata->'title')='string')then 'legacy_labels'else 'individual_chunk'end basis
  from docs group by group_key),
 source_page as(select *from sources order by created_at desc nulls last,id desc limit v_limit offset v_offset),
 group_page as(select *from groups order by group_key limit v_limit offset v_offset),
 chunk_page as(select *,case when metadata->>'chunk_index'~'^\d{1,9}$'then(metadata->>'chunk_index')::integer end chunk_index from docs where group_key=v_group order by case when metadata->>'chunk_index'~'^\d{1,9}$'then(metadata->>'chunk_index')::integer end nulls last,created_at nulls last,id limit v_limit offset v_offset),
 unit_page as(select *from units order by bedrooms nulls last,unit_type,id limit v_limit offset v_offset)
 select
 encode(extensions.digest(jsonb_build_array(
  (select coalesce(jsonb_agg(jsonb_build_array(id,md5(to_jsonb(s)::text))order by id),'[]')from sources s),
  (select coalesce(jsonb_agg(jsonb_build_array(id,md5(content),metadata,created_at,embedding is not null)order by id),'[]')from docs),
  (select coalesce(jsonb_agg(jsonb_build_array(id,md5(to_jsonb(u)::text))order by id),'[]')from units u))::text,'sha256'),'hex'),
 jsonb_build_object('sourceCount',(select count(*)from sources),'chunkCount',(select count(*)from docs),'documentGroups',(select count(*)from groups),'embeddedChunks',(select count(*)from docs where embedding is not null),'unitCount',(select count(*)from units),'hasWebsiteSources',exists(select 1 from sources where source_type='website'),'sourceStatuses',(select coalesce(jsonb_object_agg(status,n),'{}')from(select coalesce(status,'unknown')status,count(*)n from sources group by 1)x)),
 case v_kind
 when 'sources'then(select coalesce(jsonb_agg(jsonb_build_object('id',id,'source_type',source_type,'source_name',source_name,'source_url',source_url,'file_name',file_name,'file_type',file_type,'status',coalesce(status,'unknown'),'documents_created',documents_created,'last_synced_at',last_synced_at,'created_at',created_at,'updated_at',updated_at,'error_message',left(error_message,2000),'provenance',jsonb_strip_nulls(jsonb_build_object('ingestionRunId',extracted_data->>'ingestion_run_id','brandAssetId',extracted_data->>'brand_asset_id','crawlRunId',extracted_data->>'crawl_run_id','ingestionVersion',coalesce(extracted_data->>'ingestion_version',extracted_data#>>'{ingestion,version}'),'reportedOrigin',coalesce(extracted_data->>'brand_origin',extracted_data->>'generated_by',extracted_data#>>'{provenance,origin}'),'sourceIdentity',coalesce(extracted_data->>'provenance_identity',extracted_data->>'source_identity',extracted_data#>>'{provenance,identity}'),'artifactId',coalesce(extracted_data->>'artifact_id',extracted_data#>>'{artifact,id}'),'siteforgeArtifactId',coalesce(extracted_data->>'siteforge_artifact_id',extracted_data#>>'{siteforge,artifact_id}'),'lastSuccessfulAt',coalesce(extracted_data->>'last_successful_at',extracted_data->>'last_succeeded_at',extracted_data#>>'{ingestion,last_successful_at}'),'lastAttemptAt',coalesce(extracted_data->>'last_attempt_at',extracted_data#>>'{ingestion,last_attempt_at}'))))order by created_at desc nulls last,id desc),'[]')from source_page)
 when 'documents'then(select coalesce(jsonb_agg(jsonb_build_object('key',group_key,'title',left(title,1000),'source',left(source,1000),'identityBasis',basis,'chunkCount',chunk_count,'embeddedChunks',embedded_count,'firstCreatedAt',first_at,'lastCreatedAt',last_at)order by group_key),'[]')from group_page)
 when 'chunks'then(select coalesce(jsonb_agg(jsonb_build_object('id',id,'chunkIndex',chunk_index,'content',left(content,10000),'previewTruncated',length(content)>10000,'characterCount',length(content),'createdAt',created_at,'hasEmbedding',embedding is not null)order by chunk_index nulls last,created_at nulls last,id),'[]')from chunk_page)
 else(select coalesce(jsonb_agg(to_jsonb(u)order by bedrooms nulls last,unit_type,id),'[]')from unit_page u)end,
 case v_kind when'sources'then(select count(*)from sources)when'documents'then(select count(*)from groups)when'chunks'then(select count(*)from docs where group_key=v_group)else(select count(*)from units)end
 into v_hash,v_summary,v_items,v_total;
 if p_input?'expectedHash'and p_input->>'expectedHash'<>v_hash then return jsonb_build_object('state','inventory_changed');end if;
 if v_kind='chunks'and v_total=0 then return '{"state":"not_found"}';end if;
 v_result:=jsonb_build_object('state','ready','propertyId',p_property_id,'inventoryHash',v_hash,'kind',v_kind,'groupKey',v_group,'summary',v_summary,'items',v_items,'total',v_total,'nextOffset',case when v_offset+v_limit<v_total then v_offset+v_limit end,'readAt',clock_timestamp());
 if octet_length(v_result::text)>5242880 then raise exception 'Knowledge inventory page is too large to read safely';end if;
 return v_result;
end$$;
revoke all on function public.knowledge_document_group(jsonb,uuid),public.read_property_knowledge(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.knowledge_document_group(jsonb,uuid),public.read_property_knowledge(uuid,uuid,jsonb)to service_role;
