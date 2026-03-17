-- Align lead_engagement_events schema with runtime usage.
-- The app records property-scoped engagement events and stores
-- an explicit score_weight for auditability and analytics.

alter table lead_engagement_events
  add column if not exists property_id uuid references properties(id) on delete cascade,
  add column if not exists score_weight int default 0;

-- Backfill property_id from the related lead when possible.
update lead_engagement_events lee
set property_id = l.property_id
from leads l
where lee.lead_id = l.id
  and lee.property_id is null;

create index if not exists idx_lead_engagement_events_property
  on lead_engagement_events(property_id);

create index if not exists idx_lead_engagement_events_score_weight
  on lead_engagement_events(score_weight);

comment on column lead_engagement_events.property_id is 'Property scope for the engagement event, used for authorization and reporting.';
comment on column lead_engagement_events.score_weight is 'Weight applied by LeadPulse when this event contributes to scoring.';
