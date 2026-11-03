-- Shared intake and private resumable drafts. No provider authorization or publication.
-- Keep the current public save wrapper and its community access check intact.
DO $$BEGIN
 IF to_regprocedure('public._brain_save_property_setup(uuid,uuid,uuid,jsonb)') IS NULL
 OR to_regprocedure('public.brain_grant_property_creator()') IS NULL THEN
  RAISE EXCEPTION 'Apply current Community Brain access migrations before onboarding intake';
 END IF;
END $$;
CREATE TABLE public.property_onboarding_drafts (
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK (revision > 0), draft jsonb NOT NULL,
 base_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(property_id,actor_id)
);
CREATE TABLE public.property_onboarding_draft_receipts (
 id uuid PRIMARY KEY, property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 input_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.property_onboarding_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_onboarding_draft_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_onboarding_drafts,public.property_onboarding_draft_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.property_onboarding_drafts,public.property_onboarding_draft_receipts TO service_role;
CREATE POLICY onboarding_drafts_service ON public.property_onboarding_drafts FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY onboarding_draft_receipts_service ON public.property_onboarding_draft_receipts FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX onboarding_draft_receipts_property ON public.property_onboarding_draft_receipts(property_id,actor_id);

CREATE OR REPLACE FUNCTION public.property_onboarding_draft(p_property_id uuid,p_actor_id uuid,p_input jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.property_onboarding_drafts;r public.property_onboarding_draft_receipts;v_result jsonb;v_id uuid;
BEGIN
 IF NOT public.brain_can(p_actor_id,p_property_id,'manage') OR NOT EXISTS(SELECT 1 FROM public.properties p JOIN public.profiles u ON u.org_id=p.org_id WHERE p.id=p_property_id AND u.id=p_actor_id AND u.role IN('admin','manager')) THEN RETURN '{"state":"forbidden"}';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 SELECT * INTO d FROM public.property_onboarding_drafts WHERE property_id=p_property_id AND actor_id=p_actor_id FOR UPDATE;
 IF p_input IS NULL THEN RETURN jsonb_build_object('state','ready','revision',coalesce(d.revision,0),'draft',d.draft,'baseHash',d.base_hash);END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input-array['requestId','expectedRevision','baseHash','draft']<>'{}' OR octet_length(p_input::text)>262144 OR coalesce(p_input->>'baseHash','')!~'^[a-f0-9]{64}$' OR coalesce(p_input->>'expectedRevision','')!~'^[0-9]{1,9}$' OR jsonb_typeof(p_input->'draft') IS DISTINCT FROM 'object' OR p_input->'draft'->>'step' NOT IN('community','contacts','integrations','knowledge','review') THEN RAISE EXCEPTION 'Invalid bounded onboarding draft';END IF;
 v_id:=(p_input->>'requestId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text,928));
 SELECT * INTO r FROM public.property_onboarding_draft_receipts WHERE id=v_id;
 IF FOUND THEN IF (r.property_id,r.actor_id,r.input_hash) IS DISTINCT FROM(p_property_id,p_actor_id,public.knowledge_hash(p_input)) THEN RETURN '{"state":"conflict"}';END IF;RETURN r.result;END IF;
 IF EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND onboarding_completed_at IS NOT NULL) THEN RETURN '{"state":"completed"}';END IF;
 IF coalesce(d.revision,0)<>(p_input->>'expectedRevision')::integer THEN RETURN '{"state":"changed"}';END IF;
 IF public.knowledge_hash(public.property_edit_snapshot(p_property_id))<>p_input->>'baseHash' THEN RETURN '{"state":"property_changed"}';END IF;
 INSERT INTO public.property_onboarding_drafts(property_id,actor_id,revision,draft,base_hash)VALUES(p_property_id,p_actor_id,1,p_input->'draft',p_input->>'baseHash')
 ON CONFLICT(property_id,actor_id) DO UPDATE SET revision=property_onboarding_drafts.revision+1,draft=excluded.draft,base_hash=excluded.base_hash,updated_at=clock_timestamp() RETURNING * INTO d;
 v_result:=jsonb_build_object('state','saved','requestId',v_id,'revision',d.revision,'draft',d.draft,'baseHash',d.base_hash);
 INSERT INTO public.property_onboarding_draft_receipts(id,property_id,actor_id,input_hash,result)VALUES(v_id,p_property_id,p_actor_id,public.knowledge_hash(p_input),v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.property_onboarding_draft(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.property_onboarding_draft(uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.validate_onboarding_intake(v jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k text;s jsonb;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->'version' IS DISTINCT FROM '1'::jsonb OR octet_length(v::text)>65536 OR jsonb_typeof(v->'products') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'products')>7 OR jsonb_typeof(v->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'sources')>20 THEN RAISE EXCEPTION 'Invalid onboarding intake';END IF;
 IF v-array['version','subjectKind','scope','sector','transaction','lifecycle','offeringKind','primaryIntent','country','timezone','canonicalName','aliases','ownershipEntity','managementCompany','market','submarket','products','setupOwner','launchTarget','successMetric','successTarget','publicContact','tourUrl','applicationUrl','officeHours','brandMode','brandVoice','audience','legalEntity','jurisdiction','reviewer','sources']<>'{}' THEN RAISE EXCEPTION 'Unsupported intake field';END IF;
 FOR k IN SELECT jsonb_object_keys(v-array['version','products','publicContact','sources']) LOOP IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR length(v->>k)>2000 THEN RAISE EXCEPTION 'Invalid intake text';END IF;END LOOP;
 IF coalesce(v->>'timezone','')<>'' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=v->>'timezone') THEN RAISE EXCEPTION 'Choose a valid property timezone';END IF;
 IF jsonb_typeof(v->'publicContact') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'publicContact'->'confirmed') IS DISTINCT FROM 'boolean' OR (v->'publicContact'->'confirmed'='true' AND (coalesce(v->'publicContact'->>'phone','')='' OR coalesce(v->'publicContact'->>'email','')!~'^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')) THEN RAISE EXCEPTION 'Review the public contact before confirming use';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(v->'products') LOOP IF s#>>'{}' NOT IN('website','leads','messaging','creative','intelligence','reviews','reporting') THEN RAISE EXCEPTION 'Unsupported setup product';END IF;END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(v->'sources') LOOP IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR s->>'kind' NOT IN('website','document','google_drive','dropbox','pms','csv','manual','brand') OR s->>'visibility' NOT IN('internal','portal','public') THEN RAISE EXCEPTION 'Invalid source plan';END IF;END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.validate_onboarding_intake(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_onboarding_intake(jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.sync_property_setup_tasks(p_property_id uuid,p_actor_id uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.properties;i jsonb;plans jsonb;t jsonb;v_id uuid;v_org uuid;v_before jsonb;v_tasks jsonb;v_keys text[];existing record;result jsonb;v_metadata jsonb;
BEGIN
 SELECT * INTO p FROM public.properties WHERE id=p_property_id FOR UPDATE;i:=p.settings->'onboarding';IF i IS NULL THEN RETURN;END IF;v_org:=p.org_id;
 SELECT coalesce(connection_requests,'[]') INTO plans FROM public.property_setup_state WHERE property_id=p_property_id;
 v_tasks:='[
 {"key":"details","name":"Complete community details","href":"edit","category":"setup","type":"intake_form","priority":100},
 {"key":"contacts","name":"Add contact information","href":"edit#contacts","category":"setup","type":"intake_form","priority":99},
 {"key":"classification","name":"Review property purpose and classification","href":"edit","category":"setup","priority":98},
 {"key":"public_contact","name":"Confirm public contact and conversion details","href":"edit","category":"setup","priority":97},
 {"key":"sources","name":"Review authoritative sources and property facts","href":"/dashboard/community?section=knowledge","category":"documents","priority":96}]';
 IF i->'products'?|array['website','creative'] THEN v_tasks:=v_tasks||'[{"key":"brand","name":"Review brand and asset rights","href":"/dashboard/community?section=files","category":"setup","priority":94}]';END IF;
 IF i->'products'?'website' THEN v_tasks:=v_tasks||'[{"key":"inventory","name":"Review floor plans or offering inventory","href":"/dashboard/floor-plans","category":"setup","priority":92}]';END IF;
 IF i->'products'?|array['website','leads','messaging'] THEN v_tasks:=v_tasks||'[{"key":"legal","name":"Review legal statements and consent","href":"/dashboard/community?section=checklist#legal-review","category":"setup","priority":95}]';END IF;
 IF i->'products'?'leads' THEN v_tasks:=v_tasks||'[{"key":"tours","name":"Set up timezone, calendar and tour routing","href":"/dashboard/leads","category":"integrations","priority":88}]';END IF;
 IF i->'products'?'messaging' THEN v_tasks:=v_tasks||'[{"key":"messaging","name":"Review conversation knowledge and handoffs","href":"/dashboard/lumaleasing","category":"setup","priority":87}]';END IF;
 IF i->'products'?|array['intelligence','reporting'] THEN v_tasks:=v_tasks||'[{"key":"measurement","name":"Set reporting goals, sources and baseline coverage","href":"/dashboard/intelligence","category":"setup","priority":86}]';END IF;
 IF i->'products'?'reviews' THEN v_tasks:=v_tasks||'[{"key":"reviews","name":"Confirm business profile and review response rules","href":"/dashboard/reviewflow","category":"setup","priority":85}]';END IF;
 IF jsonb_array_length(i->'products')>0 THEN v_tasks:=v_tasks||'[{"key":"readiness","name":"Review readiness for selected products","href":"/dashboard/community?section=checklist#readiness-review","category":"setup","priority":60}]';END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(coalesce(plans,'[]')) LOOP v_tasks:=v_tasks||jsonb_build_array(jsonb_build_object('key','connection_'||(t->>'platform'),'name','Set up '||replace(t->>'platform','_',' '),'href',case when t->>'platform'='crm' then '/dashboard/settings/crm' when t->>'platform'='pms' then '/dashboard/floor-plans' when t->>'platform' IN('google_ads','meta_ads') then '/dashboard/community?section=overview&setupPanel=advertising#community-settings' when t->>'platform'='google_business_profile' then '/dashboard/reviewflow' when t->>'platform'='google_search_console' then '/dashboard/intelligence' else '/dashboard/community?section=overview&setupPanel=connections#property-connections' end,'category','integrations','priority',84));END LOOP;
 IF EXISTS(SELECT 1 FROM public.property_contacts WHERE property_id=p_property_id AND contact_type='billing') THEN v_tasks:=v_tasks||'[{"key":"billing","name":"Review billing contact and workflow","href":"edit#contacts","category":"billing","priority":75}]';END IF;
 v_keys:=array(SELECT value->>'key' FROM jsonb_array_elements(v_tasks));
 PERFORM set_config('p11.checklist_scope',p_property_id::text,true);
 FOR t IN SELECT value FROM jsonb_array_elements(v_tasks) LOOP
  v_id:=md5('property-checklist:'||p_property_id::text||':'||(t->>'key'))::uuid;
  v_metadata:=jsonb_build_object('setupKey',t->>'key','href',case when t->>'href' LIKE 'edit%' then '/dashboard/properties/'||p_property_id::text||'/'||(t->>'href') else t->>'href' end,'owner',i->>'setupOwner','launchTarget',i->>'launchTarget','completionCondition',case t->>'key'
   when 'classification' then 'Reconcile the property purpose with the supported offering and conversion model.'
   when 'public_contact' then 'Confirm public phone and email; review conversion destinations and office hours.'
   when 'sources' then 'Capture authoritative sources, review extracted facts and retain provenance and review dates.'
   when 'brand' then 'Approve the brand contract and verify asset rights and expiry.'
   when 'inventory' then 'Review stable offering identities, source dates, pricing and availability before use.'
   when 'legal' then 'Obtain current reviewed disclosures and consent records for the intended launch.'
   when 'readiness' then 'Build and review current readiness evidence for the selected products.'
   else 'Complete the linked workflow and review its current saved result; a reported task status alone does not verify it.' end);
  IF EXISTS(SELECT 1 FROM public.onboarding_tasks WHERE id=v_id) THEN
   IF p_actor_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.onboarding_tasks WHERE id=v_id AND NOT coalesce(metadata,'{}')@>v_metadata) THEN
    v_before:=public.onboarding_task_snapshot(v_id);
    UPDATE public.onboarding_tasks SET metadata=coalesce(metadata,'{}')||v_metadata WHERE id=v_id;
    UPDATE public.onboarding_task_workspaces SET revision=revision+1,updated_at=clock_timestamp() WHERE task_id=v_id;
    PERFORM public.record_onboarding_task_decision(gen_random_uuid(),v_id,p_actor_id,'property_setup','saved',jsonb_build_object('reason','Refresh setup responsibility and completion guidance'),v_before);
   END IF;
   CONTINUE;
  END IF;
  INSERT INTO public.onboarding_tasks(id,property_id,task_type,task_name,description,category,priority,metadata)
  VALUES(v_id,p_property_id,coalesce(t->>'type','other'),t->>'name','Complete this reviewed workflow. Reported progress does not verify readiness.',t->>'category',(t->>'priority')::int,v_metadata);
  INSERT INTO public.onboarding_task_workspaces(task_id,property_id,org_id)VALUES(v_id,p_property_id,v_org);
  PERFORM public.record_onboarding_task_decision(md5('checklist-initialized:'||v_id::text)::uuid,v_id,NULL,'default_setup','initialized',jsonb_build_object('defaultKey',t->>'key','reason','Initialize tasks for selected setup products'),NULL);
 END LOOP;
 PERFORM set_config('p11.checklist_scope','',true);
 IF p_actor_id IS NOT NULL THEN
  FOR existing IN SELECT t.id,t.metadata,w.archived,t.status FROM public.onboarding_tasks t JOIN public.onboarding_task_workspaces w ON w.task_id=t.id WHERE t.property_id=p_property_id AND t.metadata?'setupKey' LOOP
   IF (NOT (existing.metadata->>'setupKey'=ANY(v_keys)) AND NOT existing.archived AND existing.status='pending') OR (existing.metadata->>'setupKey'=ANY(v_keys) AND existing.archived) THEN
    v_before:=public.onboarding_task_snapshot(existing.id);
    result:=public.decide_onboarding_task(gen_random_uuid(),p_property_id,p_actor_id,jsonb_build_object('operation',case when existing.archived then 'restore' else 'archive' end,'taskId',existing.id,'expectedHash',public.knowledge_hash(v_before),'reason','Reconcile tasks with the reviewed product selection'));
    IF result->>'state'<>'saved' THEN RAISE EXCEPTION 'Could not reconcile setup tasks';END IF;
   END IF;
  END LOOP;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.sync_property_setup_tasks(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_property_setup_tasks(uuid,uuid) TO service_role;

create or replace function public.property_edit_snapshot(p_property_id uuid)returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('profile',jsonb_build_object(
  'name',p.name,'propertyType',p.property_type,'address',jsonb_build_object('street',coalesce(p.address->>'street',''),'city',coalesce(p.address->>'city',''),'state',coalesce(p.address->>'state',''),'zip',coalesce(p.address->>'zip','')),
  'websiteUrl',coalesce(p.website_url,''),'additionalUrls',coalesce(nullif(p.settings->'additionalUrls','null'::jsonb),'[]'::jsonb),'unitCount',p.unit_count,'yearBuilt',p.year_built,
  'amenities',coalesce(to_jsonb(p.amenities),'[]'::jsonb),'specialFeatures',coalesce(to_jsonb(p.special_features),'[]'::jsonb),'brandVoice',coalesce(p.brand_voice,''),'targetAudience',coalesce(p.target_audience,'')) || case when p.settings?'onboarding' then jsonb_build_object('intake',p.settings->'onboarding') else '{}'::jsonb end,
  'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'type',c.contact_type,'name',c.name,'email',c.email,'phone',coalesce(c.phone,''),'role',coalesce(c.role,''),'billingAddress',jsonb_build_object('street',coalesce(c.billing_address->>'street',''),'city',coalesce(c.billing_address->>'city',''),'state',coalesce(c.billing_address->>'state',''),'zip',coalesce(c.billing_address->>'zip','')),'billingMethod',coalesce(c.billing_method,''),'specialInstructions',coalesce(c.special_instructions,''),'needsW9',coalesce(c.needs_w9,false),'isPrimary',coalesce(c.is_primary,false))order by c.id)from public.property_contacts c where c.property_id=p.id),'[]'::jsonb),
  'contextCity',p.settings->'city','connectionRequests',coalesce((select s.connection_requests from public.property_setup_state s where s.property_id=p.id and s.org_id=p.org_id),'[]'::jsonb))
 from public.properties p where p.id=p_property_id
$$;
create or replace function public._brain_save_property_setup(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if v_profile?'intake' then perform public.validate_onboarding_intake(v_profile->'intake');end if;
 if jsonb_typeof(v_profile)is distinct from'object'or v_profile-array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience','intake']<>'{}' or not(v_profile?&array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience'])then raise exception 'Invalid property facts';end if;
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
 update public.properties set name=btrim(v_profile->>'name'),property_type=v_profile->>'propertyType',address=coalesce(address,'{}')||(v_profile->'address')||case when v_profile?'intake' then jsonb_build_object('country',v_profile->'intake'->>'country') else '{}'::jsonb end,website_url=nullif(v_profile->>'websiteUrl',''),unit_count=(v_profile->>'unitCount')::integer,year_built=(v_profile->>'yearBuilt')::integer,
 amenities=array(select jsonb_array_elements_text(v_profile->'amenities')),special_features=array(select jsonb_array_elements_text(v_profile->'specialFeatures')),brand_voice=nullif(v_profile->>'brandVoice',''),target_audience=nullif(v_profile->>'targetAudience',''),settings=coalesce(settings,'{}')||jsonb_build_object('additionalUrls',v_profile->'additionalUrls','city',v_profile->'address'->>'city')||case when v_profile?'intake' then jsonb_build_object('onboarding',v_profile->'intake','publicContact',v_profile->'intake'->'publicContact','timezone',nullif(v_profile->'intake'->>'timezone','')) else '{}'::jsonb end,updated_at=v_now where id=p_property_id;
 delete from public.property_contacts c where c.property_id=p_property_id and not exists(select 1 from jsonb_array_elements(p_input->'contacts')x where(x->>'id')::uuid=c.id);
 for v_contact in select value from jsonb_array_elements(p_input->'contacts')loop
  insert into public.property_contacts(id,property_id,contact_type,name,email,phone,role,billing_address,billing_method,special_instructions,needs_w9,is_primary,updated_at)
  values((v_contact->>'id')::uuid,p_property_id,v_contact->>'type',v_contact->>'name',v_contact->>'email',nullif(v_contact->>'phone',''),nullif(v_contact->>'role',''),v_contact->'billingAddress',nullif(v_contact->>'billingMethod',''),nullif(v_contact->>'specialInstructions',''),(v_contact->>'needsW9')::boolean,(v_contact->>'isPrimary')::boolean,v_now)
  on conflict(id)do update set contact_type=excluded.contact_type,name=excluded.name,email=excluded.email,phone=excluded.phone,role=excluded.role,billing_address=coalesce(public.property_contacts.billing_address,'{}')||excluded.billing_address,billing_method=excluded.billing_method,special_instructions=excluded.special_instructions,needs_w9=excluded.needs_w9,is_primary=excluded.is_primary,updated_at=excluded.updated_at where public.property_contacts.property_id=p_property_id;
 end loop;
 insert into public.property_setup_state(property_id,org_id,connection_requests,updated_at)values(p_property_id,v_org,p_input->'connectionRequests',v_now)on conflict(property_id)do update set connection_requests=excluded.connection_requests,org_id=excluded.org_id,updated_at=excluded.updated_at;
 if v_profile?'intake' then perform public.sync_property_setup_tasks(p_property_id,p_actor_id);end if;
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
  perform public.complete_property_setup_tasks(p_id,p_property_id,p_actor_id);
 end if;
 insert into public.property_setup_changes(id,property_id,org_id,actor_id,input,before_state,after_state,before_hash,after_hash,changed_sections,context_invalidated)values(p_id,p_property_id,v_org,p_actor_id,p_input,v_before,v_after,v_hash,v_after_hash,v_sections,v_invalidated);
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property',v_action,'server_confirmed','succeeded',jsonb_build_object('changeId',p_id,'inputHash',encode(extensions.digest(p_input::text,'sha256'),'hex')),jsonb_build_object('hash',v_hash),jsonb_build_object('hash',v_after_hash),jsonb_build_object('changedSections',v_sections,'setupCompleted',v_complete,'contextInvalidated',v_invalidated,'connectionsActivated',false,'websiteFetched',false));
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Could not record property change';end if;
 perform set_config('p11.property_setup_scope','',true);
 return jsonb_build_object('state','saved','id',p_id,'afterHash',v_after_hash,'contextInvalidated',v_invalidated,'setupCompleted',v_complete,'changedSections',v_sections);
end$$;
create or replace function public.create_default_onboarding_tasks(p_property_id uuid)returns void language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_id uuid;v_event uuid;t record;
begin
 if exists(select 1 from public.properties where id=p_property_id and settings?'onboarding')then perform public.sync_property_setup_tasks(p_property_id,null);return;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));select org_id into v_org from public.properties where id=p_property_id for update;if v_org is null then raise exception 'Choose a saved property';end if;
 perform set_config('p11.checklist_scope',p_property_id::text,true);
 for t in select *from(values
 ('details','intake_form','Complete community details','Review the property facts and save the setup details.','setup',100),
 ('contacts','intake_form','Add contact information','Review the property contacts and their roles.','setup',95),
 ('brochure','doc_upload','Upload property brochure','Retain the private original and review knowledge before publication.','documents',90),
 ('pets','doc_upload','Upload pet policy','Review the current pet policy in Knowledge Base.','documents',80),
 ('guidelines','doc_upload','Upload community guidelines','Review community guidance in Knowledge Base.','documents',70),
 ('analytics','ga4_access','Connect Google Analytics','Review the account connection and its verified status in Integrations.','integrations',85),
 ('google_ads','google_ads_access','Connect Google Ads','Review the account connection and its verified status in Integrations.','integrations',84),
 ('meta','meta_access','Connect Meta Ads','Review the account connection and its verified status in Integrations.','integrations',83),
 ('billing','payment_setup','Set up billing','Review billing contacts and the approved billing workflow.','billing',75)
 )as x(key,kind,name,description,category,priority)loop
  v_id:=md5('property-checklist:'||p_property_id::text||':'||t.key)::uuid;
  if exists(select 1 from public.onboarding_tasks where id=v_id or(property_id=p_property_id and task_type=t.kind and task_name=t.name))then continue;end if;
  insert into public.onboarding_tasks(id,property_id,task_type,task_name,description,category,priority)values(v_id,p_property_id,t.kind,t.name,t.description,t.category,t.priority);
  insert into public.onboarding_task_workspaces(task_id,property_id,org_id)values(v_id,p_property_id,v_org);
  v_event:=md5('checklist-initialized:'||v_id::text)::uuid;
  perform public.record_onboarding_task_decision(v_event,v_id,null,'default_setup','initialized',jsonb_build_object('defaultKey',t.key,'reason','Initialize the property setup checklist'),null);
 end loop;
 perform set_config('p11.checklist_scope','',true);
end$$;

NOTIFY pgrst, 'reload schema';

create or replace function public.readiness_safe_property(p_row jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$select public.readiness_project_json(p_row,array['id','org_id','name','address','amenities','brand_voice','current_vertical_profile_version_id','office_hours','parking_info','pet_policy','property_type','social_media','special_features','subject_kind','target_audience','unit_count','website_url','year_built'])||case when p_row is null or p_row='null'::jsonb then null else jsonb_build_object('settings',jsonb_build_object('additionalUrls',coalesce(p_row->'settings'->'additionalUrls','[]'),'publicContact',p_row->'settings'->'publicContact'))end$$;
CREATE OR REPLACE FUNCTION public.sync_legacy_property_vertical_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$ declare k text;s text;r text;pi jsonb;p jsonb;ph text;h text;pid uuid;v integer;begin
 -- Explicit onboarding classification is maintained by its own versioned trigger.
 if new.settings?'onboarding' then return new;end if;
 if new.org_id is null then return new;end if;if tg_op='UPDATE' and new.property_type is not distinct from old.property_type and new.subject_kind is not distinct from old.subject_kind then return new;end if;k:=case new.property_type when 'multifamily' then 'multifamily_residential' when 'senior' then 'senior_living' when 'student' then 'student_housing' when 'affordable' then 'affordable_housing' when 'townhome' then 'townhome_community' when 'condo' then 'condominium_community' when 'single_family' then 'single_family_community' when 'master_planned' then 'master_planned_community' when 'mixed_use' then 'mixed_use' else 'residential' end;s:=case when new.property_type in('multifamily','senior','student','affordable','townhome','condo','single_family','master_planned') then 'confirmed' else 'needs_review' end;r:=case when new.property_type='mixed_use' then 'Legacy mixed_use does not identify the primary offering or operating model.' when new.property_type='luxury' then 'Legacy luxury is a market position, not an unambiguous vertical.' when new.property_type is null then 'Legacy property type is missing.' else 'Deterministic legacy property type mapping.' end;pi:=jsonb_build_object('packKey','siteforge.real_estate.'||k,'packVersion',1);p:=jsonb_build_object('schemaVersion',2,'source','legacy_property_type','legacyPropertyType',new.property_type,'subjectKind',new.subject_kind,'verticalKey',k,'mappingStatus',s);ph:=encode(extensions.digest(convert_to(pi::text,'UTF8'),'sha256'),'hex');h:=encode(extensions.digest(convert_to(jsonb_build_object('schemaVersion',2,'profile',p,'mappingStatus',s,'mappingReason',r,'verticalPack',pi)::text,'UTF8'),'sha256'),'hex');select id into pid from public.property_vertical_profile_versions where property_id=new.id and content_hash=h;if pid is null then select coalesce(max(version),0)+1 into v from public.property_vertical_profile_versions where property_id=new.id;insert into public.property_vertical_profile_versions(org_id,property_id,version,subject_kind,vertical_key,mapping_status,mapping_reason,vertical_pack_key,vertical_pack_version,vertical_pack_content_hash,profile,content_hash)values(new.org_id,new.id,v,new.subject_kind,k,s,r,pi->>'packKey',1,ph,p,h)returning id into pid;end if;update public.properties set current_vertical_profile_version_id=pid where id=new.id and current_vertical_profile_version_id is distinct from pid;return new;end $function$;

CREATE OR REPLACE FUNCTION public.sync_onboarding_vertical_profile() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i jsonb;c jsonb;v_profile jsonb;v_pack jsonb;v_hash text;v_id uuid;v_version int;v_archetype text;v_status text;v_subject text;v_reason text;v_modifiers jsonb:='[]';v_compatible boolean;
BEGIN
 i:=new.settings->'onboarding';IF i IS NULL OR new.org_id IS NULL THEN RETURN new;END IF;
 -- Only an explicit classification change supersedes the current reviewed profile.
 -- Source/goal/contact edits must not replace a profile reviewed in another workflow.
 IF TG_OP='UPDATE' AND new.property_type IS NOT DISTINCT FROM old.property_type THEN
  IF old.settings?'onboarding' AND NOT EXISTS(
   SELECT 1 FROM unnest(array['subjectKind','scope','sector','transaction','lifecycle','offeringKind','primaryIntent']) k
   WHERE i->k IS DISTINCT FROM old.settings->'onboarding'->k
  ) THEN RETURN new;END IF;
  IF NOT(old.settings?'onboarding') AND NOT EXISTS(
   SELECT 1 FROM unnest(array['subjectKind','scope','sector','transaction','lifecycle','offeringKind','primaryIntent']) k WHERE coalesce(i->>k,'')<>''
  ) AND EXISTS(SELECT 1 FROM public.property_vertical_profile_versions v WHERE v.id=old.current_vertical_profile_version_id AND v.mapping_status='confirmed' AND v.profile->>'source' IN('operator','import')) THEN RETURN new;END IF;
 END IF;
 v_subject:=coalesce(nullif(i->>'subjectKind',''),new.subject_kind);
 v_archetype:=case when i->>'scope'='portfolio' then 'portfolio' when i->>'scope'='corporate' then 'corporate' when i->>'sector'='senior_care' then 'senior_community' when i->>'sector'='commercial' then 'commercial_property' when i->>'sector'='destination' then 'destination' when i->>'transaction'='for_sale' then 'for_sale_community' when i->>'transaction'='rental' then 'rental_multifamily' else 'unclassified' end;
 v_compatible:=case v_archetype
 when 'rental_multifamily' then i->>'sector' IN('residential','cross_sector') AND i->>'transaction'='rental'
 when 'for_sale_community' then i->>'sector'='residential' AND i->>'transaction'='for_sale'
 when 'senior_community' then i->>'sector'='senior_care' AND i->>'transaction'='care_services'
 when 'commercial_property' then i->>'sector'='commercial' AND i->>'transaction'='commercial_lease'
 when 'corporate' then i->>'scope'='corporate' AND i->>'transaction' IN('for_sale','informational')
 when 'portfolio' then i->>'scope'='portfolio' AND i->>'sector'='cross_sector' AND i->>'transaction'='informational'
 when 'destination' then i->>'scope'='destination' AND i->>'sector'='destination' AND i->>'transaction'='destination_booking'
 else false end;
 IF v_archetype='rental_multifamily' THEN
  IF new.property_type IN('affordable','student','luxury','build_to_rent') THEN v_modifiers:=v_modifiers||jsonb_build_array(new.property_type);END IF;
  IF i->>'offeringKind'='bed_space' AND NOT v_modifiers?'student' THEN v_modifiers:=v_modifiers||'"student"'::jsonb;END IF;
  IF i->>'offeringKind'='rental_home' AND NOT v_modifiers?'build_to_rent' THEN v_modifiers:=v_modifiers||'"build_to_rent"'::jsonb;END IF;
  IF new.property_type='mixed_use' AND i->>'sector'='cross_sector' THEN v_modifiers:=v_modifiers||'"mixed_use"'::jsonb;END IF;
  IF i->>'lifecycle'='lease_up' THEN v_modifiers:=v_modifiers||'"lease_up"'::jsonb;END IF;
 END IF;
 IF v_archetype='for_sale_community' AND new.property_type IN('condo','townhome') THEN v_modifiers:=v_modifiers||'"condo_townhome"'::jsonb;END IF;
 v_status:=case when coalesce(i->>'subjectKind','')<>'' AND coalesce(i->>'scope','')<>'' AND coalesce(i->>'sector','')<>'' AND coalesce(i->>'transaction','')<>'' AND coalesce(i->>'lifecycle','')<>'' AND v_compatible then 'confirmed' else 'needs_review' end;
 c:=jsonb_build_object('registryVersion',1,'scope',i->>'scope','sector',i->>'sector','transaction',i->>'transaction','archetype',v_archetype,'modifiers',v_modifiers,'lifecycle',i->>'lifecycle','confirmedOverride',null);
 v_profile:=jsonb_build_object('schemaVersion',2,'subjectKind',v_subject,'verticalKey',v_archetype,'displayName',left(new.name,160),'operatingModel',coalesce(nullif(i->>'transaction',''),'unspecified'),'attributes',jsonb_build_object('onboardingClassification',jsonb_build_object('scope',i->>'scope','sector',i->>'sector','transaction',i->>'transaction','lifecycle',i->>'lifecycle','offeringKind',i->>'offeringKind','primaryIntent',i->>'primaryIntent'))||case when v_status='confirmed' then jsonb_build_object('siteforgeComposition',c) else '{}'::jsonb end,'audiences','[]'::jsonb,'complianceTags','[]'::jsonb,'source','operator','legacyPropertyType',new.property_type);
 v_pack:=jsonb_build_object('packKey','siteforge.real_estate.'||v_archetype,'packVersion',1);
 v_reason:=case when v_status='confirmed' then 'Property purpose explicitly supplied in reviewed setup; product policies still apply.' else 'Complete and reconcile the subject, scope, sector, business model and lifecycle before website discovery.' end;
 v_hash:=public.knowledge_hash(jsonb_build_object('profile',v_profile,'mappingStatus',v_status,'mappingReason',v_reason,'verticalPack',v_pack));
 SELECT id INTO v_id FROM public.property_vertical_profile_versions WHERE property_id=new.id AND content_hash=v_hash;
 IF v_id IS NULL THEN
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.property_vertical_profile_versions WHERE property_id=new.id;
  INSERT INTO public.property_vertical_profile_versions(org_id,property_id,version,subject_kind,vertical_key,mapping_status,mapping_reason,vertical_pack_key,vertical_pack_version,vertical_pack_content_hash,profile,content_hash)
  VALUES(new.org_id,new.id,v_version,v_subject,v_archetype,v_status,v_reason,v_pack->>'packKey',1,public.knowledge_hash(v_pack),v_profile,v_hash)RETURNING id INTO v_id;
 END IF;
 UPDATE public.properties SET subject_kind=v_subject,current_vertical_profile_version_id=v_id WHERE id=new.id AND (subject_kind IS DISTINCT FROM v_subject OR current_vertical_profile_version_id IS DISTINCT FROM v_id);
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.sync_onboarding_vertical_profile() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER properties_sync_onboarding_vertical AFTER INSERT OR UPDATE OF settings,property_type,name ON public.properties FOR EACH ROW EXECUTE FUNCTION public.sync_onboarding_vertical_profile();

NOTIFY pgrst, 'reload schema';


-- Expose existing canonical location/contact values to the private editor without changing its snapshot hash.
CREATE OR REPLACE FUNCTION public._brain_read_property_setup(p_property_id uuid, p_actor_id uuid, p_cursor uuid DEFAULT NULL::uuid, p_change_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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
 select jsonb_build_object('id',p.id,'name',p.name,'org_id',p.org_id,'address',p.address,'property_type',p.property_type,'website_url',p.website_url,'unit_count',p.unit_count,'year_built',p.year_built,'amenities',p.amenities,'pet_policy',p.pet_policy,'parking_info',p.parking_info,'special_features',p.special_features,'brand_voice',p.brand_voice,'target_audience',p.target_audience,'office_hours',p.office_hours,'social_media',p.social_media,'created_at',p.created_at,'onboarding_completed_at',p.onboarding_completed_at,'settings',jsonb_build_object('additionalUrls',p.settings->'additionalUrls','brand_insights',p.settings->'brand_insights','timezone',p.settings->'timezone','publicContact',p.settings->'publicContact'))into v_property from public.properties p where p.id=p_property_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'platform',i.platform,'status',i.status,'account_id',i.account_id,'account_name',i.account_name,'notes',i.notes)order by i.platform,i.id),'[]'::jsonb)into v_connections from public.integration_credentials i where i.property_id=p_property_id;
 select jsonb_build_object('status',c.status,'requiresReview',c.requires_review,'lastGeneratedAt',c.last_generated_at,'changeSummary',c.last_change_summary)into v_context from public.property_chatbot_contexts c where c.property_id=p_property_id;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canEdit',coalesce(v_role in('admin','manager'),false),'snapshot',v_snapshot-'contextCity','snapshotHash',encode(extensions.digest(v_snapshot::text,'sha256'),'hex'),'property',v_property,'connections',v_connections,'context',v_context,'changes',v_rows,'nextCursor',v_next,'total',(select count(*)from public.property_setup_changes where property_id=p_property_id and org_id=v_org),'selected',v_selected);
end$$;
