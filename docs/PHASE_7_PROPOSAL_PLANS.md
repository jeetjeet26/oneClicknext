# Phase 7 — saved follow-up plans and human corrections

Current closeout: [Phase 7 local completion](PHASE_7_LOCAL_COMPLETION.md) supersedes the remaining local-work list below. Source coverage is now 19 source types across 15 families; proposal evaluation and bounded execution/undo are qualified in disposable local scope. Real model/client/provider acceptance and live execution remain gated. The rest of this document preserves the earlier increment's evidence.

September 24, 2026. The next authorized local increment after [current-work observation](PHASE_7_CURRENT_WORK.md) is implemented at `/dashboard/agency/plans`, linked from Agency review. This is a complete local draft/review workflow across all 19 retained product/console families. It does not certify whole-platform live readiness or activate agency execution.

## Operator workflow

A manager selects the property and product, states a goal and success criteria, and edits up to eight proposed steps. Deterministic initial suggestions adapt to held or unconfirmed saved work. The vocabulary is limited to inspecting saved work, checking an existing receipt, reviewing inputs and preparing a follow-up draft. No model is invoked. These are instructions for human consideration, not executable tool calls.

Each product has one current plan within a property/organization, with retained revisions. **Save draft** stores the exact goal, success criteria, steps, source evidence, actor and reason. **Record plan review** records judgment about the already saved content. Changed content must first become a new draft. **Withdraw plan** preserves the prior versions and records why follow-up was paused. Restarting a withdrawn plan requires a new draft. Every correction keeps the previous goal/steps/reason/evidence available in paginated history.

A new source fingerprint or current plan revision rejects stale submissions. The server rechecks current organization and manager role; viewers can read but cannot save. Property transfer does not expose former-tenant plans. Replies interrupted after saving recover the same revision by stable request ID. Closing an unused request retains a cancellation that fences a late original save; a committed save is returned instead. Pending browser storage contains only request IDs, scope and a hash, never the goal or private note. Property/product switches cannot fill the new selection with stale responses.

Draft, review, withdrawal and cancellation commit atomically with shared episode/action references: `agency.plan.drafted`, `agency.plan.reviewed`, `agency.plan.withdrawn`, `agency.plan.cancelled`. The shared stream excludes private plan text and reasons. The private record retains the proposal-only vocabulary/policy version, source snapshot and linked preceding revision. Human judgment is not a verified outcome or business reward. All records remain training-ineligible. No executable jobs, provider requests, budgets, permissions or approvals are reserved by this workflow, including reviewed plans.

## Qualification

Evidence directory: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase7-plans`.

- **44 rollback SQL assertions** passed independently in isolated `phase7_plans_20260924` and active local `postgres`. They cover immutable version history and corrections, exact saved-content review, source/revision conflicts, role/tenant/product isolation, schema/input restrictions, request recovery/cancellation, complete cursor history, and atomic rollback on recording failure.
- **69 focused application tests** passed across the existing observation/current-work and new plan contracts, API, service and browser-request client tests.
- **Seven connected browser journeys** passed together in `browser-final.log` (15.4s). Four cover observation/current-work; three cover plan drafting/correction/review/withdrawal, source changes/current viewer denial, lost replies/late arrival cancellation, and property/product switching. Native assertions verify the saved plan and shared records. No plan jobs are created. Disposable accounts/properties and held-work dependencies were cleaned up.
- Desktop and 390px mobile screenshots were inspected. No horizontal overflow. Whole-console TypeScript, focused lint, schema/type stamp, schema-truth, existing RLS guard, trust-boundary and runtime hold checks passed. Earlier markup/type-extraction and selector failures are retained with the final passing evidence.
- Refreshed static traceability covers **432 actions with zero missing mappings**. This does not certify production recording completeness, model quality or commercial outcomes.
- A fresh production snapshot still contains **2,858 catalog objects / 155 migrations**, with zero structural/history changes from the preceding snapshot. Production was read only.
- Local schema delta is **21 added catalog objects, zero changed/removed existing objects, zero history changes**. The three new function definitions exactly match the isolated trial. The new history table has RLS and no anonymous/authenticated table privileges; functions are service-only invokers with fixed search paths. Shared access rules were not changed.

Migration `20260924221116_phase_seven_proposal_plans.sql` was applied once to the isolated clone and once to active local `postgres`. Do not replay it or stamp absent history. The generated table/function additions preserve all prior qualified nullable type corrections. The frozen Phase 6 bundle excludes all three Phase 7 migrations; a hosted release requires a new explicit bundle qualified against a fresh production baseline.

## Remaining Phase 7 gates

The observation and human draft/review loop is locally usable. Current-work checks still cover nine sources across seven families; twelve families explicitly retain action-only coverage until their native signals are qualified. Initial plan suggestions are deterministic and have not been evaluated as model proposals. Further expansion should be driven by concrete product work and measured correction burden.

Before automatic execution: finish the relevant real product/client/provider/host acceptance, define and compare existing-model proposal quality against the frozen evaluation baseline, and qualify one specifically permitted reversible action with enforced scope/budget, duplicate prevention, pause/cancel/escalation, compensation and actual outcome/cost/intervention measurement. A reviewed plan cannot satisfy or grant these permissions. Cross-product execution follows proven individual actions. Training remains optional and requires a demonstrated gap and a separate authorized experiment; pretraining/mid-training are not prerequisites.

No MFA, provider/model calls, sends, spending, publishing, deployment, backlog replay, worker activation, credential replacement, training or autonomous execution occurred. The specifically blocked ReviewFlow response SQL suite was not run or recreated. Client-specific retention/erasure and normal live schedule-cycle acceptance also remain open. These gates do not reopen completed local Phase 5/6 work.
