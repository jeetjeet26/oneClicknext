begin;
do $$
declare p uuid; denied boolean:=false;
begin
 select id into p from public.properties limit 1;
 if p is null then raise exception 'Property fixture required'; end if;
 if exists(select 1 from public.properties where not public.brain_feature_enabled(id,'site')) then
  raise exception 'SiteForge is not available for every property';
 end if;
 if public.brain_feature_enabled('00000000-0000-0000-0000-000000000000','site') then
  raise exception 'Unknown property accepted';
 end if;
 -- A property without a rollout record represents the future-property boundary.
 delete from public.community_brain_settings where property_id=p;
 if not public.brain_feature_enabled(p,'site') then raise exception 'SiteForge requires a rollout record'; end if;
 begin
  perform public.brain_resolve_scope('00000000-0000-0000-0000-000000000000',array[p],'site');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Unauthorized actor accepted'; end if;
 if has_function_privilege('anon','public.brain_feature_enabled(uuid,text)','EXECUTE')
 or has_function_privilege('authenticated','public.brain_feature_enabled(uuid,text)','EXECUTE') then
  raise exception 'Private function exposed';
 end if;
end $$;
rollback;
