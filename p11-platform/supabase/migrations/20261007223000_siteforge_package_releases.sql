-- Exact-package preview, approval and Cloudways release records. No hosted mutation.
create table public.siteforge_package_releases (
 id uuid primary key,
 job_id uuid not null references public.siteforge_package_jobs(id),
 property_id uuid not null references public.properties(id),
 org_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('preview','approve','deploy')),
 state text not null check(state in ('running','succeeded','uncertain')),
 package_hash text not null check(package_hash ~ '^[a-f0-9]{64}$'),
 target_id uuid not null references public.siteforge_wordpress_targets(id),
 target_snapshot jsonb not null,
 preview_id uuid references public.siteforge_package_releases(id),
 approval_id uuid references public.siteforge_package_releases(id),
 receipt jsonb not null default '{}',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.siteforge_package_releases enable row level security;
revoke all on public.siteforge_package_releases from public,anon,authenticated;
grant select,insert,update on public.siteforge_package_releases to service_role;
create unique index siteforge_package_target_inflight on public.siteforge_package_releases(target_id) where kind in ('preview','deploy') and state in ('running','uncertain');
create index siteforge_package_release_history on public.siteforge_package_releases(job_id,created_at desc);
create function public.guard_siteforge_package_release() returns trigger language plpgsql set search_path='' as $$
declare j public.siteforge_package_jobs;t public.siteforge_wordpress_targets;p public.siteforge_package_releases;a public.siteforge_package_releases;
begin
 if tg_op='DELETE' then raise exception 'Release history is retained';end if;
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['state','receipt','updated_at']) is distinct from (to_jsonb(old)-array['state','receipt','updated_at']) or old.state not in ('running','uncertain') or new.state not in ('running','succeeded','uncertain') or (old.state='uncertain' and new.state<>'succeeded') then raise exception 'Release identity and finished results are immutable';end if;
  new.updated_at=now();return new;
 end if;
 select * into j from public.siteforge_package_jobs where id=new.job_id;
 select * into t from public.siteforge_wordpress_targets where id=new.target_id;
 perform pg_advisory_xact_lock(hashtextextended(t.website_id::text, 742));
 select * into t from public.siteforge_wordpress_targets where id=new.target_id for update;
 if j.id is null or j.state<>'ready' or j.target<>'wordpress' or j.package_hash is distinct from new.package_hash or j.property_id<>new.property_id or j.org_id<>new.org_id then raise exception 'Ready exact WordPress package required';end if;
 if not exists(select 1 from public.profiles where id=new.actor_id and org_id=new.org_id and role in ('admin','manager')) then raise exception 'Internal manager required';end if;
 if t.id is null or not t.is_active or t.status<>'ready' or t.provider<>'cloudways' or t.property_id<>new.property_id or t.org_id<>new.org_id or t.credential_ref is null or t.site_url is null then raise exception 'Ready property Cloudways target required';end if;
 if new.target_snapshot is distinct from jsonb_build_object('id',t.id,'websiteId',t.website_id,'type',t.target_type,'url',t.site_url,'credentialRef',t.credential_ref,'serverId',t.provider_server_id,'applicationId',t.provider_application_id) then raise exception 'Target changed';end if;
 if new.kind='preview' then
  if exists(select 1 from public.siteforge_package_releases d join public.siteforge_package_releases preview_release on preview_release.id=d.preview_id where d.kind='deploy' and d.state in ('running','uncertain') and preview_release.target_id=new.target_id) then raise exception 'This preview is being deployed; inspect the existing release first';end if;
  if t.target_type<>'staging' or new.state<>'running' or new.preview_id is not null or new.approval_id is not null then raise exception 'Separate staging preview required';end if;
 else
  select * into p from public.siteforge_package_releases where id=new.preview_id;
  if p.kind is distinct from 'preview' or p.state is distinct from 'succeeded' or p.job_id<>new.job_id or p.package_hash<>new.package_hash or p.target_snapshot->>'websiteId'<>t.website_id::text then raise exception 'Successful preview of this exact package required';end if;
  if exists(select 1 from public.siteforge_package_releases where target_id=p.target_id and kind in ('preview','deploy') and created_at>p.created_at) then raise exception 'Preview was superseded';end if;
  if new.kind='approve' then
   if new.target_id<>p.target_id or new.target_snapshot<>p.target_snapshot or new.state<>'succeeded' or new.approval_id is not null then raise exception 'Approve the reviewed preview';end if;
  else
   select * into a from public.siteforge_package_releases where id=new.approval_id;
   if a.kind is distinct from 'approve' or a.state is distinct from 'succeeded' or a.preview_id<>p.id or a.job_id<>j.id or a.package_hash<>j.package_hash or t.target_type<>'production' or t.site_url=p.target_snapshot->>'url' or new.state<>'running' then raise exception 'Approved package and separate production target required';end if;
  end if;
 end if;
 return new;
end $$;
create trigger guard_siteforge_package_release before insert or update or delete on public.siteforge_package_releases for each row execute function public.guard_siteforge_package_release();
create function public.record_siteforge_package_release() returns trigger language plpgsql set search_path='' as $$
declare eid uuid:=gen_random_uuid();
begin
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin) values(eid,new.org_id,new.property_id,case when tg_op='INSERT' then new.actor_id end,case when tg_op='UPDATE' then 'siteforge.delivery' end,case when tg_op='INSERT' then 'console' else 'workflow' end);
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,product,action,evidence,phase,request,result,training_eligible)
 values(gen_random_uuid(),eid,new.org_id,new.property_id,case when tg_op='INSERT' then new.actor_id end,case when tg_op='UPDATE' then 'siteforge.delivery' end,'siteforge','site.package.'||new.kind||'.'||new.state,'server_confirmed',case when new.state='uncertain' then 'failed' else 'succeeded' end,jsonb_build_object('releaseId',new.id,'jobId',new.job_id,'packageHash',new.package_hash,'targetId',new.target_id),jsonb_build_object('state',new.state,'receipt',new.receipt),false);
 return new;
end $$;
create trigger record_siteforge_package_release after insert or update on public.siteforge_package_releases for each row execute function public.record_siteforge_package_release();
revoke all on function public.guard_siteforge_package_release(),public.record_siteforge_package_release() from public,anon,authenticated;
grant execute on function public.guard_siteforge_package_release(),public.record_siteforge_package_release() to service_role;
