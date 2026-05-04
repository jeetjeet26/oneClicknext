# Supabase Schema Truth Audit

Date: 2026-05-04

## Executive Conclusion

Local Docker Supabase is still the correct default test environment for this repo. As of the latest repair pass, the local database has been migrated forward to the latest committed schema repair migration and the generated web types have been regenerated from that local schema.

The reliable source of truth should remain:

1. committed migrations in `supabase/migrations`,
2. a clean local database recreated from those migrations plus `supabase/seed.sql`,
3. generated types in `apps/web/types/supabase.ts` produced from that recreated schema.

The hosted `oneClick` Supabase project was used as reconciliation evidence, not as the schema authoring source. After explicit approval, the reconciliation migrations were applied to hosted `oneClick` through Supabase MCP and verified against `information_schema`.

## Source Comparison

| Source | Observed state | Interpretation |
| --- | --- | --- |
| Checked-in migrations | Latest file: `20260504181000_fix_schema_truth_updated_at_search_path.sql` | Repo now contains additive reconciliation migrations for local/hosted/type drift plus the helper function security-advisor fix. |
| Checked-in web types | `apps/web/types/supabase.ts` stamp: `20260504181000` | Types were regenerated from the repaired local Docker schema and stamped to the latest migration. |
| Local Docker Supabase | 60 applied migrations, latest applied `20260504181000`; 93 public tables, 5 public views, 3 public enums | Local DB includes the code-referenced reconciliation objects and passes local schema lint. |
| Hosted `oneClick` Supabase | 72 applied migrations, latest MCP-applied migration `20260504180133` (`fix_schema_truth_updated_at_search_path`); 93 public tables, 5 public views, 3 public enums | Hosted now has the reconciliation schema applied. MCP migration versions differ from repo filenames because MCP assigns the hosted apply timestamp. |

## Drift Matrix

| Drift | Evidence | Functional impact | Severity |
| --- | --- | --- | --- |
| Local DB had not applied migrations after `20260316192000` | Repaired by applying pending local migrations through `20260504174500` | Local smoke/dev now exercise the current committed schema. | Resolved locally |
| Checked-in types did not match current local DB | Repaired by regenerating `apps/web/types/supabase.ts` from local and stamping `20260504174500` | Type checks now validate against the repaired local schema surface. | Resolved locally |
| Shared substrate was missing locally | Repaired by applying existing shared substrate migrations and the schema-truth repair migration locally | `app/api/substrate/*`, `utils/services/shared-*`, and bridge paths now have local schema support. | Resolved locally |
| CRM/schema-agent support was missing locally | `field_mapping_suggestions` and `scoring_config` are now present locally with RLS policies | Data-engine CRM/schema mapping support now has local schema support. | Resolved locally |
| Forge/Site content tables were missing locally | `content_calendar`, `conversation_analytics`, and `website_generations` are now present locally | ForgeStudio/SiteForge background paths now have local schema support. | Resolved locally |
| Local RLS disabled on exposed reporting tables | `metric_goals`, `scheduled_reports`, and `report_send_history` now have RLS enabled with explicit policies | Local now models production security behavior for these reporting tables. | Resolved locally |
| Hosted shared substrate tables have RLS but no policies | Hosted advisor reports no policies on `cron_job_runs` and `shared_*` tables | Direct client access is blocked unless routes use service role. This may be intended for server-only surfaces, but should be explicit. | Medium |
| Code references tables absent from generated types | `floorplans`, `property_photos`, `competitor_snapshots`, and `social_app_credentials` were referenced outside current schema-truth scope | Repaired by adding explicit tables, RLS policies, indexes, and regenerated types locally; hosted now has the same reconciliation objects. | Resolved |
| Guard script has partial coverage | `check-schema-truth.mjs` scans only `app/api` and `utils/services`, only `.from('snake_case')` references | References in `utils/siteforge`, `utils/propertyaudit`, `utils/storage`, `utils/substrate`, dashboard pages, middleware, components, Python data-engine, RPCs, storage buckets, and joins are not fully checked. | High |
| README local schema docs are stale | README architecture text still describes a much smaller migration set | Onboarding risk; engineers may misunderstand migration count and source-of-truth process. | Low |

## Code Contract Inventory

The web app’s schema contract is broader than the current checker:

- Core app routes in `apps/web/app/api` cover auth/profile/org/property, analytics, reports, leads, workflows, LumaLeasing, ReviewFlow, ForgeStudio, SiteForge, MarketVision, PropertyAudit, documents, onboarding, cron, and shared substrate.
- Service code in `apps/web/utils/services` covers CRM sync, Gmail/calendar, tour reminders/no-show, shared approvals/dispatch/execution/outcomes, workflow processing, request context, and health.
- Additional unchecked web references exist in `apps/web/utils/siteforge`, `apps/web/utils/propertyaudit`, `apps/web/utils/substrate`, `apps/web/utils/storage`, `apps/web/utils/forgestudio`, `apps/web/app/dashboard`, `apps/web/components`, and `middleware.ts`.
- RPC usage includes `match_documents`, `score_lead`, `create_default_onboarding_tasks`, and `execute_readonly_query`.
- Storage bucket usage expects `brand-assets`, `content-assets`, `property-assets`, and `documents`.
- Data-engine expects `ad_account_connections`, `import_jobs`, `fact_marketing_performance`, `geo_*`, `properties`, `integration_credentials`, `leads`, `field_mapping_suggestions`, `competitors`, `competitor_*`, `market_alerts`, `scrape_config`, `property_units`, `property_price_history`, and `agent_calendars`.

## Proper Schema Shape

The proper schema for fully up-to-date functionality should include, at minimum:

- The checked-in generated type surface in `apps/web/types/supabase.ts`, stamped to `20260504181000`.
- The reconciliation tables now represented in migrations and local generated types: `floorplans`, `property_photos`, `competitor_snapshots`, `social_app_credentials`, `community_profiles`, `community_contacts`, `content_calendar`, `conversation_analytics`, `field_mapping_suggestions`, `scoring_config`, and `website_generations`.
- The shared substrate tables should remain server-controlled unless direct UI access is required. If direct client access is needed, add tenant-safe RLS policies.
- Reporting/analytics tables (`metric_goals`, `scheduled_reports`, `report_send_history`) should have RLS enabled with tenant/property-safe policies in all environments.

## Non-Destructive Fix Plan

1. Keep `20260504174500_reconcile_schema_truth_drift.sql` and `20260504181000_fix_schema_truth_updated_at_search_path.sql` additive and idempotent.
2. Track hosted MCP-applied migration versions separately from repo filenames when auditing hosted history.
3. Expand `check-schema-truth.mjs` to:
   - scan all app TypeScript paths that can call Supabase,
   - include RPC references,
   - include storage bucket references,
   - include data-engine Python `.table(...)` references,
   - compare generated types against live local `supabase gen types --local`,
   - optionally compare latest local applied migration against latest migration file.
4. Before final production deploy, run a clean local reset if time permits:
   - `npm run supabase:reset` from `p11-platform`.
   - regenerate Supabase TypeScript types from local or MCP.
   - run `npm run schema:types:stamp` from `p11-platform/apps/web`.
5. Validate from `p11-platform/apps/web`:
   - `npm run check:schema-types-sync`
   - `npm run check:schema-truth`
   - `npm run check:foundation`
   - targeted route/data-engine tests for the repaired product surfaces.

## Validation Run

Current local checks were run after the local and hosted repair:

- `npm run check:schema-types-sync`: passed with stamp `20260504181000`.
- `npm run check:schema-truth`: passed.
- `npm run check:foundation`: passed, including 200 test files and 642 tests.
- `npx supabase db lint --local --fail-on error`: passed with no schema errors.
- Hosted security advisor no longer reports the new `set_schema_truth_updated_at` function search-path warning after `20260504181000_fix_schema_truth_updated_at_search_path.sql`.

These passing checks clear the local schema/type drift found in the original audit and verify the hosted reconciliation objects were applied. They do not mean Vercel has been deployed.

## Recommended Source Of Truth Policy

- Local Docker Supabase remains the day-to-day test target.
- Migrations are the canonical schema history.
- Generated types are a build artifact that must be regenerated from the canonical live schema, never treated as independent truth.
- Hosted Supabase is an environment to reconcile against, not the schema authoring source.
- A local DB that has not been reset or migrated forward is not trustworthy for product validation, even if the app boots.
