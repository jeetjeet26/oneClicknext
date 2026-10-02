# Phase 5 — complete ReviewFlow insight evidence and search

September 18, 2026. Locally verified; the complete Phase 5 product register remains active.

Insights read one consistent property snapshot without the former 1,000-row cap. The actual review date determines the window; missing dates use a disclosed import-date fallback. Only the newest completed analysis for the exact current source is usable. A newer analysis requiring staff review excludes the older classification. All current open cases are included independently of their age. Mention counts compare equal time-window halves and are labeled as more/fewer mentions, not proof of better/worse outcomes. External-source completeness remains explicitly unknown.

An operator can save the exact report after reviewing its source coverage. The server computes results from the snapshot, rechecks the reviewed source hash in the atomic save and retains private immutable evidence. Lost replies reuse the same decision; later source changes cannot rewrite an earlier report. History is paged and scoped to the current organization/property. Citations retain source and analysis versions and open the corresponding review. Saving a report starts no intervention, model call or training.

Review search now covers the whole property before pagination. Search text is passed as a literal typed database argument; `%`, `_`, `*`, quotes, commas and backslashes retain their literal meaning. The invoker function preserves caller row security. Read projections exclude raw provider payloads, paging is bounded, failed reads are visible, requests have timeouts and late responses cannot replace newer filters/property context. Search results can be paged instead of being limited to the already loaded page.

Evidence:

- 251 service/API/action/scheduler tests across 34 suites passed; full web types and changed-file lint passed.
- 21 new SQL assertions and 649 total established rollback assertions passed. The separately pending response SQL suite remains unrun and excluded.
- All 25 ReviewFlow browser journeys are verified. The complete run passed 24 and encountered a timeout in one existing sign-in hook; that ticket journey passed its targeted rerun. Initial new search checks required two test-selector corrections (a Next route-announcer alert and capitalization of the paging button). The final whole run verified all new journeys.
- More than 1,000 source rows, exact-source classification, old/future review dates, old open cases, immutable report history, atomic action failure, stale previews, punctuation search, server scope and lost-save recovery are covered.
- Local type stamp 20260918161339 and 239 function-body parity checks passed. Fixture/orphan checks passed. Database advisors remain at 1,333 WARN/ERROR findings with no additions or removals. The mobile saved-report screen was visually inspected and overflow checks passed.

Migration 20260918161339_phase_five_reviewflow_insights.sql is applied only to local Supabase, without writing migration history. No deployment, hosted mutation, provider/model invocation, message, training or export occurred. Logs and mobile evidence are in the task's work/reviewflow-insights directory.

Next: complete the Today/statistics/recovery read paths, testimonial rights lifecycle, verified owner publication/renewal/readback and remaining meaningful interactions; continue every other retained product in P11_PRODUCT_READINESS.md. Client/provider acceptance and the pending response SQL qualification remain explicit gates.
