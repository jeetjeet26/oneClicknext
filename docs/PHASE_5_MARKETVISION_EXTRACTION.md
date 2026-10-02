# Phase 5 — saved MarketVision source extraction

Status: locally verified; MarketVision and Phase 5 remain in progress.

Pasted source requests now retain the exact content, optional URL and operator-reported date, model/prompt contract and original unit baseline before execution. A single invocation claim prevents duplicate model calls. Private model receipts survive reloads, interrupted replies, parsing failures and explicit stopping. Recovering a retained receipt works locally while outbound execution is paused. Uncertain execution is held; it cannot automatically call the model again.

The console reviews the retained proposal and literal source quotes, shows current saved values, requires explicit candidate selection and monthly USD rental confirmation, and accepts reasoned corrections. Application commits all selected units, source/price evidence and attributed action together, preserving unselected types. Missing values stay unknown. Changed competitor or unit context requires a fresh comparison and renewed review. Failed later candidates roll back all earlier writes and evidence. Original model values remain separate from approved corrections.

Manual pasted evidence is explicitly marked as operator-supplied; it does not claim a provider fetch or change last_scraped_at. Stopped requests retain late results without applying them. Operator decisions and service outcomes have distinct principals, safe shared summaries and retained private context. Source history is scoped and paginated; failed reads remain visible.

The local receipt worker respects the outbound pause. The existing maintenance scheduler now honors manual-only monitoring and next_run_at. No production schedule was enabled.

## Verification

- 211 service/API/action cases across 34 suites; full application types, changed-file lint and schema stamp pass.
- 46 new database assertions; 795 serial rollback assertions including prior MarketVision/ForgeStudio/ReviewFlow/action regressions. The separately pending dedicated reviewflow_responses suite remains excluded.
- Three browser journeys pass: lost source/application replies with corrected preview, stale baseline/rebase, stopped late receipts and failed reads. Mobile source review inspected.
- 271 function bodies match the local schema; no fixture/orphan records remain. Existing 1,333 WARN/ERROR database findings are unchanged.
- Migration 20260919014238_phase_five_marketvision_extraction.sql applied only locally, and local types regenerated. No actual model/provider calls, hosted changes, training or exports occurred.

## Remaining work

Complete reviewed listing links and provider source acquisition, runtime monitoring receipts, source lineage/freshness, comparisons/brief/recommendation/export, and remaining interaction/system capture. Legacy listing/refresh paths are not qualified by this increment. Every other retained product remains in scope; this is not a client or autonomy readiness declaration.
