# Phase 5 — retained competitor page acquisition

Status: locally verified for direct public HTTP pages. Phase 5 remains active.

An operator can request a saved competitor website or listing page with a recorded reason. The request freezes its URL, competitor version and source context. One worker claim permits one bounded fetch; redirects and resolved addresses are checked. Unsupported, blocked, oversized, unreadable and uncertain responses remain visible holds. Requests can be stopped and inspected after an interrupted reply without silently fetching again.

The private receipt retains the exact bounded response, normalized page text, final URL, timestamp, parser version and SHA-256. Reading a page never changes prices or declares them current. Explicit source-scope confirmation starts extraction from the exact retained page. Review and pricing approval remain separate decisions. Applied observations link to the original capture; a fetched page is not proof that its advertised prices are correct. A changed source or revoked access prevents late use, and stopped work retains late receipts without creating usable captures.

The drawer shows requests, recovery, source coverage and provenance. A failed read is not an empty history. Property changes clear old work. Current source changes block stale extraction even during rebase. Shared actions distinguish operator decisions from actual service execution.

## Local verification

- 290 service/API/transport/action cases across 42 suites pass. A final focused transport test rerun passes after rejecting unsupported control characters.
- 40 dedicated database assertions; 852 serial rollback assertions across related suites. The separately pending ReviewFlow response suite remains excluded.
- Six browser journeys pass: three acquired-page journeys and three existing pasted-source journeys. The main page-to-approved-price journey passed again after final wording refinements. Mobile layout inspected.
- Full application types, changed-file lint and generated-schema stamp pass. 281 saved function bodies match the local database; no fixture/orphan records remain. The existing 1,333 database WARN/ERROR findings are unchanged.
- Migration 20260922183732_phase_five_marketvision_acquisition.sql applied only locally. No real fetch/model invocation, hosted mutation, deployment or training occurred. Test receipts were simulated; browser requests used the real local database.

## Remaining work

This transport reads static public HTML or text, not JavaScript-rendered pages or authenticated/provider APIs. Legacy automatic discovery and price refresh are not qualified by this work. Complete runtime monitoring, discovery/intake, truthful comparisons/briefs/recommendations/exports, remaining system/interaction records and every retained product gate. Real-provider acceptance remains deferred, and delivery stays paused.
