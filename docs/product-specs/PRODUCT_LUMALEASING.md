# Product Spec: LumaLeasing

Last Updated: March 2, 2026
Status: Active (conversion automation with integration gaps)

## 1. Purpose
AI leasing assistant for lead conversation, scheduling, confirmations, and conversion support.

## 2. Core Capabilities
- Chat-based leasing assistant workflow.
- Email confirmations and outbound messaging support.
- Calendar availability and booking flows.
- Dashboard/admin controls for leasing operations.

## 3. Planned/Extended Capabilities
- Gmail thread ingestion and AI response automation.
- Two-way Google Calendar sync and token lifecycle handling.
- Enrichment of leads from conversation signals.

## 4. Interfaces (Representative)
- LumaLeasing chat and booking APIs in web app.
- OAuth/connectivity endpoints for Google integrations.
- Tour reminders and scheduling automation hooks.

## 5. Operational Requirements
- OAuth/token refresh must be observable and recoverable.
- Booking and reminder flows need retry safety and duplicate prevention.
- Calendar/webhook failures require clear fallback behavior.

## 6. Dependencies
- Google APIs (Gmail/Calendar), Resend, CRM records, scheduler.

## 7. Known Gaps
- Gmail integration and full two-way sync not fully complete.
- End-to-end QA for timezone/DST/edge cases needs consistent enforcement.

## 8. Runbook Links
- `docs/runbooks/RUNBOOK_INTEGRATIONS_AND_CREDENTIALS.md`
- `docs/runbooks/RUNBOOK_CRON_AND_PIPELINES.md`
