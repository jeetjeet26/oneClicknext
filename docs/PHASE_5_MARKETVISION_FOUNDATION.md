# Phase 5 — MarketVision operator data and settings

Status: locally verified; full MarketVision and Phase 5 gates remain open.

Competitor creation, initial units, alert, immutable private decision, and safe shared action now commit together. Reviewed metadata edits require the current version. Archive/restore retains the competitor, units, and observations. Unit add/edit/removal records exact before/after values; removal retains every prior price observation in private decision evidence. Null bathroom, availability, and price values remain unknown; zero is retained as zero. Manual values do not claim independent provider verification.

Complete property and embedded-unit reads use one database snapshot without the REST 1,000-row cap. Failed list, settings, unit, and history reads are visible. Competitor history pages in groups of twenty. Stable browser request identities recover lost replies without duplicate writes, and old source/provider changes invalidate stale forms. Archive filters remain stable and overlapping reads cannot replace newer results. The mobile drawer fits its viewport.

Monitoring changes require current manager access, a reviewed version, all preferences, and a reason. A failed read cannot become an empty/default setup. New configurations default in the console to disabled/manual and no automatic additions. Runtime health updates do not increment configuration versions; preference changes do. Settings insertion/update protects against concurrent creation. Saving preferences does not claim provider readiness or execute a source refresh.

Private evidence is service-only and immutable while its property exists. Direct authenticated business mutations are revoked. Shared action summaries contain hashes and IDs rather than form text; real operator identity and console origin are retained. Configuration and business records recheck current property ownership and version in the database. No training/export or external service was invoked.

## Verification

- 169 MarketVision/action service/API tests in 29 suites.
- 43 new database assertions; 749 serial rollback assertions including prior ForgeStudio/ReviewFlow/action regressions. The separately pending `reviewflow_responses.test.sql` suite was not run.
- Four browser journeys passed, including lost create/unit/settings replies, archive/restore, stale unit/settings conflicts, retained removal history, history pagination, and cross-property rejection. Final drawer effect cleanup also passed its targeted journey.
- Full application typecheck, changed-file lint, and migration stamp pass. 259 saved function bodies match the local schema. No fixture/orphan rows remain. Existing 1,333 WARN/ERROR database findings are unchanged.
- Migration `20260919003818_phase_five_marketvision_foundation.sql` applied only locally; types generated from that local schema. Hosted migration application and client acceptance remain separate gates.

## Remaining product work

Replace the legacy extraction preview/save path: it currently invokes the model again on save, invents missing values, can partially save units, and labels a manual paste as a scrape. Revoked direct-write privileges must not be restored as a bypass. Complete durable reviewed source ingestion, safe listing updates and runtime monitoring receipts, source lineage/freshness, truthful comparisons/briefs/recommendations/export, and every remaining user/system interaction. Existing provider paths and live acceptance are not qualified by these tests. Every other retained product in P11_PRODUCT_READINESS.md remains in scope.
