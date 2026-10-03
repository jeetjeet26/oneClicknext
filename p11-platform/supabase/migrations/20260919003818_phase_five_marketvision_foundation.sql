create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

create table public.marketvision_decisions(
 id uuid primary key,org_id uuid not null references public.organizations(id),property_id uuid not null references public.properties(id) on delete cascade,actor_id uuid not null references public.profiles(id),kind text not null,resource_id uuid not null,input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index marketvision_decision_history on public.marketvision_decisions(property_id,resource_id,created_at desc,id desc);
create index marketvision_decision_org on public.marketvision_decisions(org_id);
create index marketvision_decision_actor on public.marketvision_decisions(actor_id);
alter table public.marketvision_decisions enable row level security;
revoke all on public.marketvision_decisions from public,anon,authenticated;
grant all on public.marketvision_decisions to service_role;
create policy marketvision_decision_service on public.marketvision_decisions for all to service_role using(true) with check(true);
create function public.guard_marketvision_decision() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Saved market decisions are immutable';
end$$;
create trigger marketvision_decision_guard before update or delete on public.marketvision_decisions for each row execute function public.guard_marketvision_decision();
alter table public.competitors add column version integer not null default 1;
alter table public.competitor_units add column version integer not null default 1;
alter table public.scrape_config add column version integer not null default 1;
create function public.guard_marketvision_record_version() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.id is distinct from old.id or new.created_at is distinct from old.created_at then raise exception 'Market record identity cannot change';end if;
 if tg_table_name='competitor_units' then
  if new.competitor_id is distinct from old.competitor_id then raise exception 'Market unit ownership cannot change';end if;new.last_updated_at:=clock_timestamp();
 else
  if new.property_id is distinct from old.property_id then raise exception 'Market record property cannot change';end if;
  if tg_table_name='scrape_config' then if(new.is_enabled,new.scrape_frequency,new.radius_miles,new.max_competitors,new.auto_add,new.sources,new.proxy_enabled) is not distinct from(old.is_enabled,old.scrape_frequency,old.radius_miles,old.max_competitors,old.auto_add,old.sources,old.proxy_enabled) then new.version:=old.version;return new;end if;end if;
  new.updated_at:=clock_timestamp();
 end if;
 new.version:=old.version+1;return new;
end$$;
create trigger marketvision_competitor_version before update on public.competitors for each row execute function public.guard_marketvision_record_version();
create trigger marketvision_unit_version before update on public.competitor_units for each row execute function public.guard_marketvision_record_version();
create trigger marketvision_configuration_version before update on public.scrape_config for each row execute function public.guard_marketvision_record_version();
revoke insert,update,delete on public.competitors,public.competitor_units,public.scrape_config from public,anon,authenticated;

create function public.marketvision_decision_start(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare prior public.marketvision_decisions;begin
 if p_id is null or jsonb_typeof(p_input) is distinct from 'object' or length(p_input::text)>262144 or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the saved market decision and reason';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,71));
 select * into prior from public.marketvision_decisions where id=p_id;
 if found then
  if(prior.property_id,prior.actor_id,prior.kind,prior.input_hash,prior.org_id) is distinct from(p_property_id,p_actor_id,p_kind,public.crm_configuration_hash(p_input),(select org_id from public.properties where id=p_property_id)) then return '{"state":"request_conflict"}';end if;
  return prior.result||'{"state":"replayed"}';end if;
 return '{"state":"new"}';
end$$;
create function public.marketvision_decision_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_resource_id uuid,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare event jsonb;begin
 insert into public.marketvision_decisions(id,org_id,property_id,actor_id,kind,resource_id,input,input_hash,before_state,after_state,result)values(p_id,(select org_id from public.properties where id=p_property_id),p_property_id,p_actor_id,p_kind,p_resource_id,p_input,public.crm_configuration_hash(p_input),p_before,p_after,p_result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'marketvision','market.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_input),'resourceId',p_resource_id),case when p_before is not null then jsonb_build_object('version',p_before->'version','stateHash',public.crm_configuration_hash(p_before)) end,case when p_after is not null then jsonb_build_object('version',p_after->'version','stateHash',public.crm_configuration_hash(p_after)) end,p_result);
 if event->>'state' not in('recorded','replayed') then raise exception 'Market decision history could not be saved';end if;return p_result||'{"state":"saved"}';
end$$;
create function public.marketvision_valid_unit(p_unit public.competitor_units) returns boolean language sql immutable security invoker set search_path='' as $$select
 length(trim(coalesce(p_unit.unit_type,''))) between 1 and 100 and p_unit.bedrooms between 0 and 20 and
 (p_unit.bathrooms is null or p_unit.bathrooms between 0 and 20) and(p_unit.sqft_min is null or p_unit.sqft_min between 0 and 1000000) and(p_unit.sqft_max is null or p_unit.sqft_max between 0 and 1000000) and(p_unit.sqft_min is null or p_unit.sqft_max is null or p_unit.sqft_min<=p_unit.sqft_max) and
 (p_unit.rent_min is null or p_unit.rent_min between 0 and 100000000) and(p_unit.rent_max is null or p_unit.rent_max between 0 and 100000000) and(p_unit.rent_min is null or p_unit.rent_max is null or p_unit.rent_min<=p_unit.rent_max) and(p_unit.deposit is null or p_unit.deposit between 0 and 100000000) and(p_unit.available_count is null or p_unit.available_count between 0 and 1000000) and length(coalesce(p_unit.move_in_specials,''))<=5000;
$$;
create function public.save_marketvision_competitor(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare operation text:=p_input->>'action';kind text;decision jsonb;c public.competitors;before_state jsonb;v jsonb;item jsonb;u public.competitor_units;units_count integer:=0;begin
 if operation not in('create','save','archive','restore') or operation is null then raise exception 'Choose a competitor decision';end if;
 kind:=case operation when 'archive' then 'competitor.archived' when 'restore' then 'competitor.restored' else 'competitor.saved' end;
 decision:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,kind,p_input);if decision->>'state'<>'new' then return decision;end if;
 if operation='create' then
  if(p_input-array['action','values','units','reason'])<>'{}' then raise exception 'Review the new competitor fields';end if;c.id:=p_id;c.property_id:=p_property_id;
 else
  if(p_input-array['action','competitorId','expectedVersion','values','reason'])<>'{}' then raise exception 'Review the saved competitor identity';end if;
  select * into c from public.competitors where id=(p_input->>'competitorId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
  if c.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_competitor"}';end if;before_state:=to_jsonb(c);
 end if;
 if operation in('create','save') then
  v:=p_input->'values';if jsonb_typeof(v) is distinct from 'object' or(v-array['name','address','address_json','website_url','phone','units_count','year_built','property_type','amenities','ils_listings','notes'])<>'{}' then raise exception 'Unsupported competitor fields';end if;
  c:=jsonb_populate_record(c,v);
  if length(trim(coalesce(c.name,''))) not between 1 and 200 or length(coalesce(c.address,''))>2000 or length(coalesce(c.website_url,''))>2000 or length(coalesce(c.phone,''))>100 or length(coalesce(c.notes,''))>10000 or(c.units_count is not null and c.units_count not between 0 and 1000000) or(c.year_built is not null and c.year_built not between 1000 and 2200) or jsonb_typeof(coalesce(c.amenities,'[]'))<>'array' or jsonb_array_length(coalesce(c.amenities,'[]'))>100 then raise exception 'Review valid competitor details';end if;
  if operation='create' then
   insert into public.competitors(id,property_id,name,address,address_json,website_url,phone,units_count,year_built,property_type,amenities,ils_listings,notes,is_active)
   values(c.id,c.property_id,trim(c.name),c.address,c.address_json,c.website_url,c.phone,c.units_count,c.year_built,coalesce(c.property_type,'multifamily'),coalesce(c.amenities,'[]'),coalesce(c.ils_listings,'{}'),c.notes,true) returning * into c;
   if jsonb_typeof(coalesce(p_input->'units','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_input->'units','[]'))>100 then raise exception 'Review up to100 initial unit types';end if;
   for item in select value from jsonb_array_elements(coalesce(p_input->'units','[]')) loop
    if(item-array['unit_type','bedrooms','bathrooms','sqft_min','sqft_max','rent_min','rent_max','deposit','available_count','move_in_specials'])<>'{}' then raise exception 'Unsupported unit fields';end if;
    u:=jsonb_populate_record(null::public.competitor_units,item);if public.marketvision_valid_unit(u) is distinct from true then raise exception 'Review valid unit values and ranges';end if;units_count:=units_count+1;
    insert into public.competitor_units(id,competitor_id,unit_type,bedrooms,bathrooms,sqft_min,sqft_max,rent_min,rent_max,deposit,available_count,move_in_specials)
    values(md5(p_id::text||':unit:'||units_count)::uuid,c.id,trim(u.unit_type),u.bedrooms,u.bathrooms,u.sqft_min,u.sqft_max,u.rent_min,u.rent_max,u.deposit,u.available_count,u.move_in_specials) returning * into u;
    insert into public.competitor_price_history(competitor_unit_id,rent_min,rent_max,available_count,source)values(u.id,u.rent_min,u.rent_max,u.available_count,'manual');
   end loop;
   insert into public.market_alerts(property_id,competitor_id,alert_type,severity,title,description,data)values(p_property_id,c.id,'new_competitor','info','Competitor added to the reviewed set','An operator saved competitor details. These values have not been independently verified by a source provider.',jsonb_build_object('decisionId',p_id,'source','operator_reported'));
  else
   update public.competitors set name=trim(c.name),address=c.address,address_json=c.address_json,website_url=c.website_url,phone=c.phone,units_count=c.units_count,year_built=c.year_built,property_type=c.property_type,amenities=c.amenities,ils_listings=c.ils_listings,notes=c.notes where id=c.id returning * into c;
  end if;
 else
  if p_input ? 'values' then raise exception 'Archive or restore only the reviewed saved competitor';end if;
  update public.competitors set is_active=(operation='restore') where id=c.id returning * into c;
 end if;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,kind,c.id,p_input,before_state,to_jsonb(c)||case when operation='create' then jsonb_build_object('initialUnits',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.competitor_units q where competitor_id=c.id),'[]')) else '{}' end,jsonb_build_object('competitorId',c.id,'version',c.version,'isActive',c.is_active,'initialUnitsSaved',units_count,'providerVerified',false,'externalExecutionStarted',false));
end$$;

create function public.save_marketvision_unit(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare operation text:=p_input->>'action';kind text;decision jsonb;c public.competitors;u public.competitor_units;before_state jsonb;v jsonb;begin
 if operation not in('create','save','remove') or operation is null then raise exception 'Choose a unit decision';end if;
 kind:=case when operation='remove' then 'unit.removed' else 'unit.saved' end;
 decision:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,kind,p_input);if decision->>'state'<>'new' then return decision;end if;
 if(p_input-array['action','competitorId','unitId','expectedVersion','values','reason'])<>'{}' then raise exception 'Unsupported unit decision';end if;
 select * into c from public.competitors where id=(p_input->>'competitorId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if operation='create' then
  if p_input ? 'unitId' or p_input ? 'expectedVersion' then raise exception 'New units cannot replace a saved identity';end if;u.id:=p_id;u.competitor_id:=c.id;
 else
  select * into u from public.competitor_units where id=(p_input->>'unitId')::uuid and competitor_id=c.id for update;if not found then return '{"state":"not_found"}';end if;
  if u.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_unit"}';end if;before_state:=to_jsonb(u);
 end if;
 if operation='remove' then
  if p_input ? 'values' then raise exception 'Remove only the reviewed unit';end if;
  -- Keep the unit and every price observation in immutable private history before the FK cascade.
  before_state:=before_state||jsonb_build_object('priceHistory',coalesce((select jsonb_agg(to_jsonb(h) order by h.recorded_at,h.id) from public.competitor_price_history h where h.competitor_unit_id=u.id),'[]'));
  delete from public.competitor_units where id=u.id;
 else
  if c.is_active is distinct from true then return '{"state":"competitor_archived"}';end if;
  v:=p_input->'values';if jsonb_typeof(v) is distinct from 'object' or(v-array['unit_type','bedrooms','bathrooms','sqft_min','sqft_max','rent_min','rent_max','deposit','available_count','move_in_specials'])<>'{}' then raise exception 'Unsupported unit values';end if;
  u:=jsonb_populate_record(u,v);if public.marketvision_valid_unit(u) is distinct from true then raise exception 'Review valid unit values and ranges';end if;
  if operation='create' then
   insert into public.competitor_units(id,competitor_id,unit_type,bedrooms,bathrooms,sqft_min,sqft_max,rent_min,rent_max,deposit,available_count,move_in_specials)values(u.id,c.id,trim(u.unit_type),u.bedrooms,u.bathrooms,u.sqft_min,u.sqft_max,u.rent_min,u.rent_max,u.deposit,u.available_count,u.move_in_specials) returning * into u;
  else
   update public.competitor_units set unit_type=trim(u.unit_type),bedrooms=u.bedrooms,bathrooms=u.bathrooms,sqft_min=u.sqft_min,sqft_max=u.sqft_max,rent_min=u.rent_min,rent_max=u.rent_max,deposit=u.deposit,available_count=u.available_count,move_in_specials=u.move_in_specials,capture_id=null where id=u.id returning * into u;
  end if;
  insert into public.competitor_price_history(competitor_unit_id,rent_min,rent_max,available_count,source)values(u.id,u.rent_min,u.rent_max,u.available_count,'manual');
 end if;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,kind,c.id,p_input,before_state,case when operation<>'remove' then to_jsonb(u) end,jsonb_build_object('competitorId',c.id,'unitId',u.id,'version',u.version,'removed',operation='remove','providerVerified',false,'externalExecutionStarted',false));
end$$;

create function public.save_marketvision_configuration(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.scrape_config;before_state jsonb;decision jsonb;v jsonb;begin
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 decision:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,'configuration.saved',p_input);if decision->>'state'<>'new' then return decision;end if;
 if(p_input-array['expectedVersion','values','reason'])<>'{}' then raise exception 'Unsupported monitoring decision';end if;
 select * into c from public.scrape_config where property_id=p_property_id for update;
 if coalesce(c.version,0) is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_configuration"}';end if;
 if c.id is not null then before_state:=to_jsonb(c);end if;
 v:=p_input->'values';if jsonb_typeof(v) is distinct from 'object' or(v-array['is_enabled','scrape_frequency','radius_miles','max_competitors','auto_add'])<>'{}' or not(v ?& array['is_enabled','scrape_frequency','radius_miles','max_competitors','auto_add']) then raise exception 'Review every monitoring setting';end if;
 c:=jsonb_populate_record(c,v);
 if c.is_enabled is null or c.auto_add is null or c.scrape_frequency is null or c.scrape_frequency not in('daily','weekly','manual') or c.radius_miles is null or c.radius_miles not between 0.5 and 25 or c.max_competitors is null or c.max_competitors not between 1 and 100 then raise exception 'Review valid monitoring settings';end if;
 insert into public.scrape_config(property_id,is_enabled,scrape_frequency,radius_miles,max_competitors,auto_add,next_run_at)values(p_property_id,c.is_enabled,c.scrape_frequency,c.radius_miles,c.max_competitors,c.auto_add,case when c.is_enabled and c.scrape_frequency<>'manual' then now()+case when c.scrape_frequency='weekly' then interval '7 days' else interval '1 day' end end)
 on conflict(property_id) do update set is_enabled=excluded.is_enabled,scrape_frequency=excluded.scrape_frequency,radius_miles=excluded.radius_miles,max_competitors=excluded.max_competitors,auto_add=excluded.auto_add,next_run_at=excluded.next_run_at where public.scrape_config.version=(p_input->>'expectedVersion')::integer returning * into c;
 if not found then return '{"state":"stale_configuration"}';end if;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,'configuration.saved',c.id,p_input,before_state,to_jsonb(c),jsonb_build_object('configurationId',c.id,'version',c.version,'externalExecutionStarted',false));
end$$;

create function public.read_marketvision_history(p_property_id uuid,p_actor_id uuid,p_resource_id uuid default null,p_cursor uuid default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare anchor public.marketvision_decisions;items jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if p_cursor is not null then select * into anchor from public.marketvision_decisions where id=p_cursor and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id) and(p_resource_id is null or resource_id=p_resource_id);if not found then return '{"state":"cursor_changed"}';end if;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'resourceId',q.resource_id,'kind',q.kind,'actorId',q.actor_id,'reason',q.input->>'reason','createdAt',q.created_at,'result',q.result,'before',q.before_state-'priceHistory','after',q.after_state,'retainedPriceObservations',jsonb_array_length(coalesce(q.before_state->'priceHistory','[]'))) order by q.created_at desc,q.id desc),'[]') into items from(select d.* from public.marketvision_decisions d join public.properties p on p.id=d.property_id and p.org_id=d.org_id where d.property_id=p_property_id and(p_resource_id is null or d.resource_id=p_resource_id) and(p_cursor is null or(d.created_at,d.id)<(anchor.created_at,anchor.id))order by d.created_at desc,d.id desc limit 21)q;
 return jsonb_build_object('state','ready','history',case when jsonb_array_length(items)>20 then items-20 else items end,'nextCursor',case when jsonb_array_length(items)>20 then items->19->>'id' end);
end$$;

create function public.read_marketvision_competitors(p_property_id uuid,p_actor_id uuid,p_active_only boolean default true) returns jsonb language plpgsql stable security invoker set search_path='' as $$declare records jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 -- One database snapshot includes all matching records and all units; no REST row cap or partial embedded collection.
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('units',coalesce((select jsonb_agg(to_jsonb(u) order by u.bedrooms,u.unit_type,u.id)from public.competitor_units u where u.competitor_id=c.id),'[]')) order by lower(c.name),c.id),'[]') into records from public.competitors c where c.property_id=p_property_id and(not p_active_only or c.is_active=true);
 return jsonb_build_object('state','ready','competitors',records,'count',jsonb_array_length(records));
end$$;

revoke all on function public.guard_marketvision_decision() from public,anon,authenticated;
grant execute on function public.guard_marketvision_decision() to service_role;

revoke all on function public.guard_marketvision_record_version() from public,anon,authenticated;
grant execute on function public.guard_marketvision_record_version() to service_role;

revoke all on function public.marketvision_decision_start(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketvision_decision_start(uuid,uuid,uuid,text,jsonb) to service_role;

revoke all on function public.marketvision_decision_finish(uuid,uuid,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.marketvision_decision_finish(uuid,uuid,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;

revoke all on function public.marketvision_valid_unit(public.competitor_units) from public,anon,authenticated;
grant execute on function public.marketvision_valid_unit(public.competitor_units) to service_role;

revoke all on function public.save_marketvision_competitor(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_marketvision_competitor(uuid,uuid,uuid,jsonb) to service_role;

revoke all on function public.save_marketvision_unit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_marketvision_unit(uuid,uuid,uuid,jsonb) to service_role;

revoke all on function public.save_marketvision_configuration(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_marketvision_configuration(uuid,uuid,uuid,jsonb) to service_role;

revoke all on function public.read_marketvision_history(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_marketvision_history(uuid,uuid,uuid,uuid) to service_role;

revoke all on function public.read_marketvision_competitors(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.read_marketvision_competitors(uuid,uuid,boolean) to service_role;

notify pgrst,'reload schema';
