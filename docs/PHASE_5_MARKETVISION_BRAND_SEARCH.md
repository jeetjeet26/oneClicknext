# Phase 5 — saved search of reviewed MarketVision evidence

September 22, 2026. Locally qualified; Phase 5 remains active.

Evidence search now uses explicit literal phrase, all-word or any-word matching across reviewed statements and exact source quotations. Category, source-claim/interpretation and optional competitor scope are retained. It does not generate answers, invoke embeddings or pretend to provide semantic similarity. The old unqualified embedding/search routes remain retired.

A search atomically retains its exact criteria, algorithm, complete qualifying source context, context/result hashes, coverage, full matching results and attributed decision. A lost response reopens the same saved search. After confirmation, a deliberate new search with identical criteria creates a new snapshot. Complete request/result paging reaches beyond 1,000 records; oversized evidence fails explicitly rather than silently dropping matches. Search history and original reviewed-analysis links remain usable after reload.

New searches exclude withdrawn reviews, stale competitor/source baselines, unreviewed model candidates and earlier unqualified analyses. Saved results remain historical evidence. A fresh read shows whether each original review still qualifies now; it never rewrites the old search counts. Coverage describes only the saved reviewed selection. Missing matches do not establish market absence, source claims remain unverified, and captured promotion language may no longer apply. Private context/raw query text stays out of shared action records. Current property access is rechecked for reads and replay. Read failures stay visible and late responses cannot cross a property switch.

Migration: `20260922222029_phase_five_marketvision_brand_search.sql`.

Verified: 533 service/API/BrandForge cases across 65 suites; 26 dedicated SQL assertions and 475 serial MarketVision/shared-action/editorial assertions; two browser journeys covering lost replies, 25-result paging, withdrawal/new-search divergence, original-analysis links and failed/delayed property-scoped reads. Mobile layout inspected. Types, touched-file lint and schema stamp pass. All 330 retained function bodies match the local schema; synthetic fixtures/orphans are absent; advisor WARN/ERROR keys remain at the existing 1,333 baseline. The separately pending ReviewFlow response SQL suite was excluded.

No provider/model/embedding calls, notifications, hosted changes, publication or training occurred. Local validation added no migration-history entries. Semantic ranking/generative answers are not qualified by this literal-search workflow. MarketVision discovery/runtime activation, broader provider/client acceptance and the remaining holistic product gates are still open.
