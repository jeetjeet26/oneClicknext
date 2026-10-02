create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;


-- A batch is an immutable selection, never a query that can expand after approval.
create table public.crm_bulk_batches(
 id uuid primary key, property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id), lead_ids uuid[] not null,
 input_hash text not null, manifest jsonb not null, manifest_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(cardinality(lead_ids) between 1 and 100),check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest)=cardinality(lead_ids))
);
create index crm_bulk_batches_property on public.crm_bulk_batches(property_id,created_at desc,id desc);
create index crm_bulk_batches_actor on public.crm_bulk_batches(actor_id);
create table public.crm_bulk_commands(
 id uuid primary key,batch_id uuid not null references public.crm_bulk_batches(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),kind text not null check(kind in ('approve','stop')),
 manifest_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(batch_id,kind)
);
create index crm_bulk_commands_property on public.crm_bulk_commands(property_id);
create index crm_bulk_commands_actor on public.crm_bulk_commands(actor_id);
alter table public.crm_bulk_batches enable row level security;
alter table public.crm_bulk_commands enable row level security;
create policy crm_bulk_batches_service on public.crm_bulk_batches for all to service_role using(true) with check(true);
create policy crm_bulk_commands_service on public.crm_bulk_commands for all to service_role using(true) with check(true);
revoke all on public.crm_bulk_batches,public.crm_bulk_commands from public,anon,authenticated;
grant all on public.crm_bulk_batches,public.crm_bulk_commands to service_role;
create trigger crm_bulk_batches_immutable before update or delete on public.crm_bulk_batches for each row execute function public.protect_shared_action_history();
create trigger crm_bulk_commands_immutable before update or delete on public.crm_bulk_commands for each row execute function public.protect_shared_action_history();

create function public.prepare_crm_bulk(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_lead_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ids uuid[];b public.crm_bulk_batches;lead uuid;l public.leads;r jsonb;h public.crm_handoffs;manifest jsonb:='[]';input_hash text;e jsonb;
begin
 if p_request_id is null or p_lead_ids is null or cardinality(p_lead_ids) not between 1 and 100 or array_position(p_lead_ids,null) is not null then raise exception 'Select between one and 100 distinct leads';end if;
 select array_agg(distinct x order by x) into ids from unnest(p_lead_ids) x;
 if cardinality(ids)<>cardinality(p_lead_ids) then raise exception 'Duplicate lead selection';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input_hash:=public.crm_configuration_hash(jsonb_build_object('actorId',p_actor_id,'propertyId',p_property_id,'leadIds',ids));
 select * into b from public.crm_bulk_batches where id=p_request_id;
 if found then
  if b.input_hash<>input_hash then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','batchId',b.id);
 end if;
 -- Validate the entire scope before preparing a single child request.
 perform 1 from public.leads where property_id=p_property_id and id=any(ids) order by id for update;
 if (select count(*) from public.leads where property_id=p_property_id and id=any(ids))<>cardinality(ids) then return '{"state":"selection_changed"}';end if;
 foreach lead in array ids loop
  select * into l from public.leads where id=lead;
  r:=public.request_crm_handoff(p_property_id,lead,'bulk/'||p_request_id::text||'/'||lead::text,'operator',p_actor_id);
  if r->>'state' not in ('queued','already_linked','contact_required','handoff_in_progress','legacy_link_review_required','qualification_required','configuration_required','payload_too_large') then raise exception 'Bulk preparation could not be confirmed';end if;
  if r->>'state'='queued' then
   select * into h from public.crm_handoffs where id=(r->>'handoffId')::uuid;
   manifest:=manifest||jsonb_build_array(jsonb_build_object('leadId',lead,'leadName',concat_ws(' ',l.first_name,l.last_name),'state','prepared','handoffId',h.id,'payloadHash',public.crm_configuration_hash(h.payload),'approvalId',gen_random_uuid(),'stopId',gen_random_uuid()));
  else
   -- Existing work remains outside this batch's authority, including already linked records.
   manifest:=manifest||jsonb_build_array(jsonb_build_object('leadId',lead,'leadName',concat_ws(' ',l.first_name,l.last_name),'state',r->>'state'));
  end if;
 end loop;
 insert into public.crm_bulk_batches(id,property_id,actor_id,lead_ids,input_hash,manifest,manifest_hash)values(p_request_id,p_property_id,p_actor_id,ids,input_hash,manifest,public.crm_configuration_hash(manifest));
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'crm','crm.bulk.prepared','server_confirmed','succeeded',jsonb_build_object('batchId',p_request_id,'selectionCount',cardinality(ids),'manifestHash',public.crm_configuration_hash(manifest)),null,null,jsonb_build_object('prepared',(select count(*) from jsonb_array_elements(manifest) i where i->>'state'='prepared'),'delivered',false));
 if e->>'state' not in ('recorded','replayed') then raise exception 'Bulk preparation history unavailable';end if;
 return jsonb_build_object('state','saved','batchId',p_request_id);
end;$$;

-- Internal projection: counts always come from saved child state, never a cached success flag.
create function public.crm_bulk_snapshot(p_batch_id uuid,p_include_values boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
 with batch as(select * from public.crm_bulk_batches where id=p_batch_id),items as(
 select i.ordinality, i.value->>'leadId' lead_id,i.value->>'leadName' lead_name,
 case when i.value->>'state'='prepared' then coalesce(h.state,'missing_transfer') else i.value->>'state' end item_state,
 h.id,h.payload,h.revision,h.execution_approved_at,h.external_id,
 (select r.result->>'outcome' from public.crm_handoff_receipts r where r.handoff_id=h.id and r.stage in ('result','reconciliation') order by r.created_at desc limit 1) outcome,
 h.state='queued' and (not exists(select 1 from public.leads l where l.id=h.lead_id and l.property_id=h.property_id)
 or public.crm_configuration_hash(public.crm_lead_preview_input(h.property_id,h.lead_id)) is distinct from h.source_hash
 or not public.crm_handoff_configuration_ready(h.integration_id,h.revision,h.approved_review_id,h.validation_receipt_id,h.credentials_hash)) stale
 from batch b cross join lateral jsonb_array_elements(b.manifest) with ordinality i(value,ordinality)
 left join public.crm_handoffs h on h.id=(i.value->>'handoffId')::uuid and h.property_id=b.property_id and h.lead_id=(i.value->>'leadId')::uuid
 ), counts as(select item_state,count(*) n from items group by item_state)
 select jsonb_build_object('batchId',b.id,'requestedAt',b.created_at,'actorId',b.actor_id,'selectionCount',cardinality(b.lead_ids),'manifestHash',b.manifest_hash,
 'approved',exists(select 1 from public.crm_bulk_commands c where c.batch_id=b.id and c.kind='approve'),
 'stopped',exists(select 1 from public.crm_bulk_commands c where c.batch_id=b.id and c.kind='stop'),
 'counts',coalesce((select jsonb_object_agg(item_state,n) from counts),'{}'),
 'items',case when p_include_values then coalesce((select jsonb_agg(jsonb_build_object('leadId',lead_id,'leadName',lead_name,'state',item_state,'handoffId',id,'payload',payload,'revision',revision,'approved',execution_approved_at is not null,'externalId',external_id,'outcome',outcome,'stale',coalesce(stale,false)) order by ordinality) from items),'[]') else '[]'::jsonb end)
 from batch b;
$$;

create function public.read_crm_bulk(p_property_id uuid,p_actor_id uuid,p_batch_id uuid default null,p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;total bigint;result jsonb;
begin
 if p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid batch page';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if p_batch_id is not null then
  if not exists(select 1 from public.crm_bulk_batches where id=p_batch_id and property_id=p_property_id) then return '{"state":"not_found"}';end if;
  return public.crm_bulk_snapshot(p_batch_id,true)||'{"state":"saved"}'::jsonb;
 end if;
 select count(*) into total from public.crm_bulk_batches where property_id=p_property_id;
 select coalesce(jsonb_agg(public.crm_bulk_snapshot(b.id) order by b.created_at desc,b.id desc),'[]') into rows from (select id,created_at from public.crm_bulk_batches where property_id=p_property_id order by created_at desc,id desc offset (p_page-1)*25 limit 25) b;
 return jsonb_build_object('state','saved','batches',rows,'total',total,'pages',greatest(1,ceil(total::numeric/25)));
end;$$;

create function public.command_crm_bulk(p_property_id uuid,p_actor_id uuid,p_batch_id uuid,p_request_id uuid,p_kind text,p_manifest_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.crm_bulk_batches;c public.crm_bulk_commands;item jsonb;h public.crm_handoffs;r jsonb;e jsonb;processed integer:=0;held integer:=0;
begin
 if p_request_id is null or p_kind is null or p_kind not in ('approve','stop') or p_manifest_hash is null then raise exception 'Saved batch review required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into b from public.crm_bulk_batches where id=p_batch_id and property_id=p_property_id;
 if not found then return '{"state":"not_found"}';end if;
 if b.manifest_hash<>p_manifest_hash then return '{"state":"preview_conflict"}';end if;
 if p_kind='approve' and b.actor_id<>p_actor_id then return '{"state":"owner_required"}';end if;
 select * into c from public.crm_bulk_commands where id=p_request_id;
 if found then
  if (c.batch_id,c.actor_id,c.kind,c.manifest_hash) is distinct from (b.id,p_actor_id,p_kind,p_manifest_hash) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','batchId',b.id,'result',c.result);
 end if;
 if exists(select 1 from public.crm_bulk_commands where batch_id=b.id and kind=p_kind) then return jsonb_build_object('state','already_recorded','batchId',b.id);end if;
 if p_kind='approve' then
  if exists(select 1 from public.crm_bulk_commands where batch_id=b.id and kind='stop') then return '{"state":"stopped"}';end if;
  -- Lock every prepared child and lead before preflight. Any stale item holds all new approvals.
  perform 1 from public.crm_handoffs locked where locked.id in(select (i->>'handoffId')::uuid from jsonb_array_elements(b.manifest) i where i->>'state'='prepared') order by locked.id for update;
  perform 1 from public.leads where id=any(b.lead_ids) order by id for share;
  for item in select value from jsonb_array_elements(b.manifest) where value->>'state'='prepared' loop
   select * into h from public.crm_handoffs where id=(item->>'handoffId')::uuid and property_id=b.property_id;
   if h.id is null or h.state<>'queued' or h.actor_id<>p_actor_id or public.crm_configuration_hash(h.payload)<>item->>'payloadHash' then return '{"state":"batch_changed"}';end if;
   if not exists(select 1 from public.leads where id=h.lead_id and property_id=b.property_id) or public.crm_configuration_hash(public.crm_lead_preview_input(b.property_id,h.lead_id)) is distinct from h.source_hash then return '{"state":"stale_source"}';end if;
   perform 1 from public.integration_credentials where id=h.integration_id for share;
   if not public.crm_handoff_configuration_ready(h.integration_id,h.revision,h.approved_review_id,h.validation_receipt_id,h.credentials_hash) then return '{"state":"stale_configuration"}';end if;
   processed:=processed+1;
  end loop;
  if processed=0 then return '{"state":"nothing_to_approve"}';end if;
  for item in select value from jsonb_array_elements(b.manifest) where value->>'state'='prepared' loop
   r:=public.approve_crm_handoff(b.property_id,p_actor_id,(item->>'handoffId')::uuid,(item->>'approvalId')::uuid,item->>'payloadHash');
   if r->>'state' not in ('applied','replayed','already_approved') then raise exception 'Bulk approval could not be confirmed';end if;
  end loop;
 else
  for item in select value from jsonb_array_elements(b.manifest) where value->>'state'='prepared' loop
   select * into h from public.crm_handoffs where id=(item->>'handoffId')::uuid and property_id=b.property_id;
   if h.state in ('queued','searching') then
    r:=public.stop_crm_handoff(b.property_id,p_actor_id,h.id,(item->>'stopId')::uuid);
    if r->>'state'<>'cancelled' then raise exception 'Bulk stop could not be confirmed';end if;
    processed:=processed+1;
   elsif h.state in ('sending','needs_reconciliation') then held:=held+1;
   end if;
  end loop;
 end if;
 r:=jsonb_build_object('processed',processed,'uncertain',held,'delivered',false);
 insert into public.crm_bulk_commands(id,batch_id,property_id,actor_id,kind,manifest_hash,result)values(p_request_id,b.id,b.property_id,p_actor_id,p_kind,b.manifest_hash,r);
 -- Separate command episode permits another current manager to stop work truthfully.
 e:=public.append_shared_action_event(p_request_id,p_request_id,b.property_id,p_actor_id,'crm',case when p_kind='approve' then 'crm.bulk.approved' else 'crm.bulk.stopped' end,'server_confirmed','succeeded',jsonb_build_object('batchId',b.id,'manifestHash',b.manifest_hash),null,null,r);
 if e->>'state' not in ('recorded','replayed') then raise exception 'Bulk command history unavailable';end if;
 return jsonb_build_object('state','applied','batchId',b.id,'result',r);
end;$$;

-- Search is property-scoped, bounded and literal: punctuation cannot alter the query.
create function public.search_crm_bulk_leads(p_property_id uuid,p_actor_id uuid,p_search text default '',p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare total bigint;rows jsonb;term text:=lower(trim(coalesce(p_search,'')));
begin
 if length(term)>200 or p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid lead search';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select count(*) into total from public.leads l where l.property_id=p_property_id and (term='' or strpos(lower(concat_ws(' ',l.first_name,l.last_name,l.email,l.phone)),term)>0);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',concat_ws(' ',s.first_name,s.last_name),'email',s.email,'phone',s.phone) order by s.created_at desc,s.id desc),'[]') into rows from(select l.id,l.first_name,l.last_name,l.email,l.phone,l.created_at from public.leads l where l.property_id=p_property_id and (term='' or strpos(lower(concat_ws(' ',l.first_name,l.last_name,l.email,l.phone)),term)>0) order by l.created_at desc,l.id desc offset (p_page-1)*25 limit 25)s;
 return jsonb_build_object('state','saved','leads',rows,'total',total,'pages',greatest(1,ceil(total::numeric/25)));
end;$$;
revoke all on function public.prepare_crm_bulk(uuid,uuid,uuid,uuid[]),public.crm_bulk_snapshot(uuid,boolean),public.read_crm_bulk(uuid,uuid,uuid,integer),public.command_crm_bulk(uuid,uuid,uuid,uuid,text,text),public.search_crm_bulk_leads(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.prepare_crm_bulk(uuid,uuid,uuid,uuid[]),public.crm_bulk_snapshot(uuid,boolean),public.read_crm_bulk(uuid,uuid,uuid,integer),public.command_crm_bulk(uuid,uuid,uuid,uuid,text,text),public.search_crm_bulk_leads(uuid,uuid,text,integer) to service_role;

notify pgrst,'reload schema';
