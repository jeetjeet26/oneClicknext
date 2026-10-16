begin;
-- Index exact retained chunks under their material's transaction-local scope.
-- Worker grants, community ownership, leases and source approval stay required.
-- The managed-document guard continues to block direct source-content writes.
do $migration$
declare definition text; patched text;
begin
 select pg_get_functiondef('public.brain_project_memory(uuid,text)'::regprocedure) into definition;
 if position('previous_knowledge_scope' in definition)>0 then raise exception 'Projection scope repair already present';end if;
 patched:=replace(definition,'declare j public.shared_jobs;',
  'declare previous_knowledge_scope text:=current_setting(''p11.knowledge_scope'',true);j public.shared_jobs;');
 if patched=definition then raise exception 'Projection declaration changed; review migration';end if;
 definition:=patched;
 patched:=replace(definition,E'if v.id is not null then\n   update public.documents indexed_doc set',
  E'if v.id is not null then\n   perform set_config(''p11.knowledge_scope'',v.material_id::text,true);\n   update public.documents indexed_doc set');
 if patched=definition then raise exception 'Managed projection update changed; review migration';end if;
 definition:=patched;
 patched:=replace(definition,'and indexed_doc.metadata->>''chunk_index''=(ch.n-1)::text',
  'and indexed_doc.metadata->>''knowledge_material_id''=v.material_id::text and indexed_doc.metadata->>''chunk_index''=(ch.n-1)::text');
 if patched=definition then raise exception 'Managed projection identity changed; review migration';end if;
 definition:=patched;
 patched:=replace(definition,'and indexed_doc.embedding operator(public.=) (emb->''embedding'')::text::public.vector;',
  E'and indexed_doc.embedding operator(public.=) (emb->''embedding'')::text::public.vector;\n   perform set_config(''p11.knowledge_scope'',coalesce(previous_knowledge_scope,''''),true);');
 if patched=definition then raise exception 'Managed projection receipt check changed; review migration';end if;
 execute patched;
end $migration$;
commit;
