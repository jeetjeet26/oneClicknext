# Autonomy Foundation Codebase Gap Report

Date: 2026-03-16

## Scope

This report audits the repository against:

- `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`
- `docs/P0_LOCAL_CONTINUATION_CONTEXT.md`
- `docs/product-specs/*`
- `.cursor/rules/*`

Reviewed surfaces:

- `p11-platform/apps/web`
- `p11-platform/services/data-engine`
- `p11-platform/supabase`
- top-level docs and READMEs

Method:

- Static code and doc audit only
- Cross-check against route coverage, smoke coverage, shared services, and schema-related scripts
- Live Supabase schema spot-check via MCP SQL for core tables and for presence/absence of P2-style substrate tables

Not performed in this audit:

- Running `npm run check:foundation`
- Running Playwright or product smoke flows
- Runtime validation against live providers

## Executive Verdict

The roadmap is directionally correct, but materially ahead of the current implementation in several important places.

Headline assessment:

- `P0 local foundation` is not fully closed in code reality, even though the roadmap marks it complete.
- `P1` has substantial implemented surface area, but many products are still only partially trustworthy for repeated operator use.
- `P2 autonomy substrate` is largely absent as a shared platform layer.
- Several older product specs and top-level docs overstate completeness, production readiness, or implemented behaviors.

Most important conclusion:

The codebase is not yet ready to support a safe, auditable `P2` autonomy layer across products. The main blockers are not just missing features. They are trustworthiness gaps: tenant-safety holes, incomplete happy-path verification, fragmented job/state models, weak shared input integrity, and stale docs that imply more closure than the system currently provides.

## Overall Readiness Snapshot

| Area | Roadmap Claim | Codebase Reality | Audit Status |
|---|---|---|---|
| Local `P0` foundation | Complete | Real foundation scaffolding exists, but enforcement is incomplete and a few critical routes still violate core guardrails | Partial |
| Core `P1` product closure | In progress | Most domains have real implementations, but several still lack trustworthy end-to-end validation or deterministic side-effect handling | Partial |
| Product docs/spec alignment | Implicitly current | Newer `PRODUCT_*` docs are closer to reality; several legacy specs and README surfaces are stale or overstated | Weak |
| Shared setup and knowledge substrate | Needed for `P1` | Present but not yet dependable enough to feed autonomous systems | Partial |
| `P2` autonomy substrate | Pending | No shared jobs/actions/approvals/policy layer yet | Not started in shared form |

## Rule Audit

### `.cursor/rules/schema-truth-guardrails.mdc`

Intent is correct, but current enforcement is weaker than the rule language implies.

What is aligned:

- `check:schema-types-sync`, `check:schema-truth`, and `check:foundation` exist in `p11-platform/apps/web/package.json`.
- Generated types and schema-related scripts are part of the local foundation workflow.

What is not fully aligned:

- `p11-platform/apps/web/scripts/check-schema-truth.mjs` only scans `app/api` and `utils/services`.
- It only checks literal `.from('table')` references against `types/supabase.ts`.
- It does not verify live schema.
- It does not inspect columns, RPCs, views, raw SQL, or many Supabase-touching directories such as `utils/propertyaudit`, `utils/siteforge`, `utils/storage`, or health/config-adjacent code.

Verdict:

- Good intent, partial enforcement, not a complete schema-truth guard yet.

### `.cursor/rules/p0-foundation-product-guardrails.mdc`

Intent is correct, but the codebase still violates a few foundation expectations that the roadmap treats as closed.

Confirmed aligned:

- `api/health` exists.
- request context utilities exist.
- auth guard utilities exist.
- route tests exist across a broad surface.
- smoke coverage exists.

Current contradictions:

- `p11-platform/apps/web/app/api/dashboard/overview/route.ts` does not call `validatePropertyAccess()`.
- `p11-platform/apps/web/app/api/documents/route.ts` does not call `validatePropertyAccess()` for list/delete.
- `p11-platform/apps/web/app/api/cron/runs/route.ts` exposes global cron run visibility to any authenticated user because `cron_job_runs` is not tenant-scoped.
- `check:foundation` does not run local smoke coverage.
- request tracing and structured logging are not consistently applied across all claimed critical side-effect routes.

Verdict:

- Foundation expectations are real, but not yet consistently enforced in the shipped surface.

### `.cursor/rules/docker-local-dev-scope.mdc`

This rule is mostly aligned with the repository.

Confirmed aligned:

- `p11-platform/package.json` uses `supabase:reset` and `local:start`.
- `p11-platform/scripts/local-dev.sh` is the documented local-first entrypoint.
- Web and data-engine are still treated as native local services.

Verdict:

- Aligned.

### `.cursor/rules/p1-touched-surface-dod.mdc`

The rule is sound, but it is aspirational relative to current repo state.

Observed gaps that this rule would catch if retroactively applied:

- missing property-safe auth on some routes
- missing lease/claim patterns on some side-effect paths
- missing smoke coverage on several `P1` happy paths
- shared setup drift between product code and substrate data

Verdict:

- Good definition of done, not yet true repo-wide.

## Cross-Cutting Gaps

### 1. Tenant-Safety Is Not Consistent

Highest-risk issues:

- `p11-platform/apps/web/app/api/dashboard/overview/route.ts`
- `p11-platform/apps/web/app/api/documents/route.ts`
- `p11-platform/apps/web/app/api/cron/runs/route.ts`
- `p11-platform/apps/web/utils/services/cron-job-runs.ts`

Problems:

- `dashboard/overview` reads property-scoped data with the service client after auth but without property authorization.
- `documents` list/delete operates by `propertyId` after auth but without property authorization.
- `cron_job_runs` has no org/property scoping in live schema, and `/api/cron/runs` exposes that data to any authenticated user.

Why this matters for `P2`:

- An autonomy layer cannot be trusted on top of global or partially scoped observability and document surfaces.

### 2. Foundation Gate Coverage Is Curated, Not Complete

Relevant files:

- `p11-platform/apps/web/scripts/foundation-files.mjs`
- `p11-platform/apps/web/package.json`
- `p11-platform/apps/web/e2e/local-smoke.spec.ts`

Problems:

- `check:foundation` does not run local smoke coverage.
- Some foundation-listed routes do not have matching route tests, including `app/api/dashboard/overview/route.ts` and `app/api/documents/route.ts`.
- The foundation gate can therefore stay green while important operator paths still have auth or behavior gaps.

Why this matters for `P2`:

- Recommendation and supervised autonomy depend on high-confidence product surfaces, not a selectively green gate.

### 3. Request Context And Structured Logging Are Incomplete

Relevant examples:

- `p11-platform/apps/web/app/api/cron/knowledge-refresh/route.ts`
- `p11-platform/apps/web/app/api/cron/publish-scheduled/route.ts`
- `p11-platform/apps/web/app/api/cron/sync-ads/route.ts`
- `p11-platform/apps/web/app/api/cron/sync-reviews/route.ts`
- `p11-platform/apps/web/app/api/siteforge/deploy/[websiteId]/route.ts`
- `p11-platform/apps/web/app/api/propertyaudit/process/route.ts`

Problem:

- Request tracing exists as a shared utility, but it is not yet consistently used across important side-effect routes.

Why this matters for `P2`:

- Autonomous execution without consistent request IDs and structured logs will be hard to debug, audit, or replay.

### 4. Shared Job/Action Model Does Not Exist Yet

Live schema confirmed via MCP:

- Present: `workflow_actions`, `lead_workflows`, `workflow_definitions`, `cron_job_runs`, `geo_runs`, `import_jobs`
- Missing: generic approvals, policy decisions, experiments, shared autonomy jobs/actions tables

Problems:

- Job state models vary by product.
- `workflow_actions` is CRM-specific, not a cross-product action ledger.
- No shared approval or policy tables were found in live schema.

Why this matters for `P2`:

- This is the single biggest structural blocker to a shared autonomy substrate.

### 5. Shared Setup And Knowledge Inputs Are Not Yet Trustworthy Enough

Problems:

- setup paths can fork property identity
- document uploads are not first-class manageable knowledge sources
- website refresh is additive/duplicative rather than versioned or idempotent
- source URL preservation is lossy for multi-URL ingests
- community/profile truth is split between `properties` and `community_profiles`

Why this matters for `P2`:

- Autonomy is only as trustworthy as the property context, KB, and integration state it reads from.

## MCP Schema Snapshot

Live schema spot-checks confirmed:

- `cron_job_runs` exists with fields: `job_name`, `status`, `trigger_source`, `request_id`, timestamps, `summary`, `error`
- `documents` includes original file reference fields: `original_file_url`, `original_file_path`, `original_file_name`, `original_file_size`, `original_file_type`
- `property_brand_assets` includes `brand_book_pdf_url`, `current_step`, `current_step_name`, and `draft_section`
- `community_profiles` still exists in live schema
- no shared `approvals`, `policy_decisions`, `autonomy_jobs`, `autonomy_actions`, or similarly named tables were found

Implication:

- Some roadmap claims about repaired schema drift are true.
- The larger `P2` substrate is not yet represented in live schema.

## Product-By-Product Audit

### SiteForge

Actual status:

- Materially implemented and one of the strongest `P1` surfaces.
- Real generation, deploy, rollback, status, preview, diagnostics, and tests exist.

Confirmed strengths:

- `p11-platform/apps/web/utils/siteforge/wordpress-client.ts`
- `p11-platform/apps/web/app/api/siteforge/deploy/[websiteId]/route.ts`
- `p11-platform/apps/web/app/api/siteforge/status/[websiteId]/route.ts`
- `p11-platform/apps/web/app/api/siteforge/preview/[websiteId]/route.ts`
- `p11-platform/apps/web/e2e/local-smoke.spec.ts`

Remaining gaps:

- Edit/deploy mismatch:
  - `p11-platform/apps/web/app/api/siteforge/edit/[websiteId]/route.ts` saves `blueprint`
  - `p11-platform/apps/web/app/api/siteforge/deploy/[websiteId]/route.ts` deploys from `site_blueprint` or `pages_generated`
- Real provider validation is still optional and not proven closed in-repo.
- Preview trust is weakened by placeholder rendering in `p11-platform/apps/web/components/siteforge/ACFBlockRenderer.tsx`.
- `p11-platform/apps/web/app/api/siteforge/analyze/route.ts` can continue on fallback brand context after Brand Agent failure.

What still needs development before `P2`:

- unify edited blueprint and deployed blueprint
- complete one real WordPress deploy/rollback validation path
- reduce placeholder preview behaviors on critical blocks
- make degraded branding fallback more explicit and operator-visible

Spec drift:

- `docs/product-specs/SITEFORGE.md` is overstated
- `docs/product-specs/PRODUCT_SITEFORGE.md` is closer, but its main blocker framing is now too narrow

### LumaLeasing

Actual status:

- Large amount of real functionality exists: widget, Gmail, calendar, reconcile, watch renewal, status, duplicate-safe booking/send handling.

Confirmed strengths:

- `p11-platform/apps/web/app/api/lumaleasing/*`
- `p11-platform/apps/web/app/api/cron/calendar-ingest/route.ts`
- `p11-platform/apps/web/app/api/cron/calendar-reconcile/route.ts`
- `p11-platform/apps/web/app/api/cron/calendar-watch-renew/route.ts`
- `p11-platform/apps/web/utils/services/gmail-service.ts`
- `p11-platform/apps/web/utils/services/lumaleasing-calendar-reconcile.ts`

Remaining gaps:

- `p11-platform/apps/web/public/lumaleasing.js` relies on live availability API behavior and does not match the older “static fallback slots” spec story.
- Two-way calendar truth still depends on public webhook configuration and can silently no-op when not configured.
- No full smoke path proves booking -> calendar event -> provider mutation/watch -> reconcile -> Gmail thread lifecycle together.
- Some reschedule/cancel recovery is still effectively manual.

What still needs development before `P2`:

- explicit operator-visible activation state for watch/webhook-dependent features
- one verified provider-backed happy path across booking, Gmail, and calendar reconciliation
- clearer degraded-mode behavior when webhook/public callback is unavailable
- reduce reliance on “reply to this email” recovery for lifecycle changes

Spec drift:

- `docs/product-specs/LUMALEASING_IMPLEMENTATION_STATUS.md` is stale and still claims missing webhook/two-way sync work that now exists in code
- `docs/product-specs/PRODUCT_LUMALEASING.md` is directionally closer

### CRM / TourSpark / LeadPulse

Actual status:

- Core workflow, lead sync, scoring, and activity surfaces are real and materially implemented.

Confirmed strengths:

- `p11-platform/apps/web/utils/services/workflow-processor.ts`
- `p11-platform/apps/web/utils/services/crm-sync.ts`
- `p11-platform/apps/web/app/api/cron/crm-sync/route.ts`
- `p11-platform/apps/web/app/api/leadpulse/*`

Remaining gaps:

- `processPendingCRMSyncs()` in `p11-platform/apps/web/utils/services/crm-sync.ts` does not atomically claim retry rows before processing.
- Operator recovery for `dead_lettered` leads is weak.
- Local smoke coverage for workflow progression and CRM retry behavior is missing.

What still needs development before `P2`:

- lease/claim model for CRM retry queue
- operator replay/requeue flow
- one local happy path that proves workflow and retry behavior end to end

Spec drift:

- newer `docs/product-specs/PRODUCT_CRM_TOURSPARK_LEADPULSE.md` is more accurate than top-level README surfaces

### ReviewFlow

Actual status:

- Review sync, analysis, response drafting, approvals, tickets, and stats exist.

Confirmed strengths:

- `p11-platform/apps/web/app/api/reviewflow/*`
- `p11-platform/apps/web/app/api/cron/sync-reviews/route.ts`

Remaining gaps:

- `p11-platform/apps/web/app/api/reviewflow/respond/route.ts` still treats `post` as manual confirmation, not provider-side execution.
- Model/provider degradation collapses response quality into manual fallback.
- Review sync cron does not appear to use a stronger lease/claim execution model.

What still needs development before `P2`:

- real provider-post execution path with approval, audit, and policy checks
- stronger overlap safety for recurring sync
- better degraded behavior than coarse manual fallback

Spec drift:

- the active `PRODUCT_REVIEWFLOW_AND_FORGESTUDIO.md` doc is directionally correct that hardening remains

### ForgeStudio

Actual status:

- Strong feature surface for content generation, assets, social connections, draft management, and scheduled publish.

Confirmed strengths:

- `p11-platform/apps/web/app/api/forgestudio/*`
- `p11-platform/apps/web/app/api/cron/publish-scheduled/route.ts`

Remaining gaps:

- `publish-scheduled` does not atomically claim drafts before publish.
- `p11-platform/apps/web/app/api/forgestudio/generate/route.ts` can silently succeed without requested media if media generation fails.
- No verified local smoke path for generate -> approve/schedule -> publish.

What still needs development before `P2`:

- claim-safe scheduled publishing
- explicit draft readiness semantics when media generation fails
- one full local/provider-backed publish happy path

Spec drift:

- `PRODUCT_REVIEWFLOW_AND_FORGESTUDIO.md` is more accurate than broad “production” claims elsewhere

### BrandForge

Actual status:

- Materially implemented, but not product-complete or autonomy-ready.

Confirmed strengths:

- `p11-platform/apps/web/app/api/brandforge/*`
- `p11-platform/apps/web/components/brandforge/*`
- `p11-platform/apps/web/app/api/brandforge/status/route.ts`

Remaining gaps:

- `p11-platform/apps/web/app/api/brandforge/generate-pdf/route.ts` is still JSON export, not true PDF generation.
- `generate-pdf` writes KB document metadata as `brand_guidelines`, while `embed-to-kb` manages `brand_book`.
- `embed-to-kb` assumes section shapes that do not fully align with generated data.
- No true local smoke for `analyze -> generate/edit -> export/embed`.
- In-flight progress is still coarse.

What still needs development before `P2`:

- real export artifact, not JSON packaged as PDF flow
- unify export/embed document semantics
- validate KB embedding against actual generated section shapes
- add full local happy-path smoke

Spec drift:

- `docs/product-specs/BRANDFORGE.md` is materially outdated and self-contradictory
- `docs/product-specs/PRODUCT_BRANDFORGE.md` is much closer to current reality

### PropertyAudit

Actual status:

- Strongest `P1` candidate among the intelligence products, but still not fully closed.

Confirmed strengths:

- `p11-platform/apps/web/app/api/propertyaudit/*`
- `p11-platform/services/data-engine/jobs/propertyaudit.py`
- `p11-platform/services/data-engine/routers/propertyaudit_jobs.py`
- opt-in real smoke in `p11-platform/apps/web/e2e/local-smoke.spec.ts`

Remaining gaps:

- `p11-platform/apps/web/app/api/propertyaudit/export/route.ts` does not explicitly enforce completed-run status the way `generate-report` does.
- `generate-report` returns HTML, while product/UI language still implies PDF-grade output.
- `p11-platform/apps/web/components/propertyaudit/report/ReportBuilder.tsx` overpromises scheduling/recipient behavior relative to backend behavior.
- Python execution path still uses read-then-update run handling rather than the stronger atomic claim pattern used in the TypeScript processor.
- progress is persisted better than it is surfaced.

What still needs development before `P2`:

- unify run claim behavior across web and data-engine processors
- align export/report semantics and UI language
- surface persisted progress more clearly
- close the happy path with always-on, not opt-in-only, validation coverage

Spec drift:

- `docs/product-specs/PRODUCT_PROPERTYAUDIT.md` is broadly accurate that this is partially autonomous, but some remaining gaps are functional, not just polish

### MarketVision / MultiChannel BI

Actual status:

- Broad surface exists, but reliability and data normalization issues remain.

Confirmed strengths:

- `p11-platform/apps/web/app/api/marketvision/*`
- `p11-platform/apps/web/app/api/analytics/*`
- `p11-platform/services/data-engine/pipelines/mcp_marketing_sync.py`

Remaining gaps:

- channel normalization drift:
  - some paths write `meta`
  - others expect `meta_ads`
- `p11-platform/apps/web/components/marketvision/ImportScheduleSettings.tsx` posts to `/api/marketvision/schedule`, but that route does not exist
- partial-import behavior can be masked as successful completion
- no local smoke for competitor intel or BI imports
- risky test paths remain mostly auth-focused

What still needs development before `P2`:

- unify channel IDs across ingest and reporting
- implement or remove schedule UI path
- preserve partial-failure state explicitly
- add real import and competitor-intel happy-path validation

Spec drift:

- `docs/product-specs/PRODUCT_MARKETVISION_AND_BI_IMPORTS.md` is more realistic than top-level “production” docs

### Knowledge Base / Documents

Actual status:

- Working ingestion substrate exists, but it is not a dependable managed knowledge system yet.

Confirmed strengths:

- `p11-platform/apps/web/app/api/documents/upload/route.ts`
- `p11-platform/apps/web/app/api/documents/paste-text/route.ts`
- `p11-platform/apps/web/app/api/documents/ingest/route.ts`
- `p11-platform/apps/web/app/api/chat/route.ts`

Remaining gaps:

- `p11-platform/apps/web/app/api/documents/route.ts` lacks property-safe auth for list/delete.
- upload path stores document chunks but does not create first-class `knowledge_sources` rows.
- website refresh behavior is additive and not rollback/version aware.
- multi-URL provenance is not preserved in a way that supports faithful refresh.

What still needs development before `P2`:

- property-safe document management
- a single managed knowledge source model for upload, paste, and website ingest
- idempotent or versioned refresh semantics
- refresh failure behavior that cannot silently corrupt prior KB state

Spec drift:

- `docs/product-specs/KNOWLEDGE_BASE_FEATURES.md` overstates current management/refresh capabilities
- `docs/product-specs/PRODUCT_KNOWLEDGE_BASE.md` is a more appropriate current planning document

### Community / Property Setup

Actual status:

- UI and route substrate exists, but the operator setup journey is not yet trustworthy enough as a canonical dependency layer.

Confirmed strengths:

- `p11-platform/apps/web/app/dashboard/community/page.tsx`
- `p11-platform/apps/web/app/api/community/*`
- `p11-platform/apps/web/app/api/properties/*`

Remaining gaps:

- duplicate property risk:
  - `CommunityStep` creates early via `/api/properties/add`
  - `ReviewStep` still creates via `/api/properties/create`
- `KnowledgeStep` stores uploaded files in client state, but the create path only sends `documentCount`
- `community/profile` reads consolidated property fields, while scrape flows still write to `community_profiles`
- integration setup is partly manual status bookkeeping rather than verified connectivity
- `p11-platform/apps/web/app/api/properties/scrape-pricing/route.ts` points at `http://localhost:8001/scrape/property/refresh`, but the data-engine runs on `8000` and exposes `/scraper/*` routes

What still needs development before `P2`:

- one canonical property/setup creation path
- actual document/KB attachment during onboarding/add-property flow
- resolve `properties` vs `community_profiles` truth split
- make integration readiness verifiable, not declarative
- fix data-engine contract drift

Spec drift:

- shared setup docs are generally behind current flow mechanics and ahead of their trust level

## Documentation And Spec Drift

### Highest-Risk Stale Docs

These documents are materially misleading for current planning:

- `README.md`
- `p11-platform/README.md`
- `docs/P11_PLATFORM.md`
- `docs/product-specs/BRANDFORGE.md`
- `docs/product-specs/SITEFORGE.md`
- `docs/product-specs/LUMALEASING_IMPLEMENTATION_STATUS.md`
- `docs/product-specs/KNOWLEDGE_BASE_FEATURES.md`

Examples of stale or contradictory claims:

- products marked `Production` or `100% Complete` despite open `P1` gaps
- BrandForge claiming PDF export while code still performs JSON export
- older docs claiming no test suite, while the repo now has broad route-test coverage and smoke tests
- older docs claiming missing calendar webhook features that now exist in code
- docs claiming deployment blockers that are no longer the main blocker

### Docs That Are Closer To Reality

The newer planning-oriented docs are generally better aligned:

- `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`
- `docs/P0_LOCAL_CONTINUATION_CONTEXT.md`
- `docs/product-specs/PRODUCT_BRANDFORGE.md`
- `docs/product-specs/PRODUCT_LUMALEASING.md`
- `docs/product-specs/PRODUCT_SITEFORGE.md`
- `docs/product-specs/PRODUCT_MARKETVISION_AND_BI_IMPORTS.md`
- `docs/product-specs/PRODUCT_PROPERTYAUDIT.md`
- `docs/product-specs/PRODUCT_REVIEWFLOW_AND_FORGESTUDIO.md`
- `docs/product-specs/PRODUCT_KNOWLEDGE_BASE.md`

Even these newer docs should still be adjusted to reflect the concrete gaps called out in this report.

## P0-P1 Gap Matrix For P2 Preparation

| Domain | Must Close Before `P2` | Why |
|---|---|---|
| Platform foundation | property-safe auth holes, cron visibility scoping, smoke/gate blind spots, request-context consistency | autonomy cannot sit on top of weak trust boundaries |
| Shared substrate | generic jobs, action ledger, approvals, policy decisions, unified states | required for any shared autonomy loop |
| Shared inputs | canonical property setup, dependable KB, verified integrations | autonomy depends on trustworthy inputs |
| SiteForge | edit/deploy consistency, real deploy proof | autonomous deploys must be reversible and trusted |
| LumaLeasing | real webhook-backed validation and degraded-mode clarity | messaging/booking automation needs dependable state truth |
| CRM/LeadPulse | claim-safe retries and operator recovery | prevents duplicate outbound side effects |
| ReviewFlow | real provider posting with approval/audit | manual confirmation is not a policy-controlled action path |
| ForgeStudio | claim-safe scheduled publish and explicit media readiness | autonomous publishing requires deterministic publish state |
| BrandForge | real export, embed consistency, happy-path validation | downstream products cannot rely on ambiguous artifacts |
| PropertyAudit | consistent run claiming and artifact semantics | autonomous optimization needs trustworthy audit outputs |
| MarketVision/BI | channel normalization, partial-failure semantics, schedule wiring | analytics-driven autonomy fails if ingest truth is inconsistent |

## Recommended Pre-P2 Closure Order

### Tier 1: Immediate Structural Risk

- fix property-safe auth in `dashboard/overview` and `documents`
- tenant-scope or role-scope `cron_job_runs`
- strengthen `check:foundation` to include at least one smoke path or introduce a separate required local smoke gate
- make request context mandatory on critical side-effect routes

### Tier 2: Shared Substrate

- define shared job state model: `queued`, `running`, `succeeded`, `failed`, `retrying`, `cancelled`
- add shared job table(s), action ledger, approval records, policy-decision records
- standardize claim/lease pattern for recurring side-effect execution

### Tier 3: Shared Input Trust

- unify property setup flow so a single canonical property is created
- make KB ingestion paths first-class managed `knowledge_sources`
- fix refresh/versioning semantics
- resolve `properties` vs `community_profiles` source-of-truth split
- verify at least one real integration setup path

### Tier 4: Product Happy Paths

- close one verified local happy path for each core product:
  - SiteForge
  - LumaLeasing
  - CRM/TourSpark/LeadPulse
  - ReviewFlow/ForgeStudio
  - BrandForge
  - PropertyAudit
  - MarketVision/MultiChannel BI
  - Knowledge Base / Community setup

## Bottom Line

This repository is much closer to `P1` product closure than to `P2` autonomy readiness.

The strongest parts of the system are:

- local-first foundation scaffolding
- broad route-test coverage
- meaningful implementation depth in SiteForge, LumaLeasing, CRM, BrandForge, and PropertyAudit

The most important remaining work is not adding new autonomous logic. It is making the current platform trustworthy enough that autonomy has something safe to sit on:

- true tenant-safe boundaries
- dependable shared setup and knowledge inputs
- deterministic side-effect execution under retries
- consistent job and action audit infrastructure
- realistic docs that match what operators and future agents can actually trust
