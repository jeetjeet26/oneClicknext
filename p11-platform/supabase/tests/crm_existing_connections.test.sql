-- Synthetic, local, rollback-only coverage of pre-upgrade Lasso continuity.
begin;
create temp table continuity_checks(label text);
create function pg_temp.continuity_check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;insert into continuity_checks values(label);end$$;
create temp table continuity_fixture(property_id uuid,actor_id uuid,integration_id uuid,old_lead_id uuid,linked_lead_id uuid,new_lead_id uuid);
insert into continuity_fixture select gen_random_uuid(),id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid() from public.profiles where org_id='22222222-2222-2222-2222-222222222222' and role='admin' limit 1;
select pg_temp.continuity_check((select count(*)=1 from continuity_fixture),'local administrator fixture exists');
insert into public.properties(id,org_id,name) select property_id,'22222222-2222-2222-2222-222222222222','Synthetic preserved Lasso' from continuity_fixture;
-- Emulate a row written by the previous release, then restore the normal guard.
alter table public.integration_credentials disable trigger crm_configuration_version;
insert into public.integration_credentials(id,property_id,platform,status,mapping_validated,credentials,field_mapping)
select integration_id,property_id,'lasso','connected',true,'{"api_key":"synthetic-only","client_id":"fixture-client","project_id":"fixture-project","api_endpoint":"https://api.lassocrm.com/v1"}','{"email":"email","notes":"notes"}' from continuity_fixture;
alter table public.integration_credentials enable trigger crm_configuration_version;
insert into public.crm_existing_connections(integration_id,property_id,org_id,revision,credentials_hash,mapping_hash)
select c.id,c.property_id,p.org_id,c.crm_revision,public.crm_configuration_hash(c.credentials),public.crm_configuration_hash(c.field_mapping) from public.integration_credentials c join public.properties p on p.id=c.property_id join continuity_fixture f on f.integration_id=c.id;
insert into public.leads(id,property_id,email,crm_sync_status,external_crm_id,notes)
select old_lead_id,property_id,'older@example.invalid','pending',null,'Earlier conversation' from continuity_fixture union all
select linked_lead_id,property_id,'linked@example.invalid','pending','existing-registrant','Earlier saved conversation' from continuity_fixture;
insert into public.crm_upgrade_leads(lead_id,integration_id,property_id,previous_status,external_id,notes_hash)
select l.id,f.integration_id,l.property_id,l.crm_sync_status,l.external_crm_id,public.crm_configuration_hash(to_jsonb(coalesce(l.notes,''))) from public.leads l join continuity_fixture f on f.property_id=l.property_id;
insert into public.leads(id,property_id,email,crm_sync_status,notes) select new_lead_id,property_id,'new@example.invalid','pending','New chatbot conversation' from continuity_fixture;
do $$declare f continuity_fixture;r jsonb;h uuid;claim uuid;another uuid:=gen_random_uuid();changed uuid:=gen_random_uuid();begin
 select * into f from continuity_fixture;
 r:=public.read_crm_workspace(f.property_id,f.actor_id);
 perform pg_temp.continuity_check(r->'integrations'->0->>'status'='existing_connection' and r->'integrations'->0->>'upgradeReviewCount'='1','existing setup and held backlog are visible');
 perform pg_temp.continuity_check(r::text not like '%synthetic-only%' and r->'integrations'->0->>'providerVerified'='false','continuity does not expose credentials or invent provider verification');
 perform pg_temp.continuity_check(public.request_crm_handoff(f.property_id,f.old_lead_id,'old-pending-at-upgrade','lumaleasing')->>'state'='legacy_delivery_review_required','uncertain historical lead cannot be replayed');
 perform pg_temp.continuity_check(public.request_crm_handoff(f.property_id,f.linked_lead_id,'old-linked-at-upgrade','lumaleasing')->>'state'='already_linked','historical external ID avoids duplicate registration');
 r:=public.prepare_pending_crm_handoffs(100);
 perform pg_temp.continuity_check(r->>'state'='prepared','pending preparation executes');
 select id into h from public.crm_handoffs where lead_id=f.new_lead_id;
 perform pg_temp.continuity_check(h is not null and (select delivery_contract='existing_lasso' and approved_review_id is null and validation_receipt_id is null from public.crm_handoffs where id=h),'new lead queues with exact historical connection and no invented approval');
 perform public.prepare_pending_crm_handoffs(100);
 perform pg_temp.continuity_check((select count(*)=1 from public.crm_handoffs where lead_id=f.new_lead_id),'repeated preparation creates one request');
 perform pg_temp.continuity_check(not exists(select 1 from public.crm_handoffs where lead_id in(f.old_lead_id,f.linked_lead_id)),'old pending and unchanged old notes are not automatically replayed');
 r:=public.claim_crm_handoff(h);claim:=(r->>'claimId')::uuid;
 perform pg_temp.continuity_check(r->>'deliveryContract'='existing_lasso' and r->'payload'->>'email'='new@example.invalid','worker receives exact saved contract and mapped values');
 perform pg_temp.continuity_check(public.claim_crm_handoff(h)->>'state'='searching','two workers cannot own the same lead');
 perform pg_temp.continuity_check(public.mark_crm_handoff_write(h,claim)->>'state'='write_once','existing write-only provider can submit once');
 perform pg_temp.continuity_check(public.mark_crm_handoff_write(h,claim)->>'state'='sending','repeated write acknowledgment cannot authorize another send');
 perform pg_temp.continuity_check((select result->>'duplicateSearch'='not_supported_by_existing_connection' from public.crm_handoff_receipts where handoff_id=h and stage='write_intent'),'receipt explicitly records no provider duplicate-search capability');
 perform pg_temp.continuity_check(public.finish_crm_handoff(h,claim,'created','new-registrant')->>'deliveryState'='confirmed','completed provider acknowledgment records delivery');
 perform pg_temp.continuity_check((select external_crm_id='new-registrant' and crm_sync_status='created' from public.leads where id=f.new_lead_id),'lead projection and delivery receipt agree');
 update public.leads set crm_sync_status='pending',notes='New follow-up to the older linked conversation' where id=f.linked_lead_id;
 perform public.prepare_pending_crm_handoffs(100);
 select id into h from public.crm_handoffs where lead_id=f.linked_lead_id;
 perform pg_temp.continuity_check((select kind='note' and external_id='existing-registrant' from public.crm_handoffs where id=h),'new follow-up for a legacy linked lead becomes a note, never a second registrant');
 r:=public.claim_crm_handoff(h);claim:=(r->>'claimId')::uuid;perform public.mark_crm_handoff_write(h,claim);
 perform public.finish_crm_handoff(h,claim,'note_added','existing-registrant','new-note');perform public.prepare_pending_crm_handoffs(100);
 perform pg_temp.continuity_check((select count(*)=1 from public.crm_handoffs where lead_id=f.linked_lead_id),'unchanged saved note is not replayed by cron');
 update public.leads set external_crm_id='unreviewed-destination' where id=f.linked_lead_id;
 perform pg_temp.continuity_check(public.request_crm_handoff(f.property_id,f.linked_lead_id,'tampered-historical-link','lumaleasing',null,'Another note')->>'state'='legacy_link_review_required','legacy note destination must match the captured link');
 update public.leads set external_crm_id='existing-registrant' where id=f.linked_lead_id;
 insert into public.leads(id,property_id,email,crm_sync_status)values(another,f.property_id,'NEW@example.invalid','pending');
 perform pg_temp.continuity_check(public.request_crm_handoff(f.property_id,another,'same-contact-new-row','lumaleasing')->>'state'='existing_contact_review_required','new local row cannot duplicate a known delivered email');
 perform public.prepare_pending_crm_handoffs(100);
 perform pg_temp.continuity_check((select crm_sync_status='dead_lettered' from public.leads where id=another),'duplicate-contact hold is visible in lead review and cannot starve the queue');
 insert into public.leads(id,property_id,email,crm_sync_status)values(changed,f.property_id,'changed@example.invalid','pending');
 r:=public.request_crm_handoff(f.property_id,changed,'source-before-change','lumaleasing');h:=(r->>'handoffId')::uuid;
 update public.leads set email='corrected@example.invalid' where id=changed;
 perform pg_temp.continuity_check(public.claim_crm_handoff(h)->>'state'='stale','changed lead values stop an old saved payload');
 update public.integration_credentials set last_sync_at=clock_timestamp() where id=f.integration_id;
 perform pg_temp.continuity_check(public.crm_existing_connection_ready(f.integration_id,1,public.crm_configuration_hash((select credentials from public.integration_credentials where id=f.integration_id))),'ordinary connection metadata can update without a new login');
 update public.integration_credentials set credentials=credentials||'{"api_key":"changed-synthetic"}' where id=f.integration_id;
 perform pg_temp.continuity_check((select status='pending' and not mapping_validated from public.integration_credentials where id=f.integration_id),'credential changes require a new review');
 perform pg_temp.continuity_check(public.request_crm_handoff(f.property_id,changed,'after-credential-change','lumaleasing')->>'state'='qualification_required','cutover authority cannot survive changed credentials');
 perform pg_temp.continuity_check(not has_function_privilege('authenticated','public.prepare_pending_crm_handoffs(integer)','execute') and not has_function_privilege('anon','public.crm_existing_connection_ready(uuid,bigint,text)','execute'),'browser roles cannot prepare or claim continuity');
 perform pg_temp.continuity_check(not has_table_privilege('authenticated','public.crm_existing_connections','select') and not has_table_privilege('anon','public.crm_upgrade_leads','select'),'continuity and historical lead evidence are private');
end$$;
select count(*) as continuity_assertions from continuity_checks;
rollback;
