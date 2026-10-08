begin;
do $$
declare p uuid; o uuid; a uuid; j uuid:=gen_random_uuid(); before_count bigint; after_count bigint;
begin
  select p1.id,p1.org_id,u.id into p,o,a from public.properties p1 join public.profiles u on u.org_id=p1.org_id
    where u.role in ('admin','manager') and not exists(select 1 from public.siteforge_package_jobs j1 where j1.property_id=p1.id) limit 1;
  if p is null then raise exception 'Local fixture required'; end if;
  select count(*) into before_count from public.shared_action_events;
  insert into public.siteforge_package_jobs(id,property_id,org_id,actor_id,target,instructions,request_hash,source_hash,source_snapshot)
    values(j,p,o,a,'standalone','Build the saved property','request','source','{}');
  begin
    insert into public.siteforge_package_jobs(id,property_id,org_id,actor_id,target,instructions,request_hash,source_hash,source_snapshot)
      values(gen_random_uuid(),p,o,a,'standalone','Second click','request2','source','{}');
    raise exception 'Duplicate active build allowed';
  exception when unique_violation then null; end;
  begin update public.siteforge_package_jobs set instructions='Changed' where id=j;
    raise exception 'Source mutation allowed';
  exception when raise_exception then if sqlerrm='Source mutation allowed' then raise; end if; end;
  begin update public.siteforge_package_jobs set state='ready' where id=j;
    raise exception 'Skipped validation allowed';
  exception when raise_exception then if sqlerrm='Skipped validation allowed' then raise; end if; end;
  update public.siteforge_package_jobs set state='preparing' where id=j;
  update public.siteforge_package_jobs set state='starting' where id=j;
  update public.siteforge_package_jobs set state='uncertain' where id=j;
  begin
    insert into public.siteforge_package_jobs(id,property_id,org_id,actor_id,target,instructions,request_hash,source_hash,source_snapshot)
      values(gen_random_uuid(),p,o,a,'standalone','Retry unknown charge','request3','source','{}');
    raise exception 'Uncertain build allowed duplicate charge';
  exception when unique_violation then null; end;
  select count(*) into after_count from public.shared_action_events;
  if after_count-before_count<>4 then raise exception 'State events missing'; end if;
  if has_table_privilege('anon','public.siteforge_package_jobs','SELECT') or has_table_privilege('authenticated','public.siteforge_package_jobs','SELECT') then raise exception 'Package snapshots exposed'; end if;
  if (select public from storage.buckets where id='siteforge-packages') then raise exception 'Package bucket is public'; end if;
  update public.siteforge_package_jobs set state='generating',response_id='test-response-'||j::text where id=j;
  update public.siteforge_package_jobs set state='packaging' where id=j;
  update public.siteforge_package_jobs set state='ready',package_path='private/test.zip',package_hash='test-hash',package_bytes=123 where id=j;
  if not public.record_siteforge_package_download(p,j,a) then raise exception 'Authorized package download not recorded'; end if;
  if public.record_siteforge_package_download(gen_random_uuid(),j,a) then raise exception 'Wrong-property download allowed'; end if;
  if public.record_siteforge_package_download(p,j,gen_random_uuid()) then raise exception 'Unauthorized download allowed'; end if;
  begin update public.siteforge_package_jobs set package_hash='tampered' where id=j;
    raise exception 'Finished artifact mutation allowed';
  exception when raise_exception then if sqlerrm='Finished artifact mutation allowed' then raise; end if; end;
  raise notice 'PASS: package ownership, duplicate prevention, immutable sources, transition checks, central events and private access';
end $$;
rollback;
