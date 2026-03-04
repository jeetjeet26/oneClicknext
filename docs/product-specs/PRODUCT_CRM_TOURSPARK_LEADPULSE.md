# Product Spec: CRM, TourSpark, LeadPulse

Last Updated: March 2, 2026
Status: Active (core revenue automation layer)

## 1. Purpose
Central lead system handling intake, scoring, workflow progression, tour scheduling, and follow-up automation.

## 2. Core Capabilities
- Lead capture and lifecycle management.
- Predictive scoring and engagement event tracking.
- Workflow automation (email/SMS cadence, stage transitions).
- Tour scheduling and booking orchestration.

## 3. Interfaces (Representative)
- Lead APIs (`/api/leads/...`)
- Workflow APIs (`/api/workflows/...`)
- LeadPulse APIs (`/api/leadpulse/...`)

## 4. Operational Requirements
- Workflow transitions must be auditable and deterministic.
- Messaging provider failures require retries and dead-letter handling.
- Scoring updates must not block core lead operations.

## 5. Dependencies
- Messaging providers (Twilio/Resend), scheduler, database, scoring logic.

## 6. Known Gaps
- End-to-end test coverage and reliability gates need expansion.
- Full autonomous progression guarantees need stronger policy controls.

## 7. Runbook Links
- `docs/runbooks/RUNBOOK_INTEGRATIONS_AND_CREDENTIALS.md`
- `docs/runbooks/RUNBOOK_CRON_AND_PIPELINES.md`
- `docs/runbooks/RUNBOOK_RELEASE_AND_DEPLOYMENT.md`
