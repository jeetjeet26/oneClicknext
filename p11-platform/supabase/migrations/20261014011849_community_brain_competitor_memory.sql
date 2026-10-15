begin;
create unique index brain_competitor_chunk_owner_key on public.competitor_content_chunks(id,property_id);
alter table public.community_evidence add column competitor_chunk_id uuid,add column competitor_text_hash text;
alter table public.community_evidence add constraint brain_evidence_competitor_chunk_owner foreign key(competitor_chunk_id,property_id)references public.competitor_content_chunks(id,property_id)on delete restrict;
-- Existing capture-linked text can be replayed deliberately; anonymous legacy
-- chunks are never associated by filename, URL resemblance or vector similarity.
create trigger brain_competitor_memory after insert or update on public.competitor_content_chunks for each row execute function public.brain_enqueue_memory();
create trigger brain_capture_invalidation after insert or update or delete on public.market_source_captures for each row execute function public.brain_invalidate_canonical();
create trigger brain_competitor_invalidation after update on public.competitors for each row execute function public.brain_invalidate_canonical();
do $patch$declare definition text;begin
 select pg_get_functiondef('public.brain_evidence_eligible(uuid,uuid,text,text)'::regprocedure)into definition;
 definition:=replace(definition,'and(e.competitor_id is null or exists',
 'and(e.competitor_chunk_id is null or exists(select 1 from public.competitor_content_chunks cc where cc.id=e.competitor_chunk_id and cc.property_id=e.property_id and cc.capture_id=e.competitor_capture_id and public.knowledge_hash(to_jsonb(cc.content))=e.competitor_text_hash)) and(e.competitor_id is null or exists');
 execute definition;
 select pg_get_functiondef('public.brain_project_memory(uuid,text)'::regprocedure)into definition;
 definition:=replace(definition,'part record;begin','part record;cc public.competitor_content_chunks;capture public.market_source_captures;begin');
 definition:=replace(definition,'elsif ev.source_table=''property_intelligence_documents''then',$branch$
 elsif ev.source_table='competitor_content_chunks'then
  select *into cc from public.competitor_content_chunks where id=ev.source_id and property_id=j.property_id;
  select *into capture from public.market_source_captures where id=cc.capture_id and property_id=j.property_id and competitor_id=cc.competitor_id;
  if capture.status='captured'and capture.content_hash~'^[a-f0-9]{64}$'and capture.captured_at>clock_timestamp()-interval '7 days'
   and exists(select 1 from public.competitors where id=cc.competitor_id and property_id=j.property_id and is_active)then
   h:=capture.content_hash;eid:=md5('competitor:'||cc.id||':'||capture.id||':'||public.knowledge_hash(to_jsonb(cc.content)))::uuid;
   body:=cc.content;
   insert into public.community_evidence(id,property_id,org_id,competitor_capture_id,competitor_id,competitor_chunk_id,competitor_text_hash,authority,audience,purposes,allowed_uses,content_hash,review_status,effective_at,review_after,origin)
   values(eid,j.property_id,j.org_id,capture.id,cc.competitor_id,cc.id,public.knowledge_hash(to_jsonb(cc.content)),'observed','internal',array['research','portfolio'],array['research'],h,'approved',coalesce(capture.effective_at,capture.captured_at),capture.captured_at+interval '7 days','original')on conflict(id)do nothing;
   outcome:='competitor_research_indexed';
  else outcome:='competitor_capture_unresolved_or_stale';end if;
 elsif ev.source_table='property_intelligence_documents'then$branch$);
 definition:=replace(definition,'''sourceHash'',h),eid)',
 '''sourceHash'',h,''competitorId'',cc.competitor_id,''captureId'',capture.id,''sourceUrl'',capture.source_url,''describes'',case when cc.id is not null then ''competitor''else ''community''end),eid)');
 execute definition;
end$patch$;
alter table public.competitor_content_chunks drop constraint competitor_content_chunks_competitor_id_content_hash_key;
alter table public.competitor_content_chunks add constraint competitor_chunks_capture_content unique(competitor_id,capture_id,content_hash);
create function public.brain_competitor_history_guard()returns trigger language plpgsql set search_path='' as $$
begin
 if old.capture_id is not null and(new.capture_id,new.competitor_id,new.property_id,new.page_url,new.content,new.content_hash)is distinct from(old.capture_id,old.competitor_id,old.property_id,old.page_url,old.content,old.content_hash)then raise exception 'Retain captured competitor text; write a new capture version';end if;
 return new;
end$$;
create trigger brain_competitor_history before update on public.competitor_content_chunks for each row execute function public.brain_competitor_history_guard();

commit;
