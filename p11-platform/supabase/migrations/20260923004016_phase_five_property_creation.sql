
create table public.property_creation_requests (
 id uuid primary key,
 property_id uuid not null unique references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),
 input jsonb not null,
 template_snapshot jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create index property_creation_org on public.property_creation_requests(org_id);
create index property_creation_actor on public.property_creation_requests(actor_id);
alter table public.property_creation_requests enable row level security;
revoke all on public.property_creation_requests from public,anon,authenticated;
grant all on public.property_creation_requests to service_role;
create policy property_creation_service on public.property_creation_requests for all to service_role using(true)with check(true);
create trigger property_creation_immutable before update or delete on public.property_creation_requests for each row execute function public.guard_siteforge_brief_history();


create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action in('property.setup.saved','property.created','property.onboarding.completed') then
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
 origin:=case when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create or replace function public.save_property_setup(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_role text;v_property public.properties;v_saved public.property_setup_changes;v_before jsonb;v_after jsonb;v_hash text;v_after_hash text;v_profile jsonb;v_contact jsonb;v_request jsonb;v_event jsonb;v_sections jsonb:='[]';v_invalidated boolean:=false;v_now timestamptz:=clock_timestamp();v_key text;v_value jsonb;v_contact_id uuid;v_action text:='property.setup.saved';v_complete boolean:=false;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if v_org is null or not coalesce(v_role in('admin','manager'),false)then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object' or p_input-array['expectedHash','profile','contacts','connectionRequests','reason','completeOnboarding']<>'{}' or not(p_input?&array['expectedHash','profile','contacts','connectionRequests','reason'])or octet_length(p_input::text)>524288 or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 or coalesce(p_input->>'expectedHash','')!~'^[a-f0-9]{64}$'then raise exception 'Invalid property edit';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select *into v_property from public.properties where id=p_property_id and org_id=v_org for update;
 if not found or not exists(select 1 from public.profiles where id=p_actor_id and org_id=v_org and role in('admin','manager'))then return '{"state":"forbidden"}';end if;
 -- Serialize identical identities across properties too, then recheck saved scope.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,852));
 select *into v_saved from public.property_setup_changes where id=p_id;
 if found then
  if(v_saved.property_id,v_saved.org_id,v_saved.actor_id,v_saved.input)is distinct from(p_property_id,v_org,p_actor_id,p_input)then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','id',v_saved.id,'afterHash',v_saved.after_hash,'contextInvalidated',v_saved.context_invalidated,'setupCompleted',coalesce((v_saved.input->>'completeOnboarding')::boolean,false),'changedSections',v_saved.changed_sections);
 end if;
 perform 1 from public.property_contacts where property_id=p_property_id for update;
 if p_input?'completeOnboarding'and jsonb_typeof(p_input->'completeOnboarding')is distinct from'boolean'then raise exception 'Invalid setup completion decision';end if;
 v_complete:=coalesce((p_input->>'completeOnboarding')::boolean,false);
 if v_complete and v_property.onboarding_completed_at is not null then return '{"state":"already_completed"}';end if;
 v_before:=public.property_edit_snapshot(p_property_id);v_hash:=encode(extensions.digest(v_before::text,'sha256'),'hex');
 if v_hash<>p_input->>'expectedHash'then return '{"state":"source_changed"}';end if;
 v_profile:=p_input->'profile';
 if jsonb_typeof(v_profile)is distinct from'object'or v_profile-array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience']<>'{}' or not(v_profile?&array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience'])then raise exception 'Invalid property facts';end if;
 foreach v_key in array array['name','websiteUrl','brandVoice','targetAudience']loop
  if jsonb_typeof(v_profile->v_key)is distinct from'string'or length(v_profile->>v_key)>(case when v_key='name'then 300 else 4000 end) then raise exception 'Invalid property text';end if;
 end loop;
 if length(btrim(v_profile->>'name'))<1 then raise exception 'Property name is required';end if;
 if v_profile->'propertyType'<>'null'::jsonb and (jsonb_typeof(v_profile->'propertyType')is distinct from'string'or(v_profile->>'propertyType'not in('multifamily','senior','student','mixed_use','affordable','luxury','townhome','condo','single_family','master_planned')and v_profile->'propertyType'is distinct from v_before->'profile'->'propertyType'))then raise exception 'Select a supported property classification';end if;
 foreach v_key in array array['unitCount','yearBuilt']loop
  if v_profile->v_key<>'null'::jsonb and (jsonb_typeof(v_profile->v_key)is distinct from'number'or(v_profile->>v_key)!~'^\d+$'or(v_profile->>v_key)::numeric>(case when v_key='unitCount'then 1000000 else 9999 end) or(v_key='yearBuilt'and(v_profile->>v_key)::numeric<1))then raise exception 'Use a whole nonnegative unit count and a valid year';end if;
 end loop;
 if jsonb_typeof(v_profile->'address')is distinct from'object'or (v_profile->'address')-array['street','city','state','zip']<>'{}'or not(v_profile->'address'?&array['street','city','state','zip'])then raise exception 'Invalid property address';end if;
 for v_key,v_value in select *from jsonb_each(v_profile->'address')loop if jsonb_typeof(v_value)is distinct from'string'or length(v_value#>>'{}')>500 then raise exception 'Invalid property address';end if;end loop;
 foreach v_key in array array['additionalUrls','amenities','specialFeatures']loop
  if jsonb_typeof(v_profile->v_key)is distinct from'array'or jsonb_array_length(v_profile->v_key)>(case when v_key='additionalUrls'then 50 else 200 end) then raise exception 'Property list exceeds its supported size';end if;
  for v_value in select value from jsonb_array_elements(v_profile->v_key)loop if jsonb_typeof(v_value)is distinct from'string'or length(btrim(v_value#>>'{}'))not between 1 and 4000 then raise exception 'Invalid property list';end if;end loop;
 end loop;
 -- These are stored references only; no URL is fetched by this operation.
 for v_value in select value from jsonb_array_elements((v_profile->'additionalUrls')||jsonb_build_array(v_profile->>'websiteUrl'))loop
  if(v_value#>>'{}')<>''and(v_value#>>'{}')!~'^https?://[^[:space:]@]+$'then raise exception 'Use an HTTP or HTTPS website address without embedded credentials';end if;
 end loop;
 if jsonb_typeof(p_input->'contacts')is distinct from'array'or jsonb_array_length(p_input->'contacts')>100 then raise exception 'Edit at most 100 contacts in one property save';end if;
 if(select count(*)<>count(distinct c->>'id')from jsonb_array_elements(p_input->'contacts')c)then raise exception 'Contact identities must be unique';end if;
 if(select count(*)>1 from jsonb_array_elements(p_input->'contacts')c where c->>'type'='primary'or c->'isPrimary'='true')then raise exception 'Choose at most one primary contact';end if;
 for v_contact in select value from jsonb_array_elements(p_input->'contacts')loop
  if jsonb_typeof(v_contact)is distinct from'object'or v_contact-array['id','type','name','email','phone','role','billingAddress','billingMethod','specialInstructions','needsW9','isPrimary']<>'{}'or not(v_contact?&array['id','type','name','email','phone','role','billingAddress','billingMethod','specialInstructions','needsW9','isPrimary'])then raise exception 'Invalid contact';end if;
  v_contact_id:=(v_contact->>'id')::uuid;
  if v_contact_id is null or exists(select 1 from public.property_contacts c where c.id=v_contact_id and c.property_id<>p_property_id)then return '{"state":"contact_conflict"}';end if;
  if v_contact->>'type'not in('primary','secondary','billing','emergency')or jsonb_typeof(v_contact->'needsW9')is distinct from'boolean'or jsonb_typeof(v_contact->'isPrimary')is distinct from'boolean'then raise exception 'Invalid contact type';end if;
  foreach v_key in array array['name','email','phone','role','billingMethod','specialInstructions']loop
   if jsonb_typeof(v_contact->v_key)is distinct from'string'or length(v_contact->>v_key)>(case when v_key='specialInstructions'then 4000 else 500 end) then raise exception 'Invalid contact details';end if;
  end loop;
  if length(btrim(v_contact->>'name'))<1 or v_contact->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then raise exception 'Each contact needs a name and email address';end if;
  if v_contact->>'billingMethod'not in('','ops_merchant','nexus','ach','check','credit_card','other')then raise exception 'Invalid billing method';end if;
  if jsonb_typeof(v_contact->'billingAddress')is distinct from'object'or (v_contact->'billingAddress')-array['street','city','state','zip']<>'{}'or not(v_contact->'billingAddress'?&array['street','city','state','zip'])then raise exception 'Invalid billing address';end if;
  for v_key,v_value in select *from jsonb_each(v_contact->'billingAddress')loop if jsonb_typeof(v_value)is distinct from'string'or length(v_value#>>'{}')>500 then raise exception 'Invalid billing address';end if;end loop;
 end loop;
 if jsonb_typeof(p_input->'connectionRequests')is distinct from'array'or jsonb_array_length(p_input->'connectionRequests')>11 then raise exception 'Invalid connection requests';end if;
 if(select count(*)<>count(distinct x->>'platform')from jsonb_array_elements(p_input->'connectionRequests')x)then raise exception 'Connection requests must be unique';end if;
 for v_request in select value from jsonb_array_elements(p_input->'connectionRequests')loop
  if jsonb_typeof(v_request)is distinct from'object'or v_request-array['platform','accountId','accountName','notes']<>'{}'or not(v_request?&array['platform','accountId','accountName','notes'])or v_request->>'platform'not in('google_analytics','google_search_console','google_tag_manager','google_ads','google_business_profile','meta_ads','linkedin_ads','tiktok_ads','email_marketing','crm','pms')then raise exception 'Invalid connection request';end if;
  foreach v_key in array array['platform','accountId','accountName','notes']loop if jsonb_typeof(v_request->v_key)is distinct from'string'or length(v_request->>v_key)>(case when v_key='notes'then 4000 else 500 end) then raise exception 'Invalid connection request details';end if;end loop;
 end loop;
 if v_complete and not exists(select 1 from jsonb_array_elements(p_input->'contacts')c where c->>'type'='primary')then raise exception 'A primary contact is required to complete setup';end if;
 perform set_config('p11.property_setup_scope',p_property_id::text,true);
 update public.properties set name=btrim(v_profile->>'name'),property_type=v_profile->>'propertyType',address=coalesce(address,'{}')||(v_profile->'address'),website_url=nullif(v_profile->>'websiteUrl',''),unit_count=(v_profile->>'unitCount')::integer,year_built=(v_profile->>'yearBuilt')::integer,
 amenities=array(select jsonb_array_elements_text(v_profile->'amenities')),special_features=array(select jsonb_array_elements_text(v_profile->'specialFeatures')),brand_voice=nullif(v_profile->>'brandVoice',''),target_audience=nullif(v_profile->>'targetAudience',''),settings=coalesce(settings,'{}')||jsonb_build_object('additionalUrls',v_profile->'additionalUrls','city',v_profile->'address'->>'city'),updated_at=v_now where id=p_property_id;
 delete from public.property_contacts c where c.property_id=p_property_id and not exists(select 1 from jsonb_array_elements(p_input->'contacts')x where(x->>'id')::uuid=c.id);
 for v_contact in select value from jsonb_array_elements(p_input->'contacts')loop
  insert into public.property_contacts(id,property_id,contact_type,name,email,phone,role,billing_address,billing_method,special_instructions,needs_w9,is_primary,updated_at)
  values((v_contact->>'id')::uuid,p_property_id,v_contact->>'type',v_contact->>'name',v_contact->>'email',nullif(v_contact->>'phone',''),nullif(v_contact->>'role',''),v_contact->'billingAddress',nullif(v_contact->>'billingMethod',''),nullif(v_contact->>'specialInstructions',''),(v_contact->>'needsW9')::boolean,(v_contact->>'isPrimary')::boolean,v_now)
  on conflict(id)do update set contact_type=excluded.contact_type,name=excluded.name,email=excluded.email,phone=excluded.phone,role=excluded.role,billing_address=coalesce(public.property_contacts.billing_address,'{}')||excluded.billing_address,billing_method=excluded.billing_method,special_instructions=excluded.special_instructions,needs_w9=excluded.needs_w9,is_primary=excluded.is_primary,updated_at=excluded.updated_at where public.property_contacts.property_id=p_property_id;
 end loop;
 insert into public.property_setup_state(property_id,org_id,connection_requests,updated_at)values(p_property_id,v_org,p_input->'connectionRequests',v_now)on conflict(property_id)do update set connection_requests=excluded.connection_requests,org_id=excluded.org_id,updated_at=excluded.updated_at;
 v_after:=public.property_edit_snapshot(p_property_id);v_after_hash:=encode(extensions.digest(v_after::text,'sha256'),'hex');
 foreach v_key in array array['profile','contacts','connectionRequests']loop if v_before->v_key is distinct from v_after->v_key then v_sections:=v_sections||jsonb_build_array(v_key);end if;end loop;
 if v_before->'profile'is distinct from v_after->'profile'or v_before->'contextCity'is distinct from v_after->'contextCity'then
  update public.property_chatbot_contexts set status='stale',stale_at=v_now,last_change_summary='Saved property facts changed; refresh assistant facts before serving the new version.',version=version+1,updated_at=v_now where property_id=p_property_id;
  v_invalidated:=found;
 end if;
 if exists(select 1 from public.property_creation_requests r where r.id=p_id and r.property_id=p_property_id and r.actor_id=p_actor_id and r.org_id=v_org)then v_action:='property.created';end if;
 if v_complete then
  v_action:='property.onboarding.completed';v_sections:=v_sections||jsonb_build_array('setup');
  update public.properties set onboarding_completed_at=clock_timestamp()where id=p_property_id;
  update public.onboarding_tasks set status='completed',completed_at=clock_timestamp()where property_id=p_property_id and task_name in('Complete community details','Add contact information')and status is distinct from'completed';
 end if;
 insert into public.property_setup_changes(id,property_id,org_id,actor_id,input,before_state,after_state,before_hash,after_hash,changed_sections,context_invalidated)values(p_id,p_property_id,v_org,p_actor_id,p_input,v_before,v_after,v_hash,v_after_hash,v_sections,v_invalidated);
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property',v_action,'server_confirmed','succeeded',jsonb_build_object('changeId',p_id,'inputHash',encode(extensions.digest(p_input::text,'sha256'),'hex')),jsonb_build_object('hash',v_hash),jsonb_build_object('hash',v_after_hash),jsonb_build_object('changedSections',v_sections,'setupCompleted',v_complete,'contextInvalidated',v_invalidated,'connectionsActivated',false,'websiteFetched',false));
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Could not record property change';end if;
 perform set_config('p11.property_setup_scope','',true);
 return jsonb_build_object('state','saved','id',p_id,'afterHash',v_after_hash,'contextInvalidated',v_invalidated,'setupCompleted',v_complete,'changedSections',v_sections);
end$$;
create or replace function public.read_property_setup(p_property_id uuid,p_actor_id uuid,p_cursor uuid default null,p_change_id uuid default null)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_role text;v_snapshot jsonb;v_cursor bigint;v_rows jsonb;v_selected jsonb;v_next uuid;v_property jsonb;v_connections jsonb;v_context jsonb;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id for share of p,u;
 if v_org is null then return '{"state":"forbidden"}';end if;
 v_snapshot:=public.property_edit_snapshot(p_property_id);
 if octet_length(v_snapshot::text)>5242880 then raise exception 'Property setup is too large to read safely';end if;
 if p_cursor is not null then select change_sequence into v_cursor from public.property_setup_changes where id=p_cursor and property_id=p_property_id and org_id=v_org;if not found then return '{"state":"cursor_changed"}';end if;end if;
 with page as(select c.* from public.property_setup_changes c where c.property_id=p_property_id and c.org_id=v_org and(v_cursor is null or c.change_sequence<v_cursor)order by c.change_sequence desc limit 21)
 select coalesce(jsonb_agg(jsonb_build_object('kind',case when exists(select 1 from public.property_creation_requests r where r.id=x.id)then 'created'when x.input->'completeOnboarding'='true'then 'setup_completed'else 'edited'end,'id',x.id,'actorId',x.actor_id,'actorName',u.full_name,'createdAt',x.created_at,'reason',x.input->>'reason','changedSections',x.changed_sections,'contextInvalidated',x.context_invalidated)order by x.change_sequence desc)filter(where x.n<=20),'[]'::jsonb),(array_agg(x.id order by x.change_sequence desc))[20] into v_rows,v_next from(select page.*,row_number()over(order by change_sequence desc)n from page)x left join public.profiles u on u.id=x.actor_id;
 if jsonb_array_length(v_rows)<20 or not exists(select 1 from public.property_setup_changes where property_id=p_property_id and org_id=v_org and change_sequence<(select change_sequence from public.property_setup_changes where id=v_next))then v_next:=null;end if;
 if p_change_id is not null then select jsonb_build_object('kind',case when exists(select 1 from public.property_creation_requests r where r.id=c.id)then 'created'when c.input->'completeOnboarding'='true'then 'setup_completed'else 'edited'end,'id',c.id,'actorId',c.actor_id,'actorName',u.full_name,'createdAt',c.created_at,'reason',c.input->>'reason','changedSections',c.changed_sections,'before',c.before_state,'after',c.after_state,'beforeHash',c.before_hash,'afterHash',c.after_hash,'contextInvalidated',c.context_invalidated)into v_selected from public.property_setup_changes c left join public.profiles u on u.id=c.actor_id where c.id=p_change_id and c.property_id=p_property_id and c.org_id=v_org;if not found then return '{"state":"not_found"}';end if;end if;
 select jsonb_build_object('id',p.id,'name',p.name,'org_id',p.org_id,'address',p.address,'property_type',p.property_type,'website_url',p.website_url,'unit_count',p.unit_count,'year_built',p.year_built,'amenities',p.amenities,'pet_policy',p.pet_policy,'parking_info',p.parking_info,'special_features',p.special_features,'brand_voice',p.brand_voice,'target_audience',p.target_audience,'office_hours',p.office_hours,'social_media',p.social_media,'created_at',p.created_at,'onboarding_completed_at',p.onboarding_completed_at,'settings',jsonb_build_object('additionalUrls',p.settings->'additionalUrls','brand_insights',p.settings->'brand_insights'))into v_property from public.properties p where p.id=p_property_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'platform',i.platform,'status',i.status,'account_id',i.account_id,'account_name',i.account_name,'notes',i.notes)order by i.platform,i.id),'[]'::jsonb)into v_connections from public.integration_credentials i where i.property_id=p_property_id;
 select jsonb_build_object('status',c.status,'requiresReview',c.requires_review,'lastGeneratedAt',c.last_generated_at,'changeSummary',c.last_change_summary)into v_context from public.property_chatbot_contexts c where c.property_id=p_property_id;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canEdit',coalesce(v_role in('admin','manager'),false),'snapshot',v_snapshot-'contextCity','snapshotHash',encode(extensions.digest(v_snapshot::text,'sha256'),'hex'),'property',v_property,'connections',v_connections,'context',v_context,'changes',v_rows,'nextCursor',v_next,'total',(select count(*)from public.property_setup_changes where property_id=p_property_id and org_id=v_org),'selected',v_selected);
end$$;
create function public.read_property_creation_template(p_source_property uuid,p_actor_id uuid,p_flags jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_name text;v_snapshot jsonb;v_contacts jsonb;v_plans jsonb;v_guidance jsonb;
begin
 select p.org_id,p.name into v_org,v_name from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_source_property and u.id=p_actor_id and u.role in('admin','manager')for share of p,u;
 if v_org is null then return '{"state":"forbidden"}';end if;
 if jsonb_typeof(p_flags)is distinct from'object'or p_flags-array['contacts','connections','guidance']<>'{}'or not(p_flags?&array['contacts','connections','guidance'])or exists(select 1 from jsonb_each(p_flags)f where jsonb_typeof(f.value)<>'boolean')then raise exception 'Choose the exact template sections to review';end if;
 v_contacts:=case when(p_flags->>'contacts')::boolean then public.property_edit_snapshot(p_source_property)->'contacts'else '[]'::jsonb end;
 if jsonb_array_length(v_contacts)>100 then raise exception 'This source has more than 100 contacts; choose a smaller reviewed source';end if;
 v_plans:='[]';
 if(p_flags->>'connections')::boolean then
  -- Include the intended services, never an account, credential, token or connection status.
  with platforms as(select i.platform from public.integration_credentials i where i.property_id=p_source_property union select x->>'platform'from public.property_setup_state s cross join lateral jsonb_array_elements(s.connection_requests)x where s.property_id=p_source_property and s.org_id=v_org)
  select coalesce(jsonb_agg(jsonb_build_object('platform',platform,'accountId','','accountName','','notes','')order by platform),'[]')into v_plans from platforms;
  if exists(select 1 from jsonb_array_elements(v_plans)x where x->>'platform'not in('google_analytics','google_search_console','google_tag_manager','google_ads','google_business_profile','meta_ads','linkedin_ads','tiktok_ads','email_marketing','crm','pms'))then return '{"state":"unsupported_connections"}';end if;
 end if;
 v_guidance:=null;
 if(p_flags->>'guidance')::boolean then select jsonb_build_object('brandVoice',coalesce(brand_voice,''),'targetAudience',coalesce(target_audience,''),'petPolicy',pet_policy,'parkingInfo',parking_info,'officeHours',office_hours)into v_guidance from public.properties where id=p_source_property;end if;
 v_snapshot:=jsonb_build_object('sourcePropertyId',p_source_property,'sourceName',v_name,'flags',p_flags,'contacts',v_contacts,'connectionRequests',v_plans,'guidance',v_guidance);
 if octet_length(v_snapshot::text)>524288 then raise exception 'This template is too large to review in one creation request';end if;
 return jsonb_build_object('state','ready','sourceId',p_source_property,'snapshot',v_snapshot,'snapshotHash',encode(extensions.digest(v_snapshot::text,'sha256'),'hex'));
end$$;

create function public.read_property_creation(p_id uuid,p_actor_id uuid)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.property_creation_requests;v_workspace jsonb;v_org uuid;
begin
 select u.org_id into v_org from public.profiles u where u.id=p_actor_id and u.role in('admin','manager')for share;
 if v_org is null then return '{"state":"forbidden"}';end if;
 select *into v_request from public.property_creation_requests where id=p_id and actor_id=p_actor_id and org_id=v_org;
 if not found then return '{"state":"not_found"}';end if;
 v_workspace:=public.read_property_setup(v_request.property_id,p_actor_id);
 if v_workspace->>'state'<>'ready'then return '{"state":"forbidden"}';end if;
 return jsonb_build_object('state','ready','requestId',p_id,'propertyId',v_request.property_id,'property',v_workspace->'property','snapshot',v_workspace->'snapshot','snapshotHash',v_workspace->>'snapshotHash','template',v_request.template_snapshot,'createdAt',v_request.created_at);
end$$;

create function public.create_property_from_setup(p_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_request public.property_creation_requests;v_source jsonb;v_template jsonb;v_profile jsonb;v_contacts jsonb:='[]';v_plans jsonb:='[]';v_guidance jsonb;v_snapshot jsonb;v_result jsonb;v_save jsonb;v_now timestamptz:=clock_timestamp();
begin
 select org_id into v_org from public.profiles where id=p_actor_id and role in('admin','manager')for share;
 if v_org is null then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or p_input-array['profile','template']<>'{}'or not(p_input?&array['profile','template'])or octet_length(p_input::text)>524288 then raise exception 'Invalid property creation request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,853));
 select *into v_request from public.property_creation_requests where id=p_id;
 if found then
  if(v_request.org_id,v_request.actor_id,v_request.input)is distinct from(v_org,p_actor_id,p_input)then return '{"state":"request_conflict"}';end if;
  v_result:=public.read_property_creation(p_id,p_actor_id);
  if v_result->>'state'<>'ready'then return v_result;end if;
  return v_result||'{"state":"replayed"}';
 end if;
 if exists(select 1 from public.properties where id=p_id)then return '{"state":"request_conflict"}';end if;
 v_profile:=p_input->'profile';v_template:=p_input->'template';
 if v_template is distinct from'null'::jsonb then
  if jsonb_typeof(v_template)is distinct from'object'or v_template-array['sourceId','snapshotHash','flags','guidanceConfirmed']<>'{}'or not(v_template?&array['sourceId','snapshotHash','flags','guidanceConfirmed'])or jsonb_typeof(v_template->'guidanceConfirmed')is distinct from'boolean'then raise exception 'Review the template before creating this property';end if;
  if(v_template->'flags'->>'guidance')::boolean and v_template->'guidanceConfirmed'<>'true'then raise exception 'Confirm copied guidance applies to this new property';end if;
  v_source:=public.read_property_creation_template((v_template->>'sourceId')::uuid,p_actor_id,v_template->'flags');
  if v_source->>'state'<>'ready'then return v_source;end if;
  if v_source->>'snapshotHash'is distinct from v_template->>'snapshotHash'then return '{"state":"template_changed"}';end if;
  v_contacts:=coalesce((select jsonb_agg(x||jsonb_build_object('id',gen_random_uuid())order by x->>'id')from jsonb_array_elements(v_source->'snapshot'->'contacts')x),'[]');
  v_plans:=v_source->'snapshot'->'connectionRequests';v_guidance:=v_source->'snapshot'->'guidance';
  if v_guidance is distinct from'null'::jsonb then v_profile:=v_profile||jsonb_build_object('brandVoice',v_guidance->>'brandVoice','targetAudience',v_guidance->>'targetAudience');end if;
 end if;
 insert into public.properties(id,org_id,name,settings,pet_policy,parking_info,office_hours)values(p_id,v_org,v_profile->>'name','{}',v_guidance->'petPolicy',v_guidance->'parkingInfo',v_guidance->'officeHours');
 insert into public.property_creation_requests(id,property_id,org_id,actor_id,input,template_snapshot)values(p_id,p_id,v_org,p_actor_id,p_input,v_source->'snapshot');
 v_snapshot:=public.property_edit_snapshot(p_id);
 v_save:=public.save_property_setup(p_id,p_id,p_actor_id,jsonb_build_object('expectedHash',encode(extensions.digest(v_snapshot::text,'sha256'),'hex'),'profile',v_profile,'contacts',v_contacts,'connectionRequests',v_plans,'reason','Create the property from reviewed setup details'));
 if v_save->>'state'<>'saved'then raise exception 'Could not save the complete property creation';end if;
 perform public.create_default_onboarding_tasks(p_id);
 v_result:=public.read_property_creation(p_id,p_actor_id);
 if v_result->>'state'<>'ready'then raise exception 'Could not confirm created property';end if;
 return v_result||'{"state":"created"}';
end$$;
revoke all on function public.read_property_creation_template(uuid,uuid,jsonb),public.read_property_creation(uuid,uuid),public.create_property_from_setup(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_property_creation_template(uuid,uuid,jsonb),public.read_property_creation(uuid,uuid),public.create_property_from_setup(uuid,uuid,jsonb)to service_role;
