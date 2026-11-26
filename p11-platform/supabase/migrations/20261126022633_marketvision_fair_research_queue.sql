-- A research job returns to queued after each entity. Selecting by its original
-- creation time lets a large community monopolize every scheduled worker turn.
-- Give the next turn to the least recently serviced eligible job instead.
create index if not exists marketvision_research_fair_queue
 on public.marketvision_research_jobs(updated_at,created_at,id)
 where state in ('queued','running');

create or replace function public.claim_marketvision_research(p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.marketvision_research_jobs;
begin
 select * into job from public.marketvision_research_jobs
 where (p_id is null or id=p_id)
 and (state='queued' or (state='running' and leased_at<clock_timestamp()-interval '10 minutes'))
 order by updated_at,created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.marketvision_research_jobs
 set state='running',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=job.id returning * into job;
 return to_jsonb(job);
end$$;
revoke all on function public.claim_marketvision_research(uuid) from public,anon,authenticated;
grant execute on function public.claim_marketvision_research(uuid) to service_role;
