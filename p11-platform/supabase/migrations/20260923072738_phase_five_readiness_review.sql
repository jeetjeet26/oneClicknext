-- Complete safe readiness evidence and recorded operator review. No provider activation.
create table public.readiness_workspaces(property_id uuid primary key references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),revision bigint not null default 1,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create table public.readiness_source_manifests(snapshot_id uuid primary key references public.property_onboarding_snapshots(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),source_hash text not null,sources jsonb not null,policy_version text not null check(policy_version='readiness.review.v1'),created_at timestamptz not null default clock_timestamp());
create index readiness_manifest_property on public.readiness_source_manifests(property_id,org_id,snapshot_id);
create table public.readiness_decisions(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),snapshot_id uuid not null references public.property_onboarding_snapshots(id)on delete cascade,kind text not null check(kind in('built','approved','rejected','withdrawn')),input jsonb not null,input_hash text not null,before_state jsonb not null,after_state jsonb not null,result jsonb not null,decision_sequence bigint generated always as identity,created_at timestamptz not null default clock_timestamp());
create index readiness_decision_property on public.readiness_decisions(property_id,org_id,decision_sequence desc);
create index readiness_decision_snapshot on public.readiness_decisions(snapshot_id,decision_sequence desc);
create table public.readiness_cancellations(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),input_hash text not null,reason text not null,created_at timestamptz not null default clock_timestamp());
create table public.readiness_invalidations(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),snapshot_id uuid not null references public.property_onboarding_snapshots(id)on delete cascade,origin text not null default'readiness.sources',cause text not null,previous_status text not null,expected_source_hash text not null,current_source_hash text not null,created_at timestamptz not null default clock_timestamp());
create index readiness_invalidation_property on public.readiness_invalidations(property_id,org_id,created_at desc,id);
alter table public.readiness_workspaces enable row level security;
alter table public.readiness_source_manifests enable row level security;
alter table public.readiness_decisions enable row level security;
alter table public.readiness_cancellations enable row level security;
alter table public.readiness_invalidations enable row level security;
revoke all on public.readiness_workspaces,public.readiness_source_manifests,public.readiness_decisions,public.readiness_cancellations,public.readiness_invalidations,public.property_onboarding_snapshots from public,anon,authenticated;
grant all on public.readiness_workspaces,public.readiness_source_manifests,public.readiness_decisions,public.readiness_cancellations,public.readiness_invalidations to service_role;
grant usage,select on sequence public.readiness_decisions_decision_sequence_seq to service_role;
create function public.readiness_project_json(p_row jsonb,p_keys text[])returns jsonb language sql immutable security invoker set search_path=''as $$select case when p_row is null or p_row='null'::jsonb then null else coalesce((select jsonb_object_agg(key,value)from jsonb_each(p_row)where key=any(p_keys)),'{}')end$$;
create function public.readiness_safe_property(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','org_id','name','address','amenities','brand_voice','current_vertical_profile_version_id','office_hours','parking_info','pet_policy','property_type','social_media','special_features','subject_kind','target_audience','unit_count','website_url','year_built'])||case when p_row is null or p_row='null'::jsonb then null else jsonb_build_object('settings',jsonb_build_object('additionalUrls',coalesce(p_row->'settings'->'additionalUrls','[]')))end$$;
create function public.readiness_safe_contact(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','property_id','contact_type','email','is_primary','name','phone','role'])$$;
create function public.readiness_safe_brand(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','property_id','approval_status','approved_at','approved_by','brand_origin','contract_hash','contract_version','generation_status','revision','section_1_introduction','section_2_positioning','section_3_target_audience','section_4_personas','section_5_name_story','section_6_logo','section_7_typography','section_8_colors','section_9_design_elements','section_10_photo_yep','section_11_photo_nope','section_12_implementation'])||case when p_row is null or p_row='null'::jsonb then null when p_row='{}'::jsonb then '{}'::jsonb else jsonb_build_object('sourceManifestHash',coalesce(p_row->>'sourceManifestHash',public.knowledge_hash(coalesce(p_row->'source_manifest','{}'))))end$$;
create function public.readiness_safe_asset(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','org_id','property_id','name','asset_role','asset_type','file_url','thumbnail_url','description','width','height','duration_seconds','file_size_bytes','format','alt_text','dimensions','crop_suggestion','focal_point','approval_status','approved_at','approved_by','archived_at','duplicate_of','replacement_asset_id','content_hash','curation_status','rights_status','expires_at','storage_bucket','storage_path','governance_revision'])$$;
create function public.readiness_safe_integration(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','property_id','platform','status','verified_at','verification_method','crm_revision','crm_approved_review_id','crm_validation_receipt_id','mapping_validated','mapping_validated_at'])$$;
create function public.readiness_safe_chatbot(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','property_id','version','status','requires_review','stale_at','last_generated_at','contentHash'])$$;
create function public.readiness_safe_analytics(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','property_id','website_id','destination_type','destination_identity','consent_mode','enabled'])$$;

create function public.readiness_assistant_eligibility(p_property_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare v_workspace public.assistant_fact_workspaces;v_version public.assistant_fact_versions;v_context public.property_chatbot_contexts;v_snapshot jsonb;v_reason text;
begin

 select w.*into v_workspace from public.assistant_fact_workspaces w join public.properties p on p.id=w.property_id and p.org_id=w.org_id where w.property_id=p_property_id;
 if not found then if exists(select 1 from public.assistant_fact_workspaces where property_id=p_property_id)then return'{"state":"withheld","reason":"property_scope_changed"}';end if;return'{"state":"legacy"}';end if;
 if v_workspace.last_release_id is null then return'{"state":"legacy"}';end if;
 if v_workspace.active_version_id is null then return'{"state":"withheld","reason":"withdrawn"}';end if;
 select *into v_version from public.assistant_fact_versions where id=v_workspace.active_version_id and property_id=p_property_id and org_id=v_workspace.org_id;
 select *into v_context from public.property_chatbot_contexts where property_id=p_property_id;
 if v_version.id is null or v_context.id is null then return'{"state":"withheld","reason":"publication_unavailable"}';end if;
 if v_context.status<>'current'or v_context.requires_review or v_context.context_markdown is distinct from v_version.markdown or v_context.source_snapshot->>'assistantFactVersionId'is distinct from v_version.id::text then return'{"state":"withheld","reason":"review_required"}';end if;
 v_snapshot:=public.assistant_source_snapshot(p_property_id);
 if public.knowledge_hash(v_snapshot)is distinct from v_version.source_hash then return'{"state":"withheld","reason":"sources_changed"}';end if;
 if v_context.last_generated_at is null or v_context.last_generated_at<clock_timestamp()-interval'7 days'or v_context.last_generated_at>clock_timestamp()+interval'5 minutes'then v_reason:='publication_review_due';
 elsif exists(select 1 from jsonb_array_elements(v_snapshot->'sources')s where s->>'type'='website'and s->>'status'='completed'and((s->>'lastSyncedAt')is null or(s->>'lastSyncedAt')::timestamptz<clock_timestamp()-interval'7 days'or(s->>'lastSyncedAt')::timestamptz>clock_timestamp()+interval'5 minutes'))then v_reason:='website_freshness_review_due';end if;
 if v_reason is not null then return jsonb_build_object('state','withheld','reason',v_reason);end if;
 return jsonb_build_object('state','ready','versionId',v_version.id,'releaseId',v_workspace.last_release_id);
end$$;
create function public.readiness_source_bundle(p_property_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare prop public.properties;bundle jsonb;neighborhood jsonb;
begin
 select *into prop from public.properties where id=p_property_id;if not found or prop.org_id is null then return'{"state":"not_found"}';end if;
 if exists(select 1 from public.readiness_workspaces where property_id=p_property_id and org_id<>prop.org_id)or exists(select 1 from public.property_legal_configs where property_id=p_property_id and org_id<>prop.org_id)or exists(select 1 from public.property_units where property_id=p_property_id and org_id<>prop.org_id)or exists(select 1 from public.content_assets where property_id=p_property_id and org_id is not null and org_id<>prop.org_id)then return'{"state":"scope_changed"}';end if;
 neighborhood:=public.read_neighborhood_publication_source(p_property_id,prop.org_id);if neighborhood->>'state'<>'ready'then return neighborhood;end if;
 bundle:=jsonb_build_object('property',public.readiness_safe_property(to_jsonb(prop)),
  'contacts',coalesce((select jsonb_agg(public.readiness_safe_contact(to_jsonb(c))order by c.id)from public.property_contacts c where property_id=p_property_id and contact_type in('primary','secondary')),'[]'),
  'brand',(select public.readiness_safe_brand(to_jsonb(b))from public.property_brand_assets b where property_id=p_property_id),
  'assets',coalesce((select jsonb_agg(public.readiness_safe_asset(to_jsonb(a))order by a.id)from public.content_assets a where property_id=p_property_id),'[]'),
  'units',coalesce((select jsonb_agg(to_jsonb(u)order by u.id)from public.property_units u where property_id=p_property_id),'[]'),
  'pointsOfInterest',neighborhood->'items','neighborhoodTotal',neighborhood->'total',
  'legal',(select to_jsonb(l)from public.property_legal_configs l where property_id=p_property_id and org_id=prop.org_id and status='approved'and effective_at<=clock_timestamp()order by version desc limit 1),
  'integrations',coalesce((select jsonb_agg(public.readiness_safe_integration(to_jsonb(i))order by i.id)from public.integration_credentials i where property_id=p_property_id),'[]'),
  'analyticsDestinations',coalesce((select jsonb_agg(public.readiness_safe_analytics(to_jsonb(a))order by a.id)from public.siteforge_analytics_destinations a where property_id=p_property_id and enabled),'[]'),
  'chatbotContext',(select public.readiness_safe_chatbot(to_jsonb(c))||jsonb_build_object('contentHash',public.knowledge_hash(jsonb_build_object('json',c.context_json,'text',c.context_markdown)))from public.property_chatbot_contexts c where property_id=p_property_id));
 bundle:=bundle||jsonb_build_object('chatbotEligibility',public.readiness_assistant_eligibility(p_property_id),'eligibleUnitIds',coalesce((select jsonb_agg(id order by id)from public.property_units where property_id=p_property_id and active and review_status='approved'and(effective_at is null or effective_at<=clock_timestamp())and(expires_at is null or expires_at>clock_timestamp())),'[]'),'unexpiredAssetIds',coalesce((select jsonb_agg(id order by id)from public.content_assets where property_id=p_property_id and(expires_at is null or expires_at>clock_timestamp())),'[]'));
 if octet_length(bundle::text)>10485760 then return'{"state":"sources_too_large"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'orgId',prop.org_id,'sources',bundle,'sourceHash',public.knowledge_hash(bundle));
end$$;
create function public.readiness_safe_snapshot(p_snapshot public.property_onboarding_snapshots)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare payload jsonb:=p_snapshot.snapshot_payload;clean jsonb;
begin
 clean:=jsonb_build_object('property',public.readiness_safe_property(payload->'property'),
 'contacts',coalesce((select jsonb_agg(public.readiness_safe_contact(v))from jsonb_array_elements(case when jsonb_typeof(payload->'contacts')='array'then payload->'contacts'else'[]'end)v where v->>'contact_type'in('primary','secondary')),'[]'),
 'brand',public.readiness_safe_brand(payload->'brand'),
 'assets',coalesce((select jsonb_agg(public.readiness_safe_asset(v))from jsonb_array_elements(case when jsonb_typeof(payload->'assets')='array'then payload->'assets'else'[]'end)v),'[]'),
 'integrations',coalesce((select jsonb_agg(public.readiness_safe_integration(v))from jsonb_array_elements(case when jsonb_typeof(payload->'integrations')='array'then payload->'integrations'else'[]'end)v),'[]'),
 'chatbotContext',public.readiness_safe_chatbot(payload->'chatbotContext'))||public.readiness_project_json(payload,array['units','pointsOfInterest','legal','analyticsDestinations','requestedCapabilities','enabledCapabilities','additionalUrls','readinessEvidence']);
 return(to_jsonb(p_snapshot)-'snapshot_payload')||jsonb_build_object('snapshot_payload',clean);
end$$;
create function public.guard_readiness_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Retain readiness review evidence';end$$;
create trigger readiness_manifest_immutable before update or delete on public.readiness_source_manifests for each row execute function public.guard_readiness_history();
create trigger readiness_decision_immutable before update or delete on public.readiness_decisions for each row execute function public.guard_readiness_history();
create trigger readiness_cancellation_immutable before update or delete on public.readiness_cancellations for each row execute function public.guard_readiness_history();
create trigger readiness_invalidation_immutable before update or delete on public.readiness_invalidations for each row execute function public.guard_readiness_history();
create function public.guard_readiness_snapshot()returns trigger language plpgsql security invoker set search_path=''as $$
declare prop uuid:=case when tg_op='DELETE'then old.property_id else new.property_id end;
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=prop)then return old;end if;
 if tg_table_name='readiness_workspaces'then
  if tg_op='DELETE'or current_setting('p11.readiness_scope',true)is distinct from prop::text then raise exception 'Use a recorded readiness decision';end if;
  if tg_op='UPDATE'and(new.property_id,new.org_id,new.created_at)is distinct from(old.property_id,old.org_id,old.created_at)then raise exception 'Readiness ownership is immutable';end if;
 elsif exists(select 1 from public.readiness_workspaces where property_id=prop)then
  if tg_op='DELETE'then raise exception 'Retain the readiness snapshot';end if;
  if tg_op='UPDATE'and(to_jsonb(new)-array['status','approved_by','approved_at','approval_action_attempt_id','updated_at'])is distinct from(to_jsonb(old)-array['status','approved_by','approved_at','approval_action_attempt_id','updated_at'])then raise exception 'Build a new readiness snapshot';end if;
  if tg_op='UPDATE'and new.status='stale'and(to_jsonb(new)-array['status','updated_at'])=(to_jsonb(old)-array['status','updated_at'])then return new;end if;
  if current_setting('p11.readiness_scope',true)is distinct from prop::text then raise exception 'Use a recorded readiness decision';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger readiness_workspace_guard before insert or update or delete on public.readiness_workspaces for each row execute function public.guard_readiness_snapshot();
create trigger readiness_snapshot_guard before insert or update or delete on public.property_onboarding_snapshots for each row execute function public.guard_readiness_snapshot();
create function public.record_readiness_invalidation()returns trigger language plpgsql security invoker set search_path=''as $$
declare m public.readiness_source_manifests;current_bundle jsonb;cause text;
begin
 if new.status<>'stale'or old.status='stale'then return new;end if;
 select *into m from public.readiness_source_manifests where snapshot_id=new.id;if not found then return new;end if;
 current_bundle:=public.readiness_source_bundle(new.property_id);cause:=coalesce(nullif(current_setting('p11.readiness_invalidation_cause',true),''),case when nullif(current_setting('p11.legal_review_scope',true),'')is not null then'legal_review'when nullif(current_setting('p11.neighborhood_review_scope',true),'')is not null then'neighborhood_review'else'readiness_or_source_change'end);
 insert into public.readiness_invalidations(property_id,org_id,snapshot_id,cause,previous_status,expected_source_hash,current_source_hash)values(new.property_id,new.org_id,new.id,cause,old.status,m.source_hash,coalesce(current_bundle->>'sourceHash',public.knowledge_hash(current_bundle)));return new;
end$$;
create trigger readiness_invalidation_record after update on public.property_onboarding_snapshots for each row execute function public.record_readiness_invalidation();
create function public.invalidate_readiness_from_source()returns trigger language plpgsql security invoker set search_path=''as $$
declare prop uuid;bundle jsonb;prior text;
begin
 if tg_table_name='properties'then prop:=case when tg_op='DELETE'then old.id else new.id end;else prop:=case when tg_op='DELETE'then old.property_id else new.property_id end;end if;
 if not exists(select 1 from public.properties where id=prop)or not exists(select 1 from public.readiness_workspaces where property_id=prop)then return null;end if;
 -- Reviewed legal/neighborhood decisions already retain and invalidate their exact affected snapshots.
 if(tg_table_name='property_legal_configs'and current_setting('p11.legal_review_scope',true)=prop::text)or(tg_table_name='property_points_of_interest'and current_setting('p11.neighborhood_review_scope',true)=prop::text)then return null;end if;
 if not exists(select 1 from public.property_onboarding_snapshots s join public.readiness_source_manifests m on m.snapshot_id=s.id where s.property_id=prop and s.status in('ready','needs_review','approved'))then return null;end if;
 bundle:=public.readiness_source_bundle(prop);prior:=current_setting('p11.readiness_invalidation_cause',true);perform set_config('p11.readiness_invalidation_cause',tg_table_name||':'||lower(tg_op),true);
 update public.property_onboarding_snapshots s set status='stale'from public.readiness_source_manifests m where s.id=m.snapshot_id and s.property_id=prop and s.status in('ready','needs_review','approved')and(bundle->>'state'is distinct from'ready'or m.source_hash is distinct from bundle->>'sourceHash');
 perform set_config('p11.readiness_invalidation_cause',coalesce(prior,''),true);return null;
end$$;
create trigger readiness_source_changed after insert or update or delete on public.properties for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.property_contacts for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.property_brand_assets for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.content_assets for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.property_units for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.property_points_of_interest for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.property_legal_configs for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.integration_credentials for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.siteforge_analytics_destinations for each row execute function public.invalidate_readiness_from_source();
create trigger readiness_source_changed after insert or update or delete on public.property_chatbot_contexts for each row execute function public.invalidate_readiness_from_source();
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'readiness.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid readiness review evidence';end if;
 elsif p_action like 'neighborhood.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid neighborhood review evidence';end if;
 elsif p_action like 'legal.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid legal review evidence';end if;
 elsif p_action like 'checklist.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid checklist evidence';end if;
 elsif p_action like 'property.unit.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid floor-plan evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('organization.setup.completed','property.setup.saved','property.created','property.onboarding.completed') then
  if p_product<>'property' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid property evidence';end if;
 elsif p_action like 'site.%' then
  if p_product<>'siteforge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid brief evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.note.%' then
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid internal note evidence';end if;
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
 origin:=case when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

create function public.readiness_review_eligibility(p_snapshot public.property_onboarding_snapshots)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare expected_conflicts jsonb;facts jsonb;legal_row public.property_legal_configs;hard jsonb:='[]';warnings jsonb:='[]';entry jsonb;domain text;policy text;expected_policy text;bundle jsonb;m public.readiness_source_manifests;
begin
 select *into m from public.readiness_source_manifests where snapshot_id=p_snapshot.id and org_id=p_snapshot.org_id and property_id=p_snapshot.property_id;
 if not found then return'{"canApprove":false,"current":false,"legacy":true,"reason":"Rebuild this earlier readiness check against complete current sources."}';end if;
 bundle:=public.readiness_source_bundle(p_snapshot.property_id);
 if bundle->>'state'is distinct from'ready'or bundle->>'orgId'is distinct from p_snapshot.org_id::text or bundle->>'sourceHash'is distinct from m.source_hash then return'{"canApprove":false,"current":false,"legacy":false,"reason":"Source facts changed. Build and review a new readiness check."}';end if;
 if jsonb_typeof(p_snapshot.domain_reports)is distinct from'object'or not(p_snapshot.domain_reports?&array['identityContact','brand','assets','propertyFacts','units','neighborhood','legal','integrations'])or p_snapshot.domain_reports-array['identityContact','brand','assets','propertyFacts','units','neighborhood','legal','integrations']<>'{}'or jsonb_typeof(p_snapshot.unresolved_conflicts)is distinct from'array'then return'{"canApprove":false,"current":true,"reason":"Readiness evidence is incomplete."}';end if;
 facts:=bundle->'sources';legal_row:=jsonb_populate_record(null::public.property_legal_configs,nullif(facts->'legal','null'));
 if coalesce(length(btrim(facts->'property'->>'name')),0)=0 or not(coalesce(facts->'property'->'address','{}')?|array['street','address1','line1'])or nullif(btrim(facts->'property'->'address'->>'city'),'')is null or nullif(btrim(facts->'property'->'address'->>'state'),'')is null or not exists(select 1 from jsonb_array_elements(facts->'contacts')c where c->'is_primary'='true'and nullif(btrim(c->>'email'),'')is not null and nullif(btrim(c->>'phone'),'')is not null)or facts->'brand'->>'approval_status'is distinct from'approved'or coalesce(facts->'brand'->>'contract_hash','')!~'^[a-f0-9]{64}$'or legal_row.id is null or legal_row.approved_at is null or not public.valid_legal_review_draft(public.legal_config_draft(legal_row),true)then return'{"canApprove":false,"qualified":false,"current":true,"reason":"Required identity, approved brand or complete legal evidence is missing."}';end if;
 for domain,entry in select *from jsonb_each(p_snapshot.domain_reports)loop
  expected_policy:=case when domain in('identityContact','brand','legal')then'required'when domain in('propertyFacts')then'manager_override'when domain='integrations'and jsonb_array_length(coalesce(p_snapshot.snapshot_payload->'requestedCapabilities','[]'))>0 then'manager_override'else'advisory'end;
  if jsonb_typeof(entry)is distinct from'object'or entry->>'state'not in('missing','conflicted','needs_review','ready','stale')or entry->>'state'is null or entry->>'approvalPolicy'is distinct from expected_policy or jsonb_typeof(entry->'reasons')is distinct from'array'or jsonb_typeof(entry->'sourceIds')is distinct from'array'or entry->'blocking'is distinct from to_jsonb(entry->>'state'<>'ready'and expected_policy<>'advisory')then return'{"canApprove":false,"current":true,"reason":"Readiness reports require a new build."}';end if;
  if entry->>'state'<>'ready'and expected_policy='required'then hard:=hard||jsonb_build_array(jsonb_build_object('domain',domain,'reasons',entry->'reasons'));end if;
  if entry->>'state'<>'ready'and expected_policy='manager_override'then warnings:=warnings||jsonb_build_array(jsonb_build_object('domain',domain,'reasons',entry->'reasons'));end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('domain',k,'reasons',v->'reasons','sourceIds',v->'sourceIds','approvalPolicy',v->>'approvalPolicy')),'[]')into expected_conflicts from jsonb_each(p_snapshot.domain_reports)e(k,v)where v->'blocking'='true';
 if jsonb_array_length(expected_conflicts)<>jsonb_array_length(p_snapshot.unresolved_conflicts)or not(expected_conflicts@>p_snapshot.unresolved_conflicts and p_snapshot.unresolved_conflicts@>expected_conflicts)then return'{"canApprove":false,"qualified":false,"current":true,"reason":"Readiness conflicts need a complete new build."}';end if;
 return jsonb_build_object('qualified',jsonb_array_length(hard)=0,'canApprove',p_snapshot.status in('ready','needs_review')and jsonb_array_length(hard)=0,'current',true,'legacy',false,'requiresManagerOverride',jsonb_array_length(warnings)>0,'hardBlockers',hard,'overrideableConflicts',warnings);
end$$;
create function public.decide_readiness_review(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_calculation jsonb default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare org uuid;op text:=p_input->>'operation';decision_kind text;d public.readiness_decisions;c public.readiness_cancellations;s public.property_onboarding_snapshots;bundle jsonb;eligibility jsonb;payload jsonb;before_value jsonb;after_value jsonb;result jsonb;event jsonb;sid uuid;aid uuid;source_hash text;status_value text;expected_status text;changed jsonb:='[]';jobid uuid;attemptid uuid;manager_override boolean:=false;row_value jsonb;
begin
 select p.org_id into org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>32768 or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(p_input->>'reason'))not between 3 and 2000 or op is null or op not in('build','approve','reject','withdraw','cancel_unused')then raise exception 'Review the readiness action and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,936));
 if exists(select 1 from public.readiness_workspaces where property_id=p_property_id and org_id<>org)or exists(select 1 from public.property_onboarding_snapshots where property_id=p_property_id and org_id<>org)then return'{"state":"scope_changed"}';end if;
 select *into d from public.readiness_decisions where id=p_id;
 if found then if(d.property_id,d.org_id,d.actor_id)is distinct from(p_property_id,org,p_actor_id)or(op<>'cancel_unused'and d.input<>p_input)then return'{"state":"request_conflict"}';end if;return d.result||'{"state":"replayed"}';end if;
 select *into c from public.readiness_cancellations where id=p_id;
 if found then if op<>'cancel_unused'then return'{"state":"decision_cancelled"}';end if;if(c.property_id,c.org_id,c.actor_id,c.input_hash,c.reason)is distinct from(p_property_id,org,p_actor_id,p_input->>'inputHash',p_input->>'reason')then return'{"state":"request_conflict"}';end if;return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);end if;
 if op='cancel_unused'then
  if p_input-array['operation','reason','inputHash']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the unused request digest';end if;
  insert into public.readiness_cancellations(id,property_id,org_id,actor_id,input_hash,reason)values(p_id,p_property_id,org,p_actor_id,p_input->>'inputHash',p_input->>'reason');aid:=md5('readiness-cancel:'||p_id::text)::uuid;
  event:=public.append_shared_action_event(aid,aid,p_property_id,p_actor_id,'property','readiness.cancelled','server_confirmed','succeeded',jsonb_build_object('unusedRequestId',p_id,'browserInputHash',p_input->>'inputHash'),null,null,'{"cancelled":true}');if event->>'state'not in('recorded','replayed')then raise exception 'Readiness activity unavailable';end if;
  return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);
 end if;
 if op='build'then
  if p_input-array['operation','reason','enabledCapabilities']<>'{}'or jsonb_typeof(p_input->'enabledCapabilities')is distinct from'array'or jsonb_array_length(p_input->'enabledCapabilities')>4 or exists(select 1 from jsonb_array_elements_text(p_input->'enabledCapabilities')v where v not in('crm','tours','chatbot','analytics'))or(select count(distinct v)from jsonb_array_elements_text(p_input->'enabledCapabilities')v)<>jsonb_array_length(p_input->'enabledCapabilities')then raise exception 'Choose the supported readiness capabilities';end if;
  bundle:=public.readiness_source_bundle(p_property_id);if bundle->>'state'<>'ready'then return bundle;end if;source_hash:=bundle->>'sourceHash';
  if p_calculation is null or jsonb_typeof(p_calculation)is distinct from'object'or octet_length(p_calculation::text)>15728640 or p_calculation-array['sourceHash','payload','contentHash','domains','unresolvedConflicts','sourceReferences','status']<>'{}'or p_calculation->>'sourceHash'is distinct from source_hash then return'{"state":"sources_changed"}';end if;
  payload:=p_calculation->'payload';status_value:=p_calculation->>'status';
  if jsonb_typeof(payload)is distinct from'object'or payload-array['property','contacts','brand','assets','units','pointsOfInterest','legal','integrations','analyticsDestinations','chatbotContext','requestedCapabilities','enabledCapabilities','additionalUrls','readinessEvidence']<>'{}'or payload->'readinessEvidence'is distinct from jsonb_build_object('sourceHash',source_hash,'policyVersion','readiness.review.v1')or payload->'property'is distinct from bundle->'sources'->'property'or payload->'contacts'is distinct from bundle->'sources'->'contacts'or payload->'integrations'is distinct from bundle->'sources'->'integrations'or payload->'legal'is distinct from bundle->'sources'->'legal'or payload->'pointsOfInterest'is distinct from bundle->'sources'->'pointsOfInterest'or payload->'requestedCapabilities'is distinct from p_input->'enabledCapabilities'or coalesce(p_calculation->>'contentHash','')!~'^[a-f0-9]{64}$'or status_value is null or status_value not in('ready','needs_review')or jsonb_typeof(p_calculation->'domains')is distinct from'object'or jsonb_typeof(p_calculation->'unresolvedConflicts')is distinct from'array'or jsonb_typeof(p_calculation->'sourceReferences')is distinct from'array'then raise exception 'Use the complete safe readiness calculation';end if;
  -- A service calculation may select usable source rows, never add unsourced content or credentials.
  if payload->'brand'is distinct from coalesce(nullif(bundle->'sources'->'brand','null'),'{}')or payload->'chatbotContext'is distinct from bundle->'sources'->'chatbotContext'or jsonb_typeof(payload->'assets')is distinct from'array'or jsonb_typeof(payload->'units')is distinct from'array'or jsonb_typeof(payload->'enabledCapabilities')is distinct from'array'or jsonb_typeof(payload->'additionalUrls')is distinct from'array'then raise exception 'Retain the safe source payload';end if;
  for row_value in select value from jsonb_array_elements(payload->'assets')loop if not exists(select 1 from jsonb_array_elements(bundle->'sources'->'assets')a where a=row_value)then raise exception 'Readiness asset was not in the reviewed source';end if;end loop;
  for row_value in select value from jsonb_array_elements(payload->'units')loop if not exists(select 1 from jsonb_array_elements(bundle->'sources'->'units')u where u=row_value)then raise exception 'Readiness floor plan was not in the reviewed source';end if;end loop;
  select *into s from public.property_onboarding_snapshots where property_id=p_property_id and content_hash=p_calculation->>'contentHash'for update;
  if found and(not exists(select 1 from public.readiness_source_manifests m where m.snapshot_id=s.id and m.source_hash=bundle->>'sourceHash')or s.snapshot_payload<>payload or s.domain_reports<>p_calculation->'domains')then return'{"state":"snapshot_conflict"}';end if;
  before_value:=jsonb_build_object('snapshot',case when s.id is not null then public.readiness_safe_snapshot(s)else null end,'sourceHash',source_hash);
  perform set_config('p11.readiness_scope',p_property_id::text,true);
  insert into public.readiness_workspaces(property_id,org_id)values(p_property_id,org)on conflict(property_id)do update set revision=readiness_workspaces.revision+1,updated_at=clock_timestamp();
  if s.id is null then
   sid:=p_id;
   insert into public.property_onboarding_snapshots(id,property_id,org_id,status,schema_version,domain_reports,source_references,unresolved_conflicts,snapshot_payload,content_hash,brand_asset_id,brand_contract_version,brand_contract_hash,created_by)
   values(sid,p_property_id,org,status_value,1,p_calculation->'domains',p_calculation->'sourceReferences',p_calculation->'unresolvedConflicts',payload,p_calculation->>'contentHash',(bundle->'sources'->'brand'->>'id')::uuid,bundle->'sources'->'brand'->>'contract_version',bundle->'sources'->'brand'->>'contract_hash',p_actor_id);
   insert into public.readiness_source_manifests(snapshot_id,property_id,org_id,source_hash,sources,policy_version)values(sid,p_property_id,org,source_hash,bundle->'sources','readiness.review.v1');
  else sid:=s.id;if s.status in('stale','rejected')then update public.property_onboarding_snapshots set status=status_value,approved_by=null,approved_at=null,approval_action_attempt_id=null where id=sid;end if;end if;
  decision_kind:='built';
 else
  if p_input-array['operation','reason','snapshotId','snapshotHash','sourceHash','confirmed','allowManagerOverride']<>'{}'or p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Confirm the exact saved readiness decision';end if;
  sid:=(p_input->>'snapshotId')::uuid;select *into s from public.property_onboarding_snapshots where id=sid and property_id=p_property_id and org_id=org for update;if not found then return'{"state":"not_found"}';end if;
  if p_input->>'snapshotHash'is distinct from public.knowledge_hash(to_jsonb(s))or p_input->>'sourceHash'is distinct from(select m.source_hash from public.readiness_source_manifests m where m.snapshot_id=sid)then return'{"state":"snapshot_changed"}';end if;
  before_value:=jsonb_build_object('snapshot',public.readiness_safe_snapshot(s),'sourceHash',p_input->>'sourceHash');
  if op='approve'then
   eligibility:=public.readiness_review_eligibility(s);if eligibility->'current'is distinct from'true'::jsonb then return'{"state":"sources_changed"}';end if;if eligibility->'canApprove'is distinct from'true'::jsonb then return'{"state":"not_approvable"}';end if;
   manager_override:=coalesce((eligibility->>'requiresManagerOverride')::boolean,false);if manager_override and(p_input->'allowManagerOverride'is distinct from'true'::jsonb or length(btrim(p_input->>'reason'))<10)then return'{"state":"override_required"}';end if;
  elsif op='reject'and s.status not in('ready','needs_review')then return'{"state":"not_approvable"}';elsif op='withdraw'and s.status<>'approved'then return'{"state":"not_approvable"}';end if;
  perform set_config('p11.readiness_scope',p_property_id::text,true);
  if op='approve'then
   jobid:=p_id;attemptid:=p_id;
   insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,dedupe_key,payload,attempt_count,started_at,finished_at)values(jobid,org,p_property_id,'onboarding','property_onboarding_snapshot',sid::text,'succeeded','readiness-decision:'||p_id,jsonb_build_object('snapshotHash',s.content_hash,'sourceHash',p_input->>'sourceHash','managerOverride',manager_override),1,clock_timestamp(),clock_timestamp());
   insert into public.shared_action_attempts(id,job_id,org_id,property_id,action_type,lifecycle_status,proposal_decision_status,execution_status,requested_by,reviewed_by,request_payload,execution_payload,execution_result,policy_reason,decided_at,executed_at)values(attemptid,jobid,org,p_property_id,'approve_onboarding_snapshot','succeeded','approved','executed',p_actor_id,p_actor_id,jsonb_build_object('snapshotId',sid,'managerOverride',manager_override,'overrideConflicts',eligibility->'overrideableConflicts'),jsonb_build_object('snapshotHash',s.content_hash,'sourceHash',p_input->>'sourceHash'),jsonb_build_object('approved',true,'managerOverride',manager_override),p_input->>'reason',clock_timestamp(),clock_timestamp());
   insert into public.shared_approvals(id,action_attempt_id,org_id,property_id,decision_status,decision_reason,reviewer_profile_id,decision_payload)values(p_id,attemptid,org,p_property_id,'approved',p_input->>'reason',p_actor_id,jsonb_build_object('snapshotId',sid,'contentHash',s.content_hash,'sourceHash',p_input->>'sourceHash','managerOverride',manager_override,'overrideConflicts',eligibility->'overrideableConflicts','reasonCode','readiness.review.explicit.v1'));
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'contentHash',content_hash)order by id),'[]')into changed from public.property_onboarding_snapshots where property_id=p_property_id and status='approved'and id<>sid;
   update public.property_onboarding_snapshots set status='stale'where property_id=p_property_id and status='approved'and id<>sid;
   update public.property_onboarding_snapshots set status='approved',approved_by=p_actor_id,approved_at=clock_timestamp(),approval_action_attempt_id=attemptid where id=sid;decision_kind:='approved';
  elsif op='reject'then update public.property_onboarding_snapshots set status='rejected'where id=sid;decision_kind:='rejected';
  else update public.property_onboarding_snapshots set status='stale'where id=sid;decision_kind:='withdrawn';end if;
  update public.readiness_workspaces set revision=revision+1,updated_at=clock_timestamp()where property_id=p_property_id;
 end if;
 select *into s from public.property_onboarding_snapshots where id=sid;
 after_value:=jsonb_build_object('snapshot',public.readiness_safe_snapshot(s),'sourceHash',(select m.source_hash from public.readiness_source_manifests m where m.snapshot_id=sid),'supersededApprovals',changed);
 result:=jsonb_build_object('state','saved','propertyId',p_property_id,'decisionId',p_id,'snapshotId',sid,'status',s.status,'kind',decision_kind,'published',false,'providerActivated',false);
 insert into public.readiness_decisions(id,property_id,org_id,actor_id,snapshot_id,kind,input,input_hash,before_state,after_state,result)values(p_id,p_property_id,org,p_actor_id,sid,decision_kind,p_input,public.knowledge_hash(p_input),before_value,after_value,result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property','readiness.'||decision_kind,'server_confirmed','succeeded',jsonb_build_object('snapshotId',sid,'inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(before_value)),jsonb_build_object('hash',public.knowledge_hash(after_value)),result,case when jobid is not null then jsonb_build_object('jobId',jobid,'attemptId',attemptid)else'{}'end);
 if event->>'state'not in('recorded','replayed')then raise exception 'Readiness activity unavailable';end if;perform set_config('p11.readiness_scope','',true);return result;
end$$;

create function public.read_readiness_reviews(p_property_id uuid,p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare org uuid;role text;read_kind text:=coalesce(p_input->>'kind','snapshots');off int:=coalesce((p_input->>'offset')::int,0);rows jsonb;items jsonb;hash text;total int;s public.property_onboarding_snapshots;d public.readiness_decisions;m public.readiness_source_manifests;eligibility jsonb;
begin
 select p.org_id,u.role into org,role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if org is null then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','snapshotId','decisionId','offset','expectedHash']<>'{}'or read_kind not in('sources','snapshots','snapshot','history','history_detail','decision','invalidations','active')or off not between 0 and 1000000 then raise exception 'Choose a readiness check or history page';end if;
 if exists(select 1 from public.readiness_workspaces where property_id=p_property_id and org_id<>org)or exists(select 1 from public.property_onboarding_snapshots where property_id=p_property_id and org_id<>org)then return'{"state":"scope_changed"}';end if;
 if read_kind='sources'then return public.readiness_source_bundle(p_property_id)||jsonb_build_object('canManage',coalesce(role in('admin','manager'),false));end if;
 if read_kind in('decision','history_detail')then
  select *into d from public.readiness_decisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=org and(read_kind='history_detail'or actor_id=p_actor_id);if not found then return'{"state":"not_found"}';end if;
  if read_kind='decision'then return d.result||'{"state":"ready"}';end if;return jsonb_build_object('state','ready','propertyId',p_property_id,'decision',to_jsonb(d));
 end if;
 if read_kind='active'then
  select r.*into s from public.property_onboarding_snapshots r join public.readiness_source_manifests manifest on manifest.snapshot_id=r.id and manifest.org_id=org where r.property_id=p_property_id and r.org_id=org and r.status='approved'order by r.approved_at desc,r.id limit 1;
  if s.id is null then return jsonb_build_object('state','ready','propertyId',p_property_id,'snapshot',null);end if;
  eligibility:=public.readiness_review_eligibility(s);return jsonb_build_object('state','ready','propertyId',p_property_id,'snapshot',case when eligibility->'current'='true'::jsonb and eligibility->'qualified'='true'::jsonb then public.readiness_safe_snapshot(s)else null end);
 end if;
 if read_kind='snapshot'then
  select *into s from public.property_onboarding_snapshots where id=(p_input->>'snapshotId')::uuid and property_id=p_property_id and org_id=org;if not found then return'{"state":"not_found"}';end if;
  select *into m from public.readiness_source_manifests where snapshot_id=s.id;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(role in('admin','manager'),false),'snapshot',public.readiness_safe_snapshot(s),'snapshotHash',public.knowledge_hash(to_jsonb(s)),'sourceHash',m.source_hash,'sources',m.sources,'policyVersion',m.policy_version,'eligibility',public.readiness_review_eligibility(s));
 end if;
 if read_kind='history'then
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'snapshotId',x.snapshot_id,'kind',x.kind,'actorId',x.actor_id,'createdAt',x.created_at,'reason',x.input->>'reason')order by decision_sequence desc),'[]')into rows from public.readiness_decisions x where property_id=p_property_id and org_id=org;
 elsif read_kind='invalidations'then
  select coalesce(jsonb_agg(to_jsonb(x)order by created_at desc,id),'[]')into rows from public.readiness_invalidations x where property_id=p_property_id and org_id=org;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'createdAt',r.created_at,'approvedAt',r.approved_at,'approvedBy',r.approved_by,'contentHash',r.content_hash,'recorded',exists(select 1 from public.readiness_source_manifests where snapshot_id=r.id),'requestedCapabilities',r.snapshot_payload->'requestedCapabilities','eligibility',public.readiness_review_eligibility(r))order by r.created_at desc,r.id),'[]')into rows from public.property_onboarding_snapshots r where property_id=p_property_id and org_id=org;
 end if;
 total:=jsonb_array_length(rows);hash:=public.knowledge_hash(rows);if p_input?'expectedHash'and p_input->>'expectedHash'is distinct from hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(p.v order by n),'[]')into items from jsonb_array_elements(rows)with ordinality p(v,n)where n>off and n<=off+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(role in('admin','manager'),false),'items',items,'total',total,'nextOffset',case when off+20<total then off+20 else null end,'pageHash',hash);
end$$;
revoke all on function public.readiness_project_json(jsonb,text[])from public,anon,authenticated;grant execute on function public.readiness_project_json(jsonb,text[])to service_role;
revoke all on function public.readiness_safe_property(jsonb)from public,anon,authenticated;grant execute on function public.readiness_safe_property(jsonb)to service_role;
revoke all on function public.readiness_safe_contact(jsonb)from public,anon,authenticated;grant execute on function public.readiness_safe_contact(jsonb)to service_role;
revoke all on function public.readiness_safe_brand(jsonb)from public,anon,authenticated;grant execute on function public.readiness_safe_brand(jsonb)to service_role;
revoke all on function public.readiness_safe_asset(jsonb)from public,anon,authenticated;grant execute on function public.readiness_safe_asset(jsonb)to service_role;
revoke all on function public.readiness_safe_integration(jsonb)from public,anon,authenticated;grant execute on function public.readiness_safe_integration(jsonb)to service_role;
revoke all on function public.readiness_safe_chatbot(jsonb)from public,anon,authenticated;grant execute on function public.readiness_safe_chatbot(jsonb)to service_role;
revoke all on function public.readiness_safe_analytics(jsonb)from public,anon,authenticated;grant execute on function public.readiness_safe_analytics(jsonb)to service_role;
revoke all on function public.readiness_source_bundle(uuid)from public,anon,authenticated;grant execute on function public.readiness_source_bundle(uuid)to service_role;
revoke all on function public.readiness_safe_snapshot(public.property_onboarding_snapshots)from public,anon,authenticated;grant execute on function public.readiness_safe_snapshot(public.property_onboarding_snapshots)to service_role;
revoke all on function public.guard_readiness_history()from public,anon,authenticated;grant execute on function public.guard_readiness_history()to service_role;
revoke all on function public.guard_readiness_snapshot()from public,anon,authenticated;grant execute on function public.guard_readiness_snapshot()to service_role;
revoke all on function public.record_readiness_invalidation()from public,anon,authenticated;grant execute on function public.record_readiness_invalidation()to service_role;
revoke all on function public.invalidate_readiness_from_source()from public,anon,authenticated;grant execute on function public.invalidate_readiness_from_source()to service_role;
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated;grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)to service_role;
revoke all on function public.readiness_review_eligibility(public.property_onboarding_snapshots)from public,anon,authenticated;grant execute on function public.readiness_review_eligibility(public.property_onboarding_snapshots)to service_role;
revoke all on function public.decide_readiness_review(uuid,uuid,uuid,jsonb,jsonb)from public,anon,authenticated;grant execute on function public.decide_readiness_review(uuid,uuid,uuid,jsonb,jsonb)to service_role;
revoke all on function public.read_readiness_reviews(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.read_readiness_reviews(uuid,uuid,jsonb)to service_role;

notify pgrst,'reload schema';

create function public.readiness_publication_snapshot(p_property_id uuid,p_snapshot_id uuid default null,p_content_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare s public.property_onboarding_snapshots;e jsonb;
begin
 select r.*into s from public.property_onboarding_snapshots r join public.properties p on p.id=r.property_id and p.org_id=r.org_id join public.readiness_source_manifests m on m.snapshot_id=r.id and m.org_id=r.org_id where r.property_id=p_property_id and r.status='approved'and(p_snapshot_id is null or r.id=p_snapshot_id)and(p_content_hash is null or r.content_hash=p_content_hash)order by r.approved_at desc,r.id limit 1;
 if not found then return jsonb_build_object('state','unavailable','propertyId',p_property_id);end if;e:=public.readiness_review_eligibility(s);if e->'current'is distinct from'true'::jsonb or e->'qualified'is distinct from'true'::jsonb then return jsonb_build_object('state','sources_changed','propertyId',p_property_id);end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'snapshot',public.readiness_safe_snapshot(s));
end$$;
revoke all on function public.readiness_assistant_eligibility(uuid),public.readiness_publication_snapshot(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.readiness_assistant_eligibility(uuid),public.readiness_publication_snapshot(uuid,uuid,text)to service_role;

notify pgrst,'reload schema';

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
  perform 1 from public.property_onboarding_snapshots r where id=p_id and property_id=p_property_id for share;
  actual:=public.readiness_publication_snapshot(p_property_id,p_id)->'snapshot';
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
