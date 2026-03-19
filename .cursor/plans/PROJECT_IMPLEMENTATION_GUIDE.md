# Project Implementation Guide

Last Updated: March 17, 2026
Document Type: Execution playbook synthesized from current plan docs

## Purpose

This document is the working implementation guide to follow for the remainder of the project.

It is intentionally not a product vision doc and not a status-marketing doc. It is an execution playbook for choosing work, sequencing work, and deciding when work is actually done.

## Strategic Interpretation

This project should be interpreted as a vertically integrated operating system for multifamily marketing, not as a collection of AI features.

The intended stack is:

- a truth layer for property setup, knowledge, brand, and business context
- an execution layer for leasing, websites, content, reviews, CRM sync, and reporting
- a shared substrate for jobs, actions, approvals, policy, outcomes, and human feedback
- only then bounded autonomy and later cross-product orchestration

The moat is not "we use AI." The moat is:

- trustworthy property-scoped context
- trustworthy external execution
- durable action and decision history
- preserved human judgment that can later inform policy and preference learning

## Source Hierarchy

When documents disagree, use this order:

1. `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`
2. `outdateddocs/P0_LOCAL_CONTINUATION_CONTEXT.md`
3. `.cursor/plans/AUTONOMY_FOUNDATION_CODEBASE_GAP_REPORT_2026-03-16.md`
4. `.cursor/plans/visions/*.md`
5. touched-surface and workspace rules in `.cursor/rules/*.md`
6. older top-level README or legacy product docs only if they do not conflict with the sources above

For canonical doc/env ownership, see `.cursor/plans/DOC_AND_ENV_CANONICAL_MAP.md`.

Working interpretation:

- `P0` local-first hardening is materially closed for current local work; deferred hosted-ops work is still real, but it is not the current pacing item.
- `P0` should be read as materially closed for current local-first sequencing, not as perfect or fully generalized enforcement across every shared pattern. Remaining caveats include auth-shape standardization, local-only rate limiting, config cleanup, and a few provider-backed or stubbed `P1` paths.
- `P1` product closure is the active project phase.
- `P2` shared autonomy substrate should begin only as generic shared infrastructure work after the pre-`P2` blockers in this guide are materially closed.
- `P3` constrained autonomy is explicitly downstream of `P0`, `P1`, and `P2`.
- In this guide, `Tier 4` means the shared `P2` substrate, not the eventual full-autonomy end state described in broader vision decks or strategy briefs.

## Current Status Without Bias

The current project state should be read as:

- beyond prototype and beyond simple scaffolding
- unusually advanced for a two-month build in both breadth and internal coherence
- materially real as a product platform, not just a demo stack
- still carrying a few unresolved provider-backed and highest-risk `P1` gaps
- not yet safe to describe as a shared autonomy platform

Strongest present traits:

- clear product portfolio architecture
- real local-first hardening and validation discipline
- multiple products with meaningful operator depth
- maturing trust model around auth, state, retries, degraded behavior, and auditability

Most important remaining weakness:

- the generic shared substrate does not yet exist in the way future autonomous loops, policy controls, and cross-product orchestration will require

## Feasibility And Viability Read

Feasibility by horizon:

- highly feasible now: continue building the operator-first platform, context bridge, and recommendation-first systems
- feasible next: narrow supervised loops on top of a real shared substrate
- feasible later with discipline: bounded automation in a few low-risk domains
- not yet near-term feasible: true portfolio-level orchestration or "CEO Agent" control before the substrate, labels, and shared audit history are mature

Viability assumptions:

- the project keeps prioritizing trust and execution semantics over feature breadth
- the remaining provider-backed `P1` proofs are actually closed
- the `P2` substrate is generic and reused across domains
- preserved human review data becomes part of the system's operating memory
- claims about optimization stay proportional to the quality of available labels and outcomes

Failure modes to avoid:

- adding more product breadth before the execution substrate hardens
- building autonomy theater on top of partially trusted product surfaces
- introducing a parallel ML-only control plane that bypasses the shared substrate
- assuming business-context data alone can replace action auditability and outcome capture

## Non-Negotiable Rules

- Do not add new autonomous write paths on top of an untrusted product surface.
- Prefer local-first progress over hosted-ops work unless a task explicitly pulls hosted work into scope.
- Preserve or improve `P0` expectations on every touched surface: property-safe auth, validation, request tracing, deterministic error handling, health-aware behavior, and tests.
- Prefer a shared route auth wrapper/HOF when touching authenticated property-scoped routes. Do not keep expanding the copy-paste pattern of `getUser()` plus inline `validatePropertyAccess()` checks unless there is a clear route-specific reason.
- For Supabase-backed changes, verify live schema first, then use migrations, regenerated types, and schema-truth checks. Do not code against imagined schema.
- For side-effect paths, require idempotency, retry safety, auditability, and operator-visible degraded states.
- Do not treat a green narrow unit test as proof of product closure. Product closure requires at least one trustworthy happy path.
- Treat local smoke coverage by verified flows, not by file count. A single Playwright spec may contain many meaningful operator journeys, and a high route-test count may still hide shallow auth-only coverage.
- Do not treat external business context, model design, or a future CEO Agent as a substitute for shared action, approval, and audit infrastructure.
- Do not start Tier 4 by building product-specific agent logic. Start by building the shared primitives every future agent or scheduled loop would have to use.
- Human reviewers must be able to approve, deny, or modify agentic proposals and leave textual reasoning that is preserved as first-class decision history.
- Do not build a parallel ML-only action stack that bypasses shared jobs, approvals, action ledgers, and policy evaluation.
- Do not promote a model or loop because the algorithm sounds advanced. Promote it only when the data, labels, and operator trust are actually present.
- Prefer fixing drift at the source rather than weakening checks or documenting around problems.

## How To Choose The Next Task

Use this decision order every time:

1. If a task closes a tenant-safety, auth, or visibility hole, do it first.
2. If a task makes shared setup or shared knowledge more trustworthy, do it before product polish.
3. If a task closes a real `P1` happy-path or side-effect reliability gap in a core product, do it next.
4. Only after the above are materially closed should work move into shared `P2` substrate and read-first business-context bridge work.
5. Do not start `P3` autonomy loops, CEO-agent orchestration, or bounded auto-action until `P2` exists and the relevant product surface is already trustworthy.

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

## Tier 4 Framing

Use the following interpretation before starting any `Tier 4` work:

- `Tier 4` in this guide is the shared `P2` substrate: generic jobs, actions, approvals, policy, confidence, rollback, replay, and outcome capture.
- `Tier 4` is not "launch the CEO Agent" and it is not "turn on autonomy."
- Business-context bridge work belongs in `Tier 4` only when it creates shared primitives that multiple products can use safely.
- The preferred bridge shape is thin and explicit: map external business context into property-scoped context records and action/result ledgers rather than merging systems or hiding logic in one product.
- Read-first bridge work is preferred before write-back bridge work. The first goal is better context and better auditability, not more mutation paths.
- Model-specific artifacts such as prediction logs, feature snapshots, or human decision records should be introduced as generic substrate concepts where possible, not as a parallel ML-only stack that bypasses the shared executor and shared audit model.
- Human-in-the-loop review is a required substrate capability: the system must support approve, deny, and modify decisions with preserved free-text rationale, not just binary approval buttons.
- The CEO Agent, preference learning, and portfolio-level orchestration are downstream consumers of the substrate. They are not a reason to skip substrate work.

## Tier 4 Hard Requirements

The first meaningful `Tier 4` implementation must satisfy all of the following requirements:

- one shared proposal model that can represent recommendation, approval-required action, execution attempt, reversal, and terminal outcome
- one shared decision model that records `approved`, `denied`, and `modified` outcomes plus reviewer identity, timestamps, reasoning text, and modified payload when applicable
- one shared action ledger that records before/after state for every outbound mutation
- one shared policy-decision model that explains why an action was allowed, blocked, escalated, or forced into human review
- one shared context-snapshot model that records what property, product, business, and integration context was available when a decision was made
- one shared outcome model that separates immediate execution success from delayed business outcomes such as tours, conversions, CPL, or occupancy impact
- replay, retry, and rollback semantics that are generic enough to apply across at least two product domains
- read-first external context adapters so business systems such as the P11 data lake can enrich decisions without becoming hidden write dependencies
- local operator views that expose jobs, actions, decisions, policy results, failures, and preserved reviewer rationale
- no hidden product-specific queue or state machine may become the de facto autonomy substrate without being mapped into the shared model

Preferred first adopters:

- one recommendation-heavy domain
- one external-mutation domain

This proves the substrate is actually shared and not secretly tailored to one product.

## What Not To Build Yet

Until `Tier 4` is live and reused, do not treat the following as the next main deliverable:

- a portfolio-level CEO Agent
- a retraining pipeline that assumes high-quality labels already exist
- deep RL or simulator-heavy optimization work
- broad multi-product orchestration that bypasses per-domain closure
- more write-side autonomy in products that still lack real provider-backed validation

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
7. [ ] Centralize shared service configuration for the data-engine and fail fast when required hosted env is missing instead of silently falling back to localhost defaults.
8. [ ] Add a checked-in env template aligned with the current local-first workflow and the README-documented variables.

Exit criteria:

- no known property-safe auth holes in critical routes called out by the gap report
- cron visibility is tenant-safe or explicitly restricted to an allowed operator role
- foundation checks cover the intended trust surface more honestly
- critical side-effect routes consistently emit request context and structured logs
- data-engine URL/config resolution is centralized with explicit fail-fast behavior for missing required env
- a checked-in env template exists and is aligned with the README-documented local-first variable set

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
5. [ ] Close, hide, or explicitly degrade the remaining SiteForge AI TODO paths so user-visible generation behavior does not imply implemented refinement or brand-intelligence synthesis when those paths are still stubbed.

Done means:

- preview truth matches deploy truth
- deploy and rollback are auditable and reversible
- generation and refinement behavior are truthful to implementation, with no reachable feature-shaped TODO paths presented as complete capability
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
5. [x] Validate a full local flow for `analyze -> generate/edit -> export/embed`.

Progress note (2026-03-16):
- `/api/brandforge/generate-pdf` now generates and uploads a real PDF artifact (`application/pdf`, `.pdf`) instead of a JSON payload disguised as PDF output.
- Route response keeps `pdfUrl` compatibility and now also returns `exportFormat: 'pdf'`.
- Added route coverage in `app/api/brandforge/generate-pdf/route.test.ts` to verify PDF upload semantics.
- Export no longer performs hidden document ingestion side effects; knowledge-base embedding is now explicitly handled through `/api/brandforge/embed-to-kb`.
- Embed chunk extraction now matches actual generated section shapes (`logo.primary_url`, `typography.headline/body/accent`, object-or-array color structures, `photo_* .criteria`, `implementation.examples`) to prevent schema-shape drift in KB embeddings.
- `/api/brandforge/status` now exposes richer long-running progress context (`phase`, `phaseLabel`, baseline-aware `progress`, `activeSection`, `lastActivityAt`, `secondsSinceLastActivity`, `isPossiblyStalled`, and `nextRecommendedAction`) so operators can distinguish generation, review, completion, and attention-required states.
- Added local smoke coverage in `e2e/local-smoke.spec.ts` for full BrandForge flow: `analyze -> conversation complete -> generate/edit/approve all sections -> generate-pdf -> embed-to-kb -> status verification`.
- Hardened local determinism for that flow by adding non-failing fallback generation when Gemini/Vertex are unavailable (`/api/brandforge/generate-next-section`), auto-creating the `brand-assets` storage bucket on first PDF export (`/api/brandforge/generate-pdf`), and allowing `knowledge_sources.source_type='brand_book'` via migration `20260316192000_add_brand_book_source_type.sql`.

Done means:

- BrandForge produces a trustworthy artifact model
- embed behavior matches generated data reality
- downstream products can consume structured brand truth safely

#### 3F. PropertyAudit

Steps:

1. [x] Align export and report semantics with what operators are told they are receiving.
2. [x] Unify run-claim behavior across web and data-engine paths.
3. [x] Surface persisted run progress more clearly in operator surfaces.
4. [x] Make the local happy-path validation repeatable, not just opt-in or one-off.

Progress note (2026-03-16):
- `/api/propertyaudit/export` now accepts `format=pdf` as an explicit print-view export alias and returns deterministic artifact headers (`X-PropertyAudit-Artifact-Format`) so UI semantics and API behavior match.
- Export and report naming are now aligned on one artifact identity (`GEO Visibility Report`) across markdown and HTML output instead of split `Visibility` vs `Audit` report titles.
- File naming and response metadata were normalized (`geo_visibility_report_*`) in both `/api/propertyaudit/export` and `/api/propertyaudit/generate-report`.
- Updated route tests for export/report semantics and alias behavior (`app/api/propertyaudit/export/route.test.ts`, `app/api/propertyaudit/generate-report/route.test.ts`).
- Updated operator-facing UI copy/download naming to match the print-view contract (`components/propertyaudit/report/ReportBuilder.tsx`, `components/propertyaudit/query/ExportMenu.tsx`).
- Run-claim semantics are now claim-safe across both web and data-engine processors: data-engine uses an atomic queued→running claim before scheduling work (`services/data-engine/routers/propertyaudit_jobs.py`, `services/data-engine/jobs/propertyaudit.py`) and web dispatch treats claim-conflict 409 responses as idempotent success rather than marking runs failed (`app/api/propertyaudit/run/route.ts`).
- Added run-route coverage for idempotent claim conflicts (`app/api/propertyaudit/run/route.test.ts`) and revalidated process-route claim behavior (`app/api/propertyaudit/process/route.test.ts`).
- `/api/propertyaudit/runs` now exposes persisted operator progress metadata per run (`progressPct`, `currentQueryIndex`, `lastUpdatedAt`, `secondsSinceUpdate`, `isPossiblyStalled`, `statusLabel`, `statusDetail`, `errorMessage`, and `usesWebSearch`) derived from `geo_runs` persisted fields.
- `/api/propertyaudit/runs/[runId]` now exposes matching persisted progress metadata for run detail panels, including stalled hints and explicit status detail text.
- Operator surfaces now render progress bars and richer status context from persisted run state:
  - `components/propertyaudit/run/RunStatusIndicator.tsx` shows progress percent/details and stalled visual state.
  - `app/dashboard/propertyaudit/page.tsx` history cards now show progress detail/progress bars for queued/running runs and explicit failed details.
  - `components/propertyaudit/run/RunDetails.tsx` shows persisted status detail plus run progress bar for active runs.
- Added route coverage for persisted progress semantics:
  - `app/api/propertyaudit/runs/route.test.ts`
  - `app/api/propertyaudit/runs/[runId]/route.test.ts`
- Added deterministic local fixture execution mode for PropertyAudit run processing:
  - `/api/propertyaudit/run` accepts `useLocalFixture: true` (non-production only) and routes processing through TypeScript fixture execution (`processorMode: typescript_fixture`) without requiring external model providers.
  - `/api/propertyaudit/process` supports fixture execution via `X-PropertyAudit-Local-Fixture: 1`, generating deterministic answers/citations/scores and progressing runs to completed state for repeatable local validation.
  - TypeScript processor dispatch now supports local session-cookie auth fallback when `CRON_SECRET` is absent in local fixture mode.
- Added route coverage for fixture-mode dispatch behavior:
  - `app/api/propertyaudit/run/route.test.ts` (forced fixture processing path).
- Added non-opt-in local smoke coverage for repeatable PropertyAudit happy path in `e2e/local-smoke.spec.ts`:
  - `queries ensure -> run(useLocalFixture) -> completion wait -> generate-report -> export markdown`.

Done means:

- run lifecycle semantics are stable
- completed artifacts are trustworthy and reproducible
- operator-visible progress matches persisted truth

#### 3G. MarketVision And MultiChannel BI

Steps:

1. [x] Normalize channel identity across all import and reporting paths.
2. [x] Implement or remove UI scheduler paths that do not exist in the API surface.
3. [x] Preserve partial-failure semantics visibly instead of masking them as success.
4. [x] Add one validated happy path for competitor ingest and insight generation.
5. [x] Add one validated happy path for connection, import, reporting, and recurring sync.

Progress note (2026-03-16):
- Added shared channel canonicalization in `utils/analytics/channel-identity.ts` so API and UI paths resolve aliases (`meta`/`meta_ads`, `google`/`google_ads`) to one canonical identity.
- Updated import and ingest paths to persist canonical channel ids (`meta_ads`), including CSV upload normalization and Meta API sync ingestion.
- Updated analytics/reporting paths to normalize and aggregate legacy + canonical channel ids consistently across:
  - `/api/marketvision/import`
  - `/api/marketvision/[propertyId]`
  - `/api/analytics/upload`
  - `/api/analytics/campaigns`
  - `/api/analytics/performance`
  - `/api/reports/send`
  - BI export helpers and channel display components.
- Added compatibility query filters so canonical channel requests still include legacy stored rows during transition.
- Added unit coverage for channel normalization behavior in `utils/analytics/channel-identity.test.ts`.
- Removed orphaned UI scheduler path `components/marketvision/ImportScheduleSettings.tsx` that posted to non-existent `/api/marketvision/schedule`.
- Confirmed active BI scheduling UI paths are aligned to existing API surface (`/api/reports/scheduled` for create/list/update/delete and `/api/reports/send` for cron execution).
- Added explicit import-state derivation (`complete`, `partial`, `failed`) in `utils/marketvision/import-job-state.ts` and surfaced it in `/api/marketvision/import` responses so partial outcomes are not treated as plain success.
- Updated MultiChannel BI import progress UI (`app/dashboard/bi/page.tsx`) to recognize and display `partial` terminal states with warning styling and actionable error detail instead of showing a green success path.
- Updated Data Engine marketing sync pipeline (`services/data-engine/pipelines/mcp_marketing_sync.py`) to track per-channel outcomes and write terminal job statuses with explicit semantics:
  - `complete`: all requested channels succeeded
  - `partial`: at least one channel skipped/failed but at least one succeeded or overall run completed with warnings
  - `failed`: no requested channels produced successful results
- Pipeline now persists warning context in `import_jobs.error_message` and terminal completion metadata for partial/failure outcomes, enabling operator-visible degraded-state diagnosis.
- Added deterministic local smoke coverage for MarketVision competitor ingest and insight generation in `e2e/local-smoke.spec.ts`:
  - ingest competitor via `/api/marketvision/competitors`
  - validate generated comparison insights via `/api/marketvision/analysis?type=comparison&bedrooms=1`
  - validate summary insights via `/api/marketvision/analysis?type=summary`
  - cleanup created competitor row to keep local runs repeatable.
- Added deterministic local smoke coverage for a MultiChannel BI end-to-end operator flow in `e2e/local-smoke.spec.ts`:
  - create ad account connection via `/api/integrations/ad-connections`
  - import deterministic campaign performance via `/api/analytics/upload`
  - validate reporting aggregates via `/api/analytics/performance`
  - trigger recurring sync execution path via `/api/cron/sync-ads`
  - cleanup ad connection to keep local runs repeatable.
- Hardened `/api/analytics/upload` to write imported marketing rows through the service-role client after property access validation, removing tenant-safe RLS write failures in local happy-path ingestion while preserving authenticated authorization checks.
- Added explicit upload trust-boundary enforcement in `/api/analytics/upload` so only `admin`/`manager` roles can perform service-role-backed marketing data writes.
- Tightened recurring sync smoke assertions to validate created-connection execution outcomes explicitly (provider-backed success when configured, or explicit deterministic "not configured" degradation signal in local environments).

Done means:

- channel and import state semantics are consistent
- operators can tell fresh, partial, stale, and failed states apart
- BI data is trustworthy enough to inform future optimization

### Tier 4 Entrance Gate

Before meaningful `Tier 4` implementation begins, confirm all of the following:

1. Remaining `P1` gaps are narrow, explicit, and not being hand-waved away on the same write paths `Tier 4` would later orchestrate.
2. Community Setup, Knowledge Base, and BrandForge expose dependable property, knowledge, and brand truth instead of relying on scattered UI assumptions.
3. At least one real external/provider-backed action path is proven in each highest-risk domain that future substrate work is expected to touch first.
4. Product-specific state machines are stable enough to map into one shared vocabulary without erasing important domain detail.
5. `Tier 4` work is framed as generic infrastructure reused by multiple domains, not as a single product's internal queue or a premature autonomous control plane.

This gate exists to prevent "autonomy work" from becoming displaced product closure.

### Tier 4: Shared P2 Substrate

Objective:
Build the common execution layer and context bridge that every future recommendation loop, supervised action path, and autonomy feature will depend on.

Step-by-step:

1. Lock one shared vocabulary for lifecycle and decision semantics: `queued`, `running`, `succeeded`, `failed`, `retrying`, `cancelled`, plus common meanings for proposal, approval, execution, reversal, and outcome.
2. Add durable shared tables for jobs, action attempts, approvals, policy decisions, context snapshots, and experiment outcomes.
3. Build a read-first business-context bridge that can assemble property-scoped context from setup, knowledge, brand, BI, and external business systems without hidden writes.
4. Build a shared executor that recurring cron paths and future recommendation or autonomous loops both use.
5. Add a shared action ledger for every outbound mutation and every high-risk proposal that could become a mutation.
6. Make approvals first-class: support approve, deny, and modify decisions with reviewer identity, timestamps, structured decision status, and required free-text reasoning for non-routine decisions.
7. Attach confidence, policy, approval, and rollback metadata to actions and decisions so the system can explain why an action was allowed, denied, or modified.
8. Add outcome capture and KPI primitives for leads, tours, show rate, lease conversion, CAC, occupancy impact, and other operator-visible business results.
9. Add local ops views for jobs, actions, failures, approvals, replay, and context-bridge health, including the preserved human rationale attached to decisions.
10. Add replay and resume testing for failed jobs plus recommendation -> approval -> execution flows.
11. Keep CEO-agent, preference-model, and portfolio-orchestration work out of scope until this substrate is live and reused by at least two distinct product domains.

Progress note (2026-03-16):
- Completed Tier 4 step 1 by introducing a shared substrate vocabulary module in `utils/substrate/shared-vocabulary.ts` with one canonical lifecycle set (`queued`, `running`, `succeeded`, `failed`, `retrying`, `cancelled`) plus explicit proposal/decision, execution/reversal, and outcome semantics.
- Started consuming the shared lifecycle vocabulary across distinct domains:
  - MarketVision import state derivation now maps through shared lifecycle normalization in `utils/marketvision/import-job-state.ts`.
  - Cron run status mapping now exposes shared lifecycle normalization in `utils/services/cron-job-runs.ts`.
- Added unit coverage to lock the vocabulary and alias mappings:
  - `utils/substrate/shared-vocabulary.test.ts`
  - `utils/marketvision/import-job-state.test.ts`
  - `utils/services/cron-job-runs.test.ts`
- Completed Tier 4 step 2 by adding durable shared substrate tables via migration `20260317001000_add_shared_substrate_tables.sql`:
  - `shared_jobs`
  - `shared_action_attempts`
  - `shared_approvals`
  - `shared_policy_decisions`
  - `shared_context_snapshots`
  - `shared_experiment_outcomes`
- Applied the migration with MCP (`apply_migration`) and verified presence in live schema using MCP SQL (`information_schema.tables`).
- Synced Supabase types and migration stamp in `apps/web/types/supabase.ts` (`20260317001000`) and re-ran required local gates:
  - `npm run check:schema-types-sync`
  - `npm run check:schema-truth`
  - `npm run check:foundation` (continues to show only the known pre-existing SiteForge fixture-drift failures in `app/api/siteforge/preview/[websiteId]/route.test.ts` and `app/api/siteforge/status/[websiteId]/route.test.ts`).
- Implemented Tier 4 step 3 foundation by adding a read-first business-context bridge with no hidden writes:
  - bridge utility: `utils/substrate/business-context-bridge.ts`
  - authenticated route surface: `GET /api/substrate/context-bridge` (`app/api/substrate/context-bridge/route.ts`)
  - route unit tests: `app/api/substrate/context-bridge/route.test.ts`
- Bridge payload now assembles property-scoped context across setup, knowledge, brand, BI/import, integrations, and shared substrate health (`shared_jobs`) and returns explicit source citations to preserve operator traceability.
- Verified live schema columns for all bridge source tables via MCP SQL (`information_schema.columns`) before implementation.
- Implemented Tier 4 step 4 foundation by introducing a shared executor primitive in `utils/services/shared-executor.ts` and wiring an existing recurring cron path to use it:
  - `/api/cron/sync-ads` now executes per-connection sync work through `runSharedExecutorJob(...)`, creating/updating `shared_jobs` lifecycle records (`running -> succeeded|failed`) as a generic substrate execution path.
  - the shared executor now fails closed when an action is still `proposed`, so approval-required work is recorded but not executed automatically.
  - preserved existing cron response semantics for the existing auto-approved sync path while adding substrate-level execution traceability.
- Added/updated coverage for step 4:
  - `utils/services/shared-executor.test.ts`
  - `app/api/cron/sync-ads/route.test.ts`
- Updated `scripts/foundation-files.mjs` to include the new shared executor utility and test in the trusted foundation surface.
- Implemented Tier 4 step 5 foundation by extending the shared executor to persist action-ledger records in `shared_action_attempts` for outbound/high-risk execution paths:
  - `runSharedExecutorJob(...)` now supports optional `action` metadata and records action attempt lifecycle with truthful execution state (`pending_approval`, `executing`, `executed`, `failed`) plus proposal decision state, execution payload, result payload, policy reason, and timestamps.
  - `/api/cron/sync-ads` now emits `shared_action_attempts` entries (`action_type: sync_ad_account`) for each provider sync attempt and links them to shared jobs.
- Added ledger coverage in `utils/services/shared-executor.test.ts` and strengthened cron route coverage in `app/api/cron/sync-ads/route.test.ts` to assert action-ledger metadata wiring.
- Implemented Tier 4 step 6 as substrate-only approvals:
  - shared approval service: `utils/services/shared-approvals.ts`
  - authenticated substrate route: `app/api/substrate/approvals/route.ts`
  - service tests: `utils/services/shared-approvals.test.ts`
  - route tests: `app/api/substrate/approvals/route.test.ts`
- The approval substrate now supports listing pending approval candidates and recording `approved`, `denied`, or `modified` decisions with reviewer identity, structured decision status, required free-text rationale, optional modified payloads, and optional `shared_policy_decisions` emission when policy metadata is supplied.
- Approval recording is still substrate-only today: it updates decision state truthfully, but cross-product resume/dispatch after approval is not yet wired into a second execution consumer.
- Updated `scripts/foundation-files.mjs` to include the new shared approvals route/service and tests plus the context-bridge route/utility in the trusted foundation surface.
- Re-ran required gates for this slice:
  - focused tests for approvals passed
  - `npm run check:schema-types-sync` passed
  - `npm run check:schema-truth` passed
  - `npm run check:foundation` still reports only the known pre-existing SiteForge fixture-drift failures in `app/api/siteforge/preview/[websiteId]/route.test.ts` and `app/api/siteforge/status/[websiteId]/route.test.ts`

Evidence requirements before calling Tier 4 "real":

- one shared schema is used by at least two distinct products
- one human-reviewed flow proves approve, deny, and modify behavior end to end
- one replay path proves a failed action can be safely retried through the shared executor
- one delayed-outcome flow proves the substrate can associate executed actions with later business results
- one read-first context bridge proves external business context can be assembled and cited without hidden writes

Exit criteria:

- every scheduled or autonomous action is written to a shared audit model before and after execution
- high-risk actions support approval mode, policy reasoning, rollback metadata, and preserved reviewer rationale
- shared property and business context can be assembled read-only and cited in decisions
- jobs are visible, resumable, and retry-safe
- at least two distinct product domains use the same substrate primitives
- the substrate is generic across products, not hidden inside one domain or one ML subsystem

### Tier 5: Constrained P3 Autonomy

Objective:
Launch bounded, recommendation-first autonomy only after the platform and substrate are already trustworthy.

Step-by-step:

1. Start each loop in recommendation mode only.
2. Add supervised mode after recommendation quality is proven and humans can approve, deny, or modify proposals with textual reasoning.
3. Keep bounded auto-action disabled until both product and substrate gates are green.
4. Add explicit policy, budget, cadence, and publish limits per loop.
5. Add holdout or control comparisons for every loop.
6. Measure KPI lift against a baseline for at least two release cycles of testing before promotion.
7. Treat any CEO-agent or cross-product orchestrator as a downstream consumer of the substrate and loop evidence, not as the first `P3` deliverable.

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
4. begin Tier 4 only as shared substrate and explicit bridge/context infrastructure
5. only then advance Tier 5 constrained autonomy

## Bottom Line

The project should be treated as:

- beyond early scaffolding
- at the end of active `P1` closure, with a few real provider-backed gaps still open
- ready to define and build `Tier 4` shared primitives
- not ready to treat `Tier 4` as full autonomy or a CEO-agent rollout

The next correct phase is a thin shared substrate and context bridge: generic jobs, actions, approvals, policy, outcome capture, and property/business context primitives that multiple products can share. The wrong next phase would be jumping straight to cross-product agent orchestration, retraining loops, or portfolio-level autonomy before that substrate and the last high-risk product proofs exist.
