alter table public.knowledge_sources
drop constraint if exists knowledge_sources_source_type_check;

alter table public.knowledge_sources
add constraint knowledge_sources_source_type_check
check (
  source_type = any (
    array[
      'intake_form'::text,
      'document'::text,
      'website'::text,
      'integration'::text,
      'manual'::text,
      'brand_book'::text
    ]
  )
);
