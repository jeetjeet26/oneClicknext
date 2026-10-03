create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.%' then
  if p_product<>'leadpulse' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid scoring evidence';end if;
 elsif p_action like 'brand.%' then
  if p_product<>'brandforge' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid brand evidence';end if;
 elsif p_action in ('luma.configuration.created','luma.configuration.saved') then
  if p_product<>'lumaleasing' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid configuration evidence';end if;
 else
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid workflow evidence';end if;
 end if;
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id;
 if organization is null then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 job:=nullif(p_links->>'jobId','')::uuid;attempt:=nullif(p_links->>'attemptId','')::uuid;context_id:=nullif(p_links->>'contextId','')::uuid;
 select * into e from public.shared_action_events where id=p_id;
 if found then
  if (e.episode_id,e.property_id,e.actor_id,e.product,e.action,e.evidence,e.phase,e.request,e.before_state,e.after_state,e.result,e.shared_job_ref,e.shared_attempt_ref,e.context_snapshot_ref)
   is distinct from (p_episode_id,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','eventId',e.id);
 end if;
 if job is not null and not exists(select 1 from public.shared_jobs where id=job and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 if attempt is not null and not exists(select 1 from public.shared_action_attempts where id=attempt and org_id=organization and property_id=p_property_id and (job is null or job_id=job)) then return '{"state":"link_conflict"}';end if;
 if context_id is not null and not exists(select 1 from public.shared_context_snapshots where id=context_id and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 origin:=case when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

create table public.marketvision_brand_searches(
 id uuid primary key,search_sequence bigint generated always as identity unique,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 input jsonb not null,input_hash text not null,algorithm text not null check(algorithm='reviewed-literal-v1'),terms text[]not null,context jsonb not null,context_hash text not null,results jsonb not null,result_hash text not null,coverage jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index marketvision_brand_search_property on public.marketvision_brand_searches(property_id,search_sequence desc);
create index marketvision_brand_search_org on public.marketvision_brand_searches(org_id);
create index marketvision_brand_search_actor on public.marketvision_brand_searches(actor_id);
alter table public.marketvision_brand_searches enable row level security;
revoke all on public.marketvision_brand_searches from public,anon,authenticated;
grant all on public.marketvision_brand_searches to service_role;
create policy marketvision_brand_search_service on public.marketvision_brand_searches for all to service_role using(true)with check(true);
revoke all on sequence public.marketvision_brand_searches_search_sequence_seq from public,anon,authenticated;
grant usage,select on sequence public.marketvision_brand_searches_search_sequence_seq to service_role;
create function public.guard_marketvision_brand_search()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Saved search criteria and results are retained';end$$;
create trigger marketvision_brand_search_guard before update or delete on public.marketvision_brand_searches for each row execute function public.guard_marketvision_brand_search();
create function public.marketvision_brand_search_matches(p_claim jsonb,p_terms text[],p_mode text)returns boolean language sql immutable security invoker set search_path=''as $$
 select case when p_mode='any'then exists(select 1 from unnest(p_terms)t where position(t in lower(coalesce(p_claim->>'statement','')||E'\n'||coalesce(p_claim->>'quote','')))>0)else not exists(select 1 from unnest(p_terms)t where position(t in lower(coalesce(p_claim->>'statement','')||E'\n'||coalesce(p_claim->>'quote','')))=0)end;
$$;
create function public.save_marketvision_brand_search(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior jsonb;source_context jsonb;v_results jsonb;v_coverage jsonb;v_terms text[];v_competitor uuid;v_organization uuid;searchable bigint;reviewed bigint;active bigint;begin
 prior:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,'brand_search.saved',p_input);if prior->>'state'<>'new'then return prior;end if;
 if(p_input-array['query','mode','category','kind','competitorId','reason'])<>'{}'or jsonb_typeof(p_input->'query')is distinct from 'string'or length(trim(p_input->>'query'))not between 2 and 200 or coalesce(p_input->>'mode','')not in('phrase','all','any')or coalesce(p_input->>'category','')not in('all','positioning','audience','voice','amenity','service','promotion','lifestyle','messaging','call_to_action')or coalesce(p_input->>'kind','')not in('all','source_claim','interpretation')or not(p_input?'competitorId')then raise exception 'Review the exact words and evidence scope';end if;
 v_competitor:=nullif(p_input->>'competitorId','')::uuid;
 if v_competitor is not null and not exists(select 1 from public.competitors c where c.id=v_competitor and c.property_id=p_property_id)then return '{"state":"not_found"}';end if;
 v_terms:=case when p_input->>'mode'='phrase'then array[lower(trim(p_input->>'query'))]else array(select distinct t from unnest(regexp_split_to_array(lower(trim(p_input->>'query')),'\s+'))t order by t)end;
 if cardinality(v_terms)not between 1 and 10 then raise exception 'Use a phrase or at most ten search words';end if;
 source_context:=public.read_marketvision_brand_context(p_property_id);
 if v_competitor is not null then source_context:=jsonb_set(source_context,'{evidence}',coalesce((select jsonb_agg(e)from jsonb_array_elements(source_context->'evidence')e where e->>'competitor_id'=v_competitor::text),'[]'));end if;
 if octet_length(source_context::text)>10000000 then return '{"state":"scope_too_large"}';end if;
 select org_id into v_organization from public.properties where id=p_property_id;
 select count(*)into active from public.competitors c where c.property_id=p_property_id and c.is_active and(v_competitor is null or c.id=v_competitor);
 select count(*)into reviewed from jsonb_array_elements(source_context->'evidence')e where v_competitor is null or e->>'competitor_id'=v_competitor::text;
 with candidates as materialized(
  select e,c from jsonb_array_elements(source_context->'evidence')e cross join lateral jsonb_array_elements(e->'claims')c
  where(v_competitor is null or e->>'competitor_id'=v_competitor::text)and(p_input->>'category'='all'or c->>'category'=p_input->>'category')and(p_input->>'kind'='all'or c->>'kind'=p_input->>'kind')
 ),matched as(
  select row_number()over(order by lower(e->>'competitor_name'),e->>'competitor_id',(c->>'sourceIndex')::integer)ordinal,
  jsonb_build_object('competitorId',e->>'competitor_id','competitorName',e->>'competitor_name','reviewId',e->>'review_id','requestId',e->>'request_id','captureId',e->>'capture_id','sourceUrl',e->>'source_url','capturedAt',e->>'observed_at','claim',c)value from candidates where public.marketvision_brand_search_matches(c,v_terms,p_input->>'mode')
 )select(select count(*)from candidates),(select coalesce(jsonb_agg(value||jsonb_build_object('ordinal',ordinal)order by ordinal),'[]')from matched)into searchable,v_results;
 if jsonb_array_length(v_results)>10000 or octet_length(v_results::text)>10000000 then return '{"state":"scope_too_large"}';end if;
 v_coverage:=jsonb_build_object('activeCompetitors',active,'reviewedCompetitors',reviewed,'searchableStatements',searchable,'matchedStatements',jsonb_array_length(v_results),'independentlyVerified',false,'includesLegacy',false);
 insert into public.marketvision_brand_searches(id,property_id,org_id,actor_id,input,input_hash,algorithm,terms,context,context_hash,results,result_hash,coverage)values(p_id,p_property_id,v_organization,p_actor_id,p_input,public.crm_configuration_hash(p_input),'reviewed-literal-v1',v_terms,source_context,public.crm_configuration_hash(source_context),v_results,public.crm_configuration_hash(v_results),v_coverage);
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,'brand_search.saved',p_id,p_input,null,jsonb_build_object('contextHash',public.crm_configuration_hash(source_context),'resultHash',public.crm_configuration_hash(v_results)),jsonb_build_object('searchId',p_id,'matches',jsonb_array_length(v_results),'modelInvoked',false,'embeddingInvoked',false));
end$$;
create function public.read_marketvision_brand_searches(p_property_id uuid,p_actor_id uuid,p_request_id uuid default null,p_cursor uuid default null,p_after integer default 0)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;entry public.marketvision_brand_searches;anchor bigint;v_items jsonb;total bigint;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if p_after is null or p_after<0 or p_after%20<>0 or(p_request_id is null and p_after<>0)or(p_request_id is not null and p_cursor is not null)then raise exception 'Choose a saved search page';end if;
 if p_request_id is not null then
  select *into entry from public.marketvision_brand_searches r where r.id=p_request_id and r.property_id=p_property_id and r.org_id=organization;if not found then return '{"state":"not_found"}';end if;
  if p_after>0 and p_after>=jsonb_array_length(entry.results)then return '{"state":"cursor_changed"}';end if;
  with eligible as materialized(select review_id from public.marketvision_current_brand_evidence(p_property_id,organization))select coalesce(jsonb_agg(x.value order by x.ordinal),'[]')into v_items from(
   select r.ordinal,r.value||jsonb_build_object('stillCurrent',exists(select 1 from eligible e where e.review_id=(r.value->>'reviewId')::uuid))value
   from jsonb_array_elements(entry.results)with ordinality r(value,ordinal)where r.ordinal>p_after and r.ordinal<=p_after+20
  )x;
  return jsonb_build_object('state','ready','search',jsonb_build_object('id',entry.id,'query',entry.input->>'query','mode',entry.input->>'mode','category',entry.input->>'category','kind',entry.input->>'kind','competitorId',entry.input->'competitorId','terms',entry.terms,'algorithm',entry.algorithm,'coverage',entry.coverage,'createdAt',entry.created_at),'items',v_items,'nextOffset',case when jsonb_array_length(entry.results)>p_after+20 then p_after+20 end);
 end if;
 if p_cursor is not null then select r.search_sequence into anchor from public.marketvision_brand_searches r where r.id=p_cursor and r.property_id=p_property_id and r.org_id=organization;if not found then return '{"state":"cursor_changed"}';end if;end if;
 select count(*)into total from public.marketvision_brand_searches r where r.property_id=p_property_id and r.org_id=organization;
 select coalesce(jsonb_agg(x.value order by x.search_sequence desc),'[]')into v_items from(select r.search_sequence,jsonb_build_object('id',r.id,'query',r.input->>'query','mode',r.input->>'mode','category',r.input->>'category','kind',r.input->>'kind','coverage',r.coverage,'createdAt',r.created_at)value from public.marketvision_brand_searches r where r.property_id=p_property_id and r.org_id=organization and(p_cursor is null or r.search_sequence<anchor)order by r.search_sequence desc limit 21)x;
 return jsonb_build_object('state','ready','items',case when jsonb_array_length(v_items)>20 then v_items-20 else v_items end,'nextCursor',case when jsonb_array_length(v_items)>20 then v_items->19->>'id'end,'total',total);
end$$;
revoke all on function public.guard_marketvision_brand_search(),public.marketvision_brand_search_matches(jsonb,text[],text),public.save_marketvision_brand_search(uuid,uuid,uuid,jsonb),public.read_marketvision_brand_searches(uuid,uuid,uuid,uuid,integer)from public,anon,authenticated;
grant execute on function public.guard_marketvision_brand_search(),public.marketvision_brand_search_matches(jsonb,text[],text),public.save_marketvision_brand_search(uuid,uuid,uuid,jsonb),public.read_marketvision_brand_searches(uuid,uuid,uuid,uuid,integer)to service_role;
