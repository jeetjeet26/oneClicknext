create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
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
 origin:=case when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;


create table public.siteforge_codex_briefs(
 id uuid primary key,brief_sequence bigint generated always as identity unique,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),parent_id uuid references public.siteforge_codex_briefs(id),input jsonb not null,input_hash text not null,document text not null,document_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create index siteforge_codex_brief_property on public.siteforge_codex_briefs(property_id,brief_sequence desc);
create index siteforge_codex_brief_org on public.siteforge_codex_briefs(org_id);
create index siteforge_codex_brief_actor on public.siteforge_codex_briefs(actor_id);
create index siteforge_codex_brief_parent on public.siteforge_codex_briefs(parent_id);
create table public.siteforge_brief_exports(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),brief_id uuid not null references public.siteforge_codex_briefs(id)on delete cascade,mode text not null check(mode in('copy','download')),document_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create index siteforge_brief_export_property on public.siteforge_brief_exports(property_id,created_at desc,id desc);
create index siteforge_brief_export_org on public.siteforge_brief_exports(org_id);
create index siteforge_brief_export_actor on public.siteforge_brief_exports(actor_id);
create index siteforge_brief_export_brief on public.siteforge_brief_exports(brief_id);
create table public.siteforge_brief_export_reports(
 id uuid primary key references public.siteforge_brief_exports(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),result text not null check(result in('clipboard_succeeded','clipboard_failed','download_started','download_failed')),created_at timestamptz not null default clock_timestamp()
);
create index siteforge_brief_report_property on public.siteforge_brief_export_reports(property_id);
create index siteforge_brief_report_org on public.siteforge_brief_export_reports(org_id);
create index siteforge_brief_report_actor on public.siteforge_brief_export_reports(actor_id);
alter table public.siteforge_codex_briefs enable row level security;
alter table public.siteforge_brief_exports enable row level security;
alter table public.siteforge_brief_export_reports enable row level security;
revoke all on public.siteforge_codex_briefs,public.siteforge_brief_exports,public.siteforge_brief_export_reports from public,anon,authenticated;
grant all on public.siteforge_codex_briefs,public.siteforge_brief_exports,public.siteforge_brief_export_reports to service_role;
create policy siteforge_codex_brief_service on public.siteforge_codex_briefs for all to service_role using(true)with check(true);
create policy siteforge_brief_export_service on public.siteforge_brief_exports for all to service_role using(true)with check(true);
create policy siteforge_brief_report_service on public.siteforge_brief_export_reports for all to service_role using(true)with check(true);
revoke all on sequence public.siteforge_codex_briefs_brief_sequence_seq from public,anon,authenticated;
grant usage,select on sequence public.siteforge_codex_briefs_brief_sequence_seq to service_role;
create function public.guard_siteforge_brief_history()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Brief snapshots and handoff reports are retained';end$$;
create trigger siteforge_codex_brief_guard before update or delete on public.siteforge_codex_briefs for each row execute function public.guard_siteforge_brief_history();
create trigger siteforge_brief_export_guard before update or delete on public.siteforge_brief_exports for each row execute function public.guard_siteforge_brief_history();
create trigger siteforge_brief_report_guard before update or delete on public.siteforge_brief_export_reports for each row execute function public.guard_siteforge_brief_history();
create function public.save_siteforge_codex_brief(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_document text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;prior public.siteforge_codex_briefs;parent public.siteforge_codex_briefs;context jsonb;event jsonb;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,92));
 if p_id is null or jsonb_typeof(p_input)is distinct from 'object'or(p_input-array['property','draft','parentId','templateVersion'])<>'{}'or p_input->>'templateVersion' is distinct from 'codex-brief-v1'or octet_length(p_input::text)>200000 or length(trim(coalesce(p_input->'draft'->>'request','')))not between 1 and 8000 or jsonb_typeof(p_input->'draft')is distinct from 'object'or octet_length(coalesce(p_document,''))not between 1 and 256000 then raise exception 'Review the complete brief before saving';end if;
 select *into prior from public.siteforge_codex_briefs where id=p_id;if found then
  if(prior.property_id,prior.org_id,prior.actor_id,prior.input_hash,prior.document)is distinct from(p_property_id,organization,p_actor_id,public.crm_configuration_hash(p_input),p_document)then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','briefId',prior.id,'document',prior.document,'documentHash',prior.document_hash);end if;
 select jsonb_build_object('id',p.id,'name',p.name,'city',case when jsonb_typeof(coalesce(nullif(p.settings->'city','null'::jsonb),p.address->'city'))='string'then nullif(coalesce(nullif(p.settings->'city','null'::jsonb),p.address->'city')#>>'{}','')end)into context from public.properties p where p.id=p_property_id for share;
 if p_input->'property' is distinct from context then return '{"state":"property_changed"}';end if;
 if p_input->>'parentId'is not null then select *into parent from public.siteforge_codex_briefs where id=(p_input->>'parentId')::uuid and property_id=p_property_id and org_id=organization;if not found then return '{"state":"parent_unavailable"}';end if;end if;
 insert into public.siteforge_codex_briefs(id,property_id,org_id,actor_id,parent_id,input,input_hash,document,document_hash)values(p_id,p_property_id,organization,p_actor_id,parent.id,p_input,public.crm_configuration_hash(p_input),p_document,encode(extensions.digest(convert_to(p_document,'UTF8'),'sha256'),'hex'))returning *into prior;
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'siteforge','site.brief.saved','server_confirmed','succeeded',jsonb_build_object('parentId',parent.id,'inputHash',prior.input_hash),case when parent.id is not null then jsonb_build_object('briefId',parent.id,'documentHash',parent.document_hash)end,jsonb_build_object('briefId',prior.id,'documentHash',prior.document_hash),jsonb_build_object('briefId',prior.id,'saved',true,'websiteCreated',false));
 if event->>'state'not in('recorded','replayed')then raise exception 'The brief decision could not be recorded';end if;
 return jsonb_build_object('state','saved','briefId',prior.id,'document',prior.document,'documentHash',prior.document_hash);
end$$;
create function public.prepare_siteforge_brief_export(p_id uuid,p_property_id uuid,p_actor_id uuid,p_brief_id uuid,p_mode text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;b public.siteforge_codex_briefs;e public.siteforge_brief_exports;event jsonb;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if p_id is null or p_mode not in('copy','download')or p_mode is null then raise exception 'Choose a brief handoff action';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,92));
 select *into b from public.siteforge_codex_briefs where id=p_brief_id and property_id=p_property_id and org_id=organization;if not found then return '{"state":"not_found"}';end if;
 select *into e from public.siteforge_brief_exports where id=p_id;if found then
  if(e.property_id,e.org_id,e.actor_id,e.brief_id,e.mode)is distinct from(p_property_id,organization,p_actor_id,p_brief_id,p_mode)then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','exportId',e.id,'briefId',b.id,'document',b.document,'documentHash',b.document_hash);end if;
 insert into public.siteforge_brief_exports(id,property_id,org_id,actor_id,brief_id,mode,document_hash)values(p_id,p_property_id,organization,p_actor_id,b.id,p_mode,b.document_hash);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'siteforge','site.brief.export_prepared','server_confirmed','succeeded',jsonb_build_object('briefId',b.id,'mode',p_mode),null,null,jsonb_build_object('exportId',p_id,'documentHash',b.document_hash,'prepared',true,'deliveryConfirmed',false));
 if event->>'state'not in('recorded','replayed')then raise exception 'The handoff preparation could not be recorded';end if;
 return jsonb_build_object('state','prepared','exportId',p_id,'briefId',b.id,'document',b.document,'documentHash',b.document_hash);
end$$;
create function public.report_siteforge_brief_export(p_property_id uuid,p_actor_id uuid,p_export_id uuid,p_result text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;e public.siteforge_brief_exports;r public.siteforge_brief_export_reports;event jsonb;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 select *into e from public.siteforge_brief_exports where id=p_export_id and property_id=p_property_id and org_id=organization and actor_id=p_actor_id for update;if not found then return '{"state":"not_found"}';end if;
 if p_result is null or(e.mode='copy'and p_result not in('clipboard_succeeded','clipboard_failed'))or(e.mode='download'and p_result not in('download_started','download_failed'))then raise exception 'Report only the observed handoff outcome';end if;
 select *into r from public.siteforge_brief_export_reports where id=e.id;if found then if r.result<>p_result then return '{"state":"request_conflict"}';end if;return '{"state":"replayed"}';end if;
 insert into public.siteforge_brief_export_reports(id,property_id,org_id,actor_id,result)values(e.id,p_property_id,organization,p_actor_id,p_result);
 event:=public.append_shared_action_event(gen_random_uuid(),e.id,p_property_id,p_actor_id,'siteforge','site.brief.export_reported','browser_observed','observed',jsonb_build_object('exportId',e.id,'briefId',e.brief_id,'mode',e.mode),null,null,jsonb_build_object('reportedOutcome',p_result,'deliveryConfirmed',false,'source','browser_report'));
 if event->>'state'not in('recorded','replayed')then raise exception 'The reported handoff outcome could not be retained';end if;
 return '{"state":"recorded"}';
end$$;
create function public.read_siteforge_codex_briefs(p_property_id uuid,p_actor_id uuid,p_cursor uuid default null,p_brief_id uuid default null,p_export_cursor uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;anchor bigint;export_date timestamptz;export_anchor uuid;v_rows jsonb;v_exports jsonb;b public.siteforge_codex_briefs;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if p_cursor is not null then select brief_sequence into anchor from public.siteforge_codex_briefs where id=p_cursor and property_id=p_property_id and org_id=organization;if not found then return '{"state":"cursor_changed"}';end if;end if;
 select coalesce(jsonb_agg(x.value order by x.brief_sequence desc),'[]')into v_rows from(select item.brief_sequence,jsonb_build_object('id',item.id,'parentId',item.parent_id,'request',left(item.input->'draft'->>'request',140),'createdAt',item.created_at,'actorName',a.full_name,'target',item.input->'draft'->>'target')value from public.siteforge_codex_briefs item left join public.profiles a on a.id=item.actor_id where item.property_id=p_property_id and item.org_id=organization and(p_cursor is null or item.brief_sequence<anchor)order by item.brief_sequence desc limit 21)x;
 if p_brief_id is not null then
  select *into b from public.siteforge_codex_briefs where id=p_brief_id and property_id=p_property_id and org_id=organization;if not found then return '{"state":"not_found"}';end if;
  if p_export_cursor is not null then select e.created_at,e.id into export_date,export_anchor from public.siteforge_brief_exports e where e.id=p_export_cursor and e.brief_id=b.id and e.property_id=p_property_id and e.org_id=organization;if not found then return '{"state":"cursor_changed"}';end if;end if;
  select coalesce(jsonb_agg(x.value order by x.created_at desc,x.id desc),'[]')into v_exports from(select e.id,e.created_at,jsonb_build_object('id',e.id,'mode',e.mode,'createdAt',e.created_at,'actorName',a.full_name,'reportedOutcome',r.result,'reportedAt',r.created_at)value from public.siteforge_brief_exports e left join public.siteforge_brief_export_reports r on r.id=e.id left join public.profiles a on a.id=e.actor_id where e.brief_id=b.id and e.property_id=p_property_id and e.org_id=organization and(p_export_cursor is null or(e.created_at,e.id)<(export_date,export_anchor))order by e.created_at desc,e.id desc limit 21)x;
 end if;
 return jsonb_build_object('state','ready','briefs',case when jsonb_array_length(v_rows)>20 then v_rows-20 else v_rows end,'nextCursor',case when jsonb_array_length(v_rows)>20 then v_rows->19->>'id'end,'count',(select count(*)from public.siteforge_codex_briefs where property_id=p_property_id and org_id=organization),'selected',case when b.id is not null then jsonb_build_object('id',b.id,'input',b.input,'document',b.document,'documentHash',b.document_hash,'createdAt',b.created_at,'parentId',b.parent_id)end,'exports',case when jsonb_array_length(v_exports)>20 then v_exports-20 else coalesce(v_exports,'[]')end,'nextExportCursor',case when jsonb_array_length(v_exports)>20 then v_exports->19->>'id'end);
end$$;
revoke all on function public.guard_siteforge_brief_history(),public.save_siteforge_codex_brief(uuid,uuid,uuid,jsonb,text),public.prepare_siteforge_brief_export(uuid,uuid,uuid,uuid,text),public.report_siteforge_brief_export(uuid,uuid,uuid,text),public.read_siteforge_codex_briefs(uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.guard_siteforge_brief_history(),public.save_siteforge_codex_brief(uuid,uuid,uuid,jsonb,text),public.prepare_siteforge_brief_export(uuid,uuid,uuid,uuid,text),public.report_siteforge_brief_export(uuid,uuid,uuid,text),public.read_siteforge_codex_briefs(uuid,uuid,uuid,uuid,uuid)to service_role;
