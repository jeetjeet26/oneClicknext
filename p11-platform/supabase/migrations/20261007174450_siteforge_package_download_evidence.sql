create function public.record_siteforge_package_download(p_property_id uuid,p_job_id uuid,p_actor_id uuid)
returns boolean language plpgsql set search_path='' as $$
declare j public.siteforge_package_jobs; eid uuid:=gen_random_uuid();
begin
  select * into j from public.siteforge_package_jobs where id=p_job_id and property_id=p_property_id and state='ready';
  if not found or not exists(select 1 from public.profiles where id=p_actor_id and org_id=j.org_id and role in ('admin','manager')) then
    return false;
  end if;
  insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)
    values(eid,j.org_id,j.property_id,p_actor_id,'console');
  insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,result,training_eligible)
    values(gen_random_uuid(),eid,j.org_id,j.property_id,p_actor_id,'siteforge','site.package.download_prepared',
      'server_confirmed','succeeded',jsonb_build_object('packageId',j.id),
      jsonb_build_object('packageHash',j.package_hash,'sourceHash',j.source_hash,'requiresHumanReview',true),false);
  return true;
end $$;
revoke all on function public.record_siteforge_package_download(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_siteforge_package_download(uuid,uuid,uuid) to service_role;
