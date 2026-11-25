-- Rental extraction follows the community's explicit transaction, not its architectural form.
do $$declare definition text;old_guard text:=$guard$if c.property_type not in('multifamily','senior','student','mixed_use','affordable','luxury') or c.property_type is null then return '{"state":"unsupported_pricing_basis"}';end if;$guard$;
 new_guard text:=$guard$if (select public.community_transaction(property_type,settings) from public.properties where id=p_property_id)<>'rental' then return '{"state":"unsupported_pricing_basis"}';end if;$guard$;
begin
 select pg_get_functiondef('public._brain_begin_marketvision_extraction(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure) into definition;
 if position(old_guard in definition)=0 then raise exception 'Review the current extraction pricing guard before migration';end if;
 execute replace(definition,old_guard,new_guard);
 select pg_get_functiondef('public._brain_apply_marketvision_extraction(uuid,uuid,uuid,jsonb)'::regprocedure) into definition;
 if position('select * into c from public.competitors' in definition)=0 then raise exception 'Review the current extraction application contract before migration';end if;
 execute replace(definition,'select * into c from public.competitors',new_guard||E'\n select * into c from public.competitors');
end$$;
