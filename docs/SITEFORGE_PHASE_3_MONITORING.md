# SiteForge Phase 3 — local monitoring qualification

Current status: [all remaining identified local Phase 3 work is complete; connected acceptance remains pending](SITEFORGE_PHASE_3_COMPLETION.md). This document retains the earlier increment and its dated next-step context.

September 15, 2026. **This local monitoring increment is complete. Phase 3 overall remains open.**

The retained oneClick website-monitoring path now separates verified observations, observed failures, unavailable evidence and checks that do not apply. These changes support earlier application-managed websites. Independent Codex client projects remain in their own repositories with the personal SiteForge skill; this does not register those clients in a new console generator or monitoring service.

## Implemented behavior

- Missing identity, runtime, form, inventory, tour, widget, vulnerability or dated-special evidence stays unavailable. A missing connector configuration, observation or freshness interval does not become a pass. An observed wrong identity, stale connector, expired special or actual HTTP failure can still fail its check.
- Explicit old `passed: true` results with `unobservable`, `not_configured`, or false applicability cannot clear incidents or satisfy the exact-check repair/restore gates. A safe repair also rejects a passing run that started before the incident's latest update and checks that the incident did not change before resolving it.
- Homepage reachability requires a successful HTTP response. HTML scans exclude XML/RSS/JSON responses. One failed linked request retains the other observations and makes affected coverage incomplete. Manual redirects are limited to the checked origin before following them; credentials and obvious private targets are rejected. This is not a claim of complete DNS-rebinding protection.
- Purpose comes from an active, matching WordPress target. Lifecycle ownership metadata identifies testbeds; canonical previews are review targets. A mismatched, missing or contradictory target stays unknown. Production indexing requirements do not apply to known review/test/staging targets. Only confirmed production targets can mutate production-health incidents or request the existing supervised restore path.
- New and repeated production failures retain the same active incident key, preserving acknowledgement and ownership. Confirmed saves, optimistic row checks and suppression of an older run after a newer completed observation prevent the tested stale-update cases. Persistence errors produce failed monitoring records rather than apparent completion. This is not a transaction or distributed lock covering an entire run.
- New incidents and meaningful severity escalations become eligible for a durable alert claim. Unchanged failures retain the claim/outcome. Provider acceptance records message IDs but explicitly does not prove recipient receipt. Ambiguous outcomes stay held for operator review; they are not automatically retried. The existing delivery pause remains in force. Historical incidents are not enrolled for backlog replay.
- The scheduled route refuses to begin work if its run record cannot be saved and reports incomplete evidence as partial. It exposes its existing 100-website coverage limit. Existing execution-failure alerts and restore/stale-job processing remain separate from the new per-health-incident alert handling.
- The console distinguishes loading, unavailable history, no recorded run, incomplete evidence and verified results. It exposes retry, check summaries, target purpose, observation time, ownership and saved alert outcomes. The active list displays the latest 100 active incidents with the exact total; it does not label a truncated page as the full count. Failed refreshes remove stale counts, and changing websites resets the component.

## Verification

- **61 regression cases passed across 10 test files**, including 12 opt-in tests using the actual local Supabase database. Coverage includes run persistence, incident reuse, acknowledgement preservation, unknown evidence, older/newer run ordering, incident persistence failure, paused delivery, concurrent delivery claims, ambiguous provider outcomes, stale safe-repair evidence, active counts, cron authentication and the missing-ledger stop.
- **Five Chromium browser cases passed**: initial loading, failure/retry into the real local history endpoint, legacy incomplete evidence, failed refresh and phone layout. The retained editor's navigation and operations data were fixtures; no artifact was generated or launched. Desktop and 390-pixel phone screenshots were visually inspected. The phone page had no horizontal overflow in the covered state.
- Full application TypeScript checking and targeted lint passed. Existing dependencies were used; no package or schema migration was introduced.
- Website responses and email delivery were injected fixtures in database tests. No client host, real inbox, provider API or hosted database was used for those tests. Temporary website, policy, incident and health rows were removed. Test-created append-only launch policies required a transaction-local cleanup override restricted to each marked local fixture; normal protection was restored before the website deletion. No existing policy or historical incident was changed.
- Earlier failed attempts remain in the local work folder: an old assertion conflated a missing marker with a mismatch; the initial fixture cleanup met the append-only policy; initial browser fixtures did not open the retained editor's launch panel or return its real no-release response. The final checks include these corrections and verified cleanup.

Reproducible tests live in `utils/siteforge/health-state.test.ts`, `utils/siteforge/production-health.local.test.ts`, `utils/siteforge/production-health.test.ts`, the monitoring cron route tests and `e2e/siteforge-monitoring.spec.ts` under `p11-platform/apps/web`. Local database/browser tests require `SITEFORGE_LOCAL_DATABASE_TEST=1` and explicitly reject a non-loopback database. Browser tests also require a loopback app URL and use the existing local test account.

## Maintenance responsibility and remaining gates

| Work | Current responsibility | What remains to qualify |
| --- | --- | --- |
| Incident ownership | Existing acknowledgement assigns the acting operator; unassigned remains visible. | Name the actual maintenance owner for each client target; a property record or testbed is not an assignment. |
| Alert delivery | Existing organization admin/manager recipient resolution, behind the delivery pause. | Approve the target and destination, verify actual receipt, and review any held attempt before a manual recovery decision. Do not enable delivery to clear a test. |
| Current facts and inventory | Each client's factual owner and dated source remain authoritative. | Reconfirm facts when due; running monitoring or rebuilding must not refresh observation dates. |
| Client updates | Personal SiteForge workflow in the existing client project/editor. | Actual owner-requested edits and acceptance, normal operating effort/cost and target-specific rollback evidence. |
| Scheduled coverage | Existing retained console scheduler; no new automation created. | Observe normal cycles on approved targets. Qualify pagination beyond 100 websites, concurrent whole-run ordering, and execution/restore-failure alert grouping before broader unattended operation. |

HTML marker checks are observations, not full accessibility/legal certification, verified inquiry delivery, full inventory reconciliation or a complete crawl. A check covers the homepage and at most 10 declared/linked pages. Existing known review/test purposes do not qualify production domains or indexing. The scheduled stale-job and restore paths were not replayed against a real backlog.

Phase 0 hosted gates and Phase 2's actual recipient receipt, authoritative factual sources, exact hosted runtime/ACF, approved deployment and production restoration remain open. No real incident was bulk closed, no credentials or target designation were rewritten, and no code was committed, pushed or deployed.

## Next independent step

September 15 continuation: the isolated full-transfer, asset and redirect trial below is now [qualified locally](SITEFORGE_PHASE_3_MIGRATION.md). The next independent local step is content-merge conflict/retry and recovery qualification. The original handoff below is retained as dated context.

Continue Phase 3 with **existing-site import, asset-transfer and redirect qualification in isolated client copies**, preserving each current platform/editor and the original parent. Verify representative migration journeys and restoration locally, then retain target-specific hosted execution and owner acceptance as separate evidence. Carry maintenance ownership, real alert receipt and normal-cycle monitoring forward; this increment does not complete those gates or advance the plan to Phase 4.
