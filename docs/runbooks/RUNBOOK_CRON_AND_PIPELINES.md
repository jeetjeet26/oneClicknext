# Runbook: Cron and Pipeline Operations

Last Updated: March 2, 2026
Purpose: Operate and recover scheduled workflows and data pipelines.

## 1. Scope
- Scheduled API jobs.
- Data-engine scheduled tasks.
- Product automation loops dependent on cron.

## 2. Daily Operational Checks
1. Verify last successful run timestamp for each critical job.
2. Verify failure/retry counts in last 24 hours.
3. Verify queue depth and stuck `running` jobs.
4. Verify downstream dependencies (provider APIs, database).

## 3. Failure Triage
1. Identify failing job and first failure timestamp.
2. Determine category: auth, rate limit, code regression, schema mismatch, provider outage.
3. Check recent deploy/migration changes.
4. Retry once if transient; escalate if repeat failure.

## 4. Recovery Procedure
1. Pause job schedule if repeated failure causes risk.
2. Apply fix (config, credentials, code patch).
3. Backfill missed window safely.
4. Resume schedule and monitor two complete cycles.

## 5. Guardrails
- Do not run broad backfills without rate-limit and provider quota review.
- Do not enable new autonomous jobs without alerting and owner assignment.
- Keep idempotency keys or equivalent duplicate-prevention logic.

## 6. Verification Signals
- Success rate > target baseline.
- No orphaned/stuck records.
- Alert channel quiet for two consecutive runs.
