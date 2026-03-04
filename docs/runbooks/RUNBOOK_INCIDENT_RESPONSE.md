# Runbook: Incident Response (Operations)

Last Updated: March 2, 2026
Purpose: Contain and resolve production incidents for autonomous workflows.

## 1. Severity Model
- `SEV-1`: Major outage, data loss risk, security compromise.
- `SEV-2`: Critical feature degradation, high customer impact.
- `SEV-3`: Partial degradation, workaround available.

## 2. Immediate Response
1. Acknowledge incident and assign incident commander.
2. Freeze risky deploys/automations if needed.
3. Establish status channel and timestamped incident log.
4. Mitigate user impact first; investigate second.

## 3. Technical Triage
1. Identify blast radius (products, endpoints, tenants).
2. Check recent deploys/migrations/credential changes.
3. Inspect health checks, logs, and queue/job status.
4. Apply least-risk mitigation (rollback, disable feature, provider failover).

## 4. Recovery and Validation
1. Confirm service restoration using explicit checks.
2. Monitor for regression for a defined cooldown window.
3. Re-enable paused automations gradually.

## 5. Post-Incident Requirements
1. Publish incident summary within 24 hours.
2. Record root cause, contributing factors, and prevention actions.
3. Create owners and deadlines for corrective work.
4. Update relevant runbook/canonical requirements if process gaps were found.
