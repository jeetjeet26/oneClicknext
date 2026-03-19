# Vision: PropertyAudit

Last Updated: March 17, 2026
Document Type: Vision grounded in current implementation

## Mission

PropertyAudit measures how a property appears in AI-native discovery surfaces and turns that intelligence into actionable recommendations, reports, and future optimization inputs.

## Role In The Platform

PropertyAudit is the GEO and AI-visibility intelligence engine for the platform. It should inform strategy, content, site, and campaign decisions with a structured view of how a property is represented across model-driven discovery.

## Current Implementation Baseline

Materially implemented today:

- run, process, score, analysis, report, export, recommendation, and AI-overview routes in `app/api/propertyaudit/*`
- data-engine-backed execution in `services/data-engine/jobs/propertyaudit.py`
- job router in `services/data-engine/routers/propertyaudit_jobs.py`
- report and run UI under `components/propertyaudit/*`

Current reality:

- PropertyAudit is one of the strongest operational intelligence products in the repo
- data-engine execution and persisted progress are real
- artifact semantics and run-state handling still need cleanup before the product is autonomy-grade
- the product should still be treated as a recommendation and measurement surface, not as a direct action-control system

## End-State Vision

PropertyAudit should be a trusted intelligence product that:

- generates and manages query sets per property
- executes repeatable model/surface runs
- produces deterministic score snapshots and explainable recommendations
- exposes operator-readable progress and history
- feeds future recommendation loops with high-integrity inputs

The product should eventually behave like a recurring measurement system, not a one-off audit.

Its role in future autonomy should be narrow and honest:

- produce trustworthy visibility and recommendations
- preserve provenance and confidence
- influence actions only through the shared substrate, human review, and delayed-outcome measurement

## P1 Closure Priorities

- align export/report semantics so artifact behavior matches operator expectations
- unify run claiming and state handling across web and data-engine paths
- surface persisted progress more clearly in operator UI
- close the full local happy path with stronger repeatable validation, not just opt-in smoke

## P2 Autonomy Contract

Before autonomy can rely on PropertyAudit, the product must provide:

- stable run states and explicit job lifecycle semantics
- reproducible audit snapshots
- auditable recommendation provenance
- clear separation between completed truth and in-flight truth
- confidence boundaries before any system acts on recommendations
- recommendation-first consumption through the shared substrate rather than direct write-side automation from raw audit output
- shared context and outcome linkage so downstream actions influenced by PropertyAudit can later be evaluated against business results
- human reviewers who can approve, deny, or modify audit-driven action proposals with preserved textual reasoning when recommendations cross into real product changes

## Success Metrics

- successful run completion rate
- percentage of runs with reproducible completed artifacts
- operator trust in recommendation usefulness
- time from run start to usable report
- downstream usage of PropertyAudit outputs by other products
- percentage of audit-driven decisions that can later be linked to measurable downstream outcomes

