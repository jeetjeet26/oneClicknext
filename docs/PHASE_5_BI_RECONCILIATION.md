# Phase 5 — retained marketing data reconciliation

September 23, 2026. Locally qualified. Phase 5 remains active across the retained product register.

The BI data review now shows every matching daily row and overlapping/undated dimension row through version-checked pages. Staff save an exact private source snapshot before deciding. Managers and administrators can exclude or restore a selected row with an attributed reason. Original values, unknown accounts and source details remain unchanged. Immutable commands retain the reviewed original, inclusion before/after, actor and actual result. A stale source, changed inclusion, active import, wrong property or lost role cannot silently change reporting.

Corrections use the existing retained CSV preview/application journey. Excluding an unknown historical overlap allows a new import with its actual provider account. Excluded known-account identities must be explicitly restored before replacing their values. Restoring an older row is held when a newer included source overlaps it, preventing double counting. Daily and dimension writes are fenced against silently overwriting excluded rows. No account, currency, campaign identity or provider verification is invented.

Current reports, aggregate queries, dashboard totals and assistant/ForgeStudio business context use the same complete reporting reader and omit excluded rows. Failed source reads remain unavailable rather than becoming zero totals. Saved reports and historical reconciliation snapshots retain their original contents.

Saved reviews, exact row sources, complete decision history and JSON download preparation are available in the console. The exact download is retained server-side. A separate browser observation records whether a download was initiated or failed; it does not claim destination receipt. Interrupted saves, row decisions and exports recover using a stable identity. Unused-request cancellation fences late delivery. Browser session storage contains the pending ID only. Shared action history contains safe references/status; private originals, notes and downloaded contents remain outside it. Every record remains training-ineligible.

## Verification

- 98 application cases across eight connected suites passed. After the final ForgeStudio database-client correction, the two affected context suites passed all 11 cases again.
- Nine relevant serial rollback suites passed 514 assertions before the final history refinement. The expanded dedicated reconciliation suite then passed all 57 assertions, including unknown-account replacement, exact excluded-identity holds, complete decision paging and restoration overlap protection. This is not a claim that the entire older product regression was rerun.
- 17 distinct local browser journeys passed: eight CSV imports, two reporting identity journeys and seven reconciliation journeys. The initial run passed 16 and exposed an ambiguous SQL history alias after restoration. The native reader was corrected; all seven reconciliation journeys then passed together. Exact mobile source/reason/restoration layout was inspected.
- Full application types passed. Targeted lint is clean. Schema stamp passed before creation of the next empty Luma migration placeholder. All 639 checked native bodies match saved migrations. All selected fixtures/orphans and migration-history entries are zero. Advisors remain at 1,333 existing WARN/ERROR findings, with no additions.

Migration `20260924023346_phase_five_bi_data_reconciliation.sql` was applied once locally. The exact `read_bi_data_review` function was subsequently replaced once to correct the history alias; the full migration was not replayed. Local generated types retain their nullable RPC contracts and PostgREST version. Evidence is in the active task workspace `work/bi-reconciliation/`: `app-connected.log`, `context-final.log`, `sql-final.log`, the nine `sql-*.log` files, `browser-first.log`, `browser-final.log`, copied browser results, `types-complete.log`, `verification-complete.log` and advisor/schema JSON.

## Remaining phase boundaries

Meaningful observational interaction coverage and other retained products remain on the holistic register. Real provider/model/client acceptance and verified destination receipts remain deferred. Original-source data decisions are staff assertions, not verified business outcomes or training rewards. No hosted schema, live provider, recipient, deployment, training or autonomous execution was changed. Login remains email/password only.
