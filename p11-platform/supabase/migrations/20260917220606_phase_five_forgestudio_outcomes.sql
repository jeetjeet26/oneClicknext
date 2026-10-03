-- Measurements are observations, never automatically qualified causal rewards.
create table public.forgestudio_measurements(
 id uuid primary key,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id) on delete cascade,
 publication_id uuid not null references public.social_publications(id) on delete cascade,
 actor_id uuid references public.profiles(id),
 origin text not null check(origin in('console','scheduled_worker','operator_report')),
 state text not null check(state in('queued','reading','completed','failed','unsupported','held')),
 snapshot jsonb not null,
 claim_token uuid,
 lease_expires_at timestamptz,
 result jsonb,
 error_code text,
 review_status text not null default 'unreviewed' check(review_status in('unreviewed','included','excluded')),
 review_version integer not null default 1,
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index forgestudio_measurements_property on public.forgestudio_measurements(property_id,created_at desc,id desc);
create index forgestudio_measurements_publication on public.forgestudio_measurements(publication_id,created_at desc,id desc);
create index forgestudio_measurements_org on public.forgestudio_measurements(org_id);
create index forgestudio_measurements_actor on public.forgestudio_measurements(actor_id);
create index forgestudio_measurements_reviewer on public.forgestudio_measurements(reviewed_by);
alter table public.forgestudio_measurements enable row level security;
revoke all on public.forgestudio_measurements from public,anon,authenticated;
grant all on public.forgestudio_measurements to service_role;
create policy forgestudio_measurements_service on public.forgestudio_measurements for all to service_role using(true) with check(true);
revoke select on public.social_publication_metrics,public.social_attribution_events from anon,authenticated;

create function public.guard_forgestudio_measurement() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from public.properties where id=old.property_id) then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'Measurement evidence is retained';end if;
 if (new.id,new.property_id,new.org_id,new.publication_id,new.actor_id,new.origin,new.snapshot,new.created_at) is distinct from (old.id,old.property_id,old.org_id,old.publication_id,old.actor_id,old.origin,old.snapshot,old.created_at)
 or (old.result is not null and new.result is distinct from old.result)
 or (old.state in('completed','failed','unsupported','held') and new.state<>old.state) then raise exception 'Saved measurement identity and result are immutable';end if;
 return new;
end;$$;
create trigger forgestudio_measurement_immutable before update or delete on public.forgestudio_measurements for each row execute function public.guard_forgestudio_measurement();

create function public.forgestudio_publication_identity(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare publication public.social_publications;begin
 select * into publication from public.social_publications where id=p_id for share;
 if not found or publication.status<>'published' or publication.remote_post_id is null or publication.published_at is null or publication.published_at>clock_timestamp()+interval '5 minutes' then return null;end if;
 if not exists(select 1 from public.properties where id=publication.property_id and org_id=publication.org_id) then return null;end if;
 return jsonb_build_object('publicationId',publication.id,'propertyId',publication.property_id,'orgId',publication.org_id,'revisionId',publication.revision_id,'variantId',publication.variant_id,'connectionId',publication.connection_id,'platform',publication.platform,'remotePostId',publication.remote_post_id,'publishedAt',publication.published_at,'destination',publication.delivery_snapshot);
end;$$;

create function public.forgestudio_measurement_identity(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare identity jsonb;connection public.social_connections;begin
 identity:=public.forgestudio_publication_identity(p_id);if identity is null then return jsonb_build_object('state','publication_unavailable');end if;
 select * into connection from public.social_connections where id=(identity->>'connectionId')::uuid for share;
 if connection.id is null or connection.property_id::text is distinct from identity->>'propertyId' or connection.is_active is not true or nullif(connection.account_id,'') is null then return jsonb_build_object('state','connection_unavailable','publication',identity);end if;
 if identity->'destination' is null or identity->'destination'='null'::jsonb or connection.account_id is distinct from identity->'destination'->>'accountId' or connection.page_id is distinct from identity->'destination'->>'pageId' or connection.platform is distinct from identity->>'platform' then return jsonb_build_object('state','destination_review_required','publication',identity);end if;
 if connection.token_expires_at is not null and connection.token_expires_at<=clock_timestamp() then return jsonb_build_object('state','reconnect_required','publication',identity);end if;
 return jsonb_build_object('state','ready','publication',identity,'credentialHash',public.crm_configuration_hash(jsonb_build_object('accessToken',connection.access_token,'refreshToken',connection.refresh_token,'pageAccessToken',connection.page_access_token,'expiresAt',connection.token_expires_at)));
end;$$;

create function public.begin_forgestudio_measurement(p_id uuid,p_property_id uuid,p_actor_id uuid,p_publication_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;identity jsonb;organization uuid;prior public.forgestudio_measurements;begin
 if p_id is null then raise exception 'Request identity required';end if;
 if p_actor_id is not null then
  response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'metrics.requested',jsonb_build_object('publicationId',p_publication_id));if response->>'state'<>'new' then return response;end if;
 else perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));end if;
 select * into prior from public.forgestudio_measurements where id=p_id;
 if found then
  if (prior.property_id,prior.publication_id,prior.actor_id) is distinct from(p_property_id,p_publication_id,p_actor_id) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','measurementId',prior.id);
 end if;
 identity:=public.forgestudio_measurement_identity(p_publication_id);
 if identity->'publication'->>'propertyId' is distinct from p_property_id::text then return '{"state":"publication_unavailable"}';end if;
 organization:=(identity->'publication'->>'orgId')::uuid;
 select * into prior from public.forgestudio_measurements where publication_id=p_publication_id and state in('queued','reading') order by created_at limit 1;
 if found then
  if p_actor_id is null then return jsonb_build_object('state','replayed','measurementId',prior.id);end if;
  return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'metrics.requested',jsonb_build_object('publicationId',p_publication_id),null,jsonb_build_object('state',prior.state),jsonb_build_object('measurementId',prior.id,'publicationId',p_publication_id,'existingRequest',true));
 end if;

 insert into public.forgestudio_measurements(id,property_id,org_id,publication_id,actor_id,origin,state,snapshot,error_code)values(p_id,p_property_id,organization,p_publication_id,p_actor_id,case when p_actor_id is null then 'scheduled_worker' else 'console' end,case when identity->>'state'='ready' then 'queued' else 'held' end,identity,case when identity->>'state'<>'ready' then identity->>'state' end);
 if p_actor_id is null then return jsonb_build_object('state','saved','measurementId',p_id);end if;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'metrics.requested',jsonb_build_object('publicationId',p_publication_id),null,jsonb_build_object('state',case when identity->>'state'='ready' then 'queued' else 'held' end),jsonb_build_object('measurementId',p_id,'publicationId',p_publication_id));
end;$$;

create function public.claim_forgestudio_measurement(p_id uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.forgestudio_measurements;identity jsonb;connection public.social_connections;begin
 select r.* into run from public.forgestudio_measurements r where (p_id is null or r.id=p_id) and (r.state='queued' or(r.state='reading' and r.lease_expires_at<clock_timestamp())) order by r.created_at,r.id limit 1 for update skip locked;
 if not found then return '{"state":"empty"}';end if;
 identity:=public.forgestudio_measurement_identity(run.publication_id);
 if identity is distinct from run.snapshot then update public.forgestudio_measurements set state='held',error_code='destination_changed',updated_at=clock_timestamp() where id=run.id;return jsonb_build_object('state','held','measurementId',run.id);end if;
 if run.actor_id is not null and not exists(select 1 from public.profiles where id=run.actor_id and org_id=run.org_id) then update public.forgestudio_measurements set state='held',error_code='access_changed',updated_at=clock_timestamp() where id=run.id;return jsonb_build_object('state','held','measurementId',run.id);end if;
 update public.forgestudio_measurements set state='reading',claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() where id=run.id returning * into run;
 select * into connection from public.social_connections where id=(run.snapshot->'publication'->>'connectionId')::uuid;
 return jsonb_build_object('state','claimed','measurement',to_jsonb(run),'connection',to_jsonb(connection));
end;$$;

create function public.validate_forgestudio_metrics(p_metrics jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare key text;value jsonb;normalized jsonb:='{}';keys text[]:=array['impressions','reach','clicks','reactions','comments','shares','saves','video_views','video_completions'];begin
 if jsonb_typeof(p_metrics) is distinct from 'object' or p_metrics-keys<>'{}' then raise exception 'Invalid measurement fields';end if;
 foreach key in array keys loop
  value:=p_metrics->key;
  if value is not null and value<>'null' and (jsonb_typeof(value)<>'number' or value::text!~'^[0-9]+$' or value::numeric>1000000000000) then raise exception 'Measurements must be whole nonnegative counts or unavailable';end if;
  normalized:=normalized||jsonb_build_object(key,coalesce(value,'null'::jsonb));
 end loop;
 return normalized;
end;$$;

create function public.finish_forgestudio_measurement(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.forgestudio_measurements;v_state text;metrics jsonb;begin
 select * into run from public.forgestudio_measurements where id=p_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.claim_token is distinct from p_claim_token or p_claim_token is null then return '{"state":"claim_mismatch"}';end if;
 if run.result is not null then
  if run.result=p_result then return jsonb_build_object('state','replayed','measurementState',run.state);else return '{"state":"result_conflict"}';end if;
 end if;
 if run.state<>'reading' then return '{"state":"not_reading"}';end if;
 if coalesce(p_result->>'status','') not in('observed','unsupported','failed') or length(p_result::text)>262144 then raise exception 'Invalid provider measurement result';end if;
 if p_result->>'status'='observed' then
  metrics:=public.validate_forgestudio_metrics(p_result->'metrics');
  if metrics is distinct from p_result->'metrics' or p_result->>'definition' is distinct from 'provider_reported_snapshot.v1' or (p_result->>'observedAt')::timestamptz<(run.snapshot->'publication'->>'publishedAt')::timestamptz or (p_result->>'observedAt')::timestamptz>clock_timestamp()+interval '5 minutes' or p_result->>'observedAt' is null then raise exception 'Measurement definition and observation time required';end if;
 end if;
 v_state:=case when public.forgestudio_measurement_identity(run.publication_id) is distinct from run.snapshot then 'held' when p_result->>'status'='observed' then 'completed' when p_result->>'status'='unsupported' then 'unsupported' else 'failed' end;
 update public.forgestudio_measurements set state=v_state,result=p_result,error_code=case when v_state='held' then 'destination_changed' when v_state='failed' then 'provider_read_failed' when v_state='unsupported' then 'metrics_unsupported' end,updated_at=clock_timestamp(),lease_expires_at=null where id=run.id;
 return jsonb_build_object('state','saved','measurementState',v_state);
end;$$;

create function public.report_forgestudio_metrics(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;identity jsonb;metrics jsonb;observed timestamptz;begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'metrics.reported',p_payload);if response->>'state'<>'new' then return response;end if;
 identity:=public.forgestudio_publication_identity((p_payload->>'publicationId')::uuid);
 if identity is null or identity->>'propertyId' is distinct from p_property_id::text then return '{"state":"publication_unavailable"}';end if;
 metrics:=public.validate_forgestudio_metrics(p_payload->'metrics');observed:=(p_payload->>'observedAt')::timestamptz;
 if observed is null or observed<(identity->>'publishedAt')::timestamptz or observed>clock_timestamp()+interval '5 minutes' or length(trim(coalesce(p_payload->>'source',''))) not between 3 and 2000 or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 or not exists(select 1 from jsonb_each(metrics) where value<>'null') then raise exception 'Explain the source, time and at least one reported measurement';end if;
 insert into public.forgestudio_measurements(id,property_id,org_id,publication_id,actor_id,origin,state,snapshot,result)values(p_id,p_property_id,(identity->>'orgId')::uuid,(identity->>'publicationId')::uuid,p_actor_id,'operator_report','completed',jsonb_build_object('publication',identity),jsonb_build_object('status','observed','metrics',metrics,'observedAt',observed,'definition','reported_lifetime_snapshot.v1','source',p_payload->>'source','reason',p_payload->>'reason'));
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'metrics.reported',p_payload,null,jsonb_build_object('state','unreviewed'),jsonb_build_object('measurementId',p_id,'publicationId',identity->>'publicationId','origin','operator_report','trainingEligible',false));
end;$$;

create function public.review_forgestudio_measurement(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;run public.forgestudio_measurements;decision text:=p_payload->>'decision';begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'metrics.reviewed',p_payload);if response->>'state'<>'new' then return response;end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and role in('manager','admin')) then return '{"state":"forbidden"}';end if;
 select * into run from public.forgestudio_measurements where id=(p_payload->>'measurementId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if run.org_id is distinct from(select org_id from public.properties where id=p_property_id) then return '{"state":"forbidden"}';end if;
 if run.review_version is distinct from(p_payload->>'expectedVersion')::integer then return '{"state":"stale_measurement"}';end if;
 if run.state<>'completed' or run.result->>'status'<>'observed' then return '{"state":"observation_required"}';end if;
 if decision not in('included','excluded') or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Explain inclusion or exclusion of this exact observation';end if;
 update public.forgestudio_measurements set review_status=decision,review_version=review_version+1,reviewed_by=p_actor_id,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'metrics.reviewed',p_payload,jsonb_build_object('reviewStatus',run.review_status,'reviewVersion',run.review_version),jsonb_build_object('reviewStatus',decision,'reviewVersion',run.review_version+1),jsonb_build_object('measurementId',run.id,'publicationId',run.publication_id,'decision',decision,'reviewVersion',run.review_version+1,'trainingEligible',false));
end;$$;

create function public.due_forgestudio_measurements(p_limit integer default 20,p_property_id uuid default null) returns setof public.social_publications language sql security invoker set search_path='' as $$
 select publication.* from public.social_publications publication left join lateral(select max(created_at) attempted_at from public.forgestudio_measurements m where m.publication_id=publication.id and m.origin<>'operator_report') last_check on true
 where publication.status='published' and publication.remote_post_id is not null and publication.published_at is not null and(p_property_id is null or publication.property_id=p_property_id) and(last_check.attempted_at is null or last_check.attempted_at<clock_timestamp()-interval '24 hours')
 and exists(select 1 from public.properties p where p.id=publication.property_id and p.org_id=publication.org_id)
 order by last_check.attempted_at nulls first,publication.published_at,publication.id limit greatest(1,least(p_limit,100));
$$;

alter table public.social_attribution_events
 add column evidence_kind text not null default 'legacy_unqualified' check(evidence_kind in('legacy_unqualified','redirect_observation','system_report')),
 add column source_system text,
 add column source_event_hash text,
 add column event_state text not null default 'active' check(event_state in('active','excluded')),
 add column decision_version integer not null default 1,
 add column reviewed_by uuid references public.profiles(id),
 add column reviewed_at timestamptz;
create index social_attribution_reviewer on public.social_attribution_events(reviewed_by);
create function public.guard_forgestudio_attribution() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from public.properties where id=old.property_id) then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'Attribution evidence is retained';end if;
 if (to_jsonb(new)-array['event_state','decision_version','reviewed_by','reviewed_at']) is distinct from(to_jsonb(old)-array['event_state','decision_version','reviewed_by','reviewed_at']) then raise exception 'Saved attribution identity and evidence are immutable';end if;
 return new;
end;$$;
create trigger forgestudio_attribution_immutable before update or delete on public.social_attribution_events for each row execute function public.guard_forgestudio_attribution();

create function public.record_forgestudio_attribution(p_token uuid,p_event_type text,p_subject_hash text,p_occurred_at timestamptz,p_source_system text,p_source_event_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare publication public.social_publications;prior public.social_attribution_events;fingerprint text;event_id uuid;origin text;begin
 select * into publication from public.social_publications where tracking_token=p_token for share;
 if not found or public.forgestudio_publication_identity(publication.id) is null then return '{"state":"publication_unavailable"}';end if;
 if coalesce(p_event_type,'') not in('landing_view','lead','tour_booked','tour_completed','lease') or coalesce(p_subject_hash,'')!~'^[a-f0-9]{64}$' or coalesce(p_source_event_hash,'')!~'^[a-f0-9]{64}$' or length(trim(coalesce(p_source_system,''))) not between 1 and 100 then raise exception 'Attributed observation identity required';end if;
 origin:=case when p_event_type='landing_view' then 'redirect_observation' else 'system_report' end;
 fingerprint:='v2:'||public.crm_configuration_hash(jsonb_build_object('propertyId',publication.property_id,'sourceSystem',p_source_system,'sourceEventHash',p_source_event_hash));
 perform pg_advisory_xact_lock(hashtextextended(fingerprint,32));
 select * into prior from public.social_attribution_events where event_fingerprint=fingerprint;
 if found then
  if (prior.publication_id,prior.event_type,prior.anonymous_subject_hash,prior.source_system,prior.source_event_hash) is distinct from(publication.id,p_event_type,p_subject_hash,p_source_system,p_source_event_hash) or(origin='system_report' and prior.occurred_at is distinct from p_occurred_at) then return '{"state":"source_event_conflict"}';end if;
  return jsonb_build_object('state','replayed','publicationId',publication.id,'eventId',prior.id,'eventState',prior.event_state,'evidenceKind',prior.evidence_kind);
 end if;
 if p_occurred_at is null or p_occurred_at<publication.published_at or p_occurred_at>clock_timestamp()+interval '5 minutes' or p_occurred_at>publication.published_at+interval '30 days' then return '{"state":"outside_measurement_window"}';end if;
 insert into public.social_attribution_events(publication_id,action_attempt_id,org_id,property_id,event_type,anonymous_subject_hash,event_fingerprint,occurred_at,attribution_window_days,metadata,evidence_kind,source_system,source_event_hash)
 values(publication.id,publication.shared_action_attempt_id,publication.org_id,publication.property_id,p_event_type,p_subject_hash,fingerprint,p_occurred_at,30,jsonb_build_object('method','reported_tracking_token_association','definition','attribution_observation.v2','verified',false,'trainingEligible',false),origin,p_source_system,p_source_event_hash) returning id into event_id;
 return jsonb_build_object('state','saved','publicationId',publication.id,'eventId',event_id,'evidenceKind',origin,'eventState','active');
end;$$;

create function public.review_forgestudio_attribution(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;event public.social_attribution_events;decision text:=p_payload->>'decision';begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'attribution.reviewed',p_payload);if response->>'state'<>'new' then return response;end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and role in('manager','admin')) then return '{"state":"forbidden"}';end if;
 select * into event from public.social_attribution_events where id=(p_payload->>'eventId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if event.org_id is distinct from(select org_id from public.properties where id=p_property_id) then return '{"state":"forbidden"}';end if;
 if event.decision_version is distinct from(p_payload->>'expectedVersion')::integer then return '{"state":"stale_attribution"}';end if;
 if coalesce(decision,'') not in('active','excluded') or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Explain this attribution evidence decision';end if;
 update public.social_attribution_events set event_state=decision,decision_version=decision_version+1,reviewed_by=p_actor_id,reviewed_at=clock_timestamp() where id=event.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'attribution.reviewed',p_payload,jsonb_build_object('eventState',event.event_state,'decisionVersion',event.decision_version),jsonb_build_object('eventState',decision,'decisionVersion',event.decision_version+1),jsonb_build_object('eventId',event.id,'publicationId',event.publication_id,'evidenceKind',event.evidence_kind,'decision',decision,'decisionVersion',event.decision_version+1,'trainingEligible',false));
end;$$;

-- Preserve historical values and their prior classification, but explicitly remove
-- an unsupported automatic reward label from these two old ForgeStudio writers.
update public.shared_experiment_outcomes set attribution_payload=attribution_payload||jsonb_build_object('qualification','legacy_unreviewed','trainingEligible',false,'legacyOutcomeStatus',outcome_status),outcome_status='unknown'
 where (attribution_payload->>'source'='social_publication_metrics' or attribution_payload->>'method'='tracking_token_last_touch') and attribution_payload->>'qualification' is distinct from 'legacy_unreviewed';

create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

revoke all on function public.guard_forgestudio_measurement(),public.forgestudio_publication_identity(uuid),public.forgestudio_measurement_identity(uuid),public.begin_forgestudio_measurement(uuid,uuid,uuid,uuid),public.claim_forgestudio_measurement(uuid),public.validate_forgestudio_metrics(jsonb),public.finish_forgestudio_measurement(uuid,uuid,jsonb),public.report_forgestudio_metrics(uuid,uuid,uuid,jsonb),public.review_forgestudio_measurement(uuid,uuid,uuid,jsonb),public.due_forgestudio_measurements(integer,uuid),public.guard_forgestudio_attribution(),public.record_forgestudio_attribution(uuid,text,text,timestamptz,text,text),public.review_forgestudio_attribution(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_forgestudio_measurement(),public.forgestudio_publication_identity(uuid),public.forgestudio_measurement_identity(uuid),public.begin_forgestudio_measurement(uuid,uuid,uuid,uuid),public.claim_forgestudio_measurement(uuid),public.validate_forgestudio_metrics(jsonb),public.finish_forgestudio_measurement(uuid,uuid,jsonb),public.report_forgestudio_metrics(uuid,uuid,uuid,jsonb),public.review_forgestudio_measurement(uuid,uuid,uuid,jsonb),public.due_forgestudio_measurements(integer,uuid),public.guard_forgestudio_attribution(),public.record_forgestudio_attribution(uuid,text,text,timestamptz,text,text),public.review_forgestudio_attribution(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
