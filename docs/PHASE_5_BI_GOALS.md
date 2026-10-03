# Phase 5 — recorded BI goals

September 23, 2026. The goal lifecycle is locally qualified. The complete BI product and holistic Phase 5 gates remain open.

Administrators and managers can create, edit, archive and restore targets for spend, impressions, clicks, provider-attributed conversions, CTR and CPA. Daily, weekly, monthly, quarterly and yearly periods are supported; the old schema rejected quarterly/yearly options already offered by the console. Targets are positive and bounded, count targets use whole numbers and percentage targets cannot exceed 100. Direction is explicit (at least/at most), warning thresholds are validated, and archived duplicates remain visible for restoration rather than silent overwrite.

Goals remain manageable when marketing data is empty or unavailable. Comparisons use the shared bi-v1 definition and require a complete matching calendar period, all accounts/channels and daily stored coverage. Weeks are Monday–Sunday in UTC. Unknown currency or denominator remains unavailable; USD matches the current BI definition. Zero safely meets a maximum target. A target or its attainment is not a verified commercial outcome.

Every successful decision atomically retains its actor/property/request identity, immutable input and before/after goal snapshots, revision and actual result. Native shared actions are bi.goal.saved, bi.goal.archived, bi.goal.restored and bi.goal.request_cancelled. All are server-confirmed and training-ineligible. Goal and history pages have full counts and source-change fences. Unrecorded pre-existing changes are explicitly described as historical gaps.

The browser retains only a pending request ID scoped to the signed-in actor and selected property. Lost replies recover the recorded result; cancelling an unused request fences a late original save and never erases a completed decision. Stale edits, permission changes and cross-property/account replay cannot overwrite another result. Failed forms stay visible. Direct legacy authenticated goal mutation is retired; the old delete endpoint directs users to archival.

Verification: 121 application cases across eight suites, 43 dedicated goal SQL assertions and 1,511 selected serial rollback assertions total, six distinct goal browser journeys, full application types, targeted lint, schema stamp, 542 native function bodies matching saved migrations, no fixture or migration-history residue, and 1,333 existing advisor findings with no additions. Browser journeys covered edit/archive/restore/history, quarterly/yearly support, lost reply/reload recovery, cancellation/late requests, stale edits, revoked manager permission and unavailable report sources. Desktop and mobile views were checked. The first test run used a bad dropdown selector; it was corrected before the successful complete run. Screenshot framing was corrected and the visual journey rerun.

Migration 20260923193116_phase_five_bi_decisions.sql was applied once to local Supabase through direct SQL. No hosted writes, real provider/model calls, client messages or training occurred. Email/password sign-in remains the user policy. Continue BI query/alert recording, pipelines and every remaining retained product; actual client/provider acceptance stays deferred.

Frozen stage: work/bi-decisions. Do not replay its full migration or reinstall this stage after later work.
