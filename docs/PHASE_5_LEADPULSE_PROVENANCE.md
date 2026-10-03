# Phase 5 — LeadPulse scoring evidence and recovery

September 16, 2026 (migration timestamp September 17 UTC). Locally qualified core journeys; Phase 5 and client readiness remain open.

## Delivered

- Score reads are read-only, with an explicit unscored state. Staff choose to calculate or rescore.
- Every new score stores private immutable input evidence: evaluation/creation times, normalized source, completeness flags, lead status, contributing event IDs/types/weights/origin, user-message IDs and completed-tour identities. No contact values, raw messages or event notes enter the scoring snapshot. An exact hash identifies the input. Legacy scores remain explicitly without snapshots; legacy events are not relabeled as verified receipts.
- Fixed rules `rules-v3.0-evidence` preserve the existing bounded component weights and completed-tour source parity. Timing now uses actual 24-hour, 7-day and 30-day boundaries, replacing the old floored-day comparison that called almost 48 hours “within 24 hours.” The scorer also updates the lead's displayed score/bucket atomically, fixing the stale/unscored list after successful scoring.
- Engagement recording, scoring, snapshot and operator action are atomic. A stable request returns the same receipt after lost replies. Changed input under that identity is held. Weights and origin are server-owned. SiteForge outbox and Luma conversation identities feed the same atomic recorder; these system receipts retain their real source without fabricating a user actor.
- Staff can report supported engagement and withdraw an erroneous report with a reason. The original event, old scores and reason remain; later scores exclude the withdrawn event. System events cannot be withdrawn as staff reports. Tour outcomes use their existing dedicated controls.
- Rescore runs save the entire property or explicit selection before processing. Twenty-five targets are processed per transaction; each score/snapshot/action is atomic. Run status, per-lead failures and the target manifest survive reload. The owner can continue; another authorized teammate can stop with their own attribution. Late continuation cannot revive a stopped run. Retrying failed targets creates a new attributed run and preserves the old failure history. New leads after the saved selection are not silently added.
- Staff assessments (useful / too high / too low / insufficient evidence) bind to the exact saved score and input hash. New assessments on superseded scores are held. Reasons stay private; shared history marks them as operator assessments, not verified conversions. No score weights are changed by an assessment.
- Full-property paginated search/category filters replace the first-100-only display. Reporting aggregates the complete property; repeated rescoring cannot inflate a day's lead count. The trend includes one latest score per lead per UTC day among leads scored that day, not a conversion trend. Rules are described accurately; fixed source weights are not represented as historical learned conversion rates. Component bars use their actual caps.
- Shared actions: engagement recorded/corrected, scoring started/recalculated/completed/stopped and score assessed. Decisions retain actual actors and concise before/after summaries. Training remains disabled by default. Client command identities persist as hashes/UUIDs, without storing notes or contact data, through ambiguous responses and reloads.

## Verification

- 69 service/API checks across seven suites, including Luma and SiteForge tracker regressions.
- 70 LeadPulse SQL assertions plus 252 related tour, action-history and brand-research assertions: 322 across seven serial rollback suites. Covers private privileges, immutable inputs, actual timing thresholds, event/score/history rollback, correction semantics, membership changes, coworker intervention, complete 504-lead processing, failure-only retry, truthful aggregates and exact-score assessments.
- Five isolated browser journeys: read-only opening and lost-score recovery; lost-event replay across reload and withdrawal; interrupted-run resume/stop; full-selection filtering/scoring; late-response isolation and a phone-sized drawer. Desktop and mobile screenshots reviewed.
- Four simultaneous identical engagement requests produced one score; four simultaneous batch continuations scored all 60 targets exactly once.
- Full TypeScript check and targeted lint passed. All 54 function bodies from seven session migrations match local definitions. No fixture properties or session migration-history entries remain.
- Local advisors currently show 1,365 WARN/ERROR findings. Compared with the earlier 1,363 snapshot, two additional notices concern pre-existing `property-assets` listing policy and `get_user_org_id` execution grants. This migration changes neither object; no added advisor finding references LeadPulse. Those broader existing findings are not represented as resolved.

Migration: `20260917001351_phase_five_leadpulse_provenance.sql`. Applied to local Supabase only, without migration-history insertion. No provider calls, hosted mutations, deployment, live-lead bulk rescore, training/export or outbound delivery occurred.

## Remaining gates

Real-client source/lead quality and verified downstream business outcomes are still required before treating priority assessments as outcome labels. Source/provider qualification, generic system-actor history and durable recovery of callers that still log a failed tracking handoff remain open with their owning products. Legacy engagement identity collisions are explicit reconciliation holds; old attribution or inputs are not invented. Historical outcome validation, conversion measurement and agency permission/budget/intervention gates remain in the holistic plan. Not every view, filter, copy or pre-request validation is semantically recorded by this increment. No trained model is required to use these journeys; evaluate existing rules/models first and train only if measured evidence justifies it.

Continue CRM mapping/preview/approval, deduplication, record receipts and reconciliation, then the remaining retained products. Delivery remains paused; a continuation does not authorize provider writes, backlog replay or release.
