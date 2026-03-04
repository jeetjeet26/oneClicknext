# Product Spec: ReviewFlow and ForgeStudio

Last Updated: March 2, 2026
Status: Active (automation-enabled with hardening needs)

## 1. Purpose
- ReviewFlow: synchronize and manage reviews, generate responses, and support reputation workflows.
- ForgeStudio: generate multi-format content and publishing assets.

## 2. Core Capabilities
- Review sync/analysis/respond workflows.
- Content generation pipelines for marketing channels.
- Integration touchpoints with scheduling and downstream publish paths.

## 3. Interfaces (Representative)
- ReviewFlow APIs (`/api/reviewflow/...`).
- ForgeStudio APIs (`/api/forgestudio/...`).

## 4. Operational Requirements
- Provider failures and moderation/policy constraints must be handled explicitly.
- Auto-response and auto-publish behaviors should have policy guards.
- End-to-end observability is required for scheduled autonomous tasks.

## 5. Dependencies
- External review platforms, model providers, channel publishing integrations.

## 6. Known Gaps
- Full auto-response at production reliability level remains incomplete.
- Autonomous publishing and quality-gated deployment require tighter controls.

## 7. Runbook Links
- `docs/runbooks/RUNBOOK_CRON_AND_PIPELINES.md`
- `docs/runbooks/RUNBOOK_INTEGRATIONS_AND_CREDENTIALS.md`
