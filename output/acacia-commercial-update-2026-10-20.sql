begin;
do $fix$
declare
 pid uuid:='2f0de51e-2b63-4b4a-80c8-29855647fed0';
 actor uuid:='e9d11d03-a80c-4f59-b4b2-fb6f3ac84b80';
 mid uuid:='da69d2e9-fb3f-5633-8406-97299515ef32';
 previous uuid:='cdbc1032-4edc-5873-b95a-e5e560bca27c';
 vid uuid:=gen_random_uuid(); eid uuid; release_id uuid:=gen_random_uuid(); org uuid;
 body text:='Acacia commercial information checked on October 20, 2026.
Availability: the live official availability map marks all 16 homesites (1–16) with red S markers; its legend identifies S as sold. No homes are marked available on that map. Describe this as the website''s listed status, not a guarantee about cancellations or resale inventory.
Pricing: the homepage still advertises a starting price of $2,675,000, but this conflicts with the map showing every homesite sold. It is a published marketing price, not a confirmed price for a currently available home.
Incentives: retained map descriptions for homesites 1, 5 and 14 mention a $50,000 closeout incentive, but those homes are marked sold and their map interactions are disabled. No currently applicable incentive was confirmed; do not offer this as an active promotion.
HOA: the live FAQ publishes an estimate of approximately $800 per home per month. Present it as an estimate, not a guaranteed final bill. It describes common-area upkeep, solar maintenance, landscaping, driveways, insurance/reserves, partial exterior and roof maintenance, and trash collection. Exact responsibilities are in the CC&Rs and Exhibit A.
For changes in availability, a current purchase quote, incentive eligibility, or final HOA dues, contact sales at 408-763-5306.
Sources checked live: https://www.dividendhomes.com/acacia/availability/ ; https://www.dividendhomes.com/acacia/ ; https://www.dividendhomes.com/acacia/faq/
This dated review replaces the earlier blanket statement that all commercial information is unconfirmed. Older floor-plan records establish layout only; their older availability qualifications do not override this newer map observation.';
 h text; result jsonb; before_value jsonb; after_value jsonb;
 reason text:='User requested confirmation, scraping the official Acacia site, and updating knowledge. Live map visually shows all 16 sold; FAQ confirms estimated HOA dues. Retained price and incentive text conflicts with sold map. Reviewed October 20, 2026; no active offer inferred.';
begin
 select org_id into org from public.properties where id=pid;
 select jsonb_build_object('material',to_jsonb(m),'facts',(select jsonb_agg(to_jsonb(d)) from public.property_intelligence_documents d where d.property_id=pid and d.key in('restricted_claims','faqs','structured_facts'))) into before_value from public.knowledge_materials m where m.id=mid for update;
 result:=public.save_knowledge_material(vid,pid,actor,jsonb_build_object('materialId',mid,'previousVersionId',previous,'title','Acacia current commercial information','content',body,'reason',reason));
 if result->>'state'<>'saved' then raise exception 'Source update failed: %',result; end if;
 h:=encode(extensions.digest(body,'sha256'),'hex'); eid:=md5('material:'||vid::text)::uuid;
 insert into public.community_source_reviews(version_id,property_id,actor_id,audience,origin,allowed_uses,purposes,review_after,reason)
 values(vid,pid,actor,'public','original',array['fact'],array['chat','site','social','brand','research','portfolio'],clock_timestamp()+interval '7 days',reason);
 update public.community_evidence set review_status='withdrawn',updated_at=clock_timestamp() where material_version_id=previous and property_id=pid;
 update public.knowledge_materials set active_version_id=vid,last_release_id=release_id,updated_at=clock_timestamp() where id=mid;
 insert into public.community_evidence(id,property_id,org_id,material_version_id,authority,audience,purposes,allowed_uses,content_hash,review_status,review_after,origin)
 values(eid,pid,org,vid,'reviewed','public',array['chat','site','social','brand','research','portfolio'],array['fact'],h,'approved',clock_timestamp()+interval '7 days','original');
 perform set_config('p11.knowledge_scope',mid::text,true);
 insert into public.documents(id,property_id,content,evidence_id,metadata)
 values(gen_random_uuid(),pid,body,eid,jsonb_build_object('knowledge_material_id',mid,'version_id',vid,'title','Acacia current commercial information','source','official_website_review','chunk_index',0,'capturedAt',clock_timestamp(),'sourceUrls',jsonb_build_array('https://www.dividendhomes.com/acacia/availability/','https://www.dividendhomes.com/acacia/faq/','https://www.dividendhomes.com/acacia/')));
 update public.property_intelligence_documents set payload=payload||jsonb_build_object('value',body,'source','Acacia live official website review — 2026-10-20','sourceUrl','https://www.dividendhomes.com/acacia/availability/','sourceEvidenceId',eid,'sourceHash',h,'observedAt','2026-10-20','effectiveFrom','2026-10-20','reviewAfter','2026-10-27','origin','import'),revision=revision+1,updated_at=clock_timestamp()
 where property_id=pid and key='restricted_claims' and status='approved';
 update public.property_intelligence_documents set payload=jsonb_set(payload,'{value}',to_jsonb(replace(replace(payload->>'value','Current dues remain unconfirmed.','See the newer commercial-information review for the published HOA estimate.'),'For current availability, prices, incentives, deposits, broker compensation, sales hours and appointments, contact sales at 408-763-5306. Do not quote historical commercial figures.','Use the newer commercial-information review for availability, published pricing, incentives and HOA estimates. Deposits, broker compensation, sales hours and appointments still require sales confirmation.'))),revision=revision+1,updated_at=clock_timestamp()
 where property_id=pid and key='faqs' and status='approved';
 update public.property_intelligence_documents set payload=jsonb_set(payload,'{value}',to_jsonb(replace(payload->>'value','Availability: Unconfirmed; contact sales.','Availability: See the newer commercial-information review; this floor-plan drawing does not establish availability.'))),revision=revision+1,updated_at=clock_timestamp()
 where property_id=pid and key='structured_facts' and status='approved';
 after_value:=jsonb_build_object('activeVersionId',vid,'evidenceId',eid,'reviewAfter','2026-10-27','facts',(select jsonb_agg(to_jsonb(d))from public.property_intelligence_documents d where d.property_id=pid and d.key in('restricted_claims','faqs','structured_facts')));
 result:=public.knowledge_decision_finish(release_id,pid,actor,mid,'source.published',jsonb_build_object('reason',reason,'versionId',vid,'method','reviewed_public_text_projection','sourceUrls',jsonb_build_array('https://www.dividendhomes.com/acacia/availability/','https://www.dividendhomes.com/acacia/faq/','https://www.dividendhomes.com/acacia/')),before_value,after_value,jsonb_build_object('materialId',mid,'versionId',vid,'activeVersionId',vid,'evidenceId',eid,'published',true,'embeddingGenerated',false));
 if result->>'state'<>'saved' then raise exception 'Publication history failed';end if;
end $fix$;
commit;
