-- Read-only aggregate audit. Never returns client content, actor IDs or secrets.
-- A zero count qualifies only the records present in this snapshot.
select jsonb_build_object(
 'capturedAt',clock_timestamp(),
 'eventCount',(select count(*)from public.shared_action_events),
 'episodeCount',(select count(*)from public.shared_action_episodes),
 'trainingEligible',(select count(*)from public.shared_action_events where training_eligible),
 'episodeMismatch',(select count(*)from public.shared_action_events e left join public.shared_action_episodes p on p.id=e.episode_id where p.id is null or(e.org_id,e.property_id,e.actor_id,e.service_principal)is distinct from(p.org_id,p.property_id,p.actor_id,p.service_principal)),
 'actorAmbiguity',(select count(*)from public.shared_action_events where(actor_id is null)=(service_principal is null)),
 'observationClaimsSuccess',(select count(*)from public.shared_action_events where evidence='browser_observed'and phase<>'observed'),
 'crossTenantJob',(select count(*)from public.shared_action_events e join public.shared_jobs j on j.id=e.shared_job_ref where(e.org_id,e.property_id)is distinct from(j.org_id,j.property_id)),
 'missingHistoricalJob',(select count(*)from public.shared_action_events e where e.shared_job_ref is not null and not exists(select 1 from public.shared_jobs j where j.id=e.shared_job_ref)),
 'crossTenantAttempt',(select count(*)from public.shared_action_events e join public.shared_action_attempts a on a.id=e.shared_attempt_ref where(e.org_id,e.property_id)is distinct from(a.org_id,a.property_id)),
 'crossTenantContext',(select count(*)from public.shared_action_events e join public.shared_context_snapshots c on c.id=e.context_snapshot_ref where(e.org_id,e.property_id)is distinct from(c.org_id,c.property_id)),
 'futureContext',(select count(*)from public.shared_action_events e join public.shared_context_snapshots c on c.id=e.context_snapshot_ref where c.created_at>e.created_at),
 'missingHistoricalContext',(select count(*)from public.shared_action_events e where e.context_snapshot_ref is not null and not exists(select 1 from public.shared_context_snapshots c where c.id=e.context_snapshot_ref)),
 'outcomeTenantMismatch',(select count(*)from public.shared_experiment_outcomes o join public.shared_action_attempts a on a.id=o.action_attempt_id where(o.org_id,o.property_id)is distinct from(a.org_id,a.property_id)),
 'invalidOutcomeWindow',(select count(*)from public.shared_experiment_outcomes where measurement_window_end<measurement_window_start or measured_at<measurement_window_end),
 'outcomesWithoutAttempt',(select count(*)from public.shared_experiment_outcomes where action_attempt_id is null),
 'scopeCounts',(select coalesce(jsonb_agg(x),'[]'::jsonb)from(select product,evidence,phase,count(*)as count from public.shared_action_events group by product,evidence,phase order by product,evidence,phase)x)
) as audit;
