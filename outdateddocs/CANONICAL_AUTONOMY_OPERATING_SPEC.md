# P11 Canonical Autonomy Operating Spec

Last Updated: March 2, 2026
Status: Canonical (strategy + execution source of truth)
Scope: oneClick root + p11-platform

## 1. Purpose
This document is the single source of truth for:
- autonomous agency vision,
- current implementation reality,
- software requirements and acceptance gates,
- phased execution priorities,
- operational controls and governance.

All high-level status claims elsewhere must align to this document or be treated as historical.

## 2. Vision and Non-Goals
### Vision
Build a fully autonomous real estate digital marketing agency where the platform can continuously run lead intake, campaign execution, optimization, and reporting with humans supervising exceptions.

### Non-Goals (for current scope)
- Fully removing human approval for high-risk actions (billing, compliance-sensitive comms, irreversible destructive actions).
- Launching all 50+ product ideas before core autonomy loops are reliable.

## 3. Current Reality (Code-Verified)
### Maturity
- Platform direction: autonomous agency.
- Implementation status: partial autonomy; not yet full autonomous operation.

### Verified implemented areas
- Core web app + data-engine architecture exists.
- Some cron endpoints exist (`/api/cron/scrape-competitors`, `/api/cron/publish-scheduled`, `/api/cron/knowledge-refresh`).
- Product-level functionality exists across PropertyAudit, CRM, LumaLeasing, BrandForge, and SiteForge (uneven completeness).

### Verified gaps/blockers
- Planned endpoints not yet present (`/api/cron/ml-retrain`, `/api/cron/propertyaudit-run`, `/api/cron/agent-loop`, `/api/lumaleasing/gmail/connect`).
- Planned migration set referenced in roadmap docs is not fully present in migrations directory.
- CI standardization and hard quality gates are incomplete.
- Documentation state claims are inconsistent ("production ready" vs "not production ready").

## 4. Capability Map (Target vs Current)
| Capability | Target State | Current State | Gate to Advance |
|---|---|---|---|
| Autonomous workflow orchestration | Continuous scheduled/event-driven loops | Partial cron and workflow coverage | Unified scheduler + job state model |
| Multi-channel outreach | Reliable SMS/email/calendar execution | Partial; integration wiring gaps remain | Provider verification + delivery SLO |
| Site generation and deployment | End-to-end autonomous publish | Generation mostly present; deployment gap remains | Automated deploy + rollback proof |
| Learning and optimization | Continuous model retrain/deploy loop | Planned, not fully implemented | Feature store + model registry + eval gates |
| Production operations | Observable, recoverable, test-gated | Partial; readiness blockers documented | SLOs + incident + backup restore drills |

## 5. Requirements
### Functional requirements
- Every autonomous workflow must have deterministic states: `queued`, `running`, `succeeded`, `failed`, `retrying`, `cancelled`.
- Every external action (email/SMS/post/publish) must emit an auditable action record.
- Every critical workflow must expose health and last-run metadata.
- Every product area must declare explicit ownership and rollback path.

### Non-functional requirements
- Reliability: define service-level objectives for core APIs and scheduled jobs.
- Security: secrets management, rotation policy, scoped credentials, and audit trails.
- Observability: structured logs, error monitoring, job-level metrics, alerting.
- Testability: minimum coverage thresholds for critical paths and migration safety checks.

### Compliance and policy requirements
- Fair housing and policy constraints must be encoded as pre-send guards for messaging/content decisions.
- High-risk actions require explicit approval mode until policy confidence is proven.

## 6. Phase Gates (Autonomy Maturity Model)
### Stage A: Assistive
AI supports users; humans trigger most workflows.
Exit criteria:
- Core features stable.
- No unresolved P0 security issues.

### Stage B: Supervised Autonomous
Automations run on schedule with human override.
Exit criteria:
- Job reliability metrics in place.
- Alerting and runbooks validated.

### Stage C: Constrained Autonomous
System executes routine operations within policy/limits.
Exit criteria:
- Quality gates enforced in CI.
- Rollback tested for each critical workflow.

### Stage D: Full Autonomous Operations
System handles most operations with exception-based human review.
Exit criteria:
- Measured KPI targets met for 2 consecutive release cycles.
- Incident rates and policy violations within defined thresholds.

## 7. Delivery Plan (Current Priority)
### Priority 1: Foundation hardening
- Resolve status contradictions by enforcing this canonical spec.
- Add CI quality/security/test gates.
- Complete observability and incident readiness baseline.

### Priority 2: Blocker closure
- Finish missing scheduler and endpoint wiring.
- Complete integration gaps (Twilio, Resend production domain, SiteForge deployment path).

### Priority 3: Product completion
- Finish LumaLeasing Gmail and full calendar lifecycle.
- Validate cross-product workflow transitions (CRM -> comms -> bookings -> reporting).

### Priority 4: Learning loop
- Add model lifecycle controls (registry, evaluation, rollout/rollback).
- Enable periodic retraining only after reliability and data quality gates are green.

## 8. KPI Framework
Track at minimum:
- `% autonomous executions without manual intervention`.
- `workflow success rate` and `mean time to recovery`.
- `campaign cycle time` from lead capture to action.
- `cost per qualified lead` and conversion lift.
- `policy violation rate` and false-positive suppression rate.

## 9. Governance and Source-of-Truth Policy
- This document is canonical for vision, status, and execution priorities.
- Product docs can define implementation details but cannot override maturity/status claims here.
- Runbooks are operational procedures only; they do not redefine strategy.
- Historical docs remain for traceability until explicitly archived.

## 10. Update Protocol
Every status change must include:
- verification date,
- evidence path(s) in repository,
- owner,
- impact on phase gate.

If evidence is missing, the claim remains `unverified`.

## 11. Linked Runbooks
- `docs/runbooks/RUNBOOK_RELEASE_AND_DEPLOYMENT.md`
- `docs/runbooks/RUNBOOK_CRON_AND_PIPELINES.md`
- `docs/runbooks/RUNBOOK_INTEGRATIONS_AND_CREDENTIALS.md`
- `docs/runbooks/RUNBOOK_DATA_ENGINE_PROPERTYAUDIT.md`
- `docs/runbooks/RUNBOOK_INCIDENT_RESPONSE.md`
