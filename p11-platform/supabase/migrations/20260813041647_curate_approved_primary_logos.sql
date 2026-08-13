-- Brand approval is a manager curation decision. Repair primary logos that
-- already satisfy every immutable approval and rights requirement but were
-- left at the legacy needs_review default.
update public.content_assets
set
  curation_status = 'approved',
  updated_at = now()
where asset_role = 'primary_logo'
  and approval_status = 'approved'
  and curation_status = 'needs_review'
  and rights_status in ('owned', 'licensed', 'generated')
  and (expires_at is null or expires_at > now())
  and duplicate_of is null;
