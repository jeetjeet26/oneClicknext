# Phase 7 — agency observation and human review

Current closeout: [Phase 7 local completion](PHASE_7_LOCAL_COMPLETION.md) supersedes the remaining local-work list below. Source coverage is now 19 source types across 15 families; proposal evaluation and bounded execution/undo are qualified in disposable local scope. Real model/client/provider acceptance and live execution remain gated. The rest of this document preserves the earlier increment's evidence.

September 24, 2026. The owner explicitly requested “Continue next phase” after Phase 6 local closeout. Phase 7 local observation development is now active. This changes work order; it does not close the real acceptance gates in [Phase 6](PHASE_6_LOCAL_COMPLETION.md) or authorize agency execution. Email/password login remains; MFA and model training remain excluded.

September 24 continuation: [current unfinished-work signals](PHASE_7_CURRENT_WORK.md) are now qualified for nine sources across seven product families. The current rule is `recorded-work-v2`; it retains the historical behavior below and adds all-age held/unconfirmed work and unresolved incidents. The original qualification figures below describe the initial increment.

September 24 follow-through: [saved follow-up plans and human corrections](PHASE_7_PROPOSAL_PLANS.md) are now locally qualified across all 19 families. The combined observation/plan suite passes seven browser journeys and 69 application tests; the current static map has 432 actions. Execution and live acceptance remain gated.

## Initial observation increment

The sidebar's **Agency review** opens `/dashboard/agency`. It shows property-scoped action evidence across 19 retained product/console families, covering the current UTC day and six preceding UTC days. Complete counts distinguish confirmed server records, failures and browser observations. A product with no records is described as having limited evidence, never as healthy, inactive or launch-ready. Organization-wide events without a property are outside this view.

The deterministic `recorded-failures-v1` rule recommends inspecting a product when at least one server-confirmed failed action exists in the window. It shows the five newest immutable failure references and the full failure count. A later success does not erase a failure from the evidence: it may concern different work. This is an operational review prompt, not a diagnosis, current incident count or business-outcome measure. The view does not yet interpret held/unconfirmed results embedded in otherwise successful recording events, evaluate provider health, or establish comprehensive recording coverage.

A current manager can save **Investigate in product**, **Keep watching**, or **No follow-up needed**, with a reason. The native transaction retains exact dated evidence, rule/version and source fingerprint, actor, property/organization and decision. It also records `agency.observation.reviewed` in a shared episode/action, with references rather than the private note. Reviews grant no execution authority. Product links let the operator inspect and follow up using existing product controls.

New server activity changes the evidence fingerprint and rejects stale submissions. A matching saved review appears with the recommendation; earlier reviews remain in complete paginated history. Browser observations do not invalidate the fingerprint. A changed human judgment is a new retained review, not an overwritten outcome or reward.

Interrupted replies keep one request identity across reloads. **Check saved review** reads the actual receipt. **Close unused request** atomically fences late arrivals with a retained cancellation; if the original already committed it returns that review instead. `agency.observation.cancelled` records this action. Private notes are not retained in browser pending-request storage. Property switches discard late responses from the earlier workspace. Current membership and manager role are rechecked in the native boundary; a former tenant's records do not transfer with a property.

## Qualification

Evidence directory: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase7-observation`.

- **39 native assertions** passed independently in `phase7_observation_20260924` and the active local console, with rollback. They cover complete dated counts, future/old/property isolation, privacy, immutable history, changed evidence, duplicate prevention, review/cancellation recovery, pagination, current role/membership, ownership transfer and rollback when action recording fails.
- **31 application tests** passed for strict commands, scoped reads, safe errors, server-derived actor, bounded requests, receipt identity and pending-request recovery. **Five recording-tool tests** passed.
- **Three connected browser journeys** passed: save/reload/change evidence/review/current-role denial; committed lost reply/unused cancellation/late arrival; and held old-property response during a property switch. Desktop and 390px mobile were inspected; no horizontal overflow.
- A rollback-only isolated load trial of 100,000 synthetic events measured the complete 19-family observation query at 69.261 ms and 66.649 ms. This measures local database work, not network latency or production capacity.
- Whole-console TypeScript and focused lint passed. Schema/type version, schema-truth, existing RLS guard, foundation trust-boundary and runtime hold checks passed. These focused checks do not replace the prior Phase 6 whole-suite evidence or certify live outcomes.
- Static action traceability now covers **428 actions with zero manual mappings**. This is source traceability, not a certificate of production recording completeness. Agency reviews remain `training_eligible=false`, with no automatic success/reward labels or data export.
- The fresh production snapshot has **2,858 catalog objects / 155 historical migrations**, matching Phase 6 with zero structural/history changes. No hosted mutation was made. Local changes are **18 added catalog objects, zero changed/removed existing objects and zero history changes**.

The migration is `20260924205814_phase_seven_agency_observation.sql`. It was tested against a new isolated clone of the qualified Phase 6 production-schema rehearsal before being applied once to active local `postgres`. It adds one private RLS-enabled review table and four service-only invoker functions with fixed search paths, plus constraints/indexes/trigger. It changes no existing access checks. Native browser/anonymous table and function access is revoked. The API supplies the authenticated actor. Review notes and snapshots remain available only through current property membership checks.

Canonical TypeScript additions come from the isolated qualified schema; the previously qualified nullable RPC argument corrections were preserved because the generator does not infer them. The existing Phase 6 release bundle remains frozen at 120 pending migrations and **does not include this Phase 7 addition**. Any future release must build and qualify an updated explicit bundle against a fresh production baseline; never blind-push or stamp absent history entries.

## Remaining Phase 7 work and gates

1. **Observation expansion:** nine native sources are now qualified in [current-work evidence](PHASE_7_CURRENT_WORK.md). Keep the twelve remaining families explicitly unchecked for current work, distinguish saved timestamps from actual provider freshness, and qualify any further source-specific interpretation.
2. **Draft plans with human corrections:** [the local workflow is implemented and qualified](PHASE_7_PROPOSAL_PLANS.md), including exact evidence, human goal/success criteria, a proposal-only vocabulary, retained corrections and recovery. Suggestions are deterministic; measured existing-model proposal evaluation remains open before any paid/live invocation.
3. **Reversible execution:** after product/platform live gates and specific permission, qualify one bounded action with server-enforced scope/budget, duplicate prevention, pause/cancel/escalation, rollback/compensation, outcome definition and intervention/cost measurement.
4. **Cross-product sequences:** only expand from proven individual actions, retaining causal evidence and separate provider/launch decisions. Model output cannot grant itself permission or redefine success.

No provider sends/spend, deployment, publishing, backlog replay, worker activation, credential replacement, model training or autonomous execution occurred. The specifically approval-blocked `reviewflow_responses.test.sql` was not run or recreated. Real client/provider/host acceptance, client-specific retention/erasure, measured existing-model quality and normal live schedule cycles remain outstanding. Source-based review judgments are not training authorization or verified commercial outcomes.
