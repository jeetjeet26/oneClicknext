-- Market Brief persistence fix.
--
-- The live database has a check constraint on market_insights.insight_type
-- (market_summary, pricing_position, availability_trend, competitor_comparison,
-- opportunity) that does not exist in the migration files and predates the
-- Market Brief work. Inserting insight_type = 'market_brief' violates it,
-- which makes POST /api/marketvision/brief fail with
-- "Failed to persist market brief".
--
-- Converge live and replay on one explicit constraint that includes
-- 'market_brief'.

alter table public.market_insights
  drop constraint if exists market_insights_insight_type_check;

alter table public.market_insights
  add constraint market_insights_insight_type_check
  check (
    insight_type = any (array[
      'market_summary',
      'pricing_position',
      'availability_trend',
      'competitor_comparison',
      'opportunity',
      'market_brief'
    ])
  );
