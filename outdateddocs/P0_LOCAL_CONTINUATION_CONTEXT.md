# P0 Local Continuation Context

## Purpose

This note explains how to interpret the older production-readiness planning work now that the active roadmap has shifted to local-first `P0` completion.

Use this document together with:

- `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`
- `docs/PRODUCTION_READINESS_AUDIT_2025-12-15.md`
- `docs/PRODUCTION_READINESS_QUICK_CHECKLIST.md`

## Source Of Truth

For current execution priority, the source of truth is `.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md`.

That roadmap explicitly separates:

- local `P0` closure work
- deferred hosted ops work
- later product completion and autonomy work

The older production-readiness materials are still useful, but they should not be treated as the current ordering for day-to-day implementation.

## What Current P0 Means

Current `P0` is about local reproducibility and local trust, not hosted production promotion.

Already complete:

- one-command local startup
- local Supabase bootstrap
- deterministic local reset and seed fixtures
- web foundation gate
- request tracing and health checks
- tenant-safe auth hardening across critical API routes

Local `P0` closure is now complete.

## How To Read The Older Production-Readiness Plan

Treat the older production-readiness plan as three buckets:

### Deferred Hosted Ops

These are not current `P0` blockers:

- Sentry
- hosted uptime monitoring
- staged promotion flow
- backups and PITR drills
- CI enforcement
- hosted cron wiring
- cutover and rollback policy between environments

These map to deferred hosted ops, not local `P0` closure.

### Relevant Later

These remain important, but after local `P0` or when hosted cutover planning resumes:

- environment topology and cutover boundaries
- Python service contract alignment
- hosted security and operational hardening

### Decision Checkpoint

Docker scope is a checkpoint, not immediate work.

Current recommended scope:

- keep Docker for local Supabase
- keep web and data-engine running natively for now
- only expand to full-stack containers if stronger local/prod parity becomes a specific goal

## Why ETL And The Data Engine Were Not In The Immediate P0 Path

The data-engine was not abandoned. It was intentionally not made the pacing item for `P0`.

Why:

- The explicit foundation gate today exists on the web side.
- The remaining `P0` items are local verification and hardening tasks that can progress without first containerizing or fully re-architecting the Python service.
- The data-engine currently spans ETL, scraping, long-running jobs, CRM helpers, and app-facing APIs. That breadth makes it important, but also makes it a larger alignment project than the remaining local `P0` tasks.
- Some Python/data-engine work is more tightly coupled to hosted topology than to local closure.

The working rule is:

- if Python/data-engine changes are required to complete local smoke tests, cron visibility, or failure injection, do them inside `P0`
- otherwise, keep that stream adjacent and revisit it during hosted-ops hardening or `P1`

## Sentry And Monitoring Scope

Sentry is intentionally not part of the immediate queue.

That is consistent with the local-first roadmap, which defers hosted monitoring and alerting until after local `P0` closure.

## Practical Priority Rule

Ask this before taking on a task:

1. Does it improve local reproducibility, local trust, or local testability of core flows?
   If yes, it belongs in current `P0`.
2. Does it mainly improve hosted deployment safety, multi-environment ops, or production observability?
   If yes, it belongs in deferred hosted ops.
3. Does it mainly concern ETL/Python/service-boundary cleanup without blocking local `P0` flows?
   If yes, keep it out of the critical path for now.

## Recommended Next Sequence

Local smoke/e2e coverage now exists via `p11-platform/apps/web/e2e/local-smoke.spec.ts` and `npm run smoke:local`.
Cron/job visibility now exists via `cron_job_runs`, `p11-platform/apps/web/utils/services/cron-job-runs.ts`, and `GET /api/cron/runs`.
Critical public-route validation/rate limiting now covers the main anonymous LumaLeasing widget routes, including config, chat, lead capture, tour availability/booking, and the Gmail webhook.
Failure-injection coverage now verifies the local provider-down and service-down paths through `app/api/lumaleasing/tours/route.test.ts` and `app/api/cron/scrape-competitors/route.test.ts`.

Current next sequence:

1. Re-enter deferred hosted-only `P0` work when ready, starting with CI/app-gate enforcement or hosted deployment gates.
2. Reassess whether the Python/data-engine stream needs to move forward before `P1` or can stay parked until hosted-ops work resumes.
