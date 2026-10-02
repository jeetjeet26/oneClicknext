create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action='studio.media.completed' then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

alter table public.forgestudio_config add column configuration_version integer not null default 1 check(configuration_version>0);
revoke insert,update,delete on public.forgestudio_config from public,anon,authenticated;
create function public.forgestudio_configuration_value(p_row public.forgestudio_config) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('brand_voice',p_row.brand_voice,'target_audience',p_row.target_audience,'key_amenities',coalesce(to_jsonb(p_row.key_amenities),'[]'::jsonb),'include_hashtags',coalesce(p_row.include_hashtags,true),'include_cta',coalesce(p_row.include_cta,true),'max_caption_length',coalesce(p_row.max_caption_length,2200));
$$;
create function public.version_forgestudio_configuration() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.id is distinct from old.id or new.property_id is distinct from old.property_id then raise exception 'Configuration identity cannot change';end if;
 new.configuration_version:=old.configuration_version+1;new.updated_at:=clock_timestamp();return new;
end;$$;
create trigger forgestudio_configuration_version before update on public.forgestudio_config for each row execute function public.version_forgestudio_configuration();
create function public.save_forgestudio_configuration(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;before_row public.forgestudio_config;after_row public.forgestudio_config;settings jsonb:=p_payload->'config';before_value jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'configuration.saved',p_payload);if response->>'state'<>'new' then return response;end if;
 if p_payload-array['expectedVersion','config']<>'{}' or jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[0-9]+$' or jsonb_typeof(settings) is distinct from 'object' or settings-array['brand_voice','target_audience','key_amenities','include_hashtags','include_cta','max_caption_length']<>'{}' or not settings ?& array['brand_voice','target_audience','key_amenities','include_hashtags','include_cta','max_caption_length'] then raise exception 'Invalid studio configuration';end if;
 if (jsonb_typeof(settings->'brand_voice') not in('string','null')) or length(coalesce(settings->>'brand_voice',''))>2000 or (jsonb_typeof(settings->'target_audience') not in('string','null')) or length(coalesce(settings->>'target_audience',''))>1000 or jsonb_typeof(settings->'include_hashtags') is distinct from 'boolean' or jsonb_typeof(settings->'include_cta') is distinct from 'boolean' or jsonb_typeof(settings->'max_caption_length') is distinct from 'number' or (settings->>'max_caption_length') !~ '^[0-9]+$' or (settings->>'max_caption_length')::numeric not between 50 and 10000 or jsonb_typeof(settings->'key_amenities') is distinct from 'array' then raise exception 'Invalid studio configuration';end if;
 if jsonb_array_length(settings->'key_amenities')>30 or exists(select 1 from jsonb_array_elements(settings->'key_amenities') v where jsonb_typeof(v) is distinct from 'string' or length(trim(v#>>'{}')) not between 1 and 120) then raise exception 'Invalid studio amenities';end if;
 select * into before_row from public.forgestudio_config where property_id=p_property_id for update;
 if (p_payload->>'expectedVersion')::numeric<>coalesce(before_row.configuration_version,0) then return '{"state":"stale_configuration"}';end if;
 before_value:=public.forgestudio_configuration_value(before_row);
 insert into public.forgestudio_config(property_id,brand_voice,target_audience,key_amenities,include_hashtags,include_cta,max_caption_length)
 values(p_property_id,nullif(trim(settings->>'brand_voice'),''),nullif(trim(settings->>'target_audience'),''),array(select trim(value) from jsonb_array_elements_text(settings->'key_amenities')),(settings->>'include_hashtags')::boolean,(settings->>'include_cta')::boolean,(settings->>'max_caption_length')::integer)
 on conflict(property_id) do update set brand_voice=excluded.brand_voice,target_audience=excluded.target_audience,key_amenities=excluded.key_amenities,include_hashtags=excluded.include_hashtags,include_cta=excluded.include_cta,max_caption_length=excluded.max_caption_length returning * into after_row;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'configuration.saved',p_payload,jsonb_build_object('version',coalesce(before_row.configuration_version,0),'config',before_value),jsonb_build_object('version',after_row.configuration_version,'config',public.forgestudio_configuration_value(after_row)),jsonb_build_object('version',after_row.configuration_version,'config',public.forgestudio_configuration_value(after_row),'configurationId',after_row.id,'trainingEligible',false));
end;$$;
revoke all on function public.forgestudio_configuration_value(public.forgestudio_config),public.version_forgestudio_configuration(),public.save_forgestudio_configuration(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.forgestudio_configuration_value(public.forgestudio_config),public.version_forgestudio_configuration(),public.save_forgestudio_configuration(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.read_forgestudio_source_record(p_property_id uuid,p_kind text,p_id uuid,p_expected jsonb default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actual jsonb;typed jsonb;keys text[];projection jsonb;expected_projection jsonb;begin
 case p_kind
 when 'property' then
  keys:=array['id','name','address','property_type','website_url','unit_count','target_audience','brand_voice'];
  select to_jsonb(r) into actual from public.properties r where id=p_id and id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.properties,p_expected));end if;
 when 'config' then
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
  keys:=array['brand_voice','target_audience','key_amenities','include_hashtags','include_cta','max_caption_length'];
  select to_jsonb(r) into actual from public.forgestudio_config r where property_id=p_id and property_id=p_property_id for share;
  if actual is null then
   if p_expected is not null and p_expected<>'{"absent":true}'::jsonb then raise exception 'A source changed while its context was being saved. Reload and review it again.';end if;
   return '{"absent":true}';
  end if;
  if p_expected ? 'absent' then raise exception 'A source changed while its context was being saved. Reload and review it again.';end if;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.forgestudio_config,p_expected));end if;
 when 'onboarding' then
  keys:=array['id','status','snapshot_payload','content_hash','unresolved_conflicts'];
  select to_jsonb(r) into actual from public.property_onboarding_snapshots r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_onboarding_snapshots,p_expected));end if;
 when 'legal' then
  keys:=array['id','status','version','fair_housing','pricing_disclaimer','accessibility','effective_at'];
  select to_jsonb(r) into actual from public.property_legal_configs r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_legal_configs,p_expected));end if;
 when 'brand' then
  keys:=array['id','generation_status','approval_status','contract_version','contract_hash','section_1_introduction','section_2_positioning','section_3_target_audience','section_4_personas','section_5_name_story','section_6_logo','section_7_typography','section_8_colors','section_9_design_elements','section_10_photo_yep','section_11_photo_nope','section_12_implementation'];
  select to_jsonb(r) into actual from public.property_brand_assets r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_brand_assets,p_expected));end if;
 when 'asset' then
  keys:=array['id','name','asset_type','file_url','thumbnail_url','description','width','height','duration_seconds','alt_text','rights_status','approval_status','curation_status','expires_at','duplicate_of','content_hash','storage_bucket','storage_path','archived_at','replacement_asset_id'];
  select to_jsonb(r) into actual from public.content_assets r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.content_assets,p_expected));end if;
 when 'inventory' then
  keys:=array['id','active','unit_type','bedrooms','bathrooms','sqft_min','sqft_max','rent_min','rent_max','available_count','move_in_specials','effective_at','source_updated_at','expires_at','confidence','review_status','source_identity'];
  select to_jsonb(r) into actual from public.property_units r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_units,p_expected));end if;
 when 'poi' then
  keys:=array['id','name','category','address','distance_miles','travel_time_minutes','source_url','captured_at','confidence','approval_status'];
  select to_jsonb(r) into actual from public.property_points_of_interest r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.property_points_of_interest,p_expected));end if;
 when 'testimonial' then
  keys:=array['id','status','review_text_snapshot','reviewer_name_snapshot','rating_snapshot','platform_snapshot','attribution_approved','rights_basis','revoked_at'];
  select to_jsonb(r) into actual from public.review_testimonial_approvals r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.review_testimonial_approvals,p_expected));end if;
 when 'document' then
  keys:=array['id','content','metadata'];
  select to_jsonb(r) into actual from public.documents r where id=p_id and property_id=p_property_id for share;
  if p_expected is not null then typed:=to_jsonb(jsonb_populate_record(null::public.documents,p_expected));end if;
 else raise exception 'Unsupported source kind';end case;
 if actual is null then return null;end if;
 select jsonb_object_agg(key,actual->key) into projection from unnest(keys) key;
 if p_expected is not null then
  if not(p_expected ?& keys) or jsonb_typeof(p_expected)<>'object' then raise exception 'Source evidence is incomplete';end if;
  select jsonb_object_agg(key,typed->key) into expected_projection from unnest(keys) key;
  if projection is distinct from expected_projection then raise exception 'A source changed while its context was being saved. Reload and review it again.';end if;
 end if;
 return projection;
end;$$;
notify pgrst, 'reload schema';
