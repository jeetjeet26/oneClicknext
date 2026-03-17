# Project Implementation Guide

Last Updated: March 16, 2026
Document Type: Execution playbook synthesized from current plan docs

## Purpose

This document is the working implementation guide to follow for the remainder of the project.

It is intentionally not a product vision doc and not a status-marketing doc. It is an execution playbook for choosing work, sequencing work, and deciding when work is actually done.

## Source Hierarchy

When documents disagree, use this order:

1. `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`
2. `docs/P0_LOCAL_CONTINUATION_CONTEXT.md`
3. `.cursor/plans/AUTONOMY_FOUNDATION_CODEBASE_GAP_REPORT_2026-03-16.md`
4. `.cursor/plans/visions/*.md`
5. touched-surface and workspace rules in `.cursor/rules/*.md`
6. older top-level README or legacy product docs only if they do not conflict with the sources above

Working interpretation:

- `P0` local-first hardening is directionally complete, but there are still concrete trust gaps that must be closed before treating the foundation as truly dependable.
- `P1` product closure is the active project phase.
- `P2` shared autonomy substrate must not begin as feature work until the pre-`P2` blockers in this guide are closed.
- `P3` constrained autonomy is explicitly downstream of `P0`, `P1`, and `P2`.

## Non-Negotiable Rules

- Do not add new autonomous write paths on top of an untrusted product surface.
- Prefer local-first progress over hosted-ops work unless a task explicitly pulls hosted work into scope.
- Preserve or improve `P0` expectations on every touched surface: property-safe auth, validation, request tracing, deterministic error handling, health-aware behavior, and tests.
- For Supabase-backed changes, verify live schema first, then use migrations, regenerated types, and schema-truth checks. Do not code against imagined schema.
- For side-effect paths, require idempotency, retry safety, auditability, and operator-visible degraded states.
- Do not treat a green narrow unit test as proof of product closure. Product closure requires at least one trustworthy happy path.
- Prefer fixing drift at the source rather than weakening checks or documenting around problems.

## How To Choose The Next Task

Use this decision order every time:

1. If a task closes a tenant-safety, auth, or visibility hole, do it first.
2. If a task makes shared setup or shared knowledge more trustworthy, do it before product polish.
3. If a task closes a real `P1` happy-path or side-effect reliability gap in a core product, do it next.
4. Only after the above are materially closed should work move into shared `P2` substrate.
5. Do not start `P3` autonomy loops until `P2` exists and the relevant product surface is already trustworthy.

## Standard Task Workflow

Every implementation task should follow this sequence:

1. Confirm which phase and tier the task belongs to.
2. Check whether the task touches schema, auth, side effects, or operator-critical happy paths.
3. If schema is involved, verify live Supabase schema first and follow the full migration and type-sync flow.
4. Make the smallest change that closes the real gap, but also fix obvious foundation drift in the touched path.
5. Add or update route tests for changed side-effect behavior.
6. Add or update local smoke coverage when the task changes a critical product happy path.
7. Run the required local gates for the changed surface.
8. Update the closest planning doc if the implementation meaningfully changes reality.

## Required Validation By Change Type

For route or service changes in `p11-platform/apps/web`:

- `npm run check:foundation`
- `npm run check:schema-types-sync`
- `npm run check:schema-truth`

Also run when relevant:

- targeted Vitest route tests for changed endpoints
- local smoke coverage for changed operator-critical flows
- any product-specific verification needed to prove the happy path or degraded path

## Execution Roadmap

### Tier 1: Immediate Structural Risk

Objective:
Close the remaining trust-boundary and enforcement gaps that make the current foundation less reliable than the roadmap implies.

Step-by-step:

1. [x] Fix property-safe auth gaps in `dashboard/overview` and `documents`.
2. [x] Scope `cron_job_runs` visibility so it is not effectively global to any authenticated user.
3. [x] Strengthen the foundation gate so critical operator paths cannot be green while key trust gaps remain.
4. [x] Make request tracing and structured logging consistent across critical side-effect routes.
5. [x] Add missing tests for the routes above and align `foundation-files.mjs` if the trusted surface changes.
6. [x] Re-run local foundation checks and keep them green before taking on new product work.

Exit criteria:

- no known property-safe auth holes in critical routes called out by the gap report
- cron visibility is tenant-safe or explicitly restricted to an allowed operator role
- foundation checks cover the intended trust surface more honestly
- critical side-effect routes consistently emit request context and structured logs

### Tier 2: Shared Input Trust

Objective:
Make shared setup and shared knowledge dependable enough that downstream products can safely consume them.

Step-by-step:

1. [x] Make Community Setup create and operate on one canonical property identity.
2. [x] Remove truth drift between `properties` and `community_profiles`.
3. [x] Ensure setup flows attach real uploaded documents and source records, not only client-side intent.
4. [x] Turn knowledge ingestion into one managed-source model across scrape, upload, and paste-text.
5. [x] Make uploads create first-class `knowledge_sources`.
6. [x] Preserve provenance for multi-URL website ingests.
7. [x] Add refresh semantics that are idempotent or versioned instead of additive and destructive.
8. [x] Add explicit brand-origin classification so existing client brand material and generated brand material can both be represented cleanly.
9. [x] Turn integration setup from manual bookkeeping into verified readiness where possible.
10. [x] Prove one deterministic local happy path for property setup plus knowledge ingestion and retrieval.

Exit criteria:

- one canonical property identity per setup journey
- setup completeness and blockers are machine-readable
- knowledge sources have provenance, freshness, and failure state
- refresh cannot silently corrupt prior knowledge truth
- downstream products can consume setup and knowledge state without guessing

### Tier 3: Product Closure

Objective:
Close the remaining `P1` gaps product by product, focusing on trust, determinism, and verified happy paths rather than breadth.

Recommended order:

1. `SiteForge`
2. `LumaLeasing`
3. `CRM Sync`, `TourSpark`, and `LeadPulse`
4. `ReviewFlow` and `ForgeStudio`
5. `BrandForge`
6. `PropertyAudit`
7. `MarketVision` and `MultiChannel BI`

#### 3A. SiteForge

Steps:

1. [x] Make edited blueprint state the exact deploy source of truth.
2. [x] Reduce placeholder preview behavior on critical blocks.
3. [x] Improve operator-visible degraded states when brand or provider context is weak.
4. [ ] Validate one real WordPress deploy and rollback path, not only simulated local smoke. (Deferred pending real target prerequisites: WordPress namespace `acf/v3` availability; last real-smoke run on 2026-03-16 failed verification on this blocker.)

Done means:

- preview truth matches deploy truth
- deploy and rollback are auditable and reversible
- at least one real-target validation path is proven

#### 3B. LumaLeasing

Steps:

1. [ ] Prove one provider-backed happy path across widget, booking, calendar sync, webhook or watch flow, and Gmail thread lifecycle. (Deferred pending healthy provider-backed test data and credentials in local environment.)
2. [x] Make webhook-dependent capability state explicit in the operator UI and status surfaces.
3. [x] Close remaining manual recovery loops for reschedule, cancel, and lifecycle repair.
4. [x] Keep duplicate-safe message and booking behavior intact through retries.

Done means:

- no silent no-op states for email or calendar dependencies
- one real end-to-end provider-backed happy path is validated
- degraded states are explicit and recoverable

#### 3C. CRM Sync, TourSpark, LeadPulse

Steps:

1. [x] Add claim-safe processing for CRM retry queues.
2. [x] Add operator replay or requeue controls for dead-lettered CRM work.
3. [x] Strengthen happy-path validation for workflow progression and recovery.
4. [x] Improve operator visibility into pending, skipped, retried, paused, and failed workflow actions.
5. [x] Tie LeadPulse score behavior more explicitly to downstream workflow outcomes and explanations.

Done means:

- no duplicate external writes across overlapping retry workers
- operators can recover dead-lettered sync work
- workflow state and scoring behavior are trustworthy in repeated local use

#### 3D. ReviewFlow And ForgeStudio

Steps:

1. [x] Close the gap between approved review responses and real provider-side post execution.
2. [x] Add stronger overlap safety for recurring review sync and scheduled publish.
3. [x] Make publish and post action records explicit and auditable.
4. [x] Distinguish partial draft generation from fully ready-to-publish drafts.
5. [x] Validate one full local flow for review sync to approval to post tracking, and one for generate to approve or schedule to publish.

Validation status (2026-03-16):
- ReviewFlow local flow (`sync/review create -> response generate -> approve -> post tracking`) passes in `e2e/local-smoke.spec.ts`.
- ForgeStudio local flow (`generate -> approve`) passes in `e2e/local-smoke.spec.ts`.
- Supporting schema/policy drift resolved:
  - Removed recursive `profiles_org_read` policy path from `profiles`.
  - Added missing `review_responses.generation_prompt` column migration to match route behavior and generated types.

Done means:

- provider-side execution is real, not implied
- overlapping workers cannot duplicate publish or post actions
- readiness, retry state, and failure classification are operator-visible

#### 3E. BrandForge

Steps:

1. [x] Replace artifact drift between promised export and actual export behavior.
2. [x] Unify export and knowledge-base embed semantics.
3. [x] Align embed logic with real generated section schema.
4. [x] Improve progress visibility for long-running generation.
5. Validate a full local flow for `analyze -> generate/edit -> export/embed`.

Progress note (2026-03-16):
- `/api/brandforge/generate-pdf` now generates and uploads a real PDF artifact (`application/pdf`, `.pdf`) instead of a JSON payload disguised as PDF output.
- Route response keeps `pdfUrl` compatibility and now also returns `exportFormat: 'pdf'`.
- Added route coverage in `app/api/brandforge/generate-pdf/route.test.ts` to verify PDF upload semantics.
- Export no longer performs hidden document ingestion side effects; knowledge-base embedding is now explicitly handled through `/api/brandforge/embed-to-kb`.
- Embed chunk extraction now matches actual generated section shapes (`logo.primary_url`, `typography.headline/body/accent`, object-or-array color structures, `photo_* .criteria`, `implementation.examples`) to prevent schema-shape drift in KB embeddings.
- `/api/brandforge/status` now exposes richer long-running progress context (`phase`, `phaseLabel`, baseline-aware `progress`, `activeSection`, `lastActivityAt`, `secondsSinceLastActivity`, `isPossiblyStalled`, and `nextRecommendedAction`) so operators can distinguish generation, review, completion, and attention-required states.

Done means:

- BrandForge produces a trustworthy artifact model
- embed behavior matches generated data reality
- downstream products can consume structured brand truth safely

#### 3F. PropertyAudit

Steps:

1. Align export and report semantics with what operators are told they are receiving.
2. Unify run-claim behavior across web and data-engine paths.
3. Surface persisted run progress more clearly in operator surfaces.
4. Make the local happy-path validation repeatable, not just opt-in or one-off.

Done means:

- run lifecycle semantics are stable
- completed artifacts are trustworthy and reproducible
- operator-visible progress matches persisted truth

#### 3G. MarketVision And MultiChannel BI

Steps:

1. Normalize channel identity across all import and reporting paths.
2. Implement or remove UI scheduler paths that do not exist in the API surface.
3. Preserve partial-failure semantics visibly instead of masking them as success.
4. Add one validated happy path for competitor ingest and insight generation.
5. Add one validated happy path for connection, import, reporting, and recurring sync.

Done means:

- channel and import state semantics are consistent
- operators can tell fresh, partial, stale, and failed states apart
- BI data is trustworthy enough to inform future optimization

### Tier 4: Shared P2 Substrate

Objective:
Build the common execution layer that every future autonomy loop will depend on.

Step-by-step:

1. Define one shared state model: `queued`, `running`, `succeeded`, `failed`, `retrying`, `cancelled`.
2. Add durable shared tables for jobs, action attempts, approvals, policy decisions, and experiment outcomes.
3. Build a shared executor that recurring cron paths and future autonomous loops both use.
4. Add an action ledger for every outbound mutation.
5. Add approval and policy-decision recording for high-risk actions.
6. Attach confidence and rollback metadata to actions and decisions.
7. Add local ops views for jobs, actions, failures, approvals, and replay.
8. Add replay and resume testing for failed jobs.
9. Define KPI and reward primitives for leads, tours, show rate, lease conversion, CAC, and occupancy impact.

Exit criteria:

- every scheduled or autonomous action is written to a shared audit model
- high-risk actions support approval mode and rollback metadata
- jobs are visible, resumable, and retry-safe
- the substrate is generic across products, not hidden inside one domain

### Tier 5: Constrained P3 Autonomy

Objective:
Launch bounded autonomy only after the platform and substrate are already trustworthy.

Step-by-step:

1. Start each loop in recommendation mode only.
2. Add supervised mode after recommendation quality is proven.
3. Keep bounded auto-action disabled until both product and substrate gates are green.
4. Add explicit policy, budget, cadence, and publish limits per loop.
5. Add holdout or control comparisons for every loop.
6. Measure KPI lift against a baseline for at least two release cycles of testing before promotion.

Recommended initial loops:

- ad budget pacing recommendations
- creative rotation recommendations
- lead workflow cadence recommendations
- low-risk review-response automation
- site or content variant testing with promotion thresholds

Exit criteria:

- every loop is bounded, auditable, and reversible
- KPI lift is measurable
- policy violations remain within acceptable thresholds

## Definition Of Done For This Project

A milestone is not complete just because code merged or one route test passed.

For any meaningful slice of work, completion requires:

1. the underlying trust boundary is preserved
2. schema truth is real and types are synced
3. side effects are deterministic under retries
4. degraded states are explicit to operators
5. route tests exist for changed behavior
6. local smoke coverage exists when the flow is operator-critical
7. local gates pass
8. planning docs are updated when repository reality changes

## Documentation Discipline

After each substantial closure item:

1. update the closest relevant vision doc if the baseline or closure priorities changed
2. update the roadmap only if phase status or phase ordering actually changed
3. update the gap report only when a documented gap is materially resolved or a more important new blocker is discovered
4. avoid reintroducing overstated "production complete" claims in README-style docs

## Default Working Queue

Unless a higher-priority user request overrides it, use this order:

1. close Tier 1 trust-boundary gaps
2. close Tier 2 shared setup and knowledge trust gaps
3. finish Tier 3 product closure in the recommended order
4. begin Tier 4 shared autonomy substrate
5. only then advance Tier 5 constrained autonomy

## Bottom Line

The project should be treated as:

- beyond early scaffolding
- in active `P1` closure
- not yet ready for shared `P2` autonomy work

The most important remaining work is not adding more AI surface area. It is making the existing platform trustworthy enough that future autonomous behavior has safe inputs, safe actions, and a shared audit substrate to stand on.
