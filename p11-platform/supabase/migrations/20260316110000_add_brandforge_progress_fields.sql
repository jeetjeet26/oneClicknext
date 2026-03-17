alter table public.property_brand_assets
  add column if not exists current_step integer,
  add column if not exists current_step_name text,
  add column if not exists draft_section jsonb;

comment on column public.property_brand_assets.current_step is
  'Current BrandForge generation step number (1-12) being reviewed or generated.';
comment on column public.property_brand_assets.current_step_name is
  'Current BrandForge section slug for operator-visible progress.';
comment on column public.property_brand_assets.draft_section is
  'Draft BrandForge section awaiting review before approval.';

with progress as (
  select
    id,
    (
      case when section_1_introduction is not null then 1 else 0 end +
      case when section_2_positioning is not null then 1 else 0 end +
      case when section_3_target_audience is not null then 1 else 0 end +
      case when section_4_personas is not null then 1 else 0 end +
      case when section_5_name_story is not null then 1 else 0 end +
      case when section_6_logo is not null then 1 else 0 end +
      case when section_7_typography is not null then 1 else 0 end +
      case when section_8_colors is not null then 1 else 0 end +
      case when section_9_design_elements is not null then 1 else 0 end +
      case when section_10_photo_yep is not null then 1 else 0 end +
      case when section_11_photo_nope is not null then 1 else 0 end +
      case when section_12_implementation is not null then 1 else 0 end
    ) as approved_sections
  from public.property_brand_assets
)
update public.property_brand_assets assets
set
  current_step = case
    when assets.generation_status = 'complete' then 12
    when progress.approved_sections between 0 and 11
      and assets.conversation_summary is not null then progress.approved_sections + 1
    else assets.current_step
  end,
  current_step_name = case
    when assets.generation_status = 'complete' then 'implementation'
    when assets.conversation_summary is null then assets.current_step_name
    when progress.approved_sections = 0 then 'introduction'
    when progress.approved_sections = 1 then 'positioning'
    when progress.approved_sections = 2 then 'target_audience'
    when progress.approved_sections = 3 then 'personas'
    when progress.approved_sections = 4 then 'name_story'
    when progress.approved_sections = 5 then 'logo'
    when progress.approved_sections = 6 then 'typography'
    when progress.approved_sections = 7 then 'colors'
    when progress.approved_sections = 8 then 'design_elements'
    when progress.approved_sections = 9 then 'photo_yep'
    when progress.approved_sections = 10 then 'photo_nope'
    when progress.approved_sections = 11 then 'implementation'
    else assets.current_step_name
  end
from progress
where assets.id = progress.id;
