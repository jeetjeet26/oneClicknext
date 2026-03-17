# Runbook: Release and Deployment

Last Updated: March 2, 2026
Purpose: Safe, repeatable deployment of web app, data-engine, and migrations.

## 1. Preconditions
- Required environment variables are set in target environment.
- Migration files reviewed and approved.
- Deployment window and rollback owner assigned.

## 2. Release Checklist
1. Confirm branch/revision to deploy.
2. Confirm migration order and backward compatibility.
3. Run test suite and build checks.
4. Confirm critical cron and health endpoints are reachable in staging.
5. Announce deployment start and expected blast radius.

## 3. Deployment Procedure
1. Deploy database migrations first (forward-only).
2. Deploy data-engine services.
3. Deploy web application.
4. Validate health endpoints and key user journeys.
5. Re-enable scheduled jobs if they were paused.

## 4. Verification
- API health endpoint returns success.
- Login/auth and one critical workflow succeed.
- One cron job executes and records completion status.
- Error rate and latency remain within expected range.

## 5. Rollback
1. Stop/pause automations if degradation is active.
2. Roll back application deploy to previous version.
3. For schema changes: apply documented safe rollback or hotfix migration (no destructive rollback).
4. Confirm restored service health.
5. Publish incident note with root cause and follow-up actions.

## 6. Evidence to Capture
- Deploy commit/release IDs.
- Migration IDs applied.
- Verification command outputs/screenshots.
- Any deviations from standard procedure.
