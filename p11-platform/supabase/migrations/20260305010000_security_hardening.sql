-- Post-bootstrap hardening for fresh Supabase installs.

-- Make helper views use the querying user's permissions.
create or replace view website_summary
with (security_invoker = true) as
select
  pw.id,
  pw.property_id,
  p.name as property_name,
  pw.generation_status,
  pw.generation_progress,
  pw.brand_source,
  pw.brand_confidence,
  pw.wp_url,
  pw.version,
  coalesce(jsonb_array_length(pw.pages_generated), 0) as pages_count,
  count(distinct wa.id) as assets_count,
  pw.created_at,
  pw.updated_at
from property_websites pw
join properties p on p.id = pw.property_id
left join website_assets wa on wa.website_id = pw.id
group by pw.id, p.name;

create or replace view brand_books
with (security_invoker = true) as
select
  id,
  property_id,
  coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce(section_2_positioning->'differentiators', '[]'::jsonb)
      )
    ),
    array[]::text[]
  ) as unique_selling_points,
  coalesce(
    section_3_target_audience->>'primary',
    conversation_summary->>'targetAudience'
  ) as target_audience,
  created_at
from property_brand_assets;

-- Replace permissive system policies with explicit service-role policies.
drop policy if exists "System manage calendar events" on calendar_events;
create policy "Service role manage calendar events"
  on calendar_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "System manage email threads" on email_threads;
create policy "Service role manage email threads"
  on email_threads for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "System manage email messages" on email_messages;
create policy "Service role manage email messages"
  on email_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Pin search_path on mutable functions flagged by advisors.
alter function public.get_onboarding_progress(uuid) set search_path = public;
alter function public.create_default_onboarding_tasks(uuid) set search_path = public;
alter function public.score_lead(uuid) set search_path = public;
alter function public.match_competitor_content(vector, double precision, integer, uuid, uuid[]) set search_path = public;
alter function public.update_updated_at_column() set search_path = public;
alter function public.update_property_websites_updated_at() set search_path = public;
alter function public.set_property_website_org_id() set search_path = public;
alter function public.update_scrape_job_progress(uuid, integer, integer, uuid, uuid, jsonb) set search_path = public;
alter function public.update_marketvision_updated_at() set search_path = public;
alter function public.update_geo_runs_timestamp() set search_path = public;
alter function public.update_supporting_schema_updated_at() set search_path = public;
