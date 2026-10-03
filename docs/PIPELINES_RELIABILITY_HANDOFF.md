# P11 Console / oneClick — pipeline reliability handoff

September 14, 2026. Local implementation only. This continues the recovered oneClick improvement plan; it does not mark the entire plan or the Pipelines product complete.

## What changed

The Pipeline Monitor previously displayed invented accounts, dates and record counts. Refresh only waited; Run simulated activity and produced a random successful count. The page now reads actual records for the selected property.

- `GET /api/pipelines` authenticates the user, validates the property identifier, checks organization ownership, and queries through the signed-in Supabase client with RLS. It selects explicit columns and returns private, uncached results. Neither provider metadata nor global cron summaries are exposed in the property view.
- Connected accounts show recorded account-sync dates and reported errors. Active configuration is not described as proof of healthy provider access.
- Import history shows the latest 50 Data Engine jobs, their recorded progress, row counts, timestamps, errors and job identifiers. Counts apply only to that history window. Scheduled ad syncs are a separate execution path and do not appear as fabricated import jobs.
- Unknown statuses remain unknown. Warnings on completed jobs become partial results. Warnings do not make an active job terminal. Queued/running records older than 30 minutes receive an explicit review notice; this threshold does not assert that the worker failed or is still alive.
- Refresh reads real data. Visible tabs poll every 15 seconds. Failed refreshes preserve the prior snapshot with a stale-data warning; first-load failures remain distinct from empty results. Property switches unmount the previous view and abort outstanding requests. Demo fallback properties cannot trigger pipeline queries.
- The simulated Run button was removed. The page links to the existing MultiChannel BI import controls. This increment does not add a new dispatcher or claim those existing controls satisfy all delivery/recovery gates.

The scheduled ad-sync endpoint also reported success when adapters returned errors. It now:

- Requires a valid configured cron secret, including in local environments, and a durable cron-run record before processing accounts.
- Rejects connections missing property or organization ownership instead of bypassing the shared job ledger.
- Throws adapter error results inside the shared executor so its job and action history record failure. The route retains the provider result for its per-account summary and continues independent accounts.
- Records `success`, `partial`, or `failed` from actual results. An all-failed batch returns HTTP 502; a partial batch returns HTTP 200 with `success: false` and `status: partial`. A valid zero-row sync remains successful; an empty schedule is recorded explicitly as having no connections.
- Retries a transient failure only if it has not already imported rows. A partial write keeps its count and error for reconciliation instead of being obscured by a later retry result.

Browser verification exposed a shared narrow-screen layout defect. On phones the full sidebar is now available through a labeled Navigation disclosure, leaving the content usable. It closes after selecting a link and on Escape. The header and property selector can shrink without clipping; desktop navigation remains visible. The Pipeline Monitor uses the console theme colors.

## Verification on September 14

**46 passing tests/check cases:**

- 33 unit/route cases across pipeline authorization and query scoping, state normalization, scheduled-sync outcomes, and the existing cron outcome helper.
- 8 dedicated Pipeline Monitor browser cases, including a real authenticated query against local Supabase, rejection of an anonymous caller and an inaccessible property, fixture-based failure/partial/progress cases, refresh recovery, polling, property switching, empty-property protection, phone navigation/layout, and light/dark heading contrast.
- 5 existing SiteForge browser cases rerun after the shared navigation changes: exact brief copy/download, property switching, error recovery, clipboard denial and empty-property protection.

Full web TypeScript checking, targeted linting and diff whitespace checks passed. Visual review covered the local desktop preview, light/dark theme screenshots and the phone screenshot. These are bounded checks, not a whole-console accessibility certification. The test fixtures are never presented as actual client imports. No provider sync, client inquiry, hosted database mutation or remote release was executed.

Test environment: existing local Next app at `http://127.0.0.1:9430` and existing local Supabase. The new query was exercised against that database without adding tables, policies or migrations. The local seed property has no connected ad accounts/import jobs; the resulting empty states are accurate. Node 26 emitted a deprecation warning; the project declares Node 24. No dependency versions changed.

## Files

- `p11-platform/apps/web/app/dashboard/pipelines/page.tsx`
- `p11-platform/apps/web/app/api/pipelines/route.ts` and `route.test.ts`
- `p11-platform/apps/web/utils/pipelines/monitor.ts` and `monitor.test.ts`
- `p11-platform/apps/web/app/api/cron/sync-ads/route.ts` and `route.test.ts`
- `p11-platform/apps/web/app/dashboard/layout.tsx`
- `p11-platform/apps/web/components/layout/Sidebar.tsx`
- `p11-platform/apps/web/components/layout/PropertySwitcher.tsx`
- `p11-platform/apps/web/e2e/pipelines.spec.ts`

Other existing Phase 0 and SiteForge edits remain preserved and uncommitted. Targeted pre-change copies are in this task's `work/pipelines-update/before/` directory. The authoritative plan remains `docs/P11_IMPLEMENTATION_PLAN.md`, with the complete original plans retained under `docs/history/`.

## Remaining work / next entry point

**Later September 14 update:** the first two items below have a completed local increment in [the import tracking handoff](IMPORT_TRACKING_HANDOFF.md). Read that handoff and the current implementation plan for the latest entry point; the list below preserves the earlier checkpoint.

Continue the oneClick shared-reliability lane. Do not interpret the unresolved client inquiry recipient as blocking all console work.

1. Harden the existing import submission path: `app/api/marketvision/import/route.ts` and the Data Engine `/sync-marketing-data` endpoint can acknowledge a start without establishing a durable job identifier. Make acceptance depend on durable tracking, and exercise validation, missing connections, worker interruption and truthful terminal outcomes.
2. Review the Data Engine importer’s connection freshness writes and partial/empty-result handling. The monitor reports persisted records; it does not repair historical records or prove worker health. No automatic rerun or backlog replay was added.
3. Reconcile scheduled account job history, manual imports and provider-level outcomes. The property monitor intentionally avoids the global cron log because those rows are not property-scoped. The shared executor still has broader best-effort finalization behavior requiring a separate reliability review.
4. Validate current provider API versions, credentials, account ownership and actual destination outcomes before any authorized live reconciliation. The existing Google Ads adapter still names API version v18; it was not upgraded or exercised in this increment. Neither provider reconnection nor a live run is authorized by this handoff.
5. Continue the preserved product gates in the full plan. SiteForge delivery remains the personal Codex skill working in client projects; chatbot/GEO and all other retained products remain ahead of broad autonomy.

The release hold remains: no push, hosted migration, provider reconnection, message delivery, backlog replay or deployment without authorization for the particular action/target. No old job status was rewritten to make history appear healthy.
