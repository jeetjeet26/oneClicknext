
-- Read the complete property ledger without returning raw source/model/provider payloads.
create function public.marketvision_monitoring_rows(p_property_id uuid,p_org_id uuid)
returns table(id uuid,created_at timestamptz,updated_at timestamptz,kind text,request_state text,category text,label text,competitor_id uuid,brief_id uuid,handoff_id uuid,legacy_status text)
language sql stable security invoker set search_path=''as $$
 with saved as(
 select j.id,j.created_at,j.updated_at,
 case j.domain when 'marketvision.source'then 'source'when 'marketvision.extraction'then 'extraction'when 'marketvision.brief'then 'brief'when 'marketvision.handoff'then 'handoff'else 'legacy'end kind,
 case j.domain when 'marketvision.source'then s.state when 'marketvision.extraction'then e.state when 'marketvision.brief'then b.state when 'marketvision.handoff'then h.state else 'historical'end request_state,
 case j.domain when 'marketvision.source'then s.competitor_id when 'marketvision.extraction'then e.competitor_id end competitor_id,
 case j.domain when 'marketvision.brief'then b.id when 'marketvision.handoff'then h.brief_id end brief_id,
 h.id handoff_id,
 case when j.domain in('marketvision.ingestion','marketvision.proposal')then j.lifecycle_status end legacy_status,
 case when j.domain in('marketvision.ingestion','marketvision.proposal')then case j.subject_type when 'discovery'then 'Earlier competitor discovery'when 'observation_refresh'then 'Earlier price refresh'when 'brand_extraction'then 'Earlier brand extraction'when 'embedding'then 'Earlier search indexing'when 'change_detection'then 'Earlier change detection'when 'brief_generation'then 'Earlier brief generation'else 'Earlier MarketVision work'end
 when j.domain='marketvision.brief'then 'Saved market brief'when j.domain='marketvision.handoff'then coalesce(h.draft->>'title','Saved draft handoff')else coalesce(c.name,'Saved competitor work')end label
 from public.shared_jobs j
 left join public.marketvision_source_requests s on s.id=j.id and s.property_id=j.property_id and s.org_id=j.org_id
 left join public.marketvision_extraction_requests e on e.id=j.id and e.property_id=j.property_id and e.org_id=j.org_id
 left join public.marketvision_briefs b on b.id=j.id and b.property_id=j.property_id and b.org_id=j.org_id
 left join public.marketvision_handoffs h on h.id=j.id and h.property_id=j.property_id and h.org_id=j.org_id
 left join public.competitors c on c.id=coalesce(s.competitor_id,e.competitor_id)and c.property_id=j.property_id
 where j.property_id=p_property_id and j.org_id=p_org_id and j.domain in('marketvision.source','marketvision.extraction','marketvision.brief','marketvision.handoff','marketvision.ingestion','marketvision.proposal')
 )
 select id,created_at,updated_at,kind,coalesce(request_state,'missing_record'),
 case when kind='legacy'then 'legacy'when request_state in('queued','running')then 'active'when request_state in('ready','completed')then 'complete'when request_state in('stopped','rejected','withdrawn')then 'closed'else 'attention'end,
 label,competitor_id,brief_id,handoff_id,legacy_status from saved;
$$;
create function public.read_marketvision_monitoring(p_property_id uuid,p_actor_id uuid,p_filter text default 'all',p_request_id uuid default null,p_cursor uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;anchor_id uuid;anchor_created timestamptz;selected jsonb;items jsonb;counts jsonb;workers jsonb;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if coalesce(p_filter,'')not in('all','attention','active','complete','closed','legacy')or(p_request_id is not null and p_cursor is not null)then raise exception 'Choose a valid saved-work view';end if;
 if p_request_id is not null then
  select to_jsonb(r)into selected from public.marketvision_monitoring_rows(p_property_id,organization)r where r.id=p_request_id;if not found then return '{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','run',selected);
 end if;
 if p_cursor is not null then select r.id,r.created_at into anchor_id,anchor_created from public.marketvision_monitoring_rows(p_property_id,organization)r where r.id=p_cursor and(p_filter='all'or r.category=p_filter);if not found then return '{"state":"cursor_changed"}';end if;end if;
 with all_rows as materialized(select *from public.marketvision_monitoring_rows(p_property_id,organization)),page as(select *from all_rows r where(p_filter='all'or r.category=p_filter)and(p_cursor is null or(r.created_at,r.id)<(anchor_created,anchor_id))order by r.created_at desc,r.id desc limit 21)
 select(select coalesce(jsonb_agg(to_jsonb(p)order by p.created_at desc,p.id desc),'[]')from page p),(select jsonb_build_object('all',count(*),'attention',count(*)filter(where category='attention'),'active',count(*)filter(where category='active'),'complete',count(*)filter(where category='complete'),'closed',count(*)filter(where category='closed'),'legacy',count(*)filter(where category='legacy'))from all_rows)into items,counts;
 select jsonb_agg(jsonb_build_object('name',names.name,'lastStartedAt',r.started_at,'lastFinishedAt',r.completed_at,'lastStatus',r.status)order by names.name)into workers from(values('process-market-sources'),('process-market-extractions'))names(name)left join lateral(select started_at,completed_at,status from public.cron_job_runs where job_name=names.name order by started_at desc,id desc limit 1)r on true;
 return jsonb_build_object('state','ready','runs',case when jsonb_array_length(items)>20 then items-20 else items end,'nextCursor',case when jsonb_array_length(items)>20 then items->19->>'id'else null end,'counts',counts,'workers',workers,'readAt',statement_timestamp());
end$$;
revoke all on function public.marketvision_monitoring_rows(uuid,uuid),public.read_marketvision_monitoring(uuid,uuid,text,uuid,uuid)from public,anon,authenticated;
grant execute on function public.marketvision_monitoring_rows(uuid,uuid),public.read_marketvision_monitoring(uuid,uuid,text,uuid,uuid)to service_role;
