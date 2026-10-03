# oneClick / P11 — import tracking and recovery

September 14, 2026, follow-up to the Pipeline Monitor increment. Local implementation; no release or real provider execution.

Import tracking follows marketing-data pulls from Google Ads and Meta into MultiChannel BI. It is shared reporting reliability work in the recovered improvement plan. It is separate from client website inquiry delivery.

## Completed behavior

- A request receives a stable UUID before submission. The Data Engine uses it as the existing `import_jobs` primary key; no new table or migration is needed. Acceptance requires a confirmed saved row, and the web API additionally reads the matching property/job/contract through the signed-in user’s Supabase session.
- Repeating the same ID reuses the saved job. A queued job can be dispatched again after a lost response/dispatch, but a conditional database update from pending to running permits only one worker to claim it. Running and terminal jobs are not replayed. Reusing an ID for a different property, channel set or date range is rejected.
- Requests validate property/job identifiers, supported channels and date presets. Missing matching active accounts is an explicit setup failure, not a completed import. The requested date range is passed to the importer instead of silently switching to an incremental or all-history range.
- Property-scoped status reads honor both identifiers when supplied. Failed database reads are not turned into missing/empty/successful jobs. Unknown states remain unknown; warnings on an active job do not make it terminal. The Pipeline Monitor and BI now use the same state normalization.
- The importer confirms account writes before incrementing confirmed row counts or advancing that exact account’s freshness. Other accounts of the same platform are not updated by a broad property/platform filter. Empty successful provider results are valid; missing/skipped/failed providers remain distinct. Independent account failures preserve already confirmed records as a partial result.
- Progress writes preserve one start timestamp. If job status cannot be persisted, a tracked worker stops instead of continuing silently. A caught interruption preserves confirmed counts and records a failure or partial result where the database permits it.
- The dashboard retains request identity in session storage and resumes status reads after reload or returning to that property. Requests/timers stop when leaving the view. A failed poll or five-minute observation limit keeps the recorded progress and an explicit unconfirmed notice; it does not turn the job into success or lose its identity. The operator can refresh status or retry the same request. Terminal results remain until dismissed or a new import is requested.
- Removed the old temporary localhost debugging collector from import submission. The BI view now remounts by property, and redundant campaign refresh effects were consolidated.

## Verified

**88 passing automated cases:**

- 39 web unit/route cases across the import API, shared import-state handling and Pipeline Monitor state regression.
- 34 Python cases covering acceptance, lost acknowledgement, reused IDs, conditional worker claims, requested range, missing setup, confirmed writes, freshness, interruption and service authentication.
- 15 browser cases: seven import tracking/recovery journeys and the eight existing Pipeline Monitor journeys.

Full web TypeScript checking, targeted lint and whitespace checks passed. Browser verification used importer fixtures, never real providers. Visual inspection covered the import status panel on the local BI page.

A separate localhost-only Supabase contract check exercised real persistence, repeated-ID worker claims, one confirmed performance-row write, authenticated/RLS reads, combined property/job filtering and unchanged freshness after failure. Provider functions were replaced with fixtures. All temporary rows were removed. The first fixture property created automatic append-only vertical metadata, so its exact cleanup required a transaction that temporarily disabled and restored that one local immutability trigger; no persistent trigger/schema change remains. The revised check uses only temporary job/account/performance rows on the empty local seed property and completes cleanup normally.

The existing local Next app remains at `http://127.0.0.1:9430`. Python checks used the repository `.venv` with bytecode/cache writing disabled. The environment reports Node 26 and Python 3.14; the repository declares Node 24. Existing Node loader and FastAPI TestClient dependency deprecation warnings remain; dependencies were not upgraded.

## Files

- `p11-platform/services/data-engine/routers/marketing_import.py`: validated acceptance, same-ID reuse and conditional background-worker claim.
- `p11-platform/services/data-engine/main.py`: mounts that router while preserving the earlier authentication repair and other routes.
- `p11-platform/services/data-engine/pipelines/mcp_marketing_sync.py`: confirmed per-account persistence and truthful outcome aggregation.
- `p11-platform/services/data-engine/tests/test_marketing_import.py`: backend regression cases.
- `p11-platform/apps/web/app/api/marketvision/import/route.ts` and `route.test.ts`: validated submission, durable confirmation and scoped reads.
- `p11-platform/apps/web/utils/marketvision/import-request.ts`: supported request contract.
- `p11-platform/apps/web/utils/marketvision/import-job-state.ts` and `import-job-state.test.ts`: shared truthful states.
- `p11-platform/apps/web/utils/marketvision/use-marketing-import.ts`: retained identity, polling and retry controls.
- `p11-platform/apps/web/components/charts/MarketingImportStatus.tsx`: visible progress, uncertainty and recovery controls.
- `p11-platform/apps/web/app/dashboard/bi/page.tsx`: integrates tracking and clears view state by property.
- `p11-platform/apps/web/utils/pipelines/monitor.ts`: reuses shared normalization.
- `p11-platform/apps/web/e2e/marketing-import.spec.ts`: local browser journeys.

Pre-change copies and the localhost verification helper are in this task’s `work/import-reliability/` directory. Other existing Phase 0, SiteForge and Pipeline Monitor work remains preserved and uncommitted.

## Boundaries and next work

This provides durable identity and recovery of an unclaimed queued request. FastAPI background tasks still run in the application process; this is not a durable distributed queue. A hard process kill after claiming a job can leave a running row requiring review. No automatic timeout replay was added. See [FastAPI background-task guidance](https://fastapi.tiangolo.com/tutorial/background-tasks/) for the process-local execution model.

Idempotency applies to the same request ID. Separate IDs can still represent overlapping imports; account/property locking and reconciliation across independent requests remain separate work. Failed/partial jobs are not automatically replayed or rewritten. A database write with an unconfirmed response may have stored data; the reported count is the number confirmed, and the job instructs review before a new request.

Continue oneClick with provider-data qualification: daily versus aggregated reporting grain, date boundaries, currency units, pagination, account identity and cross-channel record keys. Also qualify the existing native sync API versions and connect scheduled account outcomes with property-scoped history. None of this increment proves real provider delivery or validates all BI calculations.

Any eventual release must deploy and verify the updated Data Engine contract before the updated web client, then verify matching request IDs through the actual deployment. A legacy backend that ignores supplied IDs does not provide the new retry guarantee. The release hold remains: no push, hosted migration, credential reconnection, real sync, message delivery, backlog replay or deployment without action/target authorization. No client website was edited in this increment.
