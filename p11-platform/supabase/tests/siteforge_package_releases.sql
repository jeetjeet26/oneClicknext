begin;
do $$
declare j public.siteforge_package_jobs; w uuid:=gen_random_uuid();st uuid:=gen_random_uuid();pr uuid:=gen_random_uuid();pv uuid:=gen_random_uuid();ap uuid:=gen_random_uuid();dep uuid:=gen_random_uuid();s jsonb;p jsonb;rejected boolean;
begin
 select * into j from public.siteforge_package_jobs where state='ready' and target='wordpress' order by created_at desc limit 1;
 if j.id is null then raise exception 'Local qualification requires a ready WordPress fixture';end if;
 insert into public.property_websites(id,property_id,org_id)values(w,j.property_id,j.org_id);
 insert into public.siteforge_wordpress_targets(id,org_id,property_id,website_id,target_type,provider,site_url,credential_ref,status,provider_server_id,provider_application_id)values(st,j.org_id,j.property_id,w,'staging','cloudways','https://preview.example.invalid','fixture-vault','ready','1','2'),(pr,j.org_id,j.property_id,w,'production','cloudways','https://production.example.invalid','fixture-vault','ready','1','3');
 s:=jsonb_build_object('id',st,'websiteId',w,'type','staging','url','https://preview.example.invalid','credentialRef','fixture-vault','serverId','1','applicationId','2');
 p:=jsonb_build_object('id',pr,'websiteId',w,'type','production','url','https://production.example.invalid','credentialRef','fixture-vault','serverId','1','applicationId','3');
 rejected:=false;begin
 insert into public.siteforge_package_releases(id,job_id,property_id,org_id,actor_id,kind,state,package_hash,target_id,target_snapshot)values(gen_random_uuid(),j.id,j.property_id,j.org_id,j.actor_id,'preview','running',j.package_hash,pr,p);
 exception when others then rejected:=true;end;if not rejected then raise exception 'Production accepted as preview';end if;
 insert into public.siteforge_package_releases(id,job_id,property_id,org_id,actor_id,kind,state,package_hash,target_id,target_snapshot)values(pv,j.id,j.property_id,j.org_id,j.actor_id,'preview','running',j.package_hash,st,s);
 rejected:=false;begin
 insert into public.siteforge_package_releases(id,job_id,property_id,org_id,actor_id,kind,state,package_hash,target_id,target_snapshot,preview_id)values(ap,j.id,j.property_id,j.org_id,j.actor_id,'approve','succeeded',j.package_hash,st,s,pv);
 exception when others then rejected:=true;end;if not rejected then raise exception 'Unfinished preview approved';end if;
 update public.siteforge_package_releases set state='succeeded',receipt='{"theme":"fixture"}' where id=pv;
 insert into public.siteforge_package_releases(id,job_id,property_id,org_id,actor_id,kind,state,package_hash,target_id,target_snapshot,preview_id)values(ap,j.id,j.property_id,j.org_id,j.actor_id,'approve','succeeded',j.package_hash,st,s,pv);
 rejected:=false;begin
 insert into public.siteforge_package_releases(id,job_id,property_id,org_id,actor_id,kind,state,package_hash,target_id,target_snapshot,preview_id)values(dep,j.id,j.property_id,j.org_id,j.actor_id,'deploy','running',j.package_hash,pr,p,pv);
 exception when others then rejected:=true;end;if not rejected then raise exception 'Deployment without approval allowed';end if;
 insert into public.siteforge_package_releases(id,job_id,property_id,org_id,actor_id,kind,state,package_hash,target_id,target_snapshot,preview_id,approval_id)values(dep,j.id,j.property_id,j.org_id,j.actor_id,'deploy','running',j.package_hash,pr,p,pv,ap);
 rejected:=false;begin update public.siteforge_package_releases set package_hash=repeat('a',64)where id=dep;exception when others then rejected:=true;end;if not rejected then raise exception 'Release identity changed';end if;
 update public.siteforge_package_releases set state='uncertain' where id=dep;
 rejected:=false;begin
 insert into public.siteforge_package_releases(id,job_id,property_id,org_id,actor_id,kind,state,package_hash,target_id,target_snapshot,preview_id,approval_id)values(gen_random_uuid(),j.id,j.property_id,j.org_id,j.actor_id,'deploy','running',j.package_hash,pr,p,pv,ap);
 exception when others then rejected:=true;end;if not rejected then raise exception 'Uncertain deployment repeated';end if;
 if has_table_privilege('authenticated','public.siteforge_package_releases','SELECT')or has_table_privilege('anon','public.siteforge_package_releases','INSERT') then raise exception 'Private release grants leaked';end if;
 raise notice 'Release qualification passed: preview isolation, approval gate, production gate, immutable identity, uncertain lock, private grants';
end $$;
rollback;
