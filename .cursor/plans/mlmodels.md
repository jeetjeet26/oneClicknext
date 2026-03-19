# ML And Decision Systems Plan

Last Updated: March 17, 2026
Document Type: Planning guide for model feasibility, data readiness, and autonomy-sequencing requirements

## Purpose

This document is the planning companion for model and decision-system work across the platform.

It should be read as:

- a reality check on what is trainable now
- a requirements doc for the data and substrate needed before model-driven actions are trustworthy
- a sequencing guide for when models should remain heuristic, recommendation-only, supervised, or fully deferred

It should not be read as permission to bypass the shared substrate described in `.cursor/plans/PROJECT_IMPLEMENTATION_GUIDE.md`.

## Core Interpretation

The project is not bottlenecked by lack of model ideas. It is bottlenecked by:

- data quality
- outcome capture
- shared action and approval history
- trusted product surfaces
- a generic substrate that can carry decisions across products

Therefore:

- the first job of ML planning is not "choose advanced algorithms"
- the first job is "only train what the current data and product truth can honestly support"

## Non-Negotiable Rules

- Do not introduce a model just because it sounds sophisticated.
- Do not build a parallel ML-only action logging stack outside the shared substrate.
- Do not claim closed-loop optimization until delayed business outcomes are captured and attributable.
- Do not make portfolio-level orchestration the first meaningful ML deliverable.
- Human review data must be first-class: `approved`, `denied`, and `modified` decisions with preserved reasoning are part of the training and policy dataset.

## Current Data Reality

Current practical read on data availability:

| Surface | Current signal | Planning implication |
|---|---|---|
| `leads`, `tour_bookings`, `lead_scores`, engagement events | Most promising current signal | LeadPulse is the closest model to genuinely trainable |
| `content_drafts` and publishing data | Thin | Content optimization must begin as recommendation logic or online learning after the publishing pipeline is active |
| `fact_marketing_performance` and BI imports | Thin but usable for early experimentation | Ad optimization should start as recommendation/bandit logic, not heavy RL |
| `competitors` and brand-intelligence data | Thin | PropertyAudit should start with deterministic/zero-shot methods, not fine-tuning |
| resident / lease / PMS data | Missing | ChurnSignal is blocked |
| human review and approval history | Not yet generic across products | Preference learning and orchestrator training are downstream of substrate work |

Bottom line:

- one or two domain models are plausible soon
- most portfolio-level learning ideas are still substrate- and label-constrained

## Revised Algorithm Map

| Domain | Recommended approach now | Not yet justified |
|---|---|---|
| LeadPulse | Global calibrated `LightGBM` or discrete-time hazard framing on lead outcomes | per-property models too early |
| PropertyAudit entity matching | zero-shot embeddings + fuzzy matching hybrid | fine-tuning until labeled pairs exist |
| Content Optimizer | contextual bandit or hierarchical Thompson sampling | large arm-space isolated per-property bandits without cross-property learning |
| AdForge V1 | recommendation-first Thompson sampling or contextual bandit | PPO / simulator-heavy RL |
| AdForge later | Bayesian optimization after more campaign-day history exists | continuous-control RL before enough data |
| ChurnSignal | deferred until PMS integration, likely tree-based survival or discrete-time hazard | any current build before resident data exists |
| CEO Agent / orchestrator | deferred until shared substrate and real human decision history exist | early portfolio-level orchestration as the main next ML deliverable |

## Per-Model Reality Check

### LeadPulse

Current read:

- best candidate for near-term trainable ML
- still needs explicit outcome framing, calibration, and operator-trustworthy explanations

Requirements before real training:

- verify actual lead and tour label volume
- verify engagement event quality and completeness
- record score explanations and stability rules
- tie score changes to downstream workflow and real outcomes

Earliest safe mode:

- recommendation-first or operator-assist scoring

### PropertyAudit

Current read:

- useful intelligence surface now
- should remain deterministic/zero-shot before any fine-tuning push

Requirements before moving beyond hybrid matching:

- accumulate labeled entity pairs from real audit review
- preserve run snapshots and recommendation provenance
- avoid treating small label sets as fine-tuning-ready

Earliest safe mode:

- recommendation and explainable intelligence

### Content Optimizer

Current read:

- conceptually strong but data-starved
- needs real publishing and engagement loops before "optimization" means much

Requirements before real learning:

- active publishing pipeline
- engagement webhooks or comparable response capture
- durable draft, approval, schedule, publish, and outcome history
- property and brand context available in reusable form

Earliest safe mode:

- recommendation-first scheduling suggestions

### AdForge

Current read:

- recommendation logic is feasible
- heavy optimization claims are premature

Requirements before real optimization:

- stable channel normalization and BI freshness
- meaningful campaign-day history
- budget, spend, and CPL outcome capture
- business guardrails and approval path for reallocation proposals

Earliest safe mode:

- recommendation-first pacing and allocation suggestions

### ChurnSignal

Current read:

- blocked, not merely delayed

Requirements before planning resumes:

- PMS integration
- resident, lease, payment, maintenance, and engagement data
- outcome framing and retention labels

Earliest safe mode:

- none until PMS truth exists

### CEO Agent / Cross-Product Orchestrator

Current read:

- strategically compelling
- absolutely not the next thing to build

Requirements before planning can move from concept to execution:

- shared substrate already live
- at least two products using the same proposal/action/approval/outcome model
- significant human review history with approve/deny/modify plus reasoning
- reliable context snapshots
- trustworthy delayed-outcome capture

Earliest safe mode:

- structured recommendation packaging after the substrate exists, not before

## Shared Data And Substrate Requirements

The model stack should prefer generic platform tables and records over ML-only silos.

Required shared concepts:

- jobs
- proposals
- action attempts
- approvals
- policy decisions
- context snapshots
- outcomes
- prediction records
- feature snapshots
- model registry
- drift checks

Important design rule:

- if a record would matter to audit, policy, or human review, it belongs in the shared substrate even if an ML consumer also uses it

## Human Review Requirements

Every supervised decision system must support:

- `approved`
- `denied`
- `modified`

Required metadata:

- reviewer identity
- timestamps
- original proposal
- modified payload where relevant
- preserved textual rationale
- policy result at the time of review
- later execution outcome

This is not only a UX requirement. It is:

- an audit requirement
- a policy requirement
- a training-data requirement
- a future preference-learning requirement

## Promotion Requirements By Maturity

### Recommendation Mode

Required:

- explainable recommendation payload
- visible confidence or stability cues
- no hidden writes
- operator-visible degraded state

### Supervised Mode

Required:

- approve/deny/modify controls
- preserved textual reasoning
- action ledger integration
- policy evaluation before execution
- replay-safe execution path

### Bounded Auto-Action

Required:

- enough supervised evidence to justify promotion
- low incident rate
- measurable KPI or operational improvement
- rollback semantics
- clear escalation triggers back to human review

## Feasibility Read

High near-term feasibility:

- LeadPulse improvement
- PropertyAudit hybrid intelligence
- recommendation-first content or budget suggestions
- shared prediction and human-review capture once `P2` exists

Medium feasibility after substrate:

- supervised AdForge
- supervised content optimization
- narrow low-risk autonomous loops

Low near-term feasibility:

- CEO-agent-style orchestration
- RL-heavy budget optimization
- resident churn prediction without PMS data
- retraining pipelines that assume mature labels already exist

## Implementation Order

1. Finish the remaining highest-risk `P1` product proofs.
2. Build the shared `P2` substrate and generic decision history.
3. Instrument shared prediction, proposal, approval, and outcome records.
4. Train or harden the most realistic early models:
   - LeadPulse
   - PropertyAudit hybrid intelligence
   - recommendation-first content or budget systems
5. Only after that, consider orchestrator-style behavior.

## Bottom Line

The platform already has enough surface area to support serious model work, but not enough shared substrate to support serious autonomous decisioning.

The right next move is:

- substrate first
- realistic models second
- orchestration last

If this order is preserved, the ML layer is feasible and strategically valuable. If this order is reversed, the project risks building impressive model narratives on top of incomplete action and outcome truth.