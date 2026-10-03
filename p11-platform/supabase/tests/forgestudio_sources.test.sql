begin;
create temp table checks(label text);
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
create temp table fixture(property_id uuid,actor_id uuid,unit_id uuid,asset_id uuid,legal_id uuid,review_id uuid,testimonial_id uuid,context_id uuid,revision_id uuid,package_id uuid,connection_id uuid,publication_id uuid,refresh_id uuid,content jsonb,bundle jsonb,payload jsonb);
insert into fixture select gen_random_uuid(),id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,gen_random_uuid(),null,gen_random_uuid(),null,null,null from public.profiles where org_id='22222222-2222-2222-2222-222222222222' and role='admin' limit 1;
insert into public.properties(id,org_id,name)select property_id,'22222222-2222-2222-2222-222222222222','ForgeStudio source rollback fixture' from fixture;
insert into public.property_units(id,org_id,property_id,canonical_key,unit_type,bedrooms,rent_min,rent_max,effective_at,expires_at,review_status,active)select unit_id,'22222222-2222-2222-2222-222222222222',property_id,'fixture-one','One bedroom',1,1800,2200,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day','approved',true from fixture;
insert into public.content_assets(id,property_id,name,asset_type,file_url,approval_status,rights_status,curation_status)select asset_id,property_id,'Fixture pool','image','https://example.invalid/pool.jpg','approved','owned','selected' from fixture;
insert into public.property_legal_configs(id,org_id,property_id,status,version,effective_at)select legal_id,'22222222-2222-2222-2222-222222222222',property_id,'approved',1,clock_timestamp()-interval '1 day' from fixture;
insert into public.reviews(id,property_id,platform,review_text,rating,reviewer_name)select review_id,property_id,'google','A peaceful community',5,'Fixture resident' from fixture;
insert into public.review_testimonial_approvals(id,property_id,review_id,approved_by,source_version,content_fingerprint,platform_snapshot,rating_snapshot,review_text_snapshot,reviewer_name_snapshot,rights_basis,status,attribution_approved,usage_scope)select f.testimonial_id,f.property_id,f.review_id,f.actor_id,r.source_version,public.crm_configuration_hash(public.reviewflow_testimonial_source(r)),r.platform,r.rating,r.review_text,r.reviewer_name,'direct_consent','active',true,'["social"]' from fixture f join public.reviews r on r.id=f.review_id;
insert into public.social_connections(id,property_id,platform,account_id,account_name,is_active)select connection_id,property_id,'facebook','fixture-destination','Fixture account',true from fixture;
create function pg_temp.bundle(f fixture) returns jsonb language plpgsql as $$begin
 return jsonb_build_object('version','forgestudio.context.v1','propertyId',f.property_id,'contextHash','fixture-exact-sources','policy',jsonb_build_object('legalConfigId',f.legal_id),'sourceRecords',jsonb_build_object(
 'inventory:'||f.unit_id,jsonb_build_object('kind','inventory','id',f.unit_id,'values',public.read_forgestudio_source_record(f.property_id,'inventory',f.unit_id)),
 'asset:'||f.asset_id,jsonb_build_object('kind','asset','id',f.asset_id,'values',public.read_forgestudio_source_record(f.property_id,'asset',f.asset_id)),
 'legal:'||f.legal_id,jsonb_build_object('kind','legal','id',f.legal_id,'values',public.read_forgestudio_source_record(f.property_id,'legal',f.legal_id)),
 'testimonial:'||f.testimonial_id,jsonb_build_object('kind','testimonial','id',f.testimonial_id,'values',public.read_forgestudio_source_record(f.property_id,'testimonial',f.testimonial_id))),
 'sources',jsonb_build_array(
 jsonb_build_object('id','structured_inventory:'||f.unit_id,'kind','structured_inventory','recordKey','inventory:'||f.unit_id,'label','Approved inventory','content','Rent starts at 1800','allowedUses','["claim"]'::jsonb),
 jsonb_build_object('id','asset:'||f.asset_id,'kind','asset','recordKey','asset:'||f.asset_id,'label','Fixture pool','content','Pool image','allowedUses','["claim"]'::jsonb),
 jsonb_build_object('id','legal_policy:'||f.legal_id,'kind','legal_policy','recordKey','legal:'||f.legal_id,'label','Approved policy','content','Fixture policy','allowedUses','["claim"]'::jsonb),
 jsonb_build_object('id','approved_testimonial:'||f.testimonial_id,'kind','approved_testimonial','recordKey','testimonial:'||f.testimonial_id,'label','Approved testimonial','content','A peaceful community','allowedUses','["claim"]'::jsonb)),
 'assets',jsonb_build_array(jsonb_build_object('id',f.asset_id,'fileUrl','https://example.invalid/pool.jpg')));
end$$;
update fixture f set bundle=pg_temp.bundle(f),content=jsonb_build_object('contractVersion','forgestudio.social.v1','conceptSummary','Source review fixture','variants',jsonb_build_array(jsonb_build_object('variantKey','primary','sequenceIndex',0,'platform','facebook','caption','Rent from $1,800. A peaceful community.','hashtags','[]'::jsonb,'assetIds',jsonb_build_array(asset_id),'mediaUrls','["https://example.invalid/pool.jpg"]'::jsonb,'contentFormat','image')),'claims',jsonb_build_array(jsonb_build_object('text','Rent from $1,800','type','pricing','citations',jsonb_build_array(jsonb_build_object('sourceType','structured_inventory','sourceId','structured_inventory:'||unit_id))),jsonb_build_object('text','A peaceful community','type','testimonial','citations',jsonb_build_array(jsonb_build_object('sourceType','approved_testimonial','sourceId','approved_testimonial:'||testimonial_id)))));
insert into public.shared_context_snapshots(id,org_id,property_id,source_domain,context_hash,context_payload)select context_id,'22222222-2222-2222-2222-222222222222',property_id,'forgestudio.generation','fixture-exact-sources',bundle from fixture;
do $$declare f fixture;r jsonb;begin
 select * into f from fixture;
 perform pg_temp.check(exists(select 1 from public.forgestudio_context_sources where context_id=f.context_id),'exact source records verified and retained with the context');
 perform pg_temp.check(public.check_forgestudio_sources(f.property_id,f.context_id,f.content)->>'state'='current','valid scoped claims and media remain usable');
 perform pg_temp.check(not has_table_privilege('authenticated','public.forgestudio_context_sources','select') and not has_function_privilege('authenticated','public.check_forgestudio_sources(uuid,uuid,jsonb)','execute'),'source manifests are private and cannot be used to cross properties');
 perform pg_temp.check(public.read_forgestudio_source_record(gen_random_uuid(),'inventory',f.unit_id) is null,'source record lookup enforces property ownership');
 perform pg_temp.check(public.check_forgestudio_sources(f.property_id,null,f.content)->>'state'='source_review_required','claims and media with missing evidence cannot approve');
 perform pg_temp.check(public.check_forgestudio_sources(f.property_id,f.context_id,jsonb_set(f.content,'{claims,0,citations,0,sourceType}','"property_field"'))->>'state'='source_review_required','citation kind cannot misrepresent an inventory source');
 perform pg_temp.check(public.check_forgestudio_sources(f.property_id,f.context_id,jsonb_set(f.content,'{variants,0,mediaUrls}','["https://example.invalid/different.jpg"]'))->>'state'='source_review_required','unreviewed media URL cannot replace the selected asset');
 r:=public.save_forgestudio_revision(f.revision_id,f.property_id,f.actor_id,jsonb_build_object('content',f.content,'authorKind','user','validation','[[]]'::jsonb,'contextSnapshotId',f.context_id));
 perform pg_temp.check(r->>'state'='saved','source-linked revision is saved');update fixture set package_id=(r->>'packageId')::uuid;
 update public.property_units set rent_min=1900 where id=f.unit_id;
 perform pg_temp.check(public.review_forgestudio_revision(gen_random_uuid(),f.property_id,f.actor_id,jsonb_build_object('revisionId',f.revision_id,'contentHash',r->'revision'->>'content_hash','decision','approved','note','Verified pricing and sources'))->>'state'='source_review_required','changed pricing blocks approval');
 perform pg_temp.check((select approval_status='pending' from public.social_content_revisions where id=f.revision_id),'failed source check leaves prior revision state intact');
 begin insert into public.shared_context_snapshots(org_id,property_id,source_domain,context_hash,context_payload)values('22222222-2222-2222-2222-222222222222',f.property_id,'forgestudio.generation','old-source',f.bundle);raise exception 'FAIL changed capture';exception when raise_exception then if SQLERRM not like 'A source changed while%' then raise;end if;end;
 perform pg_temp.check((select count(*)=1 from public.shared_context_snapshots where property_id=f.property_id),'source change during context saving rolls back the whole snapshot');
 update public.property_units set rent_min=1800 where id=f.unit_id;
 r:=public.review_forgestudio_revision(gen_random_uuid(),f.property_id,f.actor_id,jsonb_build_object('revisionId',f.revision_id,'contentHash',r->'revision'->>'content_hash','decision','approved','note','Verified pricing and sources'));
 perform pg_temp.check(r->>'state'='saved','exact current source evidence allows approval');
 update fixture set payload=jsonb_build_object('revisionId',f.revision_id,'contentHash',r->'revision'->>'content_hash','destinations',jsonb_build_array(jsonb_build_object('connectionId',f.connection_id,'variantId',(select id from public.social_content_variants where revision_id=f.revision_id),'scheduledFor',clock_timestamp()+interval '1 day','timezone','UTC')));
end$$;
do $$declare f fixture;r jsonb;job uuid;begin
 select * into f from fixture;
 -- Qualify the revoked scenario inside an isolated savepoint; revoked permission is never reactivated.
 begin
  update public.review_testimonial_approvals set status='revoked',revoked_at=clock_timestamp(),revoked_by=f.actor_id,revocation_reason='Fixture revocation' where id=f.testimonial_id;
  r:=public.schedule_forgestudio_publications(gen_random_uuid(),f.property_id,f.actor_id,f.payload);
  raise exception using errcode='P1101',message='Rollback only this revocation fixture';
 exception when sqlstate 'P1101' then null;end;
 perform pg_temp.check(r->>'state'='source_review_required','revoked testimonial blocks scheduling after approval');
 update public.content_assets set rights_status='restricted',curation_status='needs_review',expires_at=clock_timestamp()-interval '1 day' where id=f.asset_id;
 r:=public.check_forgestudio_sources(f.property_id,f.context_id,f.content);
 perform pg_temp.check(r->>'state'='current' and jsonb_array_length(r->'advisories')=1,'rights expiry and curation remain explicit advisories under owner policy');
 r:=public.schedule_forgestudio_publications(gen_random_uuid(),f.property_id,f.actor_id,f.payload);
 perform pg_temp.check(r->>'state'='saved','owner-approved media with advisory metadata can schedule');
 update fixture set publication_id=(r->'publications'->0->>'id')::uuid;
 select shared_job_id into job from public.social_publications where id=(r->'publications'->0->>'id')::uuid;
 update public.shared_jobs set lifecycle_status='running',lease_owner='source-worker',lease_expires_at=clock_timestamp()+interval '5 minutes',attempt_count=1 where id=job;
 update public.property_units set rent_min=2100 where id=f.unit_id;
 perform pg_temp.check(public.prepare_forgestudio_publication_write(job,'source-worker',gen_random_uuid())->>'state'='source_review_required','publication rechecks pricing immediately before provider intent');
 perform pg_temp.check(not exists(select 1 from public.forgestudio_publication_receipts where job_id=job),'changed source creates no provider write intent');
 update public.property_units set rent_min=1800 where id=f.unit_id;
 update public.content_assets set approval_status='rejected' where id=f.asset_id;
 perform pg_temp.check(public.prepare_forgestudio_publication_write(job,'source-worker',gen_random_uuid())->>'state'='source_review_required','revoked media approval holds provider write');
 update public.content_assets set approval_status='approved' where id=f.asset_id;
 update public.property_units set expires_at=clock_timestamp()-interval '1 second' where id=f.unit_id;
 perform pg_temp.check(public.check_forgestudio_sources(f.property_id,f.context_id,f.content)->>'state'='source_review_required','expired inventory cannot support a new send');
 update public.property_units set expires_at=(f.bundle->'sourceRecords'->('inventory:'||f.unit_id)->'values'->>'expires_at')::timestamptz where id=f.unit_id;
 update public.shared_jobs set lifecycle_status='queued',lease_owner=null,lease_expires_at=null where id=job;
 r:=public.control_forgestudio_publication(gen_random_uuid(),f.property_id,f.actor_id,jsonb_build_object('action','cancel','publicationId',(select publication_id from fixture),'expectedUpdatedAt',(select updated_at from public.social_publications where id=(select publication_id from fixture))));
 perform pg_temp.check(r->>'state'='saved' and (select status='approved' from public.social_content_packages where id=f.package_id),'cancelling the last pending destination restores the approved campaign badge');
 begin update public.shared_context_snapshots set context_payload='{}' where id=f.context_id;raise exception 'FAIL mutable context';exception when raise_exception then if SQLERRM<>'Saved ForgeStudio context is immutable' then raise;end if;end;
 perform pg_temp.check(true,'saved source context cannot be rewritten');
 update public.property_units set rent_min=2100 where id=f.unit_id;
 update fixture set bundle=pg_temp.bundle(f),content=jsonb_set(jsonb_set(f.content,'{variants,0,caption}','"Rent from $2,100. A peaceful community."'),'{claims,0,text}','"Rent from $2,100"');
end$$;
create function pg_temp.fail_source_history() returns trigger language plpgsql as $$begin if new.action='studio.sources.refreshed' then raise exception 'Fixture source history failure';end if;return new;end$$;
create trigger source_fixture_failure before insert on public.shared_action_events for each row execute function pg_temp.fail_source_history();
update fixture set payload=jsonb_build_object('packageId',package_id,'expectedRevisionId',revision_id,'reason','Reviewed the current inventory and corrected the price','previewHash','fixture-preview','bundle',bundle,'content',content,'validation','[[]]'::jsonb);
do $$declare f fixture;begin
 select * into f from fixture;
 begin perform public.refresh_forgestudio_sources(f.refresh_id,f.property_id,f.actor_id,f.payload);raise exception 'FAIL partial refresh';exception when raise_exception then if SQLERRM<>'Fixture source history failure' then raise;end if;end;
 perform pg_temp.check((select count(*)=1 from public.shared_context_snapshots where property_id=f.property_id) and (select current_revision_id=f.revision_id from public.social_content_packages where id=f.package_id),'refresh history failure rolls back the new context and revision together');
end$$;
drop trigger source_fixture_failure on public.shared_action_events;
do $$declare f fixture;r jsonb;begin
 select * into f from fixture;
 r:=public.refresh_forgestudio_sources(f.refresh_id,f.property_id,f.actor_id,f.payload);
 perform pg_temp.check(r->>'state'='saved' and r->'revision'->>'approval_status'='pending','source refresh creates a new pending revision instead of reapproving stale copy');
 perform pg_temp.check(public.refresh_forgestudio_sources(f.refresh_id,f.property_id,f.actor_id,f.payload)->>'state'='replayed','lost source refresh response recovers exactly one revision');
 perform pg_temp.check((select count(*)=2 from public.shared_context_snapshots where property_id=f.property_id) and (select count(*)=2 from public.social_content_revisions where property_id=f.property_id),'source refresh replay cannot duplicate context or revisions');
 perform pg_temp.check(exists(select 1 from public.shared_action_events where id=f.refresh_id and action='studio.sources.refreshed' and context_snapshot_ref is not null),'source refresh has atomic attributed evidence with context link');
 perform pg_temp.check(public.check_forgestudio_sources(f.property_id,(r->'revision'->>'context_snapshot_id')::uuid,r->'revision'->'content')->>'state'='current','corrected revision uses verified current source records');
 perform pg_temp.check(public.refresh_forgestudio_sources(f.refresh_id,f.property_id,f.actor_id,f.payload||'{"reason":"Different reason"}')->>'state'='request_conflict','reusing a refresh identity cannot rewrite the decision');
end$$;
select count(*) as passed_assertions from checks;
rollback;
