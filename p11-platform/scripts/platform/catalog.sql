-- Read-only structural fingerprint. No user rows, secrets, sequence values or provider commands.
with objects as (
 select 'relation'kind,n.nspname||'.'||c.relname identity,
 jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'options',c.reloptions,'acl',coalesce(c.relacl::text,'DEFAULT'),'definitionHash',case when c.relkind in('v','m')then md5(pg_get_viewdef(c.oid,true))end,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid)),'acl',a.attacl::text)order by a.attnum)from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))value
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')and c.relkind in('r','p','v','m','f')
 union all
 select 'schema',nspname,jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',coalesce(nspacl::text,'DEFAULT'))from pg_namespace where nspname in('public','private')
 union all
 select 'role',rolname,jsonb_build_object('superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'bypassRls',rolbypassrls)from pg_roles where rolname in('anon','authenticated','service_role','postgres','supabase_admin')
 union all
 select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('owner',pg_get_userbyid(p.proowner),'kind',p.prokind,'securityDefiner',p.prosecdef,'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,'leakproof',p.proleakproof,'returnType',pg_get_function_result(p.oid),'language',l.lanname,'bodyHash',md5(p.prosrc),'definitionHash',md5(pg_get_functiondef(p.oid)),'configHash',md5(p.proconfig::text),'acl',coalesce(p.proacl::text,'DEFAULT'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'extension',(select e.extname from pg_depend d join pg_extension e on e.oid=d.refobjid where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in('public','private')and p.prokind in('f','p')
 union all
 select 'policy',schemaname||'.'||tablename||'.'||policyname,jsonb_build_object('roles',roles,'command',cmd,'permissive',permissive,'usingHash',md5(qual),'checkHash',md5(with_check))from pg_policies where schemaname in('public','private','storage')
 union all
 select 'constraint',n.nspname||'.'||c.relname||'.'||k.conname,jsonb_build_object('type',k.contype,'valid',k.convalidated,'deferred',k.condeferred,'deferrable',k.condeferrable,'definitionHash',md5(pg_get_constraintdef(k.oid,true)))from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')
 union all
 select 'index',schemaname||'.'||indexname,jsonb_build_object('table',tablename,'definitionHash',md5(indexdef),'valid',i.indisvalid,'ready',i.indisready)from pg_indexes x join pg_class c on c.relname=x.indexname join pg_namespace n on n.oid=c.relnamespace and n.nspname=x.schemaname join pg_index i on i.indexrelid=c.oid where x.schemaname in('public','private')
 union all
 select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('enabled',t.tgenabled,'definitionHash',md5(pg_get_triggerdef(t.oid,true)))from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('public','private','auth','storage')
 union all
 select 'enum',n.nspname||'.'||t.typname,jsonb_build_object('values',jsonb_agg(e.enumlabel order by e.enumsortorder))from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname in('public','private')group by n.nspname,t.typname
 union all
 select 'default_acl',pg_get_userbyid(d.defaclrole)||'.'||coalesce(n.nspname,'GLOBAL')||'.'||d.defaclobjtype::text,jsonb_build_object('acl',d.defaclacl::text)from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname in('public','private')or d.defaclnamespace=0
 union all
 select 'extension',e.extname,jsonb_build_object('schema',n.nspname,'version',e.extversion)from pg_extension e join pg_namespace n on n.oid=e.extnamespace
 union all
 select 'sequence',n.nspname||'.'||c.relname,jsonb_build_object('type',format_type(s.seqtypid,null),'start',s.seqstart,'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')
)
select kind,identity,value from objects order by kind,identity;
