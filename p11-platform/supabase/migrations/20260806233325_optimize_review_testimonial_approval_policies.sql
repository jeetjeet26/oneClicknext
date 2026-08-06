create index if not exists review_testimonial_approvals_approved_by_idx
  on public.review_testimonial_approvals (approved_by);

create index if not exists review_testimonial_approvals_revoked_by_idx
  on public.review_testimonial_approvals (revoked_by)
  where revoked_by is not null;

drop policy if exists "Users view their org testimonial approvals"
  on public.review_testimonial_approvals;
create policy "Users view their org testimonial approvals"
  on public.review_testimonial_approvals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      join public.properties
        on properties.id = review_testimonial_approvals.property_id
      where profiles.id = (select auth.uid())
        and profiles.org_id = properties.org_id
    )
  );

drop policy if exists "Service role manages testimonial approvals"
  on public.review_testimonial_approvals;
create policy "Service role manages testimonial approvals"
  on public.review_testimonial_approvals
  for all
  to service_role
  using (true)
  with check (true);
