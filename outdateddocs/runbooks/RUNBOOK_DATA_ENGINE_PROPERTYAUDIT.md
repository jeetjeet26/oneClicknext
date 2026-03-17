# Runbook: Data-Engine PropertyAudit Operations

Last Updated: March 2, 2026
Purpose: Safely operate PropertyAudit execution mode, fallback, and troubleshooting.

## 1. Preconditions
- Data-engine service reachable.
- API authentication configured between web and data-engine.
- Feature flag mode understood before changes.

## 2. Mode Control
- Primary mode: data-engine execution.
- Local fallback mode: TypeScript processor only when explicitly enabled for operator/dev continuity.

## 3. Standard Validation
1. Confirm data-engine health endpoint is healthy.
2. Trigger one test PropertyAudit run.
3. Verify run transitions complete with expected artifacts.
4. Confirm report generation and persistence.

## 4. Incident Procedure
1. If runs fail repeatedly, keep the production path pointed at the data-engine and investigate the failing dispatch/worker path first.
2. Capture failing run IDs and logs.
3. Diagnose connector/provider errors vs internal processing errors.
4. Only enable local TypeScript fallback as an explicit temporary operator override in local/dev environments.
5. Restore strict data-engine mode after two successful validation runs.

## 5. Rollback and Recovery
1. Prefer restoring data-engine health rather than changing execution mode.
2. Restart affected service(s).
3. Re-run queued critical jobs.
4. Document root cause and corrective action.

## 6. Evidence to Record
- Flag value before/after.
- Run IDs tested.
- Error signatures.
- Time to restore service.
