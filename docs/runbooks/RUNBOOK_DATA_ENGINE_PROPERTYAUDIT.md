# Runbook: Data-Engine PropertyAudit Operations

Last Updated: March 2, 2026
Purpose: Safely operate PropertyAudit execution mode, fallback, and troubleshooting.

## 1. Preconditions
- Data-engine service reachable.
- API authentication configured between web and data-engine.
- Feature flag mode understood before changes.

## 2. Mode Control
- Primary mode: data-engine execution.
- Fallback mode: TypeScript processor for continuity.

## 3. Standard Validation
1. Confirm data-engine health endpoint is healthy.
2. Trigger one test PropertyAudit run.
3. Verify run transitions complete with expected artifacts.
4. Confirm report generation and persistence.

## 4. Incident Procedure
1. If runs fail repeatedly, switch to fallback mode.
2. Capture failing run IDs and logs.
3. Diagnose connector/provider errors vs internal processing errors.
4. Restore primary mode only after two successful validation runs.

## 5. Rollback and Recovery
1. Toggle feature flag to fallback mode.
2. Restart affected service(s).
3. Re-run queued critical jobs.
4. Document root cause and corrective action.

## 6. Evidence to Record
- Flag value before/after.
- Run IDs tested.
- Error signatures.
- Time to restore service.
