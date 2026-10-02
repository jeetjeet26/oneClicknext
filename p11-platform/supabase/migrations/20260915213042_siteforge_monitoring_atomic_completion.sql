-- One transaction per observed website; browser/authenticated clients cannot execute it.
create or replace function public.finalize_siteforge_health_run(
  p_run_id uuid, p_status text, p_checks jsonb, p_evidence jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.siteforge_health_runs%rowtype;
  prior public.siteforge_incidents%rowtype;
  item record;
  notification jsonb;
  state text;
  v_severity text;
  stamp timestamptz;
  superseded boolean;
  changed jsonb := '[]'::jsonb;
  alerts jsonb := '[]'::jsonb;
  outcome jsonb;
  incident_id uuid;
  priorities text[] := array['low','medium','high','critical'];
begin
  if p_status not in ('healthy','degraded','unhealthy','failed') or jsonb_typeof(p_checks) <> 'object'
     or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Invalid monitoring completion';
  end if;
  select * into strict r from public.siteforge_health_runs where id = p_run_id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('siteforge-health:' || r.website_id::text, 0));
  stamp := clock_timestamp();
  if r.status <> 'running' then
    if r.evidence ? 'commit' then return r.evidence->'commit'; end if;
    raise exception 'Health run is no longer running';
  end if;
  select exists(select 1 from public.siteforge_health_runs newer
    where newer.website_id = r.website_id and (newer.started_at,newer.id) > (r.started_at,r.id)
      and newer.completed_at is not null and newer.status <> 'failed') into superseded;
  if p_status <> 'failed' and p_evidence->>'purpose' = 'production' and not superseded then
    for item in select key,value from pg_catalog.jsonb_each(p_checks) order by key loop
      state := item.value->>'state';
      if state not in ('healthy','failed') or state is null then continue; end if;
      select * into prior from public.siteforge_incidents
        where website_id=r.website_id and dedupe_key='production-health:' || item.key and status <> 'resolved'
        for update;
      if state = 'healthy' then
        if prior.id is not null and r.trigger_type <> 'repair' then
          update public.siteforge_incidents set status='resolved',resolved_at=stamp,updated_at=stamp where id=prior.id;
        end if;
        continue;
      end if;
      v_severity := coalesce(item.value->>'severity','medium');
      notification := coalesce(prior.evidence->'notification','{}'::jsonb);
      if prior.id is null or (
        array_position(priorities,v_severity) > array_position(priorities,prior.severity)
        and not coalesce(array_position(priorities,notification->>'severity') >= array_position(priorities,v_severity),false)
      ) then
        notification := jsonb_build_object('version',1,'state','pending','severity',v_severity);
      elsif notification = '{}'::jsonb then
        notification := jsonb_build_object('version',1,'state','historical','severity',prior.severity);
      end if;
      if prior.id is null then
        insert into public.siteforge_incidents(org_id,property_id,website_id,artifact_id,dedupe_key,severity,category,title,summary,evidence,updated_at)
        values(r.org_id,r.property_id,r.website_id,r.artifact_id,'production-health:'||item.key,v_severity,item.key,
          'Production '||item.key||' check failed',coalesce(item.value->>'summary','Observed failure'),
          coalesce(item.value->'evidence','{}'::jsonb)||jsonb_build_object('healthRunId',r.id,'healthStartedAt',r.started_at,'notification',notification),stamp)
        returning id into incident_id;
        changed := changed || jsonb_build_array(incident_id);
      else
        incident_id := prior.id;
        update public.siteforge_incidents set artifact_id=r.artifact_id,severity=v_severity,
          summary=coalesce(item.value->>'summary','Observed failure'),
          evidence=coalesce(item.value->'evidence','{}'::jsonb)||jsonb_build_object('healthRunId',r.id,'healthStartedAt',r.started_at,'notification',notification),
          updated_at=stamp where id=prior.id;
        if prior.severity <> v_severity then changed := changed || jsonb_build_array(incident_id); end if;
      end if;
      alerts := alerts || jsonb_build_array(incident_id);
    end loop;
  end if;
  -- Execution failures use the same transaction and ordering as observations.
  if p_evidence->>'purpose' = 'production' and not exists(
    select 1 from public.siteforge_health_runs newer where newer.website_id=r.website_id
      and (newer.started_at,newer.id)>(r.started_at,r.id) and newer.completed_at is not null
  ) then
    select * into prior from public.siteforge_incidents
      where website_id=r.website_id and dedupe_key='operation:monitoring' and status <> 'resolved' for update;
    if p_status='failed' then
      notification := case when prior.id is null then jsonb_build_object('version',1,'state','pending','severity','high')
        else coalesce(prior.evidence->'notification',jsonb_build_object('version',1,'state','historical','severity','high')) end;
      if prior.id is null then
        insert into public.siteforge_incidents(org_id,property_id,website_id,dedupe_key,severity,category,title,summary,evidence)
        values(r.org_id,r.property_id,r.website_id,'operation:monitoring','high','monitoring_execution',
          'Website monitoring could not complete',coalesce(p_evidence->>'error','Monitoring did not complete'),
          jsonb_build_object('healthRunId',r.id,'healthStartedAt',r.started_at,'notification',notification)) returning id into incident_id;
        changed := changed || jsonb_build_array(incident_id);
      else
        incident_id := prior.id;
        update public.siteforge_incidents set summary=coalesce(p_evidence->>'error','Monitoring did not complete'),
          evidence=jsonb_build_object('healthRunId',r.id,'healthStartedAt',r.started_at,'notification',notification),updated_at=stamp where id=prior.id;
      end if;
      alerts := alerts || jsonb_build_array(incident_id);
    elsif prior.id is not null then
      update public.siteforge_incidents set status='resolved',resolved_at=stamp,updated_at=stamp where id=prior.id;
    end if;
  end if;
  outcome := jsonb_build_object('incidentChanges',changed,'alertIncidentIds',alerts,'superseded',superseded);
  update public.siteforge_health_runs set status=p_status,checks=p_checks,
    evidence=p_evidence||jsonb_build_object('commit',outcome),completed_at=stamp where id=r.id;
  return outcome;
end;
$$;
revoke all on function public.finalize_siteforge_health_run(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_siteforge_health_run(uuid,text,jsonb,jsonb) to service_role;

create index if not exists siteforge_health_runs_observation_order_idx
  on public.siteforge_health_runs(website_id,started_at desc,id desc) where completed_at is not null;

-- A single scheduler cursor is internal service state, never client data access.
create table if not exists public.siteforge_monitoring_sweep (
  singleton boolean primary key default true check(singleton),
  after_id uuid,
  through_id uuid,
  lease_token uuid,
  lease_until timestamptz,
  started_at timestamptz
);
alter table public.siteforge_monitoring_sweep enable row level security;
revoke all on public.siteforge_monitoring_sweep from public,anon,authenticated;
grant all on public.siteforge_monitoring_sweep to service_role;
insert into public.siteforge_monitoring_sweep(singleton) values(true) on conflict do nothing;

create or replace function public.claim_siteforge_monitoring_sweep(p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.siteforge_monitoring_sweep%rowtype;
begin
  if p_token is null then raise exception 'A lease token is required'; end if;
  select * into strict s from public.siteforge_monitoring_sweep where singleton for update;
  if s.lease_until > clock_timestamp() then return jsonb_build_object('claimed',false); end if;
  if s.through_id is null then
    select id into s.through_id from public.property_websites
      where production_url is not null and production_certified_at is not null order by id desc limit 1;
    s.after_id := null; s.started_at := clock_timestamp();
  end if;
  update public.siteforge_monitoring_sweep set after_id=s.after_id,through_id=s.through_id,started_at=s.started_at,
    lease_token=p_token,lease_until=clock_timestamp()+interval '6 minutes' where singleton;
  return jsonb_build_object('claimed',true,'afterId',s.after_id,'throughId',s.through_id,'startedAt',s.started_at);
end;
$$;
create or replace function public.checkpoint_siteforge_monitoring_sweep(p_token uuid,p_after_id uuid,p_complete boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.siteforge_monitoring_sweep%rowtype;
begin
  select * into strict s from public.siteforge_monitoring_sweep where singleton for update;
  if p_token is null or s.lease_token is null or s.lease_until is null or s.lease_token is distinct from p_token or s.lease_until <= clock_timestamp() then raise exception 'Monitoring lease expired or replaced'; end if;
  if p_after_id is not null and ((s.after_id is not null and p_after_id < s.after_id) or s.through_id is null or p_after_id > s.through_id) then raise exception 'Invalid monitoring cursor'; end if;
  update public.siteforge_monitoring_sweep set
    after_id=case when p_complete then null else coalesce(p_after_id,s.after_id) end,
    through_id=case when p_complete then null else s.through_id end,
    lease_token=case when p_complete then null else s.lease_token end,
    lease_until=case when p_complete then null else s.lease_until end where singleton;
end;
$$;
create or replace function public.release_siteforge_monitoring_sweep(p_token uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.siteforge_monitoring_sweep set lease_token=null,lease_until=null where singleton and lease_token=p_token;
end;
$$;
revoke all on function public.claim_siteforge_monitoring_sweep(uuid),public.checkpoint_siteforge_monitoring_sweep(uuid,uuid,boolean),public.release_siteforge_monitoring_sweep(uuid) from public,anon,authenticated;
grant execute on function public.claim_siteforge_monitoring_sweep(uuid),public.checkpoint_siteforge_monitoring_sweep(uuid,uuid,boolean),public.release_siteforge_monitoring_sweep(uuid) to service_role;
