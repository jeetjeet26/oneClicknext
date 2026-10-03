# Phase 5 — reviewed competitor listing links

Status: locally verified. Source acquisition and full product qualification remain open.

Competitor listing saves and removals now require current property access, the saved competitor version and an operator reason. The source value, private before/after evidence and safe shared action commit atomically. Lost replies recover the same decision. Removal retains prior decisions and other listing providers; archive and stale-version checks protect the current record.

The drawer loads its saved source independently, shows failed reads without inventing an empty setup, supports replacement/removal and displays readable history. Invalid public hostnames and incomplete links are rejected. Property switching clears the old source. Mobile layout is verified.

The former add-listing-and-scrape entry is retired in favor of the recorded listing route. Link changes do not call providers or imply fresh prices. Both existing refresh entry points respect the outbound pause. Refresh no longer upserts monitoring settings or silently enables automatic monitoring.

## Local verification

- 233 service/API/action cases across 36 suites; full application typecheck, changed-file lint and schema stamp pass.
- 17 new database assertions, including action-failure rollback; 812 serial rollback assertions with earlier MarketVision and ForgeStudio/ReviewFlow/action suites. The separately pending reviewflow_responses suite remains excluded.
- Three browser journeys pass: lost save/removal replies with source history, stale source replacement, failed reads and property switching. Mobile source controls inspected.
- 272 function bodies match the local schema. No fixture/orphan records remain. Existing 1,333 WARN/ERROR findings are unchanged.
- Migration 20260919021904_phase_five_marketvision_listings.sql applied only locally; local types regenerated. No actual provider/model, hosted mutation, deployment or training occurred.

Continue retained provider acquisition and review, source freshness/lineage, comparisons/briefs/recommendations/exports and all remaining product/system/interaction gates. Discovery and automatic price refresh are not qualified by these listing checks. Phase 5 remains active.
