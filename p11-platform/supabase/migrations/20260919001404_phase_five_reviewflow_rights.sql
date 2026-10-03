create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
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
 origin:=case when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

alter table public.review_testimonial_approvals add column version integer not null default 1;
alter table public.review_testimonial_approvals add column source_version integer;
alter table public.review_testimonial_approvals add column usage_scope jsonb not null default '["website"]' check(jsonb_typeof(usage_scope)='array' and jsonb_array_length(usage_scope) between 1 and 2 and usage_scope <@ '["website","social"]'::jsonb);
alter table public.review_testimonial_approvals add column expires_at timestamptz;
revoke insert,update,delete on public.review_testimonial_approvals from public,anon,authenticated;

create function public.reviewflow_testimonial_source(p_review public.reviews) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_review.id,'propertyId',p_review.property_id,'sourceVersion',p_review.source_version,'reviewerName',p_review.reviewer_name,'text',p_review.review_text,'rating',p_review.rating,'platform',p_review.platform,'reviewDate',p_review.review_date);
$$;
create function public.guard_reviewflow_testimonial() returns trigger language plpgsql security invoker set search_path='' as $$declare r public.reviews;begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Testimonial rights history must be retained';end if;
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['status','revoked_by','revoked_at','revocation_reason','updated_at','version']) is distinct from(to_jsonb(old)-array['status','revoked_by','revoked_at','revocation_reason','updated_at','version']) then raise exception 'Approved testimonial evidence is immutable';end if;
  if old.status='revoked' then raise exception 'Revoked testimonial evidence is immutable';end if;
  if new.status<>'revoked' then raise exception 'A new rights decision is required';end if;
  new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
 end if;
 select * into r from public.reviews where id=new.review_id and property_id=new.property_id;
 if not found or new.source_version is distinct from r.source_version or new.content_fingerprint is distinct from public.crm_configuration_hash(public.reviewflow_testimonial_source(r)) or(new.reviewer_name_snapshot,new.review_text_snapshot,new.rating_snapshot,new.platform_snapshot,new.review_date_snapshot) is distinct from(r.reviewer_name,r.review_text,r.rating,r.platform,r.review_date) then raise exception 'New testimonial approval requires exact current source evidence';end if;
 if new.status<>'active' or not exists(select 1 from public.profiles u join public.properties p on u.org_id=p.org_id where p.id=new.property_id and u.id=new.approved_by and u.role in('admin','manager')) then raise exception 'A current property manager must approve testimonial use';end if;
 return new;
end$$;
create trigger reviewflow_testimonial_guard before insert or update or delete on public.review_testimonial_approvals for each row execute function public.guard_reviewflow_testimonial();

create function public.eligible_reviewflow_testimonials(p_property_id uuid,p_channel text) returns setof public.review_testimonial_approvals language plpgsql stable security invoker set search_path='' as $$begin
 if p_channel not in('website','social') or p_channel is null then raise exception 'Choose a permitted testimonial use';end if;
 return query select a.* from public.review_testimonial_approvals a join public.reviews r on r.id=a.review_id and r.property_id=a.property_id
 where a.property_id=p_property_id and a.status='active' and a.revoked_at is null and a.attribution_approved and a.usage_scope ? p_channel and(a.expires_at is null or a.expires_at>now()) and a.source_version=r.source_version and a.content_fingerprint=public.crm_configuration_hash(public.reviewflow_testimonial_source(r));
end$$;

create function public.read_reviewflow_testimonial_source(p_property_id uuid,p_actor_id uuid,p_review_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$declare r public.reviews;s jsonb;a public.review_testimonial_approvals;issue text;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select * into r from public.reviews where property_id=p_property_id and id=p_review_id;if not found then return '{"state":"not_found"}';end if;s:=public.reviewflow_testimonial_source(r);
 if length(trim(coalesce(r.reviewer_name,''))) not between 1 and 200 then issue:='A saved reviewer name of 1–200 characters is required.';
 elsif length(trim(coalesce(r.review_text,''))) not between 1 and 5000 then issue:='A saved review text of 1–5,000 characters is required. Approval never silently truncates it.';
 elsif r.rating is null then issue:='A source rating is required for attributed testimonial reuse. No rating is inferred.';end if;
 select * into a from public.review_testimonial_approvals where property_id=p_property_id and review_id=p_review_id and status='active';
 return jsonb_build_object('state','ready','source',s,'sourceHash',public.crm_configuration_hash(s),'sourceIssue',issue,'activeApproval',case when a.id is not null then to_jsonb(a)||jsonb_build_object('eligibility',case when a.source_version is null then 'legacy_review_required' when a.source_version<>r.source_version or a.content_fingerprint<>public.crm_configuration_hash(s) then 'source_changed' when a.expires_at<=now() then 'expired' else 'eligible' end) end,'canManage',exists(select 1 from public.profiles where id=p_actor_id and role in('admin','manager')));
end$$;

create function public.decide_reviewflow_testimonial(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;operation text:=p_input->>'action';kind text;r public.reviews;s jsonb;a public.review_testimonial_approvals;before_state jsonb;expiry timestamptz;scope jsonb;begin
 if operation not in('approve','revoke') or operation is null then raise exception 'Choose a testimonial rights decision';end if;kind:=case operation when 'approve' then 'testimonial.approved' else 'testimonial.revoked' end;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 if length(trim(coalesce(p_input->>'reason',''))) not between 3 and 1000 then raise exception 'Record the reason for this rights decision';end if;
 select * into r from public.reviews where id=(p_input->>'reviewId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if operation='approve' then
  if(p_input-array['action','reviewId','sourceVersion','sourceHash','attributionApproved','rightsBasis','evidenceNote','usageScope','expiresAt','reason'])<>'{}' or p_input->'attributionApproved' is distinct from 'true'::jsonb or coalesce(p_input->>'rightsBasis','') not in('platform_terms','direct_consent','property_license','other') or length(trim(coalesce(p_input->>'evidenceNote',''))) not between 3 and 1000 then raise exception 'Review attribution, rights basis and retained evidence';end if;
  s:=public.read_reviewflow_testimonial_source(p_property_id,p_actor_id,r.id);if r.source_version is distinct from(p_input->>'sourceVersion')::integer or s->>'sourceHash' is distinct from p_input->>'sourceHash' then return '{"state":"stale_source"}';end if;
  if s->>'sourceIssue' is not null then return '{"state":"source_unavailable"}';end if;
  scope:=p_input->'usageScope';if jsonb_typeof(scope) is distinct from 'array' or jsonb_array_length(scope) not between 1 and 2 or not(scope <@ '["website","social"]'::jsonb) or(select count(distinct v) from jsonb_array_elements_text(scope)v)<>jsonb_array_length(scope) then raise exception 'Choose the exact permitted usage scope';end if;
  expiry:=(p_input->>'expiresAt')::timestamptz;if expiry<=now() then return '{"state":"invalid_expiry"}';end if;
  if exists(select 1 from public.review_testimonial_approvals where review_id=r.id and status='active') then return '{"state":"active_approval"}';end if;
  insert into public.review_testimonial_approvals(id,review_id,property_id,source_version,content_fingerprint,reviewer_name_snapshot,review_text_snapshot,rating_snapshot,platform_snapshot,review_date_snapshot,attribution_approved,rights_basis,rights_evidence,approved_by,usage_scope,expires_at)
  values(p_id,r.id,p_property_id,r.source_version,s->>'sourceHash',r.reviewer_name,r.review_text,r.rating,r.platform,r.review_date,true,p_input->>'rightsBasis',jsonb_build_object('note',trim(p_input->>'evidenceNote'),'source','reviewed_console_rights','reason',trim(p_input->>'reason')),p_actor_id,scope,expiry) returning * into a;
 else
  if(p_input-array['action','reviewId','approvalId','expectedVersion','reason'])<>'{}' then raise exception 'Choose the exact approval to revoke';end if;
  select * into a from public.review_testimonial_approvals where id=(p_input->>'approvalId')::uuid and property_id=p_property_id and review_id=r.id for update;
  if not found then return '{"state":"not_found"}';end if;
  if a.status<>'active' or a.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_approval"}';end if;
  before_state:=jsonb_build_object('approvalId',a.id,'version',a.version,'status',a.status);
  update public.review_testimonial_approvals set status='revoked',revoked_by=p_actor_id,revoked_at=clock_timestamp(),revocation_reason=trim(p_input->>'reason') where id=a.id returning * into a;
 end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,before_state,jsonb_build_object('approvalId',a.id,'version',a.version,'status',a.status,'sourceVersion',a.source_version,'usageScope',a.usage_scope,'expiresAt',a.expires_at),jsonb_build_object('approvalId',a.id,'version',a.version,'status',a.status,'publishedContentChanged',false));
end$$;


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
  keys:=array['id','status','review_text_snapshot','reviewer_name_snapshot','rating_snapshot','platform_snapshot','attribution_approved','rights_basis','revoked_at','version','source_version','content_fingerprint','usage_scope','expires_at'];
  select to_jsonb(r) into actual from public.review_testimonial_approvals r where id=p_id and property_id=p_property_id and exists(select 1 from public.eligible_reviewflow_testimonials(p_property_id,'social') e where e.id=r.id) for share;
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
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.reviewflow_testimonial_source(public.reviews),public.guard_reviewflow_testimonial(),public.eligible_reviewflow_testimonials(uuid,text),public.read_reviewflow_testimonial_source(uuid,uuid,uuid),public.decide_reviewflow_testimonial(uuid,uuid,uuid,jsonb),public.read_forgestudio_source_record(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.reviewflow_testimonial_source(public.reviews),public.guard_reviewflow_testimonial(),public.eligible_reviewflow_testimonials(uuid,text),public.read_reviewflow_testimonial_source(uuid,uuid,uuid),public.decide_reviewflow_testimonial(uuid,uuid,uuid,jsonb),public.read_forgestudio_source_record(uuid,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
