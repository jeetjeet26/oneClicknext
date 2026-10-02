# Phase 5 — audit worker recovery and captured crawl output

Locally qualified September 23, 2026. This closes the supported audit worker/crawl recovery increment. Full Phase 5 and real client/provider acceptance remain open. Login stays email and password; no training or autonomous activation is enabled.

The console can inspect complete, paged private crawl capture history, including exact stored page records, checkpoints and detector results. Applied captures and retained-but-unapplied captures are visibly distinct. Historical lease proof stays private. Reads require current property membership; permission removal does not erase the actual earlier evidence.

Crawl output is retained before application. Lost replies reuse the same receipt identity; uncertain application leaves retained output for recovery instead of overwriting the crawl with a guessed failure. New leases recover pending receipts before fetching again; a saved final detector receipt can finish without refetching. Explicit stop and changed access hold late output without changing findings. Captured content and accepted results are immutable. A finding observed again reopens a reported fix, preserves an explicit “won’t fix” decision, and does not treat absence as verified resolution.

Measurement workers recheck the recorded request and current authority when claiming, invoking, applying and publishing scores. Revoked or legacy work without recorded authority closes with an explicit hold; actual provider receipts and accepted observations remain intact. Human commands and service observations retain separate attribution, and shared history exposes safe identities rather than private page/provider content.

An empty final crawl queue now retains saved pages. A crash between page capture and checkpoint can reconstruct a queue from stored links, with an explicit recovery limitation carried into recommendation context. Crawling retains its bounded queue without silently dropping entries after 2,000; reaching a selection cap remains visible. These are parsed, bounded page records—not complete original HTTP bytes or proof of exhaustive website coverage. Required checkpoint failures stop further durable crawling. Legacy public crawl/model paths require the reviewed console flow; the local migration-manifest reader still works.

## Verification

- 148 dedicated native rollback assertions, including original 91 control assertions and 57 worker/capture assertions; 3,209 assertions across 54 selected serial suites.
- 97 distinct Python cases across nine suites: 96 passed in the broad run, and the local-server crawler case passed after granting local socket access. 40 application checks across three suites.
- 34 distinct connected browser journeys: 31 passed together and the three measurement-read journeys passed separately. Four new crawl journeys cover private exact evidence, stop/late capture, complete paging and role withdrawal. Desktop/mobile evidence was inspected.
- Full application types, targeted lint and schema stamp pass. All 625 checked native function bodies match saved migrations. Fixture/orphan and local migration-history counts remain zero. Database advisors remain at 1,333 with no additions.

Migration `20260924012723_phase_five_propertyaudit_worker_evidence.sql` was applied once locally. Only a whitespace-only replacement of `claim_geo_site_crawl` followed. No hosted changes, real model/provider execution, email delivery, training or deployment occurred. Outbound and other execution holds remain in place.

Continue manual marketing CSV import/reconciliation and every remaining retained-product journey in the product register. Local tests do not qualify live provider contracts or actual client acceptance.
