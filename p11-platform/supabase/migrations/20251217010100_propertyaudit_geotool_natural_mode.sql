-- PropertyAudit GEO Natural Mode
-- Adds support for storing the full natural LLM response and which analysis method was used.

alter table if exists geo_answers
  add column if not exists natural_response text;

alter table if exists geo_answers
  add column if not exists analysis_method text default 'structured';
