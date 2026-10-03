# Phase 7 — current unfinished work

Current closeout: [Phase 7 local completion](PHASE_7_LOCAL_COMPLETION.md) supersedes the remaining local-work list below. Source coverage is now 19 source types across 15 families; proposal evaluation and bounded execution/undo are qualified in disposable local scope. Real model/client/provider acceptance and live execution remain gated. The rest of this document preserves the earlier increment's evidence.

September 24, 2026. Agency review now combines dated action evidence with explicit native work states. This locally qualified increment builds on [the observation/review workflow](PHASE_7_AGENCY_OBSERVATION.md). It grants no execution authority.

## What operators see

Recent action counts retain the seven-UTC-day window. Current unfinished work has no age cutoff: an old hold or uncertain result remains visible until its native state leaves the checked set. Counts are separate because a failed action and an unfinished item can refer to the same work. The five oldest item references are shown with the complete count, recorded date and last saved change when available. The product link opens the full work list. A manager reviews this displayed summary; the decision does not resolve any source item.

| Product | Checked native source | Included saved states |
| --- | --- | --- |
| SiteForge | Website incidents | open, acknowledged, repairing |
| ForgeStudio | Social publications | reconciling |
| ReviewFlow | Manual review publications | held (staff-reported uncertainty), awaiting_confirmation (manual preparation awaiting confirmation) |
| MarketVision | Source capture, pricing extraction, brand evidence requests | held |
| Knowledge | Search preparation requests | held |
| BI | Report delivery records | unknown and not closed |
| CRM | Transfers | needs_reconciliation |

These are nine sources across seven product families. The other twelve families retain action evidence and explicitly show that current-work checks are unavailable. Ordinary queued/running work is not classified as uncertain. Native timestamps report saved changes, not provider freshness. CRM has no suitable change timestamp, so it is explicitly unavailable. A saved status does not establish provider health or comprehensive coverage.

All projections require the property's current organization. CRM's original organization is checked through its shared job because the native transfer predates an organization column. Projections include only IDs, source/category/status/version and timestamps; source content, errors, tokens and recipient data are excluded.

The `recorded-work-v2` fingerprint includes every qualifying native row, even beyond the five displayed references. Changed source versions invalidate stale review submissions. Resolved work leaves the current list; its exact previously displayed summary remains in immutable review history. Earlier `recorded-failures-v1` reviews remain readable. Human choices are private review evidence, not business rewards, training eligibility or permission to execute.

## Qualification and schema evidence

Evidence: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase7-work-signals`.

- 35 new SQL assertions passed in isolated `phase7_work_signals_20260924`. These are projection tests with rollback and synthetic rows; missing parent dependencies were bypassed only while inserting these isolated fixtures. They do not certify the underlying product workflows.
- The existing 39 Agency SQL assertions passed in the isolated and active local databases. Role/isolation, immutable evidence, duplicate prevention and lost-reply/cancellation behavior remain qualified.
- 37 application tests and four connected browser journeys passed. The new journey uses real foreign keys, six 30-day-old held requests with no failed action, stale-review rejection, resolution and retained history. Its shared jobs are failed, with no executable queue. Disposable users/properties/jobs/contexts were cleaned up. Desktop and 390px mobile screenshots were inspected.
- Whole-console TypeScript, focused lint, schema/type stamp, schema-truth, existing RLS guard, trust-boundary and runtime hold checks passed. The refreshed static action map retains 428 actions and zero missing mappings.
- Production remains 2,858 catalog objects / 155 migrations, with zero structural or history change from the preceding Phase 7 snapshot. Production was read only.
- Local catalog changes are exactly two new functions and two changed Agency function bodies; no other objects or migration history changed. All four definitions match the isolated trial. New helpers remain service-only, invoker functions with fixed search paths; shared access checks were not modified.

Migration `20260924215029_phase_seven_current_work_signals.sql` was applied once to the isolated clone and once to active local `postgres`, without history stamping. Generated helper types preserve the previously qualified nullable-argument corrections and explicitly reflect nullable source timestamps. The frozen Phase 6 release bundle does not include either Phase 7 migration. Any hosted release requires a newly qualified explicit bundle against fresh production evidence.

## Remaining work

[Proposal-only goals/plans and retained human corrections are now qualified](PHASE_7_PROPOSAL_PLANS.md). Continue source expansion and measured proposal evaluation within the documented gates. Broader source-specific work signals must be qualified individually; missing checks stay visible. Real client/provider/host acceptance, existing-model quality, retention/erasure and live schedule cycles remain open. The specifically blocked ReviewFlow response suite was not run or recreated. No training, MFA, provider calls, sends, deployment, publishing, backlog replay or autonomous execution occurred.
